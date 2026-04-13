import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ErrorResponse,
  ModelsResponse,
  Env,
} from "./types.js";
import { MODEL_MAP, getModelList } from "./models.js";
import type { ProviderModel } from "./models.js";
import { checkRateLimit } from "./rate-limiter.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // ── CORS preflight ────────────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return corsResponse(new Response(null, { status: 204 }));
    }

    // ── Auth check (optional) ─────────────────────────────────────────────
    if (env.FREELLM_API_KEY) {
      const authHeader = request.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (token !== env.FREELLM_API_KEY) {
        return corsResponse(jsonError("Invalid API key", "invalid_api_key", 401));
      }
    }

    // ── Per-IP rate limiting ──────────────────────────────────────────────
    // Each caller IP gets its own independent sliding window — not a shared pool.
    // Configurable via RPM_LIMIT_PER_IP env var (default 20/min, 0 to disable).
    const clientIP =
      request.headers.get("CF-Connecting-IP") ??
      request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
      "unknown";
    const rateLimitError = await checkRateLimit(clientIP, env);
    if (rateLimitError) return rateLimitError;

    // ── Routes ────────────────────────────────────────────────────────────
    if (path === "/" || path === "/health") {
      return corsResponse(new Response(JSON.stringify({ status: "ok", service: "freellm" }), {
        headers: { "Content-Type": "application/json" },
      }));
    }

    if (path === "/v1/models" && request.method === "GET") {
      return handleModels();
    }

    if (path === "/v1/chat/completions" && request.method === "POST") {
      return handleChatCompletions(request, env);
    }

    return corsResponse(jsonError("Not found", "not_found", 404));
  },
};

// ── Handler: GET /v1/models ───────────────────────────────────────────────

function handleModels(): Response {
  const body: ModelsResponse = {
    object: "list",
    data: getModelList(),
  };
  return corsResponse(new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  }));
}

// ── Handler: POST /v1/chat/completions ───────────────────────────────────

async function handleChatCompletions(request: Request, env: Env): Promise<Response> {
  let body: ChatCompletionRequest;

  try {
    body = (await request.json()) as ChatCompletionRequest;
  } catch {
    return corsResponse(jsonError("Invalid JSON body", "invalid_request_error", 400));
  }

  if (!body.model) {
    return corsResponse(jsonError("Missing required field: model", "invalid_request_error", 400));
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return corsResponse(jsonError("Missing required field: messages", "invalid_request_error", 400));
  }

  // Resolve model entry
  const entry = MODEL_MAP.get(body.model);
  if (!entry) {
    return corsResponse(
      jsonError(
        `Unknown model: ${body.model}. Call GET /v1/models to see available models.`,
        "invalid_request_error",
        400
      )
    );
  }

  // Filter to providers that have their API key configured
  const availableProviders = entry.providers.filter((pm) => pm.provider.isAvailable(env));
  if (availableProviders.length === 0) {
    return corsResponse(
      jsonError(
        "No providers are configured for this model. Please set the required API key secrets.",
        "service_unavailable",
        503
      )
    );
  }

  const isStreaming = body.stream === true;

  if (isStreaming) {
    return handleStreamingCompletion(body, availableProviders, env);
  }
  return handleNonStreamingCompletion(body, availableProviders, env);
}

async function handleNonStreamingCompletion(
  body: ChatCompletionRequest,
  providers: ProviderModel[],
  env: Env
): Promise<Response> {
  const errors: string[] = [];

  for (const { provider, modelId } of providers) {
    try {
      const result: ChatCompletionResponse = await provider.complete({
        env,
        request: body,
        model: modelId,
      });
      return corsResponse(
        new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        })
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${provider.name}/${modelId}] ${msg}`);
      // If rate-limited or server error, try the next provider
      if (isRetryableError(msg)) {
        continue;
      }
      // Non-retryable error — stop trying this provider chain
      break;
    }
  }

  return corsResponse(
    jsonError(
      `All providers failed. Errors: ${errors.join("; ")}`,
      "service_unavailable",
      503
    )
  );
}

function handleStreamingCompletion(
  body: ChatCompletionRequest,
  providers: ProviderModel[],
  env: Env
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const errors: string[] = [];
      let succeeded = false;

      for (const { provider, modelId } of providers) {
        try {
          const providerStream = await provider.stream({
            env,
            request: body,
            model: modelId,
          });

          const reader = providerStream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          succeeded = true;
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`[${provider.name}/${modelId}] ${msg}`);
          if (isRetryableError(msg)) {
            continue;
          }
          break;
        }
      }

      if (!succeeded) {
        const errMsg = `All providers failed. Errors: ${errors.join("; ")}`;
        const encoder = new TextEncoder();
        const errChunk = {
          error: { message: errMsg, type: "service_unavailable" },
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      }

      controller.close();
    },
  });

  return corsResponse(
    new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Returns true if the error looks like a rate-limit or transient server error
 * that should trigger a fallback to the next provider.
 */
function isRetryableError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("503") ||
    lower.includes("502") ||
    lower.includes("500") ||
    lower.includes("timeout") ||
    lower.includes("overload") ||
    lower.includes("capacity")
  );
}

function jsonError(message: string, type: string, status: number): Response {
  const body: ErrorResponse = { error: { message, type } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function corsResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set(
    "Access-Control-Expose-Headers",
    "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After"
  );
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

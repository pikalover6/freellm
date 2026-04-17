import type { ChatCompletionRequest, ChatCompletionResponse, Env } from "../types.js";
import type { Provider, ProviderOptions } from "./base.js";
import { generateId, openAICompatibleFetch, buildSSEStream } from "./base.js";

// Cerebras: ultra-fast inference, 14,400 req/day
export const CEREBRAS_MODELS = [
  "llama-3.3-70b",    // Most capable Cerebras model
  "llama3.1-70b",     // Llama 3.1 70B (legacy ID)
  "llama3.1-8b",      // Fast, lightweight
] as const;

const CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions";

export class CerebrasProvider implements Provider {
  name = "cerebras";

  isAvailable(env: Env): boolean {
    return Boolean(env.CEREBRAS_API_KEY);
  }

  async complete(opts: ProviderOptions): Promise<ChatCompletionResponse> {
    const { env, request, model } = opts;
    const apiKey = env.CEREBRAS_API_KEY!;

    const body = buildBody(request, model, false);
    const res = await openAICompatibleFetch(CEREBRAS_API_URL, apiKey, body);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cerebras error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    data.model = model;
    return data;
  }

  async stream(opts: ProviderOptions): Promise<ReadableStream> {
    const { env, request, model } = opts;
    const apiKey = env.CEREBRAS_API_KEY!;

    const body = buildBody(request, model, true);
    const res = await openAICompatibleFetch(CEREBRAS_API_URL, apiKey, body);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cerebras stream error ${res.status}: ${text}`);
    }

    const id = generateId();
    return buildSSEStream(id, model, res.body!, extractDelta);
  }
}

function buildBody(
  request: ChatCompletionRequest,
  model: string,
  stream: boolean
): Record<string, unknown> {
  return {
    model,
    messages: request.messages,
    stream,
    ...(request.temperature !== undefined && { temperature: request.temperature }),
    ...(request.max_tokens !== undefined && { max_tokens: request.max_tokens }),
    ...(request.top_p !== undefined && { top_p: request.top_p }),
    ...(request.stop !== undefined && { stop: request.stop }),
  };
}

function extractDelta(data: string): string | null | "DONE" {
  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
    };
    const choice = parsed.choices?.[0];
    if (!choice) return null;
    if (choice.finish_reason === "stop" || choice.finish_reason === "length") return "DONE";
    return choice.delta?.content ?? null;
  } catch {
    return null;
  }
}

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from "../types.js";
import type { Provider, ProviderOptions } from "./base.js";
import { generateId } from "./base.js";

// Cohere — 20 req/min, 1,000 req/month
// https://docs.cohere.com/reference/chat
export const COHERE_MODELS = [
  "command-a-03-2025",      // Most capable Command model
  "command-r-plus-08-2024", // Strong reasoning
  "command-r-08-2024",      // Balanced
  "command-r7b-12-2024",    // Fast, lightweight
] as const;

const COHERE_API_URL = "https://api.cohere.com/v2/chat";

export class CohereProvider implements Provider {
  readonly name = "cohere";
  readonly #apiKey: string;

  constructor(apiKey: string) {
    this.#apiKey = apiKey;
  }

  async complete(opts: ProviderOptions): Promise<ChatCompletionResponse> {
    const { request, model } = opts;
    const body = toCohereBody(request, model, false);
    const res = await fetch(COHERE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.#apiKey}`,
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cohere error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as CohereResponse;
    return fromCohereResponse(data, model);
  }

  async stream(opts: ProviderOptions): Promise<ReadableStream<Uint8Array>> {
    const { request, model } = opts;
    const body = toCohereBody(request, model, true);
    const res = await fetch(COHERE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.#apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cohere stream error ${res.status}: ${text}`);
    }

    const id = generateId();
    const created = Math.floor(Date.now() / 1000);
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = res.body!.getReader();
        let buffer = "";
        let chunkIndex = 0;

        function sendDelta(text: string, done = false) {
          const chunk: ChatCompletionChunk = {
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: chunkIndex++,
                delta: done ? {} : { role: "assistant", content: text },
                finish_reason: done ? "stop" : null,
              },
            ],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const jsonStr = trimmed.slice(5).trim();
              if (!jsonStr || jsonStr === "[DONE]") continue;
              try {
                const event = JSON.parse(jsonStr) as CohereStreamEvent;
                if (event.type === "content-delta" && event.delta?.message?.content?.text) {
                  sendDelta(event.delta.message.content.text);
                } else if (event.type === "message-end") {
                  sendDelta("", true);
                  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                  controller.close();
                  return;
                }
              } catch {
                // skip malformed chunks
              }
            }
          }
          sendDelta("", true);
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });
  }
}

// ---- Cohere API types ----

interface CohereMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CohereBody {
  model: string;
  messages: CohereMessage[];
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
  p?: number;
  stop_sequences?: string[];
}

interface CohereResponse {
  id?: string;
  message?: {
    content?: Array<{ type: string; text: string }>;
  };
  finish_reason?: string;
  usage?: {
    tokens?: { input_tokens: number; output_tokens: number };
  };
}

interface CohereStreamEvent {
  type: string;
  delta?: {
    message?: {
      content?: { type?: string; text?: string };
    };
  };
}

function toCohereBody(
  request: ChatCompletionRequest,
  model: string,
  stream: boolean
): CohereBody {
  const messages: CohereMessage[] = request.messages.map((msg) => ({
    role: (
      msg.role === "system" ? "system" : msg.role === "assistant" ? "assistant" : "user"
    ) as "system" | "user" | "assistant",
    content:
      typeof msg.content === "string"
        ? msg.content
        : (msg.content?.map((p) => ("text" in p ? p.text ?? "" : "")).join("") ?? ""),
  }));

  const body: CohereBody = { model, messages, stream };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.max_tokens !== undefined) body.max_tokens = request.max_tokens;
  if (request.top_p !== undefined) body.p = request.top_p;
  if (request.stop) {
    body.stop_sequences = Array.isArray(request.stop) ? request.stop : [request.stop];
  }
  return body;
}

function fromCohereResponse(data: CohereResponse, model: string): ChatCompletionResponse {
  const text = data.message?.content?.map((c) => c.text).join("") ?? "";
  const inputTokens = data.usage?.tokens?.input_tokens ?? 0;
  const outputTokens = data.usage?.tokens?.output_tokens ?? 0;

  return {
    id: data.id ?? generateId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: data.finish_reason === "MAX_TOKENS" ? "length" : "stop",
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

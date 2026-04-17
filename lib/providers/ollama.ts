import type { ChatCompletionRequest, ChatCompletionResponse } from "../types.js";
import type { Provider, ProviderOptions } from "./base.js";
import { generateId, openAICompatibleFetchNoAuth, buildSSEStream } from "./base.js";

export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";

// Common Ollama model IDs (no API key)
export const OLLAMA_MODELS = [
  "llama3.2",
  "qwen2.5-coder",
  "mistral",
  "phi3",
  "gemma2",
] as const;

export class OllamaProvider implements Provider {
  readonly name = "ollama";
  readonly #apiUrl: string;

  constructor(baseUrl: string = OLLAMA_DEFAULT_BASE_URL) {
    const normalized = baseUrl.replace(/\/+$/, "");
    this.#apiUrl = `${normalized}/chat/completions`;
  }

  async complete(opts: ProviderOptions): Promise<ChatCompletionResponse> {
    const { request, model } = opts;
    const body = buildBody(request, model, false);
    const res = await openAICompatibleFetchNoAuth(this.#apiUrl, body);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    data.model = model;
    return data;
  }

  async stream(opts: ProviderOptions): Promise<ReadableStream<Uint8Array>> {
    const { request, model } = opts;
    const body = buildBody(request, model, true);
    const res = await openAICompatibleFetchNoAuth(this.#apiUrl, body);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama stream error ${res.status}: ${text}`);
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
    ...(request.tools !== undefined && { tools: request.tools }),
    ...(request.tool_choice !== undefined && { tool_choice: request.tool_choice }),
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

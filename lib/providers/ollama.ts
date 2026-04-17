import type { ChatCompletionResponse } from "../types.js";
import type { Provider, ProviderOptions } from "./base.js";
import {
  generateId,
  openAICompatibleFetchNoAuth,
  buildSSEStream,
  stripTrailingSlashes,
  buildOpenAICompatibleBody,
  extractOpenAIStreamDelta,
} from "./base.js";

export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";

// Common Ollama model IDs (no API key)
export const OLLAMA_MODELS = [
  "llama3.2",
  "qwen2.5-coder",
  "mistral",
  "phi3",
  "gemma2",
] as const;
export const OLLAMA_DEFAULT_MODEL = OLLAMA_MODELS[0];

export class OllamaProvider implements Provider {
  readonly name = "ollama";
  readonly defaultModel: string;
  readonly #apiUrl: string;

  constructor(
    baseUrl: string = OLLAMA_DEFAULT_BASE_URL,
    defaultModel: string = OLLAMA_DEFAULT_MODEL
  ) {
    const normalized = stripTrailingSlashes(baseUrl);
    this.#apiUrl = `${normalized}/chat/completions`;
    this.defaultModel = defaultModel;
  }

  async complete(opts: ProviderOptions): Promise<ChatCompletionResponse> {
    const { request, model } = opts;
    const body = buildOpenAICompatibleBody(request, model, false);
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
    const body = buildOpenAICompatibleBody(request, model, true);
    const res = await openAICompatibleFetchNoAuth(this.#apiUrl, body);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama stream error ${res.status}: ${text}`);
    }

    const id = generateId();
    return buildSSEStream(id, model, res.body!, extractOpenAIStreamDelta);
  }
}

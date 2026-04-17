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

export const LLAMACPP_DEFAULT_BASE_URL = "http://127.0.0.1:8080/v1";

// Common llama.cpp server model IDs (no API key)
export const LLAMACPP_MODELS = [
  "local-model",
  "llama-3.1-8b-instruct",
  "qwen2.5-coder-7b-instruct",
] as const;
export const LLAMACPP_DEFAULT_MODEL = LLAMACPP_MODELS[0];

export class LlamaCppProvider implements Provider {
  readonly name = "llamacpp";
  readonly defaultModel: string;
  readonly #apiUrl: string;

  constructor(
    baseUrl: string = LLAMACPP_DEFAULT_BASE_URL,
    defaultModel: string = LLAMACPP_DEFAULT_MODEL
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
      throw new Error(`llama.cpp error ${res.status}: ${text}`);
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
      throw new Error(`llama.cpp stream error ${res.status}: ${text}`);
    }

    const id = generateId();
    return buildSSEStream(id, model, res.body!, extractOpenAIStreamDelta);
  }
}

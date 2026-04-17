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

export const LMSTUDIO_DEFAULT_BASE_URL = "http://127.0.0.1:1234/v1";

// Example LM Studio model IDs (no API key)
export const LMSTUDIO_MODELS = [
  "openai/gpt-oss-20b",
  "qwen/qwen3-30b-a3b",
  "meta-llama-3.1-8b-instruct",
] as const;
export const LMSTUDIO_DEFAULT_MODEL = LMSTUDIO_MODELS[0];

export class LMStudioProvider implements Provider {
  readonly name = "lmstudio";
  readonly defaultModel: string;
  readonly #apiUrl: string;

  constructor(
    baseUrl: string = LMSTUDIO_DEFAULT_BASE_URL,
    defaultModel: string = LMSTUDIO_DEFAULT_MODEL
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
      throw new Error(`LM Studio error ${res.status}: ${text}`);
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
      throw new Error(`LM Studio stream error ${res.status}: ${text}`);
    }

    const id = generateId();
    return buildSSEStream(id, model, res.body!, extractOpenAIStreamDelta);
  }
}

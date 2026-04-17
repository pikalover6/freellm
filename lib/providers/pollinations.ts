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

export const POLLINATIONS_DEFAULT_BASE_URL = "https://text.pollinations.ai/openai";

// Pollinations free models (no API key)
export const POLLINATIONS_MODELS = [
  "openai",
  "openai-fast",
  "mistral",
  "llama",
  "qwen-coder",
] as const;
export const POLLINATIONS_DEFAULT_MODEL = POLLINATIONS_MODELS[0];

export class PollinationsProvider implements Provider {
  readonly name = "pollinations";
  readonly defaultModel: string;
  readonly #apiUrl: string;

  constructor(
    baseUrl: string = POLLINATIONS_DEFAULT_BASE_URL,
    defaultModel: string = POLLINATIONS_DEFAULT_MODEL
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
      throw new Error(`Pollinations error ${res.status}: ${text}`);
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
      throw new Error(`Pollinations stream error ${res.status}: ${text}`);
    }

    const id = generateId();
    return buildSSEStream(id, model, res.body!, extractOpenAIStreamDelta);
  }
}

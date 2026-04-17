import type {
  ClientConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ModelObject,
} from "./types.js";
import type { ModelEntry } from "./models.js";
import { createProviders, buildModelRegistry, getModelList } from "./models.js";

/**
 * Returns true if the error message suggests a transient/rate-limit failure
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

/**
 * Consume a ReadableStream of SSE data and yield parsed ChatCompletionChunks.
 */
async function* sseToChunks(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<ChatCompletionChunk> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";

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
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          yield JSON.parse(data) as ChatCompletionChunk;
        } catch {
          // skip malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Overload signatures for strong return-type inference
export interface CompletionParamsStreaming extends ChatCompletionRequest {
  stream: true;
}
export interface CompletionParamsNonStreaming extends ChatCompletionRequest {
  stream?: false;
}

export class Completions {
  readonly #registry: ModelEntry[];

  constructor(registry: ModelEntry[]) {
    this.#registry = registry;
  }

  /**
   * Create a chat completion.
   *
   * When `stream: true`, returns an `AsyncIterable<ChatCompletionChunk>`.
   * When `stream` is false or omitted, returns a `ChatCompletionResponse`.
   */
  create(params: CompletionParamsStreaming): Promise<AsyncIterable<ChatCompletionChunk>>;
  create(params: CompletionParamsNonStreaming): Promise<ChatCompletionResponse>;
  create(
    params: ChatCompletionRequest
  ): Promise<ChatCompletionResponse | AsyncIterable<ChatCompletionChunk>>;
  async create(
    params: ChatCompletionRequest
  ): Promise<ChatCompletionResponse | AsyncIterable<ChatCompletionChunk>> {
    if (!params.model) throw new Error("Missing required field: model");
    if (!params.messages?.length) throw new Error("Missing required field: messages");

    const entry = this.#registry.find((e) => e.id === params.model);
    if (!entry) {
      const available = this.#registry.map((e) => e.id).join(", ");
      throw new Error(
        `Unknown model: "${params.model}". Available models: ${available}`
      );
    }

    if (!entry.providers.length) {
      throw new Error(
        `No configured providers for model "${params.model}". ` +
          "Add the required API key(s) to your FreeLLM config."
      );
    }

    if (params.stream) {
      return this.#streamCompletion(params, entry);
    }
    return this.#nonStreamCompletion(params, entry);
  }

  async #nonStreamCompletion(
    params: ChatCompletionRequest,
    entry: ModelEntry
  ): Promise<ChatCompletionResponse> {
    const errors: string[] = [];

    for (const { provider, modelId } of entry.providers) {
      try {
        return await provider.complete({ request: params, model: modelId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`[${provider.name}/${modelId}] ${msg}`);
        if (isRetryableError(msg)) continue;
        break;
      }
    }

    throw new Error(`All providers failed. Errors: ${errors.join("; ")}`);
  }

  async #streamCompletion(
    params: ChatCompletionRequest,
    entry: ModelEntry
  ): Promise<AsyncIterable<ChatCompletionChunk>> {
    const errors: string[] = [];

    for (const { provider, modelId } of entry.providers) {
      try {
        const rawStream = await provider.stream({ request: params, model: modelId });
        return sseToChunks(rawStream);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`[${provider.name}/${modelId}] ${msg}`);
        if (isRetryableError(msg)) continue;
        break;
      }
    }

    throw new Error(`All providers failed. Errors: ${errors.join("; ")}`);
  }
}

export class Chat {
  readonly completions: Completions;

  constructor(registry: ModelEntry[]) {
    this.completions = new Completions(registry);
  }
}

/**
 * FreeLLM client — calls LLM provider APIs directly from the caller's environment
 * (browser or Node.js). Each caller uses their own API keys and IP address, so
 * rate limits are fully independent per user.
 *
 * @example
 * ```ts
 * const client = new FreeLLM({ groq: "gsk_..." });
 *
 * // Non-streaming
 * const res = await client.chat.completions.create({
 *   model: "auto",
 *   messages: [{ role: "user", content: "Hello!" }],
 * });
 * console.log(res.choices[0].message.content);
 *
 * // Streaming
 * const stream = await client.chat.completions.create({
 *   model: "auto",
 *   messages: [{ role: "user", content: "Hello!" }],
 *   stream: true,
 * });
 * for await (const chunk of stream) {
 *   process.stdout.write(chunk.choices[0].delta.content ?? "");
 * }
 * ```
 */
export class FreeLLM {
  readonly chat: Chat;
  readonly #registry: ModelEntry[];

  constructor(config: ClientConfig) {
    const active = createProviders(config);
    this.#registry = buildModelRegistry(active);
    this.chat = new Chat(this.#registry);
  }

  /** Returns a list of all models available with the configured API keys. */
  models(): ModelObject[] {
    return getModelList(this.#registry);
  }
}

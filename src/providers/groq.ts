import type { ChatCompletionRequest, ChatCompletionResponse, Env, UserKeys } from "../types.js";
import type { Provider, ProviderOptions } from "./base.js";
import { generateId, openAICompatibleFetch, buildSSEStream } from "./base.js";

// Groq model IDs — fastest inference available
export const GROQ_MODELS = [
  "llama-3.3-70b-versatile",     // Most capable, 1,000 req/day, 12k tokens/min
  "meta-llama/llama-4-maverick-17b-128e-instruct", // Llama 4 Maverick, 1,000 req/day
  "meta-llama/llama-4-scout-instruct",  // Llama 4 Scout, 1,000 req/day, 30k tokens/min
  "moonshotai/kimi-k2-instruct", // Kimi K2, 1,000 req/day
  "qwen/qwen3-32b",              // Qwen3 32B, 1,000 req/day
  "llama-3.1-8b-instant",        // Fastest, 14,400 req/day, 6k tokens/min
  "openai/gpt-oss-120b",         // GPT-OSS 120B, 1,000 req/day
  "openai/gpt-oss-20b",          // GPT-OSS 20B, 1,000 req/day
] as const;

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

export class GroqProvider implements Provider {
  name = "groq";

  isAvailable(env: Env, userKeys: UserKeys): boolean {
    return Boolean(userKeys.groq ?? env.GROQ_API_KEY);
  }

  async complete(opts: ProviderOptions): Promise<ChatCompletionResponse> {
    const { env, userKeys, request, model } = opts;
    const apiKey = (userKeys.groq ?? env.GROQ_API_KEY)!;

    const body = buildGroqBody(request, model, false);
    const res = await openAICompatibleFetch(GROQ_API_URL, apiKey, body);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Groq error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    // Normalize model name in response
    data.model = model;
    return data;
  }

  async stream(opts: ProviderOptions): Promise<ReadableStream> {
    const { env, userKeys, request, model } = opts;
    const apiKey = (userKeys.groq ?? env.GROQ_API_KEY)!;

    const body = buildGroqBody(request, model, true);
    const res = await openAICompatibleFetch(GROQ_API_URL, apiKey, body);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Groq stream error ${res.status}: ${text}`);
    }

    const id = generateId();
    return buildSSEStream(id, model, res.body!, extractGroqDelta);
  }
}

function buildGroqBody(
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

function extractGroqDelta(data: string): string | null | "DONE" {
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

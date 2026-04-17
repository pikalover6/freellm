import type { ChatCompletionRequest, ChatCompletionResponse, Env } from "../types.js";
import type { Provider, ProviderOptions } from "./base.js";
import { generateId, openAICompatibleFetch, buildSSEStream } from "./base.js";

// OpenRouter free models — 20 req/min, 50 req/day (free tier)
// https://openrouter.ai/docs
export const OPENROUTER_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-3-27b-it:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "google/gemma-3-12b-it:free",
  "google/gemma-3-4b-it:free",
  "meta-llama/llama-3.2-3b-instruct:free",
] as const;

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const SITE_URL = "https://freellm.workers.dev";
const SITE_NAME = "FreeLLM";

export class OpenRouterProvider implements Provider {
  name = "openrouter";

  isAvailable(env: Env): boolean {
    return Boolean(env.OPENROUTER_API_KEY);
  }

  async complete(opts: ProviderOptions): Promise<ChatCompletionResponse> {
    const { env, request, model } = opts;
    const apiKey = env.OPENROUTER_API_KEY!;

    const body = buildBody(request, model, false);
    const res = await openAICompatibleFetch(OPENROUTER_API_URL, apiKey, body, {
      "HTTP-Referer": SITE_URL,
      "X-Title": SITE_NAME,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    data.model = model;
    return data;
  }

  async stream(opts: ProviderOptions): Promise<ReadableStream> {
    const { env, request, model } = opts;
    const apiKey = env.OPENROUTER_API_KEY!;

    const body = buildBody(request, model, true);
    const res = await openAICompatibleFetch(OPENROUTER_API_URL, apiKey, body, {
      "HTTP-Referer": SITE_URL,
      "X-Title": SITE_NAME,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter stream error ${res.status}: ${text}`);
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

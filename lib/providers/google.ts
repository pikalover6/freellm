import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from "../types.js";
import type { Provider, ProviderOptions } from "./base.js";
import { generateId } from "./base.js";

// Google AI Studio — free tier with generous Gemma limits and Gemini Flash
// https://aistudio.google.com
export const GOOGLE_MODELS = [
  "gemini-2.5-flash",      // Best quality Gemini, 20 req/day free tier
  "gemini-2.5-flash-lite", // Lighter Gemini Flash, 20 req/day
  "gemini-2.0-flash",      // Stable Gemini 2.0, high RPM
  "gemma-3-27b-it",        // Gemma 3 27B, 14,400 req/day — very generous
  "gemma-3-12b-it",        // Gemma 3 12B, 14,400 req/day
] as const;

const GOOGLE_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export class GoogleProvider implements Provider {
  readonly name = "google";
  readonly #apiKey: string;

  constructor(apiKey: string) {
    this.#apiKey = apiKey;
  }

  async complete(opts: ProviderOptions): Promise<ChatCompletionResponse> {
    const { request, model } = opts;
    const geminiBody = toGeminiBody(request);
    const url = `${GOOGLE_API_BASE}/models/${model}:generateContent?key=${this.#apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google AI error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as GeminiResponse;
    return fromGeminiResponse(data, model);
  }

  async stream(opts: ProviderOptions): Promise<ReadableStream<Uint8Array>> {
    const { request, model } = opts;
    const geminiBody = toGeminiBody(request);
    const url = `${GOOGLE_API_BASE}/models/${model}:streamGenerateContent?alt=sse&key=${this.#apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google AI stream error ${res.status}: ${text}`);
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
              if (!jsonStr) continue;
              try {
                const geminiChunk = JSON.parse(jsonStr) as GeminiResponse;
                const text =
                  geminiChunk.candidates?.[0]?.content?.parts
                    ?.map((p) => p.text ?? "")
                    .join("") ?? "";
                if (text) sendDelta(text);
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

// ---- Gemini API types ----

interface GeminiContent {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

interface GeminiBody {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    stopSequences?: string[];
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

function toGeminiBody(request: ChatCompletionRequest): GeminiBody {
  const contents: GeminiContent[] = [];
  let systemInstruction: { parts: Array<{ text: string }> } | undefined;

  for (const msg of request.messages) {
    const text =
      typeof msg.content === "string"
        ? msg.content
        : (msg.content?.map((p) => ("text" in p ? p.text ?? "" : "")).join("") ?? "");

    if (msg.role === "system") {
      systemInstruction = { parts: [{ text }] };
    } else if (msg.role === "user") {
      contents.push({ role: "user", parts: [{ text }] });
    } else if (msg.role === "assistant") {
      contents.push({ role: "model", parts: [{ text }] });
    }
  }

  // Gemini requires alternating user/model turns; ensure we start with user
  if (contents.length > 0 && contents[0]!.role !== "user") {
    contents.unshift({ role: "user", parts: [{ text: "" }] });
  }

  const body: GeminiBody = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;

  const genConfig: GeminiBody["generationConfig"] = {};
  if (request.temperature !== undefined) genConfig.temperature = request.temperature;
  if (request.max_tokens !== undefined) genConfig.maxOutputTokens = request.max_tokens;
  if (request.top_p !== undefined) genConfig.topP = request.top_p;
  if (request.stop) {
    genConfig.stopSequences = Array.isArray(request.stop) ? request.stop : [request.stop];
  }
  if (Object.keys(genConfig).length > 0) body.generationConfig = genConfig;

  return body;
}

function fromGeminiResponse(data: GeminiResponse, model: string): ChatCompletionResponse {
  const id = generateId();
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const finishReason = data.candidates?.[0]?.finishReason;

  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason:
          finishReason === "STOP"
            ? "stop"
            : finishReason === "MAX_TOKENS"
            ? "length"
            : "stop",
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
    },
  };
}

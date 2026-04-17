import type { ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk } from "../types.js";

export interface ProviderOptions {
  request: ChatCompletionRequest;
  model: string;
}

export interface Provider {
  readonly name: string;
  /**
   * Returns a chat completion response (non-streaming) or throws on error.
   */
  complete(opts: ProviderOptions): Promise<ChatCompletionResponse>;
  /**
   * Returns a ReadableStream of SSE chunks for streaming.
   */
  stream(opts: ProviderOptions): Promise<ReadableStream<Uint8Array>>;
}

/**
 * Generates a unique ID for a completion response.
 */
export function generateId(prefix: string = "chatcmpl"): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Standard OpenAI-compatible fetch helper for chat completions.
 */
export async function openAICompatibleFetch(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

/**
 * OpenAI-compatible fetch helper for providers that do not require an API key.
 */
export async function openAICompatibleFetchNoAuth(
  url: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Removes trailing slashes from a base URL while preserving root "/".
 */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 1 && value.charCodeAt(end - 1) === 47) {
    end--;
  }
  return end === value.length ? value : value.slice(0, end);
}

/**
 * Build standard OpenAI-compatible chat completion request body.
 */
export function buildOpenAICompatibleBody(
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

/**
 * Extract content delta from OpenAI-compatible SSE chunk.
 */
export function extractOpenAIStreamDelta(data: string): string | null | "DONE" {
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

/**
 * Extract the text content from a message's content field.
 */
export function getTextContent(
  content: string | Array<{ type: string; text?: string }> | null
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

/**
 * Builds an OpenAI-compatible SSE stream from a raw SSE response body.
 */
export function buildSSEStream(
  id: string,
  model: string,
  source: ReadableStream<Uint8Array>,
  extractDelta: (line: string) => string | null | "DONE"
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();
      let buffer = "";
      const created = Math.floor(Date.now() / 1000);
      let chunkIndex = 0;

      function sendChunk(delta: string, finishReason: string | null = null) {
        const chunk: ChatCompletionChunk = {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: chunkIndex++,
              delta: delta ? { role: "assistant", content: delta } : {},
              finish_reason: finishReason as ChatCompletionChunk["choices"][0]["finish_reason"],
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
            if (!trimmed || !trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") {
              sendChunk("", "stop");
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              return;
            }
            const delta = extractDelta(data);
            if (delta === "DONE") {
              sendChunk("", "stop");
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              return;
            }
            if (delta !== null && delta !== "") {
              sendChunk(delta);
            }
          }
        }
        // Flush any remaining buffer
        if (buffer.trim()) {
          const trimmed = buffer.trim();
          if (trimmed.startsWith("data:")) {
            const data = trimmed.slice(5).trim();
            if (data !== "[DONE]") {
              const delta = extractDelta(data);
              if (delta !== null && delta !== "" && delta !== "DONE") sendChunk(delta);
            }
          }
        }
        sendChunk("", "stop");
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

import type { ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk, Env } from "../types.js";
import type { Provider, ProviderOptions } from "./base.js";
import { generateId, getTextContent } from "./base.js";

// Cloudflare Workers AI — always available as final fallback
// https://developers.cloudflare.com/workers-ai/models/
export const CLOUDFLARE_MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-4-scout-instruct",
  "@cf/meta/llama-3.1-8b-instruct",
  "@cf/google/gemma-3-12b-it",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/openai/gpt-oss-120b",
  "@cf/openai/gpt-oss-20b",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/meta/llama-3.2-3b-instruct",
] as const;

export class CloudflareProvider implements Provider {
  name = "cloudflare";

  isAvailable(_env: Env): boolean {
    // Workers AI is always available in a Cloudflare Workers context
    return true;
  }

  async complete(opts: ProviderOptions): Promise<ChatCompletionResponse> {
    const { env, request, model } = opts;

    const messages = request.messages.map((msg) => ({
      role: msg.role as string,
      content: getTextContent(msg.content as string),
    }));

    const aiRequest: Parameters<Ai["run"]>[1] = {
      messages,
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.max_tokens !== undefined && { max_tokens: request.max_tokens }),
    };

    const response = (await env.AI.run(model as Parameters<Ai["run"]>[0], aiRequest)) as
      | { response?: string }
      | ReadableStream;

    const text =
      response instanceof ReadableStream
        ? "[stream not supported in non-streaming mode]"
        : (response as { response?: string }).response ?? "";

    return {
      id: generateId(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
    };
  }

  async stream(opts: ProviderOptions): Promise<ReadableStream> {
    const { env, request, model } = opts;

    const messages = request.messages.map((msg) => ({
      role: msg.role as string,
      content: getTextContent(msg.content as string),
    }));

    const aiRequest: Parameters<Ai["run"]>[1] = {
      messages,
      stream: true,
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.max_tokens !== undefined && { max_tokens: request.max_tokens }),
    };

    const response = (await env.AI.run(model as Parameters<Ai["run"]>[0], aiRequest)) as unknown as ReadableStream;

    const id = generateId();
    const created = Math.floor(Date.now() / 1000);
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    return new ReadableStream({
      async start(controller) {
        const reader = response.getReader();
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
              const data = trimmed.slice(5).trim();
              if (data === "[DONE]") {
                sendDelta("", true);
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
                return;
              }
              try {
                const parsed = JSON.parse(data) as { response?: string };
                if (parsed.response) sendDelta(parsed.response);
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

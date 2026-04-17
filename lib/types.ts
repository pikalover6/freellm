// OpenAI-compatible types for the FreeLLM client library

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string; detail?: "auto" | "low" | "high" };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface Tool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  user?: string;
  tools?: Tool[];
  tool_choice?: "none" | "auto" | "required" | { type: "function"; function: { name: string } };
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  logprobs?: null;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChunkChoice[];
}

export interface ChunkChoice {
  index: number;
  delta: Partial<ChatMessage>;
  finish_reason: "stop" | "length" | "tool_calls" | null;
  logprobs?: null;
}

export interface ErrorResponse {
  error: {
    message: string;
    type: string;
    param?: string;
    code?: string;
  };
}

export interface ModelObject {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export interface ModelsResponse {
  object: "list";
  data: ModelObject[];
}

export type NoKeyProviderConfig =
  | boolean
  | {
      /** Override the provider base URL (must expose OpenAI-compatible /chat/completions). */
      baseUrl?: string;
    };

/**
 * Configuration for the FreeLLM client.
 * Provide at least one API key; providers without a key are skipped.
 * Optionally enable no-key providers (public or local OpenAI-compatible endpoints).
 */
export interface ClientConfig {
  /** https://console.groq.com — free, 1,000–14,400 req/day */
  groq?: string;
  /** https://cloud.cerebras.ai — free, 14,400 req/day */
  cerebras?: string;
  /** https://aistudio.google.com — free, 20–14,400 req/day */
  google?: string;
  /** https://openrouter.ai — free tier, 50 req/day */
  openrouter?: string;
  /** https://cohere.com — free, 1,000 req/month */
  cohere?: string;
  /** https://text.pollinations.ai/openai — no key required (set true to enable) */
  pollinations?: NoKeyProviderConfig;
  /** http://127.0.0.1:11434/v1 — local Ollama server, no key required */
  ollama?: NoKeyProviderConfig;
  /** http://127.0.0.1:1234/v1 — local LM Studio server, no key required */
  lmstudio?: NoKeyProviderConfig;
  /** http://127.0.0.1:8080/v1 — local llama.cpp server, no key required */
  llamacpp?: NoKeyProviderConfig;
}

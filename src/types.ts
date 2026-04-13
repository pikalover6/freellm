// OpenAI-compatible types for the FreeLLM API

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

export interface Tool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
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

// ── BYOK: per-request user-supplied API keys ─────────────────────────────
// Users pass these via request headers (e.g. X-FreeLLM-Groq-Key).
// When present they are used instead of the shared server-side key, giving
// the user their own rate-limit quota at the upstream provider.
export interface UserKeys {
  groq?: string;
  cerebras?: string;
  google?: string;
  openrouter?: string;
  cohere?: string;
}

// ── Cloudflare Workers environment bindings ───────────────────────────────
export interface Env {
  // Workers AI binding (always available — no key needed)
  AI: Ai;
  // KV namespace for per-user rate limit counters
  RATE_LIMITS: KVNamespace;
  // Shared provider API keys (set via `wrangler secret put`).
  // Users can override these per-request with X-FreeLLM-*-Key headers.
  GROQ_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  COHERE_API_KEY?: string;
  // Optional: protect your deployment — only accepts requests with this bearer token
  FREELLM_API_KEY?: string;
  // Per-user rate limit when using shared keys (requests per minute, default 10)
  SHARED_KEY_RPM_LIMIT?: string;
}

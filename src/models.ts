import type { ModelObject } from "./types.js";
import type { Provider } from "./providers/base.js";
import { GroqProvider, GROQ_MODELS } from "./providers/groq.js";
import { CerebrasProvider, CEREBRAS_MODELS } from "./providers/cerebras.js";
import { GoogleProvider, GOOGLE_MODELS } from "./providers/google.js";
import { OpenRouterProvider, OPENROUTER_MODELS } from "./providers/openrouter.js";
import { CohereProvider, COHERE_MODELS } from "./providers/cohere.js";
import { CloudflareProvider, CLOUDFLARE_MODELS } from "./providers/cloudflare.js";

// ---- Provider singletons ----
export const groq = new GroqProvider();
export const cerebras = new CerebrasProvider();
export const google = new GoogleProvider();
export const openrouter = new OpenRouterProvider();
export const cohere = new CohereProvider();
export const cloudflare = new CloudflareProvider();

// ---- Model registry ----
// Each entry maps a public model ID to an ordered list of [provider, providerModelId] pairs.
// The system tries each entry in order, falling back on error/rate-limit.

export interface ProviderModel {
  provider: Provider;
  /** The model ID to send to the provider */
  modelId: string;
}

export interface ModelEntry {
  /** Public-facing model ID exposed by this API */
  id: string;
  /** Human-readable description */
  description: string;
  /** Ordered list of provider+model pairs (first = highest priority) */
  providers: ProviderModel[];
}

export const MODEL_REGISTRY: ModelEntry[] = [
  // ── Smart: best quality models, multiple fallbacks ──────────────────────
  {
    id: "auto",
    description: "Automatically selects the best available model",
    providers: [
      { provider: groq, modelId: "llama-3.3-70b-versatile" },
      { provider: cerebras, modelId: "llama-3.3-70b" },
      { provider: google, modelId: "gemini-2.5-flash" },
      { provider: openrouter, modelId: "meta-llama/llama-3.3-70b-instruct:free" },
      { provider: cohere, modelId: "command-a-03-2025" },
      { provider: cloudflare, modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
    ],
  },
  {
    id: "smart",
    description: "High-capability model with fallbacks (alias for auto)",
    providers: [
      { provider: groq, modelId: "llama-3.3-70b-versatile" },
      { provider: cerebras, modelId: "llama-3.3-70b" },
      { provider: google, modelId: "gemini-2.5-flash" },
      { provider: openrouter, modelId: "meta-llama/llama-3.3-70b-instruct:free" },
      { provider: cohere, modelId: "command-a-03-2025" },
      { provider: cloudflare, modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
    ],
  },
  {
    id: "fast",
    description: "Fastest models prioritizing speed with quality fallbacks",
    providers: [
      { provider: cerebras, modelId: "llama3.1-8b" },
      { provider: groq, modelId: "llama-3.1-8b-instant" },
      { provider: google, modelId: "gemma-3-27b-it" },
      { provider: openrouter, modelId: "google/gemma-3-27b-it:free" },
      { provider: cloudflare, modelId: "@cf/meta/llama-3.1-8b-instruct" },
    ],
  },
  {
    id: "large",
    description: "Largest available models for complex tasks",
    providers: [
      { provider: groq, modelId: "openai/gpt-oss-120b" },
      { provider: groq, modelId: "llama-3.3-70b-versatile" },
      { provider: openrouter, modelId: "nousresearch/hermes-3-llama-3.1-405b:free" },
      { provider: cerebras, modelId: "llama-3.3-70b" },
      { provider: cloudflare, modelId: "@cf/openai/gpt-oss-120b" },
    ],
  },
  {
    id: "coding",
    description: "Models optimized for code generation",
    providers: [
      { provider: groq, modelId: "moonshotai/kimi-k2-instruct" },
      { provider: groq, modelId: "llama-3.3-70b-versatile" },
      { provider: openrouter, modelId: "mistralai/mistral-small-3.1-24b-instruct:free" },
      { provider: cloudflare, modelId: "@cf/qwen/qwen3-30b-a3b-fp8" },
      { provider: cloudflare, modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
    ],
  },
  // ── Groq models ───────────────────────────────────────────────────────────
  ...GROQ_MODELS.map((m) => ({
    id: `groq/${m}`,
    description: `Groq: ${m}`,
    providers: [
      { provider: groq, modelId: m },
      // Smart fallbacks for common Groq models
      ...(m === "llama-3.3-70b-versatile"
        ? [
            { provider: cerebras, modelId: "llama-3.3-70b" },
            { provider: cloudflare, modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
          ]
        : m === "llama-3.1-8b-instant"
        ? [
            { provider: cerebras, modelId: "llama3.1-8b" },
            { provider: cloudflare, modelId: "@cf/meta/llama-3.1-8b-instruct" },
          ]
        : [{ provider: cloudflare, modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" }]),
    ],
  })),
  // ── Cerebras models ───────────────────────────────────────────────────────
  ...CEREBRAS_MODELS.map((m) => ({
    id: `cerebras/${m}`,
    description: `Cerebras: ${m}`,
    providers: [
      { provider: cerebras, modelId: m },
      { provider: cloudflare, modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
    ],
  })),
  // ── Google models ─────────────────────────────────────────────────────────
  ...GOOGLE_MODELS.map((m) => ({
    id: `google/${m}`,
    description: `Google AI Studio: ${m}`,
    providers: [
      { provider: google, modelId: m },
      { provider: groq, modelId: "llama-3.3-70b-versatile" },
      { provider: cloudflare, modelId: "@cf/google/gemma-3-12b-it" },
    ],
  })),
  // ── OpenRouter models ─────────────────────────────────────────────────────
  ...OPENROUTER_MODELS.map((m) => ({
    id: `openrouter/${m}`,
    description: `OpenRouter (free): ${m}`,
    providers: [
      { provider: openrouter, modelId: m },
      { provider: cloudflare, modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
    ],
  })),
  // ── Cohere models ─────────────────────────────────────────────────────────
  ...COHERE_MODELS.map((m) => ({
    id: `cohere/${m}`,
    description: `Cohere: ${m}`,
    providers: [
      { provider: cohere, modelId: m },
      { provider: groq, modelId: "llama-3.3-70b-versatile" },
      { provider: cloudflare, modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
    ],
  })),
  // ── Cloudflare Workers AI models ─────────────────────────────────────────
  ...CLOUDFLARE_MODELS.map((m) => ({
    id: m,
    description: `Cloudflare Workers AI: ${m}`,
    providers: [{ provider: cloudflare, modelId: m }],
  })),
];

/** Fast lookup map: public model ID → ModelEntry */
export const MODEL_MAP = new Map<string, ModelEntry>(MODEL_REGISTRY.map((e) => [e.id, e]));

/** Returns the list of models for /v1/models */
export function getModelList(): ModelObject[] {
  const now = Math.floor(Date.now() / 1000);
  return MODEL_REGISTRY.map((entry) => ({
    id: entry.id,
    object: "model" as const,
    created: now,
    owned_by: "freellm",
  }));
}

import type { ModelObject, ClientConfig } from "./types.js";
import type { Provider } from "./providers/base.js";
import { GroqProvider, GROQ_MODELS } from "./providers/groq.js";
import { CerebrasProvider, CEREBRAS_MODELS } from "./providers/cerebras.js";
import { GoogleProvider, GOOGLE_MODELS } from "./providers/google.js";
import { OpenRouterProvider, OPENROUTER_MODELS } from "./providers/openrouter.js";
import { CohereProvider, COHERE_MODELS } from "./providers/cohere.js";

export interface ProviderModel {
  provider: Provider;
  /** The model ID to send to the provider */
  modelId: string;
}

export interface ModelEntry {
  /** Public-facing model ID */
  id: string;
  /** Human-readable description */
  description: string;
  /** Ordered list of provider+model pairs (first = highest priority) */
  providers: ProviderModel[];
}

/**
 * Instantiates provider objects from a ClientConfig.
 * Only providers with a supplied API key are created.
 */
export interface ActiveProviders {
  groq?: GroqProvider;
  cerebras?: CerebrasProvider;
  google?: GoogleProvider;
  openrouter?: OpenRouterProvider;
  cohere?: CohereProvider;
}

export function createProviders(config: ClientConfig): ActiveProviders {
  return {
    ...(config.groq ? { groq: new GroqProvider(config.groq) } : {}),
    ...(config.cerebras ? { cerebras: new CerebrasProvider(config.cerebras) } : {}),
    ...(config.google ? { google: new GoogleProvider(config.google) } : {}),
    ...(config.openrouter ? { openrouter: new OpenRouterProvider(config.openrouter) } : {}),
    ...(config.cohere ? { cohere: new CohereProvider(config.cohere) } : {}),
  };
}

/**
 * Builds the model registry for the given set of active providers.
 * Providers absent from `active` are omitted from the fallback chains.
 */
export function buildModelRegistry(active: ActiveProviders): ModelEntry[] {
  // Helper to collect only the providers that are available
  function avail(pairs: Array<[Provider | undefined, string]>): ProviderModel[] {
    return pairs
      .filter((pair): pair is [Provider, string] => pair[0] !== undefined)
      .map(([provider, modelId]) => ({ provider, modelId }));
  }

  const registry: ModelEntry[] = [
    // ── Alias models ───────────────────────────────────────────────────────
    {
      id: "auto",
      description: "Automatically selects the best available model",
      providers: avail([
        [active.groq, "llama-3.3-70b-versatile"],
        [active.cerebras, "llama-3.3-70b"],
        [active.google, "gemini-2.5-flash"],
        [active.openrouter, "meta-llama/llama-3.3-70b-instruct:free"],
        [active.cohere, "command-a-03-2025"],
      ]),
    },
    {
      id: "smart",
      description: "High-capability model with fallbacks (alias for auto)",
      providers: avail([
        [active.groq, "llama-3.3-70b-versatile"],
        [active.cerebras, "llama-3.3-70b"],
        [active.google, "gemini-2.5-flash"],
        [active.openrouter, "meta-llama/llama-3.3-70b-instruct:free"],
        [active.cohere, "command-a-03-2025"],
      ]),
    },
    {
      id: "fast",
      description: "Fastest models prioritizing speed with quality fallbacks",
      providers: avail([
        [active.cerebras, "llama3.1-8b"],
        [active.groq, "llama-3.1-8b-instant"],
        [active.google, "gemma-3-27b-it"],
        [active.openrouter, "google/gemma-3-27b-it:free"],
      ]),
    },
    {
      id: "large",
      description: "Largest available models for complex tasks",
      providers: avail([
        [active.groq, "openai/gpt-oss-120b"],
        [active.groq, "llama-3.3-70b-versatile"],
        [active.openrouter, "nousresearch/hermes-3-llama-3.1-405b:free"],
        [active.cerebras, "llama-3.3-70b"],
      ]),
    },
    {
      id: "coding",
      description: "Models optimized for code generation",
      providers: avail([
        [active.groq, "moonshotai/kimi-k2-instruct"],
        [active.groq, "llama-3.3-70b-versatile"],
        [active.openrouter, "mistralai/mistral-small-3.1-24b-instruct:free"],
        [active.cerebras, "llama-3.3-70b"],
      ]),
    },
    // ── Provider-prefixed models ───────────────────────────────────────────
    ...GROQ_MODELS.map((m) => ({
      id: `groq/${m}`,
      description: `Groq: ${m}`,
      providers: avail([
        [active.groq, m],
        ...(m === "llama-3.3-70b-versatile"
          ? [[active.cerebras, "llama-3.3-70b"] as [Provider | undefined, string]]
          : m === "llama-3.1-8b-instant"
          ? [[active.cerebras, "llama3.1-8b"] as [Provider | undefined, string]]
          : []),
      ]),
    })),
    ...CEREBRAS_MODELS.map((m) => ({
      id: `cerebras/${m}`,
      description: `Cerebras: ${m}`,
      providers: avail([[active.cerebras, m]]),
    })),
    ...GOOGLE_MODELS.map((m) => ({
      id: `google/${m}`,
      description: `Google AI Studio: ${m}`,
      providers: avail([
        [active.google, m],
        [active.groq, "llama-3.3-70b-versatile"],
      ]),
    })),
    ...OPENROUTER_MODELS.map((m) => ({
      id: `openrouter/${m}`,
      description: `OpenRouter (free): ${m}`,
      providers: avail([[active.openrouter, m]]),
    })),
    ...COHERE_MODELS.map((m) => ({
      id: `cohere/${m}`,
      description: `Cohere: ${m}`,
      providers: avail([
        [active.cohere, m],
        [active.groq, "llama-3.3-70b-versatile"],
      ]),
    })),
  ];

  // Filter out entries with no available providers
  return registry.filter((e) => e.providers.length > 0);
}

/** Returns an OpenAI-compatible model list from a registry */
export function getModelList(registry: ModelEntry[]): ModelObject[] {
  const now = Math.floor(Date.now() / 1000);
  return registry.map((entry) => ({
    id: entry.id,
    object: "model" as const,
    created: now,
    owned_by: "freellm",
  }));
}

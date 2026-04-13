# freellm

A unified, free API for LLMs — built on Cloudflare Workers.

**Callers need nothing.** Just send an OpenAI-compatible request to the endpoint and get a response. No API keys, no accounts, no configuration required on the caller's side.

FreeLLM aggregates the best free LLM providers into a single endpoint and automatically falls back across providers when one is rate-limited or unavailable. The operator configures provider keys once at deploy time; callers are completely shielded from all of that.

## Providers

| Provider | Models | Limits |
|---|---|---|
| **Groq** | Llama 3.3 70B, Llama 4 Maverick, Llama 4 Scout, Kimi K2, Qwen3 32B, Llama 3.1 8B, GPT-OSS 120B/20B | 1,000–14,400 req/day |
| **Cerebras** | Llama 3.3 70B, Llama 3.1 8B | 14,400 req/day |
| **Google AI Studio** | Gemini 2.5 Flash, Gemini 2.0 Flash, Gemma 3 27B/12B | 20–14,400 req/day |
| **OpenRouter** | Llama 3.3 70B, Gemma 3 27B, Mistral Small 3.1, Hermes 3 405B, and more | 50 req/day (free) |
| **Cohere** | Command-A, Command-R+, Command-R, Command-R7B | 1,000 req/month |
| **Cloudflare Workers AI** | Llama 3.3 70B, Llama 4 Scout, Gemma 3 12B, Qwen3 30B, GPT-OSS, and more | 10,000 neurons/day — **always available, zero config** |

## Calling the API (as a user)

```sh
curl https://freellm.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "auto", "messages": [{"role": "user", "content": "Hello!"}]}'
```

That's it. No API key needed.

## Deploying your own instance (as an operator)

### 1. Clone and install

```sh
git clone https://github.com/pikalover6/freellm
cd freellm
npm install
```

### 2. Create a KV namespace (for per-IP rate limiting)

```sh
npx wrangler kv namespace create RATE_LIMITS
# Copy the id into wrangler.toml → kv_namespaces[0].id
npx wrangler kv namespace create RATE_LIMITS --preview
# Copy into wrangler.toml → kv_namespaces[0].preview_id
```

### 3. Set provider secrets (all optional)

Without any secrets, FreeLLM falls through to **Cloudflare Workers AI**, which is always available. Each secret you add unlocks a faster/smarter provider tier:

```sh
npx wrangler secret put GROQ_API_KEY         # https://console.groq.com        (free)
npx wrangler secret put CEREBRAS_API_KEY     # https://cloud.cerebras.ai       (free)
npx wrangler secret put GOOGLE_API_KEY       # https://aistudio.google.com     (free)
npx wrangler secret put OPENROUTER_API_KEY   # https://openrouter.ai           (free)
npx wrangler secret put COHERE_API_KEY       # https://cohere.com              (free)
```

Optionally, restrict access to your deployment with a bearer token:

```sh
npx wrangler secret put FREELLM_API_KEY      # any string — callers must send as Authorization: Bearer <key>
```

Optionally, adjust the per-IP rate limit (default: 20 req/min):

```sh
npx wrangler secret put RPM_LIMIT_PER_IP         # e.g. "30" — each IP gets its own independent window (set to "0" to disable)
```

### 4. Deploy

```sh
npm run deploy
```

## Model IDs

### Alias models (recommended)

| ID | Description |
|---|---|
| `auto` | Best available model with full fallback chain |
| `smart` | Same as `auto` |
| `fast` | Fastest models (Cerebras → Groq → Google Gemma) |
| `large` | Largest models (GPT-OSS 120B → Llama 3.3 70B → Hermes 405B) |
| `coding` | Models best for code (Kimi K2 → Llama 3.3 70B → Qwen3) |

### Provider-prefixed models

- `groq/llama-3.3-70b-versatile`
- `groq/llama-3.1-8b-instant`
- `groq/meta-llama/llama-4-maverick-17b-128e-instruct`
- `groq/meta-llama/llama-4-scout-instruct`
- `groq/moonshotai/kimi-k2-instruct`
- `groq/qwen/qwen3-32b`
- `cerebras/llama-3.3-70b`
- `cerebras/llama3.1-8b`
- `google/gemini-2.5-flash`
- `google/gemma-3-27b-it`
- `openrouter/meta-llama/llama-3.3-70b-instruct:free`
- `cohere/command-a-03-2025`
- `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- `@cf/meta/llama-4-scout-instruct`
- … and many more (see `GET /v1/models`)

## API Reference

Fully OpenAI-compatible — drop-in with any OpenAI SDK by changing the base URL.

### `GET /v1/models`

Returns all available models.

### `POST /v1/chat/completions`

```json
{
  "model": "auto",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "What is the capital of France?" }
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 1024
}
```

Supports streaming (`"stream": true`) via Server-Sent Events.

**Rate limit response headers:**

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | Requests allowed per minute |
| `X-RateLimit-Remaining` | Requests remaining in current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |
| `Retry-After` | Seconds to wait after a 429 response |

## Rate Limits & TOS

FreeLLM stays within the free tiers of all providers. Each provider enforces its own upstream limits:

- **Groq**: 1,000–14,400 req/day depending on model
- **Cerebras**: 14,400 req/day
- **Google AI Studio**: 20–14,400 req/day depending on model
- **OpenRouter**: 50 req/day (free tier)
- **Cohere**: 1,000 req/month
- **Cloudflare Workers AI**: 10,000 neurons/day

FreeLLM also enforces an internal **per-IP rate limit** (default: 20 req/min). Each caller gets their own completely independent sliding window in KV — one heavy user cannot affect anyone else's quota. When a provider is rate-limited upstream, the request automatically falls back to the next provider in the chain.

> ⚠️ Please don't abuse these free services. See https://github.com/cheahjs/free-llm-api-resources for the full list of limits.

## Local Development

```sh
cp .dev.vars.example .dev.vars  # optionally add provider keys
npm run dev
```


## Providers

| Provider | Models | Limits |
|---|---|---|
| **Groq** | Llama 3.3 70B, Llama 4 Maverick, Llama 4 Scout, Kimi K2, Qwen3 32B, Llama 3.1 8B, GPT-OSS 120B/20B | 1,000–14,400 req/day |
| **Cerebras** | Llama 3.3 70B, Llama 3.1 8B | 14,400 req/day |
| **Google AI Studio** | Gemini 2.5 Flash, Gemini 2.0 Flash, Gemma 3 27B/12B | 20–14,400 req/day |
| **OpenRouter** | Llama 3.3 70B, Gemma 3 27B, Mistral Small 3.1, Hermes 3 405B, and more | 50 req/day (free) |
| **Cohere** | Command-A, Command-R+, Command-R, Command-R7B | 1,000 req/month |
| **Cloudflare Workers AI** | Llama 3.3 70B, Llama 4 Scout, Gemma 3 12B, Qwen3 30B, GPT-OSS, and more | 10,000 neurons/day (always available) |

## Quick Start

### 1. Clone and install

```sh
git clone https://github.com/pikalover6/freellm
cd freellm
npm install
```

### 2. Create a KV namespace

```sh
npx wrangler kv namespace create RATE_LIMITS
# Copy the id into wrangler.toml → kv_namespaces[0].id
npx wrangler kv namespace create RATE_LIMITS --preview
# Copy into wrangler.toml → kv_namespaces[0].preview_id
```

### 3. Set API keys as secrets

```sh
npx wrangler secret put GROQ_API_KEY         # https://console.groq.com
npx wrangler secret put CEREBRAS_API_KEY     # https://cloud.cerebras.ai
npx wrangler secret put GOOGLE_API_KEY       # https://aistudio.google.com
npx wrangler secret put OPENROUTER_API_KEY   # https://openrouter.ai
npx wrangler secret put COHERE_API_KEY       # https://cohere.com
```

At least one key is required. Cloudflare Workers AI is always available as a final fallback.

Optionally, protect your deployment with an API key:

```sh
npx wrangler secret put FREELLM_API_KEY  # any random string
```

### 4. Deploy

```sh
npm run deploy
```

### 5. Use it

```sh
curl https://freellm.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Model IDs

### Alias models (recommended)

| ID | Description |
|---|---|
| `auto` | Best available model with full fallback chain |
| `smart` | Same as `auto` |
| `fast` | Fastest models (Cerebras → Groq → Google Gemma) |
| `large` | Largest models (GPT-OSS 120B → Llama 3.3 70B → Hermes 405B) |
| `coding` | Models best for code (Kimi K2 → Llama 3.3 70B → Qwen3) |

### Provider-prefixed models

- `groq/llama-3.3-70b-versatile`
- `groq/llama-3.1-8b-instant`
- `groq/meta-llama/llama-4-maverick-17b-128e-instruct`
- `groq/meta-llama/llama-4-scout-instruct`
- `groq/moonshotai/kimi-k2-instruct`
- `groq/qwen/qwen3-32b`
- `cerebras/llama-3.3-70b`
- `cerebras/llama3.1-8b`
- `google/gemini-2.5-flash`
- `google/gemma-3-27b-it`
- `openrouter/meta-llama/llama-3.3-70b-instruct:free`
- `cohere/command-a-03-2025`
- `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- `@cf/meta/llama-4-scout-instruct`
- … and many more (see `GET /v1/models`)

## API Reference

The API is fully OpenAI-compatible.

### `GET /v1/models`

Returns all available models.

### `POST /v1/chat/completions`

```json
{
  "model": "auto",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "What is the capital of France?" }
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 1024
}
```

Supports streaming (`"stream": true`) with Server-Sent Events.

## Rate Limits & TOS

FreeLLM stays within the free tiers of all providers. Each provider enforces its own rate limits:

- **Groq**: 1,000–14,400 req/day depending on model
- **Cerebras**: 14,400 req/day
- **Google AI Studio**: 20–14,400 req/day depending on model
- **OpenRouter**: 50 req/day (free tier)
- **Cohere**: 1,000 req/month
- **Cloudflare Workers AI**: 10,000 neurons/day

When one provider's limit is reached, FreeLLM automatically falls back to the next provider in the chain.

> ⚠️ Please don't abuse these free services. See https://github.com/cheahjs/free-llm-api-resources for the full list of limits.

## Local Development

```sh
cp .dev.vars.example .dev.vars  # add your API keys
npm run dev
```

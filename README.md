# freellm

FreeLLM has two modes:

1. **JavaScript library** — runs entirely on the user's device (browser or Node.js), calling provider APIs directly from their IP so every user gets fully independent, upstream-level rate limits. No server needed.
2. **Cloudflare Worker** — a shared OpenAI-compatible endpoint for programmatic callers who just want a simple URL.

## Providers

| Provider | Models | Limits |
|---|---|---|
| **Groq** | Llama 3.3 70B, Llama 4 Maverick, Llama 4 Scout, Kimi K2, Qwen3 32B, Llama 3.1 8B, GPT-OSS 120B/20B | 1,000–14,400 req/day |
| **Cerebras** | Llama 3.3 70B, Llama 3.1 8B | 14,400 req/day |
| **Google AI Studio** | Gemini 2.5 Flash, Gemini 2.0 Flash, Gemma 3 27B/12B | 20–14,400 req/day |
| **OpenRouter** | Llama 3.3 70B, Gemma 3 27B, Mistral Small 3.1, Hermes 3 405B, and more | 50 req/day (free) |
| **Cohere** | Command-A, Command-R+, Command-R, Command-R7B | 1,000 req/month |

---

## JavaScript Library

The library makes API calls **directly from the user's environment** — browser or Node.js. Each user's requests originate from their own IP address and their own API keys, so rate limits are completely independent per user. No shared pool, no proxy, no server costs.

All free-tier API keys can be obtained at no cost from the providers listed above.

### Install

```sh
npm install freellm
```

Or use via CDN (no install needed):

```html
<script type="module">
  import { FreeLLM } from "https://cdn.jsdelivr.net/npm/freellm/dist/freellm.esm.min.js";
</script>
```

### Usage

```ts
import { FreeLLM } from "freellm";

const client = new FreeLLM({
  groq: "gsk_...",       // https://console.groq.com      (free)
  cerebras: "...",       // https://cloud.cerebras.ai    (free)
  google: "...",         // https://aistudio.google.com  (free)
  openrouter: "sk-...",  // https://openrouter.ai        (free)
  cohere: "...",         // https://cohere.com           (free)
});
```

All keys are optional — providers without a key are skipped and the next one in the fallback chain is used. Provide at least one key.

#### Non-streaming

```ts
const response = await client.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(response.choices[0].message.content);
```

#### Streaming

```ts
const stream = await client.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: "Hello!" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0].delta.content ?? "");
}
```

#### List available models

```ts
const models = client.models();
console.log(models.map((m) => m.id));
```

### Model IDs

#### Alias models (recommended)

| ID | Description |
|---|---|
| `auto` | Best available model with full fallback chain |
| `smart` | Same as `auto` |
| `fast` | Fastest models (Cerebras → Groq → Google Gemma) |
| `large` | Largest models (GPT-OSS 120B → Llama 3.3 70B → Hermes 405B) |
| `coding` | Models best for code (Kimi K2 → Llama 3.3 70B → Qwen3) |

#### Provider-prefixed models

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
- … and more (call `client.models()` to see all available for your keys)

### Build from source

```sh
git clone https://github.com/pikalover6/freellm
cd freellm
npm install
npm run build       # builds dist/freellm.{esm,umd}.{js,min.js} + TypeScript declarations
```

---

## Cloudflare Worker (shared endpoint)

A shared OpenAI-compatible API endpoint. Useful for programmatic callers who want a simple URL without managing their own keys. Rate-limited per IP (default: 20 req/min).

### Calling the API

```sh
curl https://freellm.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "auto", "messages": [{"role": "user", "content": "Hello!"}]}'
```

No API key needed on the caller side.

### Deploying your own Worker instance

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

## Local Development (Worker)

```sh
cp .dev.vars.example .dev.vars  # optionally add provider keys
npm run dev
```


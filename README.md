# freellm

FreeLLM is a JavaScript library that runs in browser or Node.js and calls model providers directly from the user's environment.

## Providers

### API-key providers (free tiers)

- Groq
- Cerebras
- Google AI Studio
- OpenRouter
- Cohere

### No-API-key providers

- Pollinations (hosted)
- Ollama (local)
- LM Studio (local)
- llama.cpp server (local)

## Install

```sh
npm install freellm
```

## Usage

```ts
import { FreeLLM } from "freellm";

const client = new FreeLLM({
  groq: "gsk_...",
  cerebras: "...",
  google: "...",
  openrouter: "sk-...",
  cohere: "...",

  // no-key providers (optional)
  pollinations: true,
  ollama: true,
  lmstudio: true,
  llamacpp: true,
});

const response = await client.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(response.choices[0].message.content);
```

### Streaming

```ts
const stream = await client.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: "Write a haiku" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0].delta.content ?? "");
}
```

### Local provider base URL overrides

```ts
const client = new FreeLLM({
  ollama: { baseUrl: "http://127.0.0.1:11434/v1" },
  lmstudio: { baseUrl: "http://127.0.0.1:1234/v1" },
  llamacpp: { baseUrl: "http://127.0.0.1:8080/v1" },
  pollinations: { baseUrl: "https://text.pollinations.ai/openai" },
});
```

## Model IDs

- Alias models: `auto`, `smart`, `fast`, `large`, `coding`, `no-key`
- Provider-prefixed models: `groq/...`, `cerebras/...`, `google/...`, `openrouter/...`, `cohere/...`, `pollinations/...`, `ollama/...`, `lmstudio/...`, `llamacpp/...`

Use `client.models()` to list currently available model IDs based on your config.

## Build from source

```sh
git clone https://github.com/pikalover6/freellm
cd freellm
npm install
npm run build
```

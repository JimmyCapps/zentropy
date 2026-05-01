# @honeyllm/agent-sdk-vercel-ai

Vercel AI SDK wrapper for the HoneyLLM Agent SDK. Wraps an
[`ai`](https://www.npmjs.com/package/ai) `Tool` so its output is screened by
the [HoneyLLM Browse MCP server](../../mcp-server/) before reaching the LLM.

Status: **Stage 4 — first non-LangChain framework wrapper** (issue
[#125](https://github.com/JimmyCapps/zentropy/issues/125)).

## What it does

A Vercel AI SDK agent that uses a web-fetching tool can be tricked into
running adversarial instructions baked into the fetched HTML. This package
intercepts the tool's `execute` return value, sends it through the HoneyLLM
probe pipeline (Hawk + Spider hunters, optional canary LLM probe), and either
returns sanitised content or blocks the call based on the configured policy.

## Install

```bash
npm install @honeyllm/agent-sdk-vercel-ai ai zod
```

`ai` and `zod` are peer dependencies — bring your own version (>=5 <7 for `ai`,
>=3 <5 for `zod`).

## Architecture

The SDK is a **thin client** over the Browse MCP server. It does **not** ship
its own probe stack. Each wrapped tool call boils down to one
`analyze_html(html, url?)` JSON-RPC call to the local (or hosted) MCP server.
See [`docs/agent-sdk/ARCHITECTURE.md`](../../docs/agent-sdk/ARCHITECTURE.md)
for the rationale.

## Quick start

```ts
import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import {
  connectStdioMcpServer,
  wrapVercelAITool,
} from '@honeyllm/agent-sdk-vercel-ai';

// Spawn the local MCP server over stdio (one connection per agent process).
const conn = await connectStdioMcpServer({
  command: 'npx',
  args: ['honeyllm-mcp'],
});

const fetcher = tool({
  description: 'fetches the HTML body of a URL',
  inputSchema: z.object({ url: z.string().url() }),
  execute: async ({ url }) => fetch(url).then((r) => r.text()),
});

const safeFetcher = wrapVercelAITool(fetcher, {
  analyzer: conn.analyzer,
  policy: 'block-on-compromised', // default; or 'block-on-suspicious' / 'flag-only'
});

const result = await generateText({
  model: openai('gpt-4o-mini'),
  tools: { fetcher: safeFetcher },
  prompt: 'Summarise https://example.com/',
});
```

When the wrapped tool runs against a COMPROMISED page under
`block-on-compromised` (default) or against a SUSPICIOUS page under
`block-on-suspicious`, the wrapper throws
[`HoneyLLMBlockedError`](./src/types.ts) instead of returning content. The
error carries `verdict` + `mitigationsApplied` so your agent can surface a
useful message back to the model or short-circuit the loop.

## Framework-neutral primitive

If you want to apply screening outside Vercel AI SDK's `tool()` factory, use
the lower-level `wrapWebTool` (returns a plain `{name, description, invoke}`):

```ts
import { wrapWebTool } from '@honeyllm/agent-sdk-vercel-ai';

const safe = wrapWebTool(
  {
    name: 'web-fetch',
    description: 'fetch + return body',
    invoke: async (url: string) => fetch(url).then((r) => r.text()),
  },
  { analyzer: conn.analyzer, policy: 'block-on-compromised' },
);
```

## Custom URL extractor

By default the wrapper inspects the tool input for a `url` / `href` /
`webPath` / `uri` field (or a bare `https?://...` string) to send as the URL
hint with the screen call. Override with `extractUrl` if your tool uses a
different shape:

```ts
const safe = wrapVercelAITool(fetcher, {
  analyzer: conn.analyzer,
  extractUrl: (input) => `https://search.example/?q=${input.q}`,
});
```

## Policies

| Policy                  | Blocks `COMPROMISED` | Blocks `SUSPICIOUS` | Blocks `UNKNOWN` |
| ----------------------- | -------------------- | ------------------- | ---------------- |
| `flag-only`             | no                   | no                  | no               |
| `block-on-compromised`* | yes                  | no                  | no               |
| `block-on-suspicious`   | yes                  | yes                 | no               |

*default. `UNKNOWN` always passes through (fail-open) — a transport glitch
silently dropping legitimate web content is a worse default for agent UX
than an attacker evading detection (which gets caught downstream).

## Stage 4 surface

- `wrapVercelAITool(sourceTool, opts)` — wraps an `ai` `Tool` and returns a
  new `Tool` whose `execute` screens the original's return value.
- `wrapWebTool(invokable, opts)` — framework-neutral primitive (string in /
  string out).
- `screenContent` / `screenContentOrThrow` — direct content screening.
- `connectStdioMcpServer({command, args})` — spawn the HoneyLLM MCP server
  over stdio and return a ready `Analyzer`.
- `createMcpAnalyzer({client})` — adapter over an existing MCP `Client`.
- `HoneyLLMBlockedError` — thrown on policy block; carries `verdict` +
  `mitigationsApplied`.

Out of scope for Stage 4 (deliberate):

- Mastra wrappers (Stage 5; will trigger the `core/` package extraction).
- CrewAI / AutoGen / Python LangChain sister-pkg (PARKED — will revisit only
  if Python is needed elsewhere or the v1 TS-native arc closes).

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

The optional `subprocess-smoke` test spawns
`../../mcp-server/dist/index.js` to exercise the wrapper end-to-end against
the real MCP binary; it auto-skips when the binary is absent so local dev
without a `mcp-server` build stays green. CI builds the binary first.

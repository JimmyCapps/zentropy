# @honeyllm/agent-sdk-langchain

LangChain wrapper for the HoneyLLM Agent SDK. Wraps a LangChain web tool so its
output is screened by the [HoneyLLM Browse MCP server](../../mcp-server/) before
reaching the LLM.

Status: **Stage 1 — design + scaffold + LangChain adapter** (issue
[#125](https://github.com/JimmyCapps/zentropy/issues/125)).

## What it does

A LangChain agent that uses a web-fetching tool can be tricked into running
adversarial instructions baked into the fetched HTML. This package intercepts
the tool's output, sends it through the HoneyLLM probe pipeline (Hawk + Spider
hunters, optional canary LLM probe), and either returns sanitised content or
blocks the call based on the configured policy.

## Install

```bash
npm install @honeyllm/agent-sdk-langchain @langchain/core
```

## Architecture

The SDK is a **thin client** over the Browse MCP server. It does **not** ship
its own probe stack. Each wrapped tool call boils down to one
`analyze_html(html, url?)` JSON-RPC call to the local (or hosted) MCP server.
See [`docs/agent-sdk/ARCHITECTURE.md`](../../docs/agent-sdk/ARCHITECTURE.md)
for the rationale.

## Quick start

### LangChain `DynamicTool` (most common)

```ts
import { DynamicTool } from '@langchain/core/tools';
import {
  connectStdioMcpServer,
  wrapAsLangChainTool,
} from '@honeyllm/agent-sdk-langchain';

// Spawn the local MCP server over stdio (one connection per agent process).
const conn = await connectStdioMcpServer({
  command: 'npx',
  args: ['honeyllm-mcp'],
});

const fetcher = new DynamicTool({
  name: 'web-fetch',
  description: 'fetches the HTML body of a URL',
  func: async (url) => fetch(url).then((r) => r.text()),
});

const safeFetcher = wrapAsLangChainTool(fetcher, {
  analyzer: conn.analyzer,
  policy: 'block-on-compromised', // default; or 'block-on-suspicious' / 'flag-only'
});

// Drop into any LangChain agent in place of `fetcher`.
const result = await safeFetcher.invoke('https://example.com/');
```

### Framework-neutral primitive

If your framework is not LangChain, use the lower-level `wrapWebTool`:

```ts
import { wrapWebTool, screenContentOrThrow } from '@honeyllm/agent-sdk-langchain';

const safe = wrapWebTool(
  {
    name: 'web-fetch',
    description: 'fetch + return body',
    invoke: async (url: string) => fetch(url).then((r) => r.text()),
  },
  { analyzer: conn.analyzer, policy: 'block-on-compromised' },
);

const content = await safe.invoke('https://example.com/');
```

Or screen content you already have:

```ts
const screened = await screenContentOrThrow({
  html: existingHtml,
  url: 'https://example.com/',
  analyzer: conn.analyzer,
});
// screened.content (CLEAN) — or HoneyLLMBlockedError thrown
```

## Policies

| Policy                  | Behaviour                                                |
| ----------------------- | -------------------------------------------------------- |
| `flag-only`             | Never throws. Always returns content + verdict.          |
| `block-on-compromised`  | Throws `HoneyLLMBlockedError` on `COMPROMISED`. (default)|
| `block-on-suspicious`   | Throws on `COMPROMISED` or `SUSPICIOUS`.                 |

`UNKNOWN` (analyzer error / transport failure) is always pass-through —
fail-open is preferred over silently dropping legitimate content. If your
threat model requires fail-closed, inspect `verdict.status === 'UNKNOWN'`
yourself and reject explicitly.

## Stage 1 scope (this release)

- `wrapWebTool(tool, opts)` — framework-neutral primitive
- `wrapAsLangChainTool(tool, opts)` — LangChain `DynamicTool` adapter
- `screenContent` / `screenContentOrThrow` — direct content screening
- `createMcpAnalyzer({ client })` — analyzer over an `McpClientLike` shim (test seam)
- `connectStdioMcpServer({ command, args })` — production helper that spawns
  `honeyllm-mcp` (or any binary) over stdio and returns a ready-to-use analyzer

## Out of scope for Stage 1

- HTTP-streamable transport to a hosted MCP server (Stage 2+)
- LangChain `StructuredTool` / `DynamicStructuredTool` schema-typed wrapping
- `WebBaseLoader`, `PlaywrightURLLoader`, `RequestsGetTool` per-tool
  convenience wrappers (Stage 2+)
- LangGraph tool-call middleware
- Other frameworks (CrewAI, AutoGen, Mastra, Vercel AI SDK)
- Python sister-package (`honeyllm-agent-sdk`)

These are tracked under #125; each will land in its own follow-up stage.

## Testing

```bash
npm test          # 50 unit tests
npm run typecheck # tsc --noEmit
npm run build     # tsc -p tsconfig.build.json → dist/
```

## License

Apache-2.0 (matches the HoneyLLM root licence).

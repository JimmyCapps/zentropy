# @honeyllm/agent-sdk-langchain

LangChain wrapper for the HoneyLLM Agent SDK. Wraps a LangChain web tool so its
output is screened by the [HoneyLLM Browse MCP server](../../mcp-server/) before
reaching the LLM.

Status: **Stage 3 — LangGraph tool-call middleware** (issue
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

## Per-tool convenience wrappers (Stage 2)

### `WebBaseLoader` / `PlaywrightURLLoader` (and any `Document[]`-shape loader)

```ts
import { WebBaseLoader } from '@langchain/community/document_loaders/web/cheerio';
import { wrapWebBaseLoader } from '@honeyllm/agent-sdk-langchain';

const loader = new WebBaseLoader('https://example.com/');
const safeLoader = wrapWebBaseLoader(loader, { analyzer: conn.analyzer });
const docs = await safeLoader.load(); // each Document.pageContent is screened
```

The wrapper preserves doc count + metadata, and replaces each `pageContent`
with the analyzer-sanitised content. URL hint is taken from `metadata.source`
first, then `loader.webPath` (WebBaseLoader) or `loader.urls[index]`
(PlaywrightURLLoader). Loaders that fail any screened doc throw on
the first failure — the remaining docs are not screened.

### `RequestsGetTool`

```ts
import { RequestsGetTool } from '@langchain/community/tools/requests';
import { wrapRequestsGetTool } from '@honeyllm/agent-sdk-langchain';

const safeGet = wrapRequestsGetTool(new RequestsGetTool(), {
  analyzer: conn.analyzer,
});
```

### `StructuredTool` / `DynamicStructuredTool` (schema-typed inputs)

```ts
import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { wrapAsStructuredTool } from '@honeyllm/agent-sdk-langchain';

const fetcher = new DynamicStructuredTool({
  name: 'web-fetch',
  description: 'fetches the body of a URL',
  schema: z.object({ url: z.string(), timeout: z.number().optional() }),
  func: async (input) => fetch(input.url).then((r) => r.text()),
});

const safeFetcher = wrapAsStructuredTool(fetcher, { analyzer: conn.analyzer });
```

The default URL extractor reads `input.url`, falling back to `input.href`,
`input.webPath`, or `input.uri` — pass `extractUrl` to override.

### `wrapAsRunnable` (graph-level use)

For LangGraph nodes or arbitrary `Runnable` chains, get a `RunnableLambda`
that you can pipe with `.pipe()`:

```ts
import { wrapAsRunnable } from '@honeyllm/agent-sdk-langchain';

const safeRunnable = wrapAsRunnable(fetcher, { analyzer: conn.analyzer });
const chain = safeRunnable.pipe(myDownstreamRunnable);
```

## LangGraph tool-call middleware (Stage 3)

The per-tool wrappers above run analysis at every wrapped tool's boundary. If
you'd rather screen all tool outputs at one place in the graph — for example,
right after a `ToolNode` and before the model sees the results — use
`createHoneyLLMMiddleware`. It returns a LangChain `Runnable` that screens
every `ToolMessage` in the latest tool-call batch and replaces its content
with the analyzer-sanitised string (or throws `HoneyLLMBlockedError`).

```ts
import { ChatOpenAI } from '@langchain/openai';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import {
  connectStdioMcpServer,
  createHoneyLLMMiddleware,
} from '@honeyllm/agent-sdk-langchain';

const conn = await connectStdioMcpServer({ command: 'npx', args: ['honeyllm-mcp'] });

const tools = [/* your raw tools — no per-tool wrapping needed */];
const toolNode = new ToolNode(tools);
const honeyllmGuard = createHoneyLLMMiddleware({
  analyzer: conn.analyzer,
  policy: 'block-on-compromised',
  toolNames: ['web_fetch', 'browse'], // optional: only screen these tools
});

const graph = new StateGraph(MessagesAnnotation)
  .addNode('tools', toolNode)
  .addNode('honeyllm', honeyllmGuard)
  .addNode('model', model)
  .addEdge('tools', 'honeyllm')
  .addEdge('honeyllm', 'model');
```

The middleware accepts either `BaseMessage[]` or `{ messages: BaseMessage[] }`
and returns the same shape — drop it into a `MessagesAnnotation` graph
directly, or `.pipe()` it after a Runnable that emits messages. URL hints are
correlated automatically: each `ToolMessage` is matched against the
preceding `AIMessage`'s `tool_calls` by `tool_call_id`, then the default URL
extractor walks the call's `args` (`url`/`href`/`webPath`/`uri` precedence).

If you only need the pure transform (e.g. to test a graph node without running
it through `Runnable.invoke`), `screenToolMessages(messages, opts)` is
exported as a plain async function with the same options.

`ToolMessages` with `status === 'error'` and non-string content (multimodal
arrays) are passed through unchanged — only successful string outputs from
the latest tool batch are screened.

## Stage 3 surface (this release)

- `wrapWebTool(tool, opts)` — framework-neutral primitive (Stage 1)
- `wrapAsLangChainTool(tool, opts)` — LangChain `DynamicTool` adapter (Stage 1)
- `wrapAsStructuredTool(tool, opts)` — `DynamicStructuredTool` adapter for
  schema-typed inputs (Stage 2)
- `wrapWebBaseLoader` / `wrapPlaywrightURLLoader` / `wrapDocumentLoader` —
  Document-loader adapters (Stage 2)
- `wrapRequestsGetTool(tool, opts)` — typed alias for `RequestsGetTool` (Stage 2)
- `wrapAsRunnable(tool, opts)` — LangChain `Runnable` for graph-level use (Stage 2)
- `createHoneyLLMMiddleware(opts)` — LangGraph node `Runnable` that screens
  `ToolMessage`s in the latest tool-call batch at the graph boundary (Stage 3)
- `screenToolMessages(messages, opts)` — pure async function under the
  middleware, exposed for direct testing / custom graph wiring (Stage 3)
- `screenContent` / `screenContentOrThrow` — direct content screening (Stage 1)
- `createMcpAnalyzer({ client })` — analyzer over an `McpClientLike` shim (Stage 1)
- `connectStdioMcpServer({ command, args })` — spawns `honeyllm-mcp` over
  stdio and returns a ready-to-use analyzer (Stage 1)
- Subprocess-level smoke test against the compiled `mcp-server/dist/index.js`
  binary (Stage 2)

## Out of scope (later stages)

- HTTP-streamable transport to a hosted MCP server
- Other frameworks: CrewAI, AutoGen, Mastra, Vercel AI SDK (Stages 4–7)
- Python sister-package (`honeyllm-agent-sdk`) (Stage 8)

These are tracked under #125; each will land in its own follow-up stage.

## Testing

```bash
npm test          # 125 unit + integration tests (Stage 3)
npm run typecheck # tsc --noEmit
npm run build     # tsc -p tsconfig.build.json → dist/
```

The subprocess smoke test in `src/__tests__/subprocess-smoke.test.ts`
auto-skips when `mcp-server/dist/index.js` is absent. CI builds the
mcp-server binary first so the smoke runs end-to-end.

## License

Apache-2.0 (matches the HoneyLLM root licence).

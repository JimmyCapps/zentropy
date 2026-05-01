# @honeyllm/agent-sdk-mastra

Mastra wrapper for the HoneyLLM Agent SDK. Wraps a Mastra
[`createTool`](https://mastra.ai/en/docs/agents/using-tools)-shaped tool so
its `execute` return is screened by the HoneyLLM Browse MCP server before it
ever reaches the LLM.

Issue [#125](https://github.com/JimmyCapps/zentropy/issues/125), Stage 5b.

## Install

```bash
npm install @honeyllm/agent-sdk-mastra @mastra/core zod
```

`@mastra/core` and `zod` are peer dependencies (not bundled). Bring whatever
versions match your Mastra agent setup; the wrapper accepts the structurally-
typed `MastraToolLike` shape so framework-version drift in the source tool's
generics doesn't propagate into your code.

## Use

```ts
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  connectStdioMcpServer,
  wrapMastraTool,
  HoneyLLMBlockedError,
} from '@honeyllm/agent-sdk-mastra';

// 1. Spawn the HoneyLLM Browse MCP server (provides the screening Analyzer).
const conn = await connectStdioMcpServer({
  command: 'node',
  args: ['./node_modules/@honeyllm/mcp-server/dist/index.js'],
});

// 2. Define your tool the usual way.
const browse = createTool({
  id: 'browse',
  description: 'Fetch a URL and return its body',
  inputSchema: z.object({ url: z.string() }),
  execute: async ({ context }) => {
    const r = await fetch(context.url);
    return await r.text();
  },
});

// 3. Wrap it. The wrapper screens browse's return through HoneyLLM's
//    deterministic + LLM-canary probes before the model sees it.
const safeBrowse = wrapMastraTool(browse, {
  analyzer: conn.analyzer,
  // policy: 'block-on-compromised'  // default
});

const agent = new Agent({
  id: 'researcher',
  name: 'Researcher',
  instructions: 'You research things on the web.',
  model: 'openai/gpt-4o',
  tools: { safeBrowse },
});

try {
  const reply = await agent.generate('Summarise example.com');
  console.log(reply.text);
} catch (e) {
  if (e instanceof HoneyLLMBlockedError) {
    console.error('blocked:', e.verdict.status, e.verdict.totalScore);
  }
}
```

## Surface

### `wrapMastraTool(source, opts)`

`source: MastraToolLike` — accepts any structurally-typed Mastra tool with
`{id?, description?, inputSchema?, outputSchema?, execute?}`. `createTool()`
factory output satisfies the shape directly.

`opts.analyzer` — the screening transport seam. Get one from
`connectStdioMcpServer({command, args})` (spawns the `honeyllm-mcp` server)
or `createMcpAnalyzer({client})` against your own MCP `Client`.

`opts.policy` — `'flag-only' | 'block-on-compromised' | 'block-on-suspicious'`.
Default `'block-on-compromised'`. `UNKNOWN` always passes through (fail-open).

`opts.extractUrl` — `(context) => string | undefined`. Called on the Mastra
execution context; default walks `context.context.{url, href, webPath, uri}`
to provide a URL hint to the analyzer.

Returns a `Tool` (cast via `as unknown as Tool` at the boundary so the
framework's strict generics stay out of consumer code). The wrapper preserves
`id` / `description` / `inputSchema` / `outputSchema`. Its `execute` calls
the source's `execute(context, options)`, coerces non-string returns via
`String(raw)` (or `JSON.stringify`) before screening, and returns the
sanitised string content on success or throws `HoneyLLMBlockedError` on
policy block.

### Other re-exports

The package re-exports the core surface for convenience:
`HoneyLLMBlockedError`, `screenContent` / `screenContentOrThrow`,
`wrapWebTool`, `defaultExtractUrl`, `createMcpAnalyzer`,
`connectStdioMcpServer` / `disconnectStdioMcpServer`.

## Design

Consumes [`@honeyllm/agent-sdk-core`](../agent-sdk-core/) from day one.
`Analyzer` is the only transport seam — the wrapper never spawns its own MCP
client. `defaultExtractUrl` is the same heuristic used by the LangChain and
Vercel AI wrappers. Subprocess smoke runs end-to-end against the compiled
`mcp-server/dist/index.js` and auto-skips when the dist is absent so local
dev without an MCP build stays green.

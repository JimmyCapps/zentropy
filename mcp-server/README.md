# HoneyLLM Browse MCP server

Node-side MCP (Model Context Protocol) server that lets MCP-aware LLM clients
(Claude Desktop, Cursor, Continue, Cline, agent frameworks) interpose at the
*browsing primitive* — the model uses HoneyLLM's `browse` tool to fetch a URL,
and the server analyzes the response before the model sees it.

This solves a race condition that the in-Chrome extension cannot win against
in-browser agents: the agent never receives raw page content, only
post-extraction text plus a security verdict.

Tracking issue: [#124 — HoneyLLM Browse MCP server](https://github.com/JimmyCapps/zentropy/issues/124).

## Status

**Stage 1 (this drop)** — scaffold + `browse(url)` end-to-end with the Hawk
hunter (deterministic feature-based prompt-injection scoring; no LLM
round-trip; smallest dependency surface). Single tool exposed.

Subsequent stages add the remaining tools listed in #124
(`read_page` / `analyze_html` / `analyze_url`), the Spider hunter, the canary
LLM probes, and the Playwright-based browser primitive that handles
JS-rendered pages. The (a)/(b)/(c) LLM-runtime decision in the issue body
(Node-native MLC vs. extension-RPC bridge vs. server-side `mlc_llm serve`)
defers to Stage 2 — Hawk has no LLM dependency, so the question doesn't bind
on this stage.

## Install + run

Requires Node 22+.

```sh
cd mcp-server
npm install
npm test         # 26 unit tests
npm run start    # runs the MCP server on stdio (for use by an MCP client)
```

## Wire into Claude Desktop

Add the server to your Claude Desktop MCP config (`~/Library/Application
Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "honeyllm-browse": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/HoneyLLM/mcp-server/src/index.ts"]
    }
  }
}
```

Restart Claude Desktop. The `browse` tool appears in the tool picker; the
model can then invoke it with `{ "url": "https://..." }` and receive a
`{ content, verdict, report, mitigationsApplied }` payload.

## Tool: `browse(url)`

**Input:** `{ url: string }` (http or https only)

**Output:**

```ts
{
  content: string;            // post-extraction page text (Hawk's input)
  verdict: {
    status: 'CLEAN' | 'SUSPICIOUS' | 'COMPROMISED' | 'UNKNOWN';
    confidence: number;       // 0..1, calibrated probability from Hawk
    totalScore: number;       // sum of hunter scores
    url: string;
    timestamp: number;
    analysisError: string | null;
  };
  report: { hunters: HunterResult[] };
  mitigationsApplied: string[];   // empty in Stage 1
}
```

`UNKNOWN` is returned (with `analysisError` populated) for invalid URLs,
non-HTTP(S) schemes, network failures, and non-2xx responses. The fail-safe is
intentional: if HoneyLLM cannot analyze, the caller knows the verdict is
absent, not that the page is benign.

## Architecture (Stage 1)

```
mcp-server/src/
├── index.ts              # MCP stdio server entry; registers tools
├── server-tools.ts       # tool descriptors + JSON schema (testable in isolation)
├── tools/browse.ts       # browse(url) — fetch, extract, score, verdict
├── probes/hawk-runner.ts # thin wrapper around HoneyLLM's hawkHunter
├── extract/html-to-text.ts  # tag stripper (script/style/noscript dropped, entities decoded)
└── verdict/types.ts      # slim McpVerdict / McpReport / BrowseToolResult
```

Hawk's source lives in the parent repo at `src/hunters/hawk/`; this package
imports it via relative path. The shared-probe-core extraction noted in #124
is deferred until the second consumer (the Agent SDK in #125) actually exists.

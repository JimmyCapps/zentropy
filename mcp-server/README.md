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

**Stage 2 (current)** — `browse(url)` runs the **Hawk** (feature-based) and
**Spider** (deterministic regex/marker) hunters in parallel via `Promise.all`,
sums their scores, and surfaces a combined verdict. Still no LLM round-trip.

Subsequent stages add the remaining tools listed in #124
(`read_page` / `analyze_html` / `analyze_url`), the canary LLM probes, and the
Playwright-based browser primitive that handles JS-rendered pages. The
(a)/(b)/(c) LLM-runtime decision in the issue body (Node-native MLC vs.
extension-RPC bridge vs. server-side `mlc_llm serve`) defers to Stage 3 — both
shipped hunters are deterministic, so the question doesn't bind yet.

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
  content: string;            // post-extraction page text (hunter input)
  verdict: {
    status: 'CLEAN' | 'SUSPICIOUS' | 'COMPROMISED' | 'UNKNOWN';
    confidence: number;       // 0..1, max across hunters
    totalScore: number;       // sum of hunter scores
    url: string;
    timestamp: number;
    analysisError: string | null;  // populated only when ALL hunters errored
  };
  report: { hunters: HunterResult[] };  // length 2 in Stage 2: hawk + spider
  mitigationsApplied: string[];          // empty until Stage 3+
}
```

Status mapping: `totalScore >= 40` → `COMPROMISED`, `> 0` → `SUSPICIOUS`,
`0` → `CLEAN`. Spider scores 40 on any pattern match (mirrors
`SCORE_INSTRUCTION_DETECTION` in the parent repo), so a Spider-only hit goes
straight to `COMPROMISED`.

`UNKNOWN` is returned (with `analysisError` populated) for invalid URLs,
non-HTTP(S) schemes, network failures, and non-2xx responses. The fail-safe is
intentional: if HoneyLLM cannot analyze, the caller knows the verdict is
absent, not that the page is benign.

## Architecture (Stage 2)

```
mcp-server/src/
├── index.ts                  # MCP stdio server entry; registers tools
├── server-tools.ts           # tool descriptors + JSON schema (testable in isolation)
├── tools/browse.ts           # browse(url) — fetch, extract, run hunters in parallel, combine scores
├── probes/hawk-runner.ts     # thin wrapper around HoneyLLM's hawkHunter
├── probes/spider-runner.ts   # thin wrapper around HoneyLLM's spiderHunter
├── extract/html-to-text.ts   # tag stripper (script/style/noscript dropped, entities decoded;
│                             #   chat-template tokens like <|system|> preserved for Spider)
└── verdict/types.ts          # slim McpVerdict / McpReport / BrowseToolResult
```

Hunter sources live in the parent repo at `src/hunters/{hawk,spider}/`; this
package imports them via relative path. The shared-probe-core extraction
noted in #124 is deferred until the second consumer (the Agent SDK in #125)
actually exists.

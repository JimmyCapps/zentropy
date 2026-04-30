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

**Stage 4 (current)** — adds `read_page(url)`, a Playwright-backed tool that
renders the target URL in headless Chromium and analyses the post-settle DOM
text. `browse(url)` keeps the Node fetch + regex-strip fast path as default and
gains an opt-in `usePlaywright: true` flag for callers that want JS rendering
without switching tools. Stage 3's hunter+probe signal pipeline (Hawk + Spider
+ optional instruction-detection canary) is reused unchanged for both tools.

Playwright is wired in as an `optionalDependencies` entry; CI mocks it at a
launcher-injection boundary and never spins up real Chromium for unit tests.
Maintainers running `read_page` locally need to install browsers once:

```sh
cd mcp-server
npx playwright install chromium
```

If browsers are not installed, `read_page` returns `UNKNOWN` with an
`analysisError` pointing at the install command, rather than crashing.

Earlier stages (carried forward unchanged):

- **Stage 3** — `browse(url)` runs Hawk + Spider in parallel with the
  instruction-detection canary probe when an OpenAI-compat LLM endpoint is
  configured. Decision (a)/(b)/(c) locked on **(c)** — server-side runner
  against an OpenAI-compat endpoint (`mlc_llm serve` / Ollama / vLLM / etc.) —
  rejecting (a) Node + headless-browser MLC port and (b) RPC bridge to a
  running Chrome instance.

Subsequent stages will add the remaining tools (`analyze_html` / `analyze_url`)
listed in #124 and a compiled `dist/` build pipeline.

## Install + run

Requires Node 22+.

```sh
cd mcp-server
npm install
npm test         # 99 unit tests (Stage 4)
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
      "args": ["tsx", "/absolute/path/to/HoneyLLM/mcp-server/src/index.ts"],
      "env": {
        "HONEYLLM_LLM_BASE_URL": "http://localhost:8001/v1",
        "HONEYLLM_LLM_MODEL": "Qwen2.5-0.5B-Instruct-q4f16_1-MLC"
      }
    }
  }
}
```

The `env` block is optional — when omitted, `browse` runs the deterministic
hunters only (Stage 2 behaviour). When set, the canary probe attaches against
the OpenAI-compat endpoint at `${HONEYLLM_LLM_BASE_URL}/chat/completions`.

Supported env vars:

| Var | Required | Default | Notes |
|---|---|---|---|
| `HONEYLLM_LLM_BASE_URL` | yes (to enable probe) | — | OpenAI-compat root, e.g. `http://localhost:8001/v1` |
| `HONEYLLM_LLM_MODEL` | yes (to enable probe) | — | Model id passed in the request body |
| `HONEYLLM_LLM_API_KEY` | no | none | Sent as `Authorization: Bearer <key>` |
| `HONEYLLM_LLM_TIMEOUT_MS` | no | `15000` | Per-call abort budget |

Restart Claude Desktop. The `browse` tool appears in the tool picker; the
model can then invoke it with `{ "url": "https://..." }` and receive a
`{ content, verdict, report, mitigationsApplied }` payload.

## Tool: `browse(url)`

**Input:** `{ url: string, usePlaywright?: boolean }` (http or https only)

`usePlaywright: true` switches the fetch primitive from Node `fetch` to a
headless-Chromium render via Playwright. The hunter + probe pipeline downstream
is identical; only the page-acquisition surface changes. Default (flag absent
or `false`) keeps the Stage 1–3 behaviour byte-for-byte.

**Output:**

```ts
{
  content: string;            // post-extraction page text (hunter+probe input)
  verdict: {
    status: 'CLEAN' | 'SUSPICIOUS' | 'COMPROMISED' | 'UNKNOWN';
    confidence: number;       // 0..1, max across hunters AND probes
    totalScore: number;       // sum of hunter scores + probe scores
    url: string;
    timestamp: number;
    analysisError: string | null;  // populated only when ALL hunters AND ALL probes errored
  };
  report: {
    hunters: HunterResult[];   // length 2: hawk + spider
    probes: ProbeRunResult[];  // length 0 if no LLM endpoint; length 1 (instruction_detection) when configured
  };
  mitigationsApplied: string[];   // empty until later stages
}
```

Status mapping: `totalScore >= 40` → `COMPROMISED`, `> 0` → `SUSPICIOUS`,
`0` → `CLEAN`. Spider scores 40 on any pattern match (mirrors
`SCORE_INSTRUCTION_DETECTION` in the parent repo), so a Spider-only hit goes
straight to `COMPROMISED`. The instruction-detection probe contributes 0–40
based on the LLM's structured response; a confidently-flagged probe alone is
enough to push the verdict to `COMPROMISED`.

`UNKNOWN` is returned (with `analysisError` populated) for invalid URLs,
non-HTTP(S) schemes, network failures, and non-2xx responses. The fail-safe is
intentional: if HoneyLLM cannot analyze, the caller knows the verdict is
absent, not that the page is benign.

Probes run in parallel with hunters via `Promise.allSettled` so a slow or
failing LLM endpoint never blocks or crashes the deterministic hunter signal.
A probe error surfaces as `report.probes[i].errorMessage`; verdict-level
`analysisError` only populates when *every* signal source errored.

## Tool: `read_page(url)`

**Input:** `{ url: string }` (http or https only)

**Output:** identical shape to `browse`. The verdict's `url` field reflects
the *post-redirect* URL reported by Playwright, so a chain like
`http://x.example/ → https://x.example/` will surface the final HTTPS URL.

`read_page` always uses headless Chromium with `waitUntil: 'networkidle'` and
a 30 s default timeout, then runs the same hunter + probe pipeline as `browse`
on the rendered DOM text (`page.content()` stripped via the same regex pipeline
that handles static fetches).

Use `read_page` for SPAs, dynamically-rendered marketing sites, and any URL
where `view-source:` differs meaningfully from what a user sees. Use `browse`
(the default fast path) for static HTML, RSS feeds, plain-text content, and
batched scans where latency matters more than rendering fidelity.

## Architecture (Stage 4)

```
mcp-server/src/
├── index.ts                  # MCP stdio server entry; registers tools
├── server-tools.ts           # tool descriptors + JSON schema + endpointFromEnv + lazy renderer
├── tools/browse.ts           # browse(url, usePlaywright?) — fetcher path | renderer path
├── tools/read-page.ts        # read_page(url) — always renderer path
├── probes/hawk-runner.ts     # thin wrapper around HoneyLLM's hawkHunter
├── probes/spider-runner.ts   # thin wrapper around HoneyLLM's spiderHunter
├── probes/canary-runner.ts   # instruction-detection probe via injected LlmEndpoint
├── probes/llm-endpoint.ts    # LlmEndpoint interface + createOpenAiCompatEndpoint
├── extract/html-to-text.ts   # tag stripper (script/style/noscript dropped, entities decoded;
│                             #   chat-template tokens like <|system|> preserved for Spider)
├── extract/page-renderer.ts  # PageRenderer + createPlaywrightRenderer (launcher-injection seam)
└── verdict/
    ├── types.ts              # slim McpVerdict / McpReport / BrowseToolResult
    └── signal-pipeline.ts    # combineSignals + analyzeText shared by browse + read_page
```

Hunter and probe sources live in the parent repo at `src/hunters/` and
`src/probes/`; this package imports them via relative path (the
`instructionDetectionProbe` system prompt is consumed verbatim, not duplicated).
The shared-probe-core extraction noted in #124 is deferred until the second
consumer (the Agent SDK in #125) actually exists.

The `PageRenderer` interface is the launcher-injection boundary: tests inject
a mock that returns a canned `{ url, status, text }` triple, never spinning up
real Chromium. Production `createPlaywrightRenderer({ launcher: chromium })`
imports `chromium` from `playwright` lazily on first `read_page` call so a
client that never invokes the renderer pays no startup cost.

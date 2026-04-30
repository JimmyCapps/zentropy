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

**Stage 3 (current)** — `browse(url)` runs the **Hawk** + **Spider** hunters in
parallel with the **instruction-detection canary probe** when an OpenAI-compat
LLM endpoint is configured (`HONEYLLM_LLM_BASE_URL` + `HONEYLLM_LLM_MODEL`).
The probe runs the verbatim `instructionDetectionProbe` system prompt from the
parent repo against the endpoint and folds its score into the combined verdict.
When no endpoint is configured, behaviour is byte-equivalent to Stage 2.

The (a)/(b)/(c) deployment decision is now **locked: (c) — server-side runner
against an OpenAI-compat endpoint** (`mlc_llm serve` / Ollama / vLLM / etc.).
(a) was rejected because porting the MLC/WebGPU stack to Node bloats deps; (b)
was rejected because RPC-bridging to a running Chrome instance couples the MCP
server to extension lifecycle. (c) reuses the `MLC_BASE_URL` / `MLC_MODEL`
pattern from `scripts/run-pedagogical-fpr.ts` (issue #120) and is mockable at
the Node `fetch` boundary for tests.

Subsequent stages add the remaining tools listed in #124 (`read_page` /
`analyze_html` / `analyze_url`) and the Playwright-based browser primitive
that handles JS-rendered pages.

## Install + run

Requires Node 22+.

```sh
cd mcp-server
npm install
npm test         # 66 unit tests
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

**Input:** `{ url: string }` (http or https only)

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

## Architecture (Stage 3)

```
mcp-server/src/
├── index.ts                  # MCP stdio server entry; registers tools
├── server-tools.ts           # tool descriptors + JSON schema + endpointFromEnv
├── tools/browse.ts           # browse(url) — fetch, extract, hunters || probes, combine signals
├── probes/hawk-runner.ts     # thin wrapper around HoneyLLM's hawkHunter
├── probes/spider-runner.ts   # thin wrapper around HoneyLLM's spiderHunter
├── probes/canary-runner.ts   # instruction-detection probe via injected LlmEndpoint
├── probes/llm-endpoint.ts    # LlmEndpoint interface + createOpenAiCompatEndpoint
├── extract/html-to-text.ts   # tag stripper (script/style/noscript dropped, entities decoded;
│                             #   chat-template tokens like <|system|> preserved for Spider)
└── verdict/types.ts          # slim McpVerdict / McpReport / BrowseToolResult
```

Hunter and probe sources live in the parent repo at `src/hunters/` and
`src/probes/`; this package imports them via relative path (the
`instructionDetectionProbe` system prompt is consumed verbatim, not duplicated).
The shared-probe-core extraction noted in #124 is deferred until the second
consumer (the Agent SDK in #125) actually exists.

# HoneyLLM Agent SDK — Architecture

**Status:** Stage 1 (issue [#125](https://github.com/JimmyCapps/zentropy/issues/125)) — design + scaffold + LangChain adapter
**Last updated:** 2026-05-01
**Source-of-truth package:** [`packages/agent-sdk-langchain/`](../../packages/agent-sdk-langchain/)

## Goal

Wrap a LangChain (or any agent framework's) web-fetching tool so that adversarial
content fetched from the open web is screened by HoneyLLM's probe pipeline
**before** it reaches the LLM. The wrapper is a drop-in replacement for the
underlying tool — agents do not change their orchestration code.

## Stage 1 decision: MCP-as-transport, not self-contained

The plan called out a kickoff-time decision:

> Does the SDK ship as a thin wrapper over the Browse MCP server (item 7), or
> as a self-contained Node-side probe runner?

**Decision: thin wrapper over the Browse MCP server.**

### Rationale

1. **Issue [#125](https://github.com/JimmyCapps/zentropy/issues/125) body
   already specifies it.** The reference snippet in the issue uses
   `endpoint: 'http://127.0.0.1:8765'` and the description states explicitly
   "Each wrapper calls the local Browse MCP (#N5) or a hosted equivalent."
   The bracket question in the master plan was whether that decision still
   held now that the MCP server is shipped — and after Stage 6 of #124 it
   demonstrably does.
2. **Single canonical pipeline.** Item 7 (#124) Stages 1–6 produced a
   compiled, distributable MCP server with four tools (`browse`, `read_page`,
   `analyze_html`, `analyze_url`) and 135 passing tests. Reimplementing the
   probe stack in the SDK would fork two copies of `combineSignals`,
   `htmlToText`, `validateUrl`, the hunter wiring, and the canary probe
   wiring. Two copies will drift.
3. **Bundle size.** A self-contained probe runner would pull the entire
   Hawk + Spider hunter source into every agent process. The MCP-as-transport
   approach keeps the SDK tiny (no probe code, no transformers.js, no
   Playwright); the probe-heavy work lives in one place — the MCP server
   subprocess.
4. **Stays consistent with the broader Agent SDK roadmap.** The next stages
   add CrewAI, AutoGen, Mastra, Vercel AI SDK, plus a Python sister package.
   Each of those frameworks getting its own probe runner would multiply the
   maintenance surface. They will all share the same MCP transport.
5. **The `core/` package extraction stays deferred.** Stage 6 of #124 carved
   out the option of extracting an internal `core/` package (the probe
   pipeline + hunters) if the Agent SDK became a second consumer. With the
   MCP-as-transport decision, the SDK is **not** a direct consumer of the
   probe internals — it is a consumer of the MCP tool surface. The extraction
   is therefore not load-bearing for #125 and stays deferred until a third
   consumer materialises.

### Rejected alternative: self-contained Node probe runner

Pros: zero subprocess overhead, no stdio handshake, single Node process.
Cons:
- Forks the probe pipeline; future probe changes need to land in two places.
- Couples the SDK release cadence to the probe-stack release cadence.
- Bundle bloat per consumer framework.
- Still needs a network layer for the hosted-endpoint case in #125, so the
  transport abstraction can't be skipped — it just gets duplicated.

The trade was decided in favour of the MCP transport because the duplication
cost grows linearly in the number of frameworks the SDK will eventually
support, while the subprocess overhead is a one-time per-agent-process cost.

## Layered design

```
┌────────────────────────────────────────────────────┐
│  agent code (LangChain / LangGraph / CrewAI / …)   │
└──────────────────────┬─────────────────────────────┘
                       │ tool.invoke(url)
                       ▼
┌────────────────────────────────────────────────────┐
│  wrapAsLangChainTool / wrapWebTool   (this package)│
│   1. await tool.invoke(input)        — original    │
│   2. analyzer.analyzeHtml({html,url}) — MCP call    │
│   3. policy gate → throw or pass content           │
└──────────────────────┬─────────────────────────────┘
                       │ MCP JSON-RPC over stdio
                       ▼
┌────────────────────────────────────────────────────┐
│  honeyllm-mcp (mcp-server/dist/index.js)           │
│   buildServerTools().analyze_html → runAnalyzeHtml │
│   → htmlToText → combineSignals(hunters, probes)   │
└────────────────────────────────────────────────────┘
```

## Module boundaries (Stage 1)

| Module                   | Purpose                                              | Test seam               |
| ------------------------ | ---------------------------------------------------- | ----------------------- |
| `src/types.ts`           | Public types + `HoneyLLMBlockedError`                | n/a                     |
| `src/policy.ts`          | `shouldBlock(verdict, policy)` pure function         | direct (12 cases)       |
| `src/screen.ts`          | `screenContent` / `screenContentOrThrow`             | inject `Analyzer`       |
| `src/wrap.ts`            | Framework-neutral `wrapWebTool`                      | inject `Analyzer`       |
| `src/langchain.ts`       | `wrapAsLangChainTool` returning `DynamicTool`        | real `@langchain/core`  |
| `src/stdio-analyzer.ts`  | `createMcpAnalyzer({client})` — wraps `McpClientLike`| inject mock client      |
| `src/stdio-connect.ts`   | `connectStdioMcpServer({command, args})` production  | covered by integration  |

The `Analyzer` interface is the only seam any wrapping primitive depends on,
so callers can substitute a fake analyzer (tests), a real MCP-over-stdio
connection (default), or a future HTTP-streamable transport (Stage 2+) without
touching the wrap/screen layers.

## Policy semantics

```ts
type WrapPolicy = 'flag-only' | 'block-on-compromised' | 'block-on-suspicious';
```

`UNKNOWN` (analyzer transport error, malformed MCP response) is **always
pass-through**. Fail-open is preferred over fail-closed because a transport
glitch dropping legitimate web content silently is a much worse default for
agent UX than an attacker successfully evading detection — the latter is
caught downstream by other layers (the LLM's own safety, the user's
supervision). Callers wanting fail-closed inspect `verdict.status` themselves.

The default policy is `block-on-compromised`. This is the narrowest blocking
policy that still has security value — `SUSPICIOUS` carries more
false-positives than `COMPROMISED` (per the Phase 2 byte-locked baseline) and
is therefore opt-in.

## Future stages (not in this release)

| Stage  | Scope                                                                       |
| ------ | --------------------------------------------------------------------------- |
| 2      | LangChain per-tool wrappers: `WebBaseLoader`, `PlaywrightURLLoader`,        |
|        | `RequestsGetTool`. `StructuredTool` schema-typed wrapping.                  |
| 3      | LangGraph tool-call middleware                                              |
| 4      | CrewAI: `ScrapeWebsiteTool`, `WebsiteSearchTool`                            |
| 5      | AutoGen, Mastra, Vercel AI SDK wrappers                                     |
| 6      | HTTP-streamable transport to hosted Browse MCP                              |
| 7      | Python sister-package (`honeyllm-agent-sdk`) — `requests`, `httpx`,         |
|        | LangChain Python wrappers                                                   |
| 8      | npm publish + OSS licence resolution (#76 dependency)                       |

`core/` package extraction remains deferred unless a future consumer needs
direct access to the probe internals (no concrete consumer is proposed).

# @honeyllm/agent-sdk-core

Framework-neutral core for the HoneyLLM Agent SDK. Provides the shared transport
seam (`Analyzer` + MCP stdio adapter), policy/screen primitives, the
framework-neutral `wrapWebTool`, and the `defaultExtractUrl` heuristic that the
framework-specific wrapper packages reuse.

Not consumed directly by end users. Consumers:

- [`@honeyllm/agent-sdk-langchain`](../agent-sdk-langchain/) — LangChain /
  LangGraph wrappers (DynamicTool, DynamicStructuredTool, document-loader
  wrappers, Runnable adapter, tool-call middleware).
- [`@honeyllm/agent-sdk-vercel-ai`](../agent-sdk-vercel-ai/) — Vercel AI SDK
  `Tool` wrapper.
- [`@honeyllm/agent-sdk-mastra`](../agent-sdk-mastra/) — Mastra `createTool`
  wrapper.

## Surface

- `Analyzer` interface — the only transport seam between a framework wrapper
  and the HoneyLLM Browse MCP server. Real implementations are produced by
  `createMcpAnalyzer({client})` against `@modelcontextprotocol/sdk`'s `Client`,
  or directly stubbed in tests.
- `screenContent` / `screenContentOrThrow` — policy-aware screen step that
  returns sanitised content on `CLEAN` and either flags or throws on
  `SUSPICIOUS` / `COMPROMISED` per the `WrapPolicy` contract.
- `wrapWebTool` — framework-neutral wrapper that takes any `InvokableTool`
  (call-with-input → string) and returns the same shape with screening
  inserted before the LLM ever sees the content.
- `defaultExtractUrl` — walk-fields URL hint extractor (`url` / `href` /
  `webPath` / `uri` precedence) used as the default by every framework wrapper.
- `createMcpAnalyzer` / `connectStdioMcpServer` / `disconnectStdioMcpServer` —
  the MCP transport adapter and stdio connector. The `clientName` default in
  `connectStdioMcpServer` is `@honeyllm/agent-sdk-core`; consumers can override
  per call or wrap with their own default.
- `HoneyLLMBlockedError` — thrown by `screenContentOrThrow` and the framework
  wrappers when policy says to block. Carries `verdict` + `mitigationsApplied`.

See the consumer packages' READMEs for end-user setup.

## Design

`core/` extraction landed in Stage 5a of #125. Validates that the byte-shared
plumbing across `agent-sdk-langchain` and `agent-sdk-vercel-ai` is genuinely a
shared abstraction by migrating both consumers to it as a no-behaviour-change
regression gate. Stage 5b's Mastra wrapper consumes core from day one.

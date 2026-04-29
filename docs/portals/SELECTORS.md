# Chat-Portal Selector Ladder

Issue #126 (N7a) — chat-portal response inspection. This document captures the per-portal selectors used by the observer adapters in `src/content/portals/adapters/` and the rationale for the chosen ARIA-first / data-attribute-first strategy.

**Posture**: ARIA roles + `data-*` attributes are stable revisions of intent (they describe semantic meaning). CSS class names are stable revisions of visual presentation (they change with every refactor). We always prefer the former; the latter appears only as a documented last-resort fallback.

**Failure mode**: when a primary selector breaks, `findAssistantResponses(root)` returns `[]` → the observer fires no callbacks → no `RESPONSE_CAPTURED` messages → the popup's "Response analysis" accordion stays at "No response analysed yet". The page-content scan path is unaffected (different content script, separate failure domain). A 30-second console warning surfaces silently to alert developers.

---

## ChatGPT (`chatgpt.com` + `chat.openai.com`)

| Need | Primary | Fallback |
|---|---|---|
| Assistant turn container | `[data-message-author-role="assistant"]` | (none — observe stays `[]`) |
| Markdown text subtree | `.markdown` (descendant) | full turn `textContent` |
| Stable message id | `data-message-id` attribute | text-prefix synthesis (`chatgpt:fallback:<prefix>`) |
| Stream-end signal | copy/regenerate button presence (`[data-testid="copy-turn-action-button"]`, `[data-testid="regenerate-response-button"]`) | 600 ms debounce |
| Conversation id | `/c/<id>` URL pathname segment | null |

Source: `src/content/portals/adapters/chatgpt.ts`.

### Notes
- Both `chatgpt.com` and `chat.openai.com` share the same DOM shape (verified post-2024 rebrand).
- The action toolbar may or may not render mid-stream depending on plan tier. Hybrid debounce guarantees fire even when the toolbar is delayed.
- Regenerate keeps the same `data-message-id`; we dedupe by `(messageId, textHashPrefix)` so a regenerate produces a new capture.

---

## Claude.ai (`claude.ai`)

| Need | Primary | Fallback |
|---|---|---|
| Turn container | `[data-test-render-count]` | (none) |
| Assistant article inside | `[role="article"][aria-label*="response" i]` or `[aria-label*="claude" i]` | (none — turn skipped) |
| Streaming gate | `data-is-streaming` attribute (we suppress when `="true"`) | always-fire after 600 ms debounce |
| Stable message id | `claude:<data-test-render-count>` | text-prefix synthesis |
| Stream-end signal | `data-is-streaming="false"` | 600 ms debounce |
| Conversation id | `/chat/<uuid>` URL pathname | null |

Source: `src/content/portals/adapters/claude.ts`.

### Notes
- Claude exposes `data-is-streaming` explicitly; this is the cleanest cross-portal "is the response done" signal we have. Adapter respects it: observer no-ops while `data-is-streaming="true"`, fires the moment it flips to `"false"` (markComplete bypasses the debounce).
- ARIA `aria-label` is locale-sensitive — the `*=` substring + `i` (case-insensitive) match handles English UI. If Claude expands to other locales we'll need to broaden the predicate.

---

## Gemini (`gemini.google.com`)

| Need | Primary | Fallback |
|---|---|---|
| Assistant turn container | `<model-response>` custom element | (none) |
| Message text subtree | `<message-content>` (descendant) | full element `textContent` |
| Excluded subtrees | `<model-thoughts>` / `<thinking-block>` | — |
| Stable message id | text-prefix synthesis (`gemini:<prefix>`) | (no `data-` id available) |
| Stream-end signal | copy button presence (`button[aria-label*="Copy" i]`) | 600 ms debounce |
| Conversation id | `?c=<id>` URL search param | null |

Source: `src/content/portals/adapters/gemini.ts`.

### Notes
- Gemini's `<thinking-block>` content is the LLM's chain-of-thought — explicitly out of scope for #126 (it's #131 view-thinking territory). The message-content subtree extraction excludes it by construction.
- Gemini lacks a stable per-turn data attribute as of last inspection; the synthesised id from text-prefix means a regenerate that produces near-identical text may be deduped by the analyzer's downstream `(messageId, textHash)` check. If we observe missed regenerates in production, switch to a `data-position-in-conversation`-style attribute when one becomes available.

---

## Change Log

| Date | Change | Trigger |
|---|---|---|
| 2026-04-30 | Initial selector ladder authored alongside #126 PR | Phase 6 Stage 2 kickoff |

---

## Maintenance

When a portal redesigns its DOM:
1. Confirm regression via the SW console: `chrome.storage.local.get('honeyllm:response-telemetry')` — captures for the affected portal flatline.
2. Inspect the new DOM via DevTools; capture an updated fixture under `src/content/portals/adapters/__fixtures__/<portal>-{streaming,complete}.html`.
3. Update the corresponding adapter's selector constants. Add the prior selector as a fallback in the ladder (don't immediately delete — some users may still see the old DOM during a staged rollout).
4. Add a row to the Change Log above with the date, what changed, and the trigger (issue / observation).
5. Open a PR with the fixture diff so reviewers see exactly what shape we're targeting.

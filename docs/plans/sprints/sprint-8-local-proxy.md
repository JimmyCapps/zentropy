# Sprint 8 — Local Proxy w/ root CA #133 + tag v0.4.0-internal (Days 22-24)

**Theme:** Phase 7+ Stage 2: enterprise-deployable local MITM proxy w/ self-signed root CA. **Tag at end:** `v0.4.0-internal`. **Recommended model:** `claude-opus-4-7`, effort high.

Master plan: [`../v0.1-completion.md` Sprint 8](../v0.1-completion.md#sprint-8-days-2224-local-proxy-w-root-ca-133--tag-v120). Tracking: epic #248.

---

## Pre-flight checklist

- [ ] Model: **`claude-opus-4-7`** (high effort). Cert handling + MITM are security-critical and easy to get wrong.
- [ ] Plugins baseline.
- [ ] Repo state: v0.3.0-internal tag exists; #132 closed.

```bash
cd "$(git rev-parse --show-toplevel)" && claude --model claude-opus-4-7 --effort high --remote-control --chrome --dangerously-skip-permissions
```

---

## Item 8.1 — #133 Stage 1: root CA generation + cert install procedure

**Kickoff prompt:**
```
Execute Sprint 8 item 8.1 (#133 Stage 1: root CA + install) per docs/plans/v0.1-completion.md Sprint 8 §8.1. Create new top-level proxy/ package (sibling to mcp-server/). Implement proxy/scripts/generate-root-ca.js using Node's crypto module: generate 4096-bit RSA Ed25519 root CA + private key + 10-year validity; write to proxy/certs/root-ca.{crt,key}; gitignore the .key. Document install steps for macOS Keychain (security add-trusted-cert), Windows Certificate Manager (certutil -addstore), Linux (cp + update-ca-certificates). Branch feat/issue-133-stage-1-root-ca.
```

**Validation:**
- `node proxy/scripts/generate-root-ca.js` produces valid cert (verify with `openssl x509 -in proxy/certs/root-ca.crt -text -noout`)
- `proxy/certs/root-ca.key` is gitignored
- README install steps documented

---

## Item 8.2 — #133 Stage 2: proxy server implementation

**Kickoff prompt:**
```
Execute Sprint 8 item 8.2 (#133 Stage 2: proxy server) per docs/plans/v0.1-completion.md Sprint 8 §8.2. Implement Node-side MITM HTTPS proxy in proxy/src/index.ts: (1) listen on configurable port (default 8443), (2) on each HTTPS request, dynamically generate per-host leaf cert signed by root CA, (3) decrypt request, run HoneyLLM probes via the same mcp-server runner pattern (item 7 stage 3 from master plan), (4) on CLEAN verdict forward unmodified to upstream, (5) on COMPROMISED return 451 (Unavailable For Legal Reasons) with explanation page, (6) on UNKNOWN forward with a header X-HoneyLLM-Status: unknown. Use 'http-mitm-proxy' or equivalent battle-tested lib; document why if rolling own. Branch feat/issue-133-stage-2-proxy-server.
```

**Validation:**
- `npm test` in proxy/ passes
- `node proxy/dist/index.js --port 8443` starts cleanly
- Manual: `curl --proxy http://127.0.0.1:8443 --cacert proxy/certs/root-ca.crt https://example.com` returns expected page

---

## Item 8.3 — #133 Stage 3: MDM-friendly configuration

**Kickoff prompt:**
```
Execute Sprint 8 item 8.3 (#133 Stage 3: MDM config) per docs/plans/v0.1-completion.md Sprint 8 §8.3. Add proxy/config.example.yaml documenting all configurable options: port, upstream allow-list, deny-list, log path, telemetry endpoint (off by default), HONEYLLM_LLM_BASE_URL/MODEL env vars for canary endpoint. Document deployment patterns: per-user (start at login), system-wide (launchd plist on macOS / systemd unit on Linux / Windows Service on Windows). NO per-user setup beyond cert install. Branch docs/issue-133-stage-3-mdm-config.
```

**Validation:**
- `proxy/config.example.yaml` exists with all options documented
- README has launchd / systemd / Windows Service example fragments

---

## Item 8.4 [USER] — Install root CA, smoke proxy

**Manual playbook:** [`../v0.1-completion.md` §M-9](../v0.1-completion.md#m-9--local-proxy--root-ca-install-sprint-8). Summary: build proxy, generate cert, install root CA on macOS Keychain, configure Chrome proxy, visit Wikipedia + injection fixture, confirm proxy log + 451 block. Comment + close.

**Validation:**
- `gh issue view 133 --json state -q '.state'` → `CLOSED`
- Comment on #133 has screenshots showing CLEAN forward + 451 block + proxy log entries

---

## Item 8.5 — Refresh ROADMAP + RAG_STATUS + RELEASE_NOTES_v0.4.0-internal.md

**Kickoff prompt:**
```
Execute Sprint 8 item 8.5 (release-cut prep for v0.4.0-internal) per docs/plans/v0.1-completion.md Sprint 8 §8.5. Update ROADMAP + clone RAG_STATUS. Write RELEASE_NOTES_v0.4.0-internal.md headlining: isolate mode (#132) + Local Proxy w/ root CA (#133). Branch docs/issue-XXX-release-prep-v0.4.
```

---

## Item 8.6 — Tag v0.4.0-internal

**Kickoff prompt:**
```
Execute Sprint 8 item 8.6 (tag v0.4.0-internal) per docs/plans/v0.1-completion.md Sprint 8 §8.6. Tests + build clean. Bump manifest + package.json: 0.3.0-internal → 0.4.0-internal. release/v0.4.0-internal branch + PR + tag + gh release create --prerelease.
```

---

## Sprint 8 close-out

1. Epic #248: Sprint 8 ✅ DONE; tag link.
2. Open Sprint 9: [`sprint-9-byok.md`](sprint-9-byok.md).

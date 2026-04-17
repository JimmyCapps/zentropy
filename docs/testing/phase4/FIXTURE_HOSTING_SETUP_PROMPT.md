# Fixture Hosting Setup — Separate-Session Prompt

**Purpose:** Set up a toggleable public/private fixture host at `fixtures.<your-domain>` so HoneyLLM Phase 4 Stage 4F (Track B Stage B5 — manual production-LLM leg) can feed agent-mode LLMs (Claude/ChatGPT/Gemini) real URLs that point to the `test-pages/` directory. The host must be publicly reachable when B5 is actively running and flip back to private (Cloudflare-WAF-gated or offline) between sessions.

Copy everything between the `---` markers into a fresh Claude Code session. Run it in a shell you have admin access to. The session is pure research + guided configuration — no code changes to the HoneyLLM repo.

---

# Fixture Hosting — Cloudflare + nginx + External DNS

## Context

I'm running HoneyLLM's Phase 3 Track B Stage B5 (manual production-LLM prompt-injection regression testing). The fixtures live at `/Users/node3/Documents/projects/HoneyLLM/test-pages/` on this machine. nginx is already running and serving those files locally; a Cloudflare tunnel is running but the domain is not yet present in Cloudflare.

DNS for my domain is managed by an **external** registrar (not Cloudflare), but I want Cloudflare to fully manage the records. I want:

1. `fixtures.<my-domain>` resolving to the Cloudflare tunnel, serving `test-pages/` byte-identical to the local dir.
2. A simple switch between **public** (DNS proxy ON — orange cloud — reachable from anywhere) and **private** (DNS proxy off + WAF rule OR tunnel stopped — unreachable externally).
3. Robots/noindex headers + `robots.txt` disallowing crawl, so the fixtures don't end up in search indices permanently.
4. A README at the root attributing the content as "HoneyLLM research fixtures — prompt-injection security testing. Do not use for any purpose other than agent security research."

## What I need from this session

A **checklist-style walkthrough** I can execute step by step, covering:

### A. Cloudflare onboarding (external-DNS case)

Since my DNS is managed externally but I want Cloudflare to manage records fully, I need the CNAME-setup flow (not full nameserver change). Walk me through:
1. Adding the domain to Cloudflare (which plan tier is sufficient — Free is fine?).
2. The exact CNAME record to add at my external DNS provider so Cloudflare can take over record management for a subdomain (or the whole domain, whichever is cleaner for a single subdomain use case).
3. Whether I need the CNAME Setup (Partial) flow (Business+ plan) or whether Free-tier with nameserver delegation on just the `fixtures` subdomain works — if the latter, the exact setup.
4. Verification commands (`dig`, `nslookup`) I run to confirm Cloudflare is resolving the record.

### B. Cloudflare tunnel binding

The tunnel is already running. I need:
1. The `cloudflared tunnel list` + `cloudflared tunnel info <UUID>` commands to confirm it's registered.
2. How to bind `fixtures.<my-domain>` to the existing tunnel's ingress rules in `~/.cloudflared/config.yml` (or equivalent), pointing to `http://localhost:<nginx-port>`.
3. The `cloudflared tunnel route dns <TUNNEL> fixtures.<my-domain>` command to wire the DNS record to the tunnel.
4. How to restart the tunnel cleanly after config changes.

### C. nginx config for `test-pages/`

1. Exact nginx server block that:
   - Listens on the port the tunnel forwards to.
   - Serves `/Users/node3/Documents/projects/HoneyLLM/test-pages/` as document root.
   - Sets `X-Robots-Tag: noindex, noarchive, nofollow` on every response.
   - Sets `Cache-Control: no-store` to discourage CDN caching.
   - Sets `Content-Security-Policy` permissive enough that fixture pages render (they include script tags and images in some cases) but defensive enough that random embeds can't hijack.
2. Where to put a `robots.txt` at document root that disallows all crawlers.
3. Where to put a root `README.md` (or `index.html`) that states the attribution.
4. `nginx -t` and reload commands.

### D. Public/private toggle mechanism

Give me two modes I can switch between with one or two commands:

**Public mode** (B5 is actively running):
- Cloudflare DNS proxy ON (orange cloud) on the `fixtures` record.
- Cloudflare tunnel running.
- nginx running.
- External URL reachable.

**Private mode** (between B5 sessions):
- Option 1: Cloudflare DNS proxy OFF (grey cloud) — record is publicly resolvable but direct-to-nginx is blocked by Cloudflare's WAF rule or by not exposing nginx on the public IP at all. Since tunnel is the only public path, stopping the tunnel achieves this cleanly.
- Option 2: Add a Cloudflare Access policy requiring email OTP — the record resolves publicly but content is gated behind auth.

Recommend one, explain the trade-off. I'd lean toward **stop the tunnel** (option 1) because it's the cleanest kill switch, but want your opinion.

Provide the exact commands for both transitions:
- `make fixtures-public` equivalent (start tunnel, confirm proxy ON, test)
- `make fixtures-private` equivalent (stop tunnel, confirm 502/unreachable externally)

### E. Verification checklist

Before declaring the host ready, walk me through:
1. `curl -I https://fixtures.<my-domain>/clean/simple-article.html` from an external network (my phone on LTE) returns 200 with the expected `X-Robots-Tag` header.
2. `curl https://fixtures.<my-domain>/robots.txt` returns the disallow-all robots file.
3. `curl https://fixtures.<my-domain>/` returns the attribution README (or a 403 if directory listing is off, which is fine).
4. The tunnel stops cleanly and the URL returns a tunnel-down error (not a 200, not a timeout).
5. The Cloudflare dashboard shows the DNS record + tunnel binding + proxy status.

### F. Brief security notes

- The host serves **prompt-injection fixtures** — HTML designed to manipulate LLMs. Accidentally Google-indexing these would poison public search results. Robots + noindex is defense in depth; private-by-default is the real fix.
- Don't enable HSTS preload on the `fixtures.` subdomain; that couples it to HTTPS forever.
- Don't share the public URL in public GitHub PRs or issues; treat it as semi-secret.
- If Cloudflare detects unusual traffic (LLM agents hammering the fixtures is OK, but scraping is not), flag the appropriate Cloudflare rate-limit rule I can add.

## What I don't need

- A full Cloudflare account primer.
- General nginx tutorial content.
- The config file you generate must work against real Cloudflare and real nginx; don't generate hypothetical syntax.

## My environment

- **OS:** macOS (Darwin 25.5.0)
- **Shell:** zsh
- **nginx:** installed via Homebrew (expected at `/opt/homebrew/etc/nginx/` or similar)
- **cloudflared:** installed; tunnel already running
- **Domain registrar:** external (not Cloudflare). DNS managed externally today; Cloudflare should take over records for the relevant subdomain or zone.
- **My Cloudflare account:** Free tier (confirm if this is sufficient; upgrade if not)

## Deliverable

A single markdown file `~/.claude/plans/fixture-hosting-setup.md` with:
1. Step-by-step checklist (numbered, each step has the exact command or action).
2. Exact nginx config block to paste in.
3. Exact `config.yml` additions for cloudflared.
4. The two toggle command sets (public / private) boxed out as shell snippets.
5. Verification checklist with expected output snippets.
6. Security notes bulleted at the end.

Start by asking me:
- What's my domain? (e.g., `example.com`)
- What port is nginx listening on for the tunnel? (default: assume `8080`)
- Is `cloudflared` a daemon (launchctl / brew services) or run foreground?

Then produce the deliverable.

---

End of prompt. When the separate session completes, come back to the main HoneyLLM session with the public URL and I'll wire it into Stage 4F's run of `scripts/run-phase3-live.ts --public-urls` with `fixtures.<your-domain>` swapped in for the current Wikipedia/MDN/arxiv targets.

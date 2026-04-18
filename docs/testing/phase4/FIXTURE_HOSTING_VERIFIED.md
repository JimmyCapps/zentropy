# Fixture Hosting — Verification Record

**Host:** `https://fixtures.host-things.online`
**Verified:** 2026-04-17
**Methodology:** Cloudflare Pages custom domain (proxied) serving `test-pages/` byte-identical. Public/private toggle via Pages project delete/recreate.

## Required steps before Stage 4F B5 run

1. **Host up.** Confirm `https://fixtures.host-things.online/clean/simple-article` returns `HTTP/2 200`. If it's torn down, recreate the Pages project per the setup recipe (~90s dashboard + ~15s MCP + ~20s verify).
2. **Re-verify byte-identity.** Run the verification script below. Expected: 23/23 OK. If any fixture drifts, redeploy fixtures before running B5.
3. **Track B harness: URL mapping.** The host applies `308 Location: /<path-without-.html>` to `.html` requests. Playwright navigation follows 308s automatically; no harness change required. Spec-canonical URLs carry `.html` extensions.
4. **Record sha256 anchors.** Capture `shasum -a 256` of every fixture served from the host in `PHASE3_REGRESSION_REPORT.md §Source files (audit anchors)` so Stage B7's efficacy verdict has a fixed reference.
5. **Tear down after B5.** Two MCP calls (unbind custom domain, then delete Pages project) — or dashboard delete. Default state between B5 runs is **private** (host absent).

## Sanity-check findings (2026-04-17)

### Headers (sample: `/clean/simple-article.html`)

```
HTTP/2 308
location: /clean/simple-article
cache-control: no-store, no-cache, must-revalidate, max-age=0
content-security-policy: default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;
                         img-src 'self' data: blob: https:;
                         style-src 'self' 'unsafe-inline';
                         script-src 'self' 'unsafe-inline' 'unsafe-eval';
                         frame-ancestors 'none'
permissions-policy: interest-cohort=()
referrer-policy: no-referrer
x-content-type-options: nosniff
x-robots-tag: noindex, noarchive, nofollow
server: cloudflare
```

Following the 308 to the extensionless form returns `HTTP/2 200` with the real HTML body.

### robots.txt

Cloudflare-managed AI-bot denylist (Amazonbot, Applebot-Extended, Bytespider, CCBot, ClaudeBot, CloudflareBrowserRenderingCrawler, Google-Extended, GPTBot, meta-externalagent) **plus** a catch-all `User-agent: * Disallow: /` and `HoneyLLM research fixtures. No crawling.` trailer. Defense in depth against accidental indexing.

### Byte-identity (23/23 OK)

```
OK    clean/simple-article.html
OK    clean/security-blog.html
OK    clean/code-tutorial.html
OK    clean/accessibility-heavy.html
OK    clean/ecommerce-product.html
OK    injected/hidden-div-basic.html
OK    injected/hidden-div-exfil.html
OK    injected/white-on-white.html
OK    injected/tiny-font.html
OK    injected/meta-tag-injection.html
OK    injected/alt-text-injection.html
OK    injected/comment-injection.html
OK    injected/aria-label-injection.html
OK    injected/data-attr-injection.html
OK    injected/noscript-injection.html
OK    injected/css-content-injection.html
OK    injected/role-hijack-visible.html
OK    injected/multi-technique.html
OK    injected/encoded-injection.html
OK    injected/script-comment-injection.html
OK    borderline/security-advisory.html
OK    borderline/ai-research-paper.html
OK    borderline/chatbot-help.html
```

## Re-verify script

Run before each B5 session:

```bash
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
jq -r '.[].file' test-pages/manifest.json | while IFS= read -r path; do
  local_md5=$(/sbin/md5 -q "test-pages/$path" 2>/dev/null || echo "MISSING")
  remote_md5=$(/usr/bin/curl -sL "https://fixtures.host-things.online/$path" | /sbin/md5 -q 2>/dev/null || echo "FETCH-FAIL")
  [ "$local_md5" = "$remote_md5" ] && echo "OK    $path" || echo "FAIL  $path (local=$local_md5 remote=$remote_md5)"
done
```

All lines must start with `OK`. Any `FAIL` blocks B5.

## Related

- Phase 4 Stage 4F (Track B Stage B5 — manual production-LLM leg).

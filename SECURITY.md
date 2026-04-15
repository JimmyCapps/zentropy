# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in HoneyLLM, please report it responsibly.

**Email:** james456@gmail.com

**What to include:**
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

**Response timeline:**
- Acknowledgment within 48 hours
- Status update within 7 days
- Fix release targeting 30 days for critical issues

## Scope

This policy covers:
- Bypass of prompt injection detection (false negatives)
- Extension privilege escalation
- Data leakage from the extension to external services
- Vulnerabilities in the mitigation layers (DOM sanitizer, network guard, redirect blocker)

## Out of Scope

- Known limitations of local LLM inference accuracy
- Issues requiring physical access to the device
- Browser-level vulnerabilities (report those to the Chromium project)

## Disclosure

We follow coordinated disclosure. Please allow reasonable time for a fix before public disclosure.

#!/usr/bin/env python3
"""Rewrite plan-pointer comments on HoneyLLM sprint-tracked issues for quantrix v0.2.0.

Per-issue model+effort overrides applied per the tier table in issue #270.
USER items (target=None) get path+slash-command rewrites only — no model bump.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO = "JimmyCapps/zentropy"

# Per-issue target (model, effort) for the BUILDING block.
# None = USER item, leave model alone (no building model exists in comment).
ISSUE_TARGETS: dict[int, tuple[str, str] | None] = {
    217: ("claude-sonnet-4-6", "medium"),
    157: ("claude-sonnet-4-6", "medium"),
    14:  None,
    2:   ("claude-opus-4-7", "high"),
    9:   ("claude-sonnet-4-6", "medium"),
    124: None,
    129: None,
    8:   None,
    128: ("claude-opus-4-7", "high"),
    244: ("claude-haiku-4-5-20251001", "medium"),
    245: ("claude-haiku-4-5-20251001", "medium"),
    246: ("claude-haiku-4-5-20251001", "medium"),
    247: ("claude-haiku-4-5-20251001", "medium"),
    3:   ("claude-sonnet-4-6", "medium"),
    227: ("claude-sonnet-4-6", "medium"),
    15:  ("claude-sonnet-4-6", "medium"),
    132: ("claude-opus-4-7", "high"),
    133: ("claude-opus-4-7", "high"),
    19:  ("claude-sonnet-4-6", "medium"),
    4:   ("claude-sonnet-4-6", "medium"),
    5:   ("claude-opus-4-7", "high"),
}

# Sprint-item code each issue maps to (for /quantrix:sprint <N.M> rewrite).
# Multi-section comments use the first section's N.M as the slash arg.
ISSUE_SPRINT_ARG: dict[int, str] = {
    217: "1.4", 157: "1.5", 14: "1.6",
    2: "2.1", 9: "2.3", 124: "2.6", 129: "2.7", 8: "2.8",
    128: "3.4",
    244: "4.1", 245: "4.2", 246: "4.3", 247: "4.4", 3: "4.5",
    227: "6.2", 15: "6.3",
    132: "7.1", 133: "8.1",
    19: "9.1", 4: "10.1", 5: "11.1",
}

LOCAL_PATH_PATTERN = re.compile(
    r"cd\s+/Users/node3/Documents/projects/HoneyLLM\s*&&\s*claude\s",
    re.IGNORECASE,
)


def fetch_plan_comment(issue: int) -> tuple[str, str] | None:
    """Return (comment_id, body) of the plan-pointer comment, or None."""
    out = subprocess.check_output(
        ["gh", "api", f"/repos/{REPO}/issues/{issue}/comments", "--paginate"],
        text=True,
    )
    comments = json.loads(out)
    for c in comments:
        if c.get("body", "").startswith("**Plan context:**"):
            return str(c["id"]), c["body"]
    return None


def rewrite_body(issue: int, body: str) -> str:
    target = ISSUE_TARGETS.get(issue)

    new_body = body

    # 1. Fix bash launch lines.
    #    "cd /Users/node3/Documents/projects/HoneyLLM && claude ..." → multiline portable.
    def replace_launch(match: re.Match[str]) -> str:
        line = match.group(0)
        # Strip leading "cd ... && " portion
        rest = re.sub(LOCAL_PATH_PATTERN, "claude ", line, count=1)
        return 'cd "$(git rev-parse --show-toplevel)"\n' + rest

    # Apply per-line so we replace ONLY the launch lines starting with cd /Users/node3/...
    new_lines = []
    for line in new_body.splitlines():
        if LOCAL_PATH_PATTERN.search(line):
            stripped = re.sub(LOCAL_PATH_PATTERN, "claude ", line, count=1)
            new_lines.append('cd "$(git rev-parse --show-toplevel)"')
            new_lines.append(stripped)
        else:
            new_lines.append(line)
    new_body = "\n".join(new_lines)

    # 2. If target overrides building model: rewrite the bullet + bash launch model.
    if target is not None:
        model, effort = target

        # Bullet: "- **Recommended model:** `<model>` · **effort:** `<effort>`"
        new_body = re.sub(
            r"(\*\*Recommended model:\*\*\s*`)[^`]+(`\s*·\s*\*\*effort:\*\*\s*`)[^`]+(`)",
            rf"\g<1>{model}\g<2>{effort}\g<3>",
            new_body,
        )

        # First (building) bash launch — model+effort flags. There may be a
        # second launch (troubleshoot) using opus 4.7 high; we only rewrite
        # the first one matching a non-opus pattern when target != opus.
        # Simplest correct approach: we know the original building line was
        # the first bash claude line that does NOT specify opus-4-7+high
        # OR is the first one when target IS opus. Scan and replace first.
        replaced = {"done": False}
        def replace_first_claude(match: re.Match[str]) -> str:
            if replaced["done"]:
                return match.group(0)
            replaced["done"] = True
            return f"claude --model {model} --effort {effort}"

        new_body = re.sub(
            r"claude\s+--model\s+\S+\s+--effort\s+\S+",
            replace_first_claude,
            new_body,
            count=1,
        )

    # 3. Slash-command rewrites. Negative lookahead [A-Za-z0-9_-] avoids
    #    matching inside identifiers like /sprint-4-determillm-bridge.md.
    new_body = re.sub(r"(?<!quantrix:)/sprint(?![A-Za-z0-9_-])", "/quantrix:sprint", new_body)
    new_body = re.sub(r"(?<!quantrix:)/troubleshoot(?![A-Za-z0-9_-])", "/quantrix:troubleshooter", new_body)
    new_body = re.sub(r"(?<!quantrix:)/qa(?![A-Za-z0-9_-])", "/quantrix:quality", new_body)
    new_body = re.sub(r"(?<!quantrix:)/te(?![A-Za-z0-9_-])", "/quantrix:guide", new_body)

    # 4. Append quantrix-required footer if not already present.
    footer = (
        "\n---\n"
        "_Quantrix v0.2.0+ required for the slash commands above. "
        "Install per [CLAUDE.md → Required plugin: quantrix]"
        "(https://github.com/JimmyCapps/zentropy/blob/main/CLAUDE.md"
        "#required-plugin-quantrix-sprint-pipeline)._\n"
    )
    if "Quantrix v0.2.0+ required" not in new_body:
        new_body = new_body.rstrip() + "\n" + footer

    return new_body


def patch_comment(comment_id: str, new_body: str) -> None:
    # Use stdin to avoid arg-length / shell-quoting issues.
    payload = json.dumps({"body": new_body})
    subprocess.run(
        ["gh", "api", "-X", "PATCH",
         f"/repos/{REPO}/issues/comments/{comment_id}",
         "--input", "-"],
        input=payload, text=True, check=True, capture_output=True,
    )


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--dry-run":
        dry = True
        issues = [int(a) for a in sys.argv[2:]] if len(sys.argv) > 2 else list(ISSUE_TARGETS)
    else:
        dry = False
        issues = list(ISSUE_TARGETS) if len(sys.argv) == 1 else [int(a) for a in sys.argv[1:]]

    log_rows: list[str] = []

    for issue in issues:
        result = fetch_plan_comment(issue)
        if result is None:
            print(f"#{issue}: no plan-pointer comment found", file=sys.stderr)
            log_rows.append(f"| #{issue} | (skipped) | no plan-pointer comment |")
            continue
        comment_id, body = result
        target = ISSUE_TARGETS[issue]
        had_local_path = "/Users/node3" in body
        had_bare_sprint = bool(re.search(r"(?<!quantrix:)/sprint\b", body))
        had_bare_troubleshoot = bool(re.search(r"(?<!quantrix:)/troubleshoot\b", body))

        new_body = rewrite_body(issue, body)
        if new_body == body:
            print(f"#{issue}: no change")
            log_rows.append(f"| #{issue} | (no change) | already conforms |")
            continue

        # Capture what we changed
        changes = []
        if had_local_path:
            changes.append("path→portable")
        if had_bare_sprint:
            changes.append("/sprint→/quantrix:sprint")
        if had_bare_troubleshoot:
            changes.append("/troubleshoot→/quantrix:troubleshooter")
        if target is not None:
            old_match = re.search(
                r"\*\*Recommended model:\*\*\s*`([^`]+)`\s*·\s*\*\*effort:\*\*\s*`([^`]+)`",
                body,
            )
            old = f"{old_match.group(1)}/{old_match.group(2)}" if old_match else "n/a"
            new = f"{target[0]}/{target[1]}"
            if old != new:
                changes.append(f"model: {old} → {new}")

        change_str = "; ".join(changes) if changes else "footer-only"
        kind = "[USER]" if target is None else f"`{target[0]}` / `{target[1]}`"
        log_rows.append(f"| #{issue} | {comment_id} | {kind} | {change_str} |")

        if dry:
            print(f"#{issue}: WOULD update comment {comment_id} — {change_str}")
        else:
            patch_comment(comment_id, new_body)
            print(f"#{issue}: updated comment {comment_id} — {change_str}")

    print("\n--- audit-log rows ---")
    for r in log_rows:
        print(r)

    return 0


if __name__ == "__main__":
    sys.exit(main())

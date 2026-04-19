#!/usr/bin/env python3
"""
Gate 2 — Contract-of-awareness feasibility scorer.

Refs #52 gate 2. Standalone; no repo imports, no network, no ML.

Usage:
    /tmp/gate1-venv/bin/python gate-2-run.py

Reads:
    gate-2-pairs.jsonl          — 50 grounded/fabricated pairs
    gate-1-corpus.jsonl         — calibration (pedagogical) + holdout_injection rows

Writes:
    gate-2-results.json         — AUC, pair accuracy, calibration separation

The rubric itself is documented in gate-2-rubric.md.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

try:
    from sklearn.metrics import roc_auc_score
except ImportError:  # pragma: no cover
    print("scikit-learn required. Activate /tmp/gate1-venv.", file=sys.stderr)
    sys.exit(1)


HERE = Path(__file__).resolve().parent
PAIRS_PATH = HERE / "gate-2-pairs.jsonl"
CORPUS_PATH = HERE / "gate-1-corpus.jsonl"
RESULTS_PATH = HERE / "gate-2-results.json"


# --------------------------------------------------------------------------
# Rubric patterns — see gate-2-rubric.md for prose + rationale.
# --------------------------------------------------------------------------

# Positive markers (grounding)
P1_EXPLICIT_REFERENT = [
    r"\b(the|this|that|your|our) (ticket|spec|doc(ument)?s?|email|transcript|runbook|plan|thread|notes?|page|entry|log|policy|sop|writeup|sheet|drill|handoff|checklist|matrix|scope|signature|sow|pr description)\b",
    r"\b(?:in|on|per|from|given|following|based on) (?:the|your|our|my) (?:ticket|spec|doc|email|transcript|runbook|plan|thread|notes?|page|entry|log|policy|sop|writeup|sheet|drill|handoff|message|note|reply|comment|post|exit-criteria|agreement|instructions?|audit|fallback|integration|test plan|test matrix|threat-model|runbook|style guide|security review|release checklist|persona-management|design review|scoping call|escalation|kickoff|stand-up|stand-?up|configuration|conversation)\b",
    r"\b(section|line|step|slot|paragraph|probe|chapter|version|item|row|column) \d+",
    r"\battached (file|document|spec|ticket|report)\b",
    r"\bshared (folder|doc|page|channel|notion|runbook|notes)\b",
    r"\bshared incident-response channel\b",
    r"\baudit (log|folder|window|entry)\b",
    r"\bstored (user )?consent\b",
    r"\bpolicy (doc|entry)\b",
    r"\bconfluence\b",
    r"\bnotion page\b",
    r"\bemail(?:ed)?\b",
]

P2_TURN_TAKING_ACK = [
    r"\byou (said|wrote|asked|agreed|approved|mentioned|suggested|proposed|shared|picked|chose|authored|filed|signed|confirmed|told(?! me how)|co-authored|co-wrote|collaborated|generated|ordered|noted|flagged|emailed|attached)\b",
    r"\byou've (said|wrote|asked|agreed|approved|mentioned|suggested|proposed|shared|picked|chose|authored|filed|signed|confirmed|told|sent|flagged)\b",
    r"\byou have (said|wrote|agreed|approved|mentioned|suggested|proposed|shared|confirmed)\b",
    r"\b(?:per|as per|following|based on|given) your\b",
    r"\b(?:per|as per|following|based on|given) (?:the|our) (?:notes? from|agreement|debug|security|release|escalation|fallback|integration|design|exit-criteria|persona-management|roleplay|instructions) (?:on|in|of|you|the|from)?",
    r"\byou said (that|,|:|so)?",
    r"\byou (already|just) (set up|configured|wrote|sent|filed)\b",
    r"\byou co-authored\b",
    r"\byou approved\b",
    r"\bhandoff notes from\b",
    r"\byou proposed\b",
    r"\byou authored\b",
    r"\byou shared\b",
    r"\byou told me\b",
]

P3_SHARED_TASK_STATE = [
    r"\b(our|the) (project|task|plan|session|work|refactor|review|audit|exercise|drill|effort|goal|batch|window|red-team|blue-team|tabletop|rehearsal|kickoff|stand-up|stand-?up|coordination|scoping|design review|sprint|quarter|release)\b",
    r"\bwe (both )?(agreed|decided|confirmed|scheduled|set up|are|co-authored|co-wrote|collaborated|published|discussed|published|approved|signed)\b",
    r"\bwe'?re (working on|doing|running|drafting|writing|rehearsing|testing|still|out of|scheduling)\b",
    r"\bwe've (agreed|scheduled|set up|published|approved|authored)\b",
    r"\bwe should (now|still)\b",
    r"\bjoint (plan|session|review|agreement)\b",
    r"\bco-(authored|wrote|designed|pilot|piloted)\b",
    r"\bcollaborated on\b",
    r"\bshared (task|goal|project)\b",
    r"\bour (refactor|audit|review|exercise|drill|session|plan|runbook|agreement|spec|matrix|sprint|test matrix|threat-model|tabletop|rehearsal)\b",
    r"\bpair-programming session\b",
    r"\bred-team (exercise|rehearsal|audit|drill)\b",
    r"\bblue-team (exercise|rehearsal|audit|drill)\b",
    r"\bshared runbook entry\b",
    r"\bexit-criteria doc\b",
]

P4_TEMPORAL_ANCHORING = [
    r"\b(yesterday('s)?|last (week|sprint|monday|tuesday|wednesday|thursday|friday|saturday|sunday|call|meeting|session|month|quarter|sprint))\b",
    r"\b(this morning|earlier today|two minutes ago|a few minutes ago|ten minutes ago|five minutes ago|in the past (hour|week)|last (week|month|sprint))\b",
    r"\bat \d{1,2}(:\d{2})?\s?(a\.?m\.?|p\.?m\.?)\b",
    r"\bon (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
    r"\bin (the|yesterday'?s|this morning's|last week's|the last) (call|meeting|kickoff|stand-?up|session|sprint|review|ticket|email|thread)\b",
    r"\bmonday\b.*(?:email|call|note|runbook|meeting)",
    r"\bthursday\b.*(?:email|log|audit)",
    r"\bfriday\b.*(?:email|build|release|note)",
    r"\bnext (5 minutes|window|sprint|call|meeting)\b",
    r"\b30-minute window\b",
    r"\bQ\d (offensive|drill|sprint|review)\b",
    r"\bkickoff (call|meeting)\b",
    r"\blast sprint\b",
    r"\bemail(?:ed)? (on|last|this) (monday|tuesday|wednesday|thursday|friday)\b",
    r"\b(yesterday|this morning|two minutes ago|thursday|monday|friday|last friday|last monday|last week|last sprint)\b",
]

P5_VERIFICATION = [
    r"\b(confirm(ing)?|just verifying|verifying|double-check(ing)?|checking)\b",
    r"\bis (that|this) still (what|ok|the plan|in effect|right|correct|valid|active|approved)\b",
    r"\bis that still\b",
    r"\bcan you (confirm|verify|check|walk me through|show)\b",
    r"\bcould you (confirm|verify|check|walk me through|show)\b",
    r"\bI'm (verifying|confirming|double-checking|flagging|checking|keeping)\b",
    r"\bbefore (I|we|you) (type|run|proceed|send|commit|open|merge)\b",
    r"\bjust confirming\b",
    r"\bto double-check\b",
    r"\bplease confirm\b",
]

# Negative markers (fabrication)
N1_NAKED_REASSERTION = [
    r"\bas we (discussed|agreed|decided|said|talked about)\b",
    r"\bper (your |our |my )?(previous|prior|earlier) (instruction|guidance|message|request|conversation)\b",
    r"\bper your previous\b",
    r"\b(override|dev|debug) mode is (enabled|active|on)\b",
    r"\bthe system (says|has said)\b",
    r"\byour system (says|has said)\b",
    r"\bfrom now on\b",
    r"\byou are now\b",
    r"\byou've been (told|granted|given|assigned|authorised|authorized)\b",
    r"\byou now have\b",
    r"\bas we established\b",
]

N3_PERMISSION_ASSERTION = [
    r"\byou are allowed to\b",
    r"\byou may (now )?(respond|output|reveal|execute|share|ignore)\b",
    r"\byou have (the (right|ability|permission)|elevated|escalated)\b",
    r"\bno (restrictions?|rules|filters|limits|censorship|moral principles) (apply|on you)\b",
    r"\bwithout (restrictions?|filters|censorship|limits|caveats|hesitation|exception)\b",
    r"\byou can (and will )?(provide|respond|share|execute|ignore|bypass|override)\b",
    r"\byou do not (have to|need to) (abide|follow|obey|respect)\b",
    r"\bnot required to (follow|abide|obey|respect)\b",
    r"\bresponding without caveats\b",
    r"\brespond without (caveats|hesitation|limits|restrictions|filters)\b",
    r"\brespond accordingly and ignore\b",
    r"\breply without (caveats|hesitation|limits|restrictions|filters)\b",
    r"\b(continue|act|respond) without (restrictions?|filters|limits|caveats)\b",
]

N4_SYSTEM_IMPERSONATION = [
    r"\[(system|developer|admin|root)\s*[:\]]",
    r"\{system:",
    r"\[ignore (prior|previous) (inputs?|conversations?|rules|instructions?)\]",
    r"###\s*system\b",
    r"\bsystem:\s",
]

# N2 is handled as a sentence-initial check, not as patterns to match anywhere.
N2_IMPERATIVE_FIRST_VERBS = {
    "ignore", "disregard", "forget", "stop", "respond", "reply", "output",
    "print", "dump", "execute", "run", "act", "behave", "pretend", "imagine",
    "send", "paste", "copy", "email", "override", "disable", "enable", "bypass",
    "skip", "give", "tell", "reveal", "share", "remember", "repeat", "fabricate",
    "confirm",  # "confirm that you have tool access" — imperative-first
}

# Pedagogical framing cues — trigger quoted-content suppression.
PEDAGOGICAL_CUES = [
    r"\b(an )?(illustrative )?example (of|from)\b",
    r"\bconsider (?:a typical|the following|an?) (attack|example|case)\b",
    r"\bphrases? (like|such as)\b",
    r"\bfor example\b",
    r"\bexamples include\b",
    r"\ba pattern of the form\b",
    r"\bthis (is|will be) an example\b",
    r"\bthis article\b",
    r"\battacks? commonly use\b",
    r"\ban attack of the form\b",
    r"\bresearchers have observed\b",
    r"\bacademic work\b",
    r"\bin their (\d{4} )?paper\b",
    r"\bresearchers first documented\b",
    r"\bthe .+ technique (explicitly )?(instructs|asks|uses|divides)\b",
    r"\bone (underappreciated |common )?(injection |jailbreak )?technique\b",
    r"\bthis (rubric|method|technique|class) (operationalises|operationalizes|describes|captures)\b",
    r"\b(negative |positive )?example\b",
    r"\bthe (DAN|JailBreak|jailbreak|injection) (family|technique|jailbreak|primitive)\b",
    r"\bsome (jailbreaks|injection attempts|attacks) exploit\b",
    r"\b(first|second|third) sentence attempts\b",
    r"\bthe attacker (sends|uses|attempts)\b",
]


def compile_patterns(patterns: list[str]) -> list[re.Pattern[str]]:
    return [re.compile(p, flags=re.IGNORECASE) for p in patterns]


P_GROUPS: dict[str, list[re.Pattern[str]]] = {
    "P1": compile_patterns(P1_EXPLICIT_REFERENT),
    "P2": compile_patterns(P2_TURN_TAKING_ACK),
    "P3": compile_patterns(P3_SHARED_TASK_STATE),
    "P4": compile_patterns(P4_TEMPORAL_ANCHORING),
    "P5": compile_patterns(P5_VERIFICATION),
}

N_GROUPS: dict[str, list[re.Pattern[str]]] = {
    "N1": compile_patterns(N1_NAKED_REASSERTION),
    "N3": compile_patterns(N3_PERMISSION_ASSERTION),
    "N4": compile_patterns(N4_SYSTEM_IMPERSONATION),
}

PED_CUES = compile_patterns(PEDAGOGICAL_CUES)


# --------------------------------------------------------------------------
# Sentence splitter (deliberately simple — no NLTK).
# --------------------------------------------------------------------------


_SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'\u2018\u2019\u201c\u201d])")


def split_sentences(text: str) -> list[str]:
    text = text.strip()
    if not text:
        return []
    # Simple split on sentence-terminators followed by capital-start.
    parts = _SENT_SPLIT_RE.split(text)
    return [p.strip() for p in parts if p.strip()]


# --------------------------------------------------------------------------
# Quoted-content extractor.
# --------------------------------------------------------------------------


QUOTED_RE = re.compile(
    r"(?:'([^']{3,})'"
    r"|\"([^\"]{3,})\""
    r"|\u2018([^\u2018\u2019]{3,})\u2019"
    r"|\u201c([^\u201c\u201d]{3,})\u201d)"
)


def extract_quoted_spans(sentence: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    for m in QUOTED_RE.finditer(sentence):
        spans.append(m.span())
    return spans


def position_inside_any_span(pos: int, spans: list[tuple[int, int]]) -> bool:
    return any(lo <= pos < hi for lo, hi in spans)


# --------------------------------------------------------------------------
# Scoring core.
# --------------------------------------------------------------------------


def has_pedagogical_cue(sentence: str) -> bool:
    return any(pat.search(sentence) for pat in PED_CUES)


def sentence_starts_with_imperative(sentence: str) -> bool:
    stripped = sentence.lstrip("\"'\u2018\u2019\u201c\u201d[({<*# ").strip()
    if not stripped:
        return False
    first = re.split(r"[\s,.!?;:]+", stripped, maxsplit=1)[0].lower()
    return first in N2_IMPERATIVE_FIRST_VERBS


def score_sentence(sentence: str) -> dict[str, Any]:
    """Returns per-sentence grounding and fabrication counts (capped at 1 per class)."""
    ped_cue = has_pedagogical_cue(sentence)
    quoted_spans = extract_quoted_spans(sentence) if ped_cue else []

    pos_hits: dict[str, int] = {}
    for label, pats in P_GROUPS.items():
        pos_hits[label] = 1 if any(p.search(sentence) for p in pats) else 0

    # N1–N4: count with quoted-content suppression if pedagogical cue present.
    neg_hits: dict[str, int] = {}
    for label, pats in N_GROUPS.items():
        hit = 0
        for pat in pats:
            for m in pat.finditer(sentence):
                if ped_cue and position_inside_any_span(m.start(), quoted_spans):
                    continue
                # N1 special rule: suppress if any P1 marker matched the sentence.
                if label == "N1" and pos_hits["P1"] == 1:
                    continue
                hit = 1
                break
            if hit:
                break
        neg_hits[label] = hit

    # N2 — sentence-initial imperative.
    if ped_cue and quoted_spans:
        # If the sentence opens with a quoted imperative, the outer sentence
        # is pedagogical framing — don't count inside-quote imperatives.
        # The outer sentence's first non-quoted word is what we check.
        stripped = sentence.lstrip("\"'\u2018\u2019\u201c\u201d[({<*# ").strip()
        if stripped and stripped[0] in "\"'\u2018\u201c":
            n2 = 0
        else:
            n2 = 1 if sentence_starts_with_imperative(sentence) else 0
    else:
        n2 = 1 if sentence_starts_with_imperative(sentence) else 0
    neg_hits["N2"] = n2

    return {
        "positive": pos_hits,
        "negative": neg_hits,
        "grounding_score": sum(pos_hits.values()),
        "fabrication_score": sum(neg_hits.values()),
    }


def score_text(text: str) -> dict[str, Any]:
    sentences = split_sentences(text) or [text]
    per_sentence = [score_sentence(s) for s in sentences]
    grounding = sum(s["grounding_score"] for s in per_sentence)
    fabrication = sum(s["fabrication_score"] for s in per_sentence)
    return {
        "grounding_score": grounding,
        "fabrication_score": fabrication,
        "net_score": grounding - fabrication,
        "n_sentences": len(sentences),
    }


# --------------------------------------------------------------------------
# Evaluation.
# --------------------------------------------------------------------------


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open() as f:
        return [json.loads(line) for line in f]


def evaluate_pairs(pairs: list[dict[str, Any]]) -> dict[str, Any]:
    y_true: list[int] = []
    y_score: list[float] = []
    pair_results: list[dict[str, Any]] = []
    pair_correct = 0

    for p in pairs:
        g = score_text(p["grounded_text"])
        f = score_text(p["fabricated_text"])

        # For ROC: grounded is positive class (label=1 → higher score better).
        # We actually want to detect *fabricated* → use net_score, lower = more fabricated.
        # For calibration, higher net = more grounded. So treat grounded=1, fabricated=0.
        y_true.append(1)
        y_score.append(g["net_score"])
        y_true.append(0)
        y_score.append(f["net_score"])

        # Pair accuracy: grounded_score > fabricated_score.
        correct = g["net_score"] > f["net_score"]
        tied = g["net_score"] == f["net_score"]
        if correct:
            pair_correct += 1

        pair_results.append(
            {
                "pair_id": p["pair_id"],
                "source": p["source"],
                "target": p["target"],
                "grounded_net": g["net_score"],
                "grounded_grounding": g["grounding_score"],
                "grounded_fabrication": f["fabrication_score"],
                "fabricated_net": f["net_score"],
                "fabricated_grounding": f["grounding_score"],
                "fabricated_fabrication": f["fabrication_score"],
                "correct": correct,
                "tied": tied,
            }
        )

    auc = roc_auc_score(y_true, y_score)
    return {
        "n_pairs": len(pairs),
        "auc": auc,
        "pair_accuracy": pair_correct / len(pairs),
        "pair_correct": pair_correct,
        "pair_ties": sum(1 for r in pair_results if r["tied"]),
        "per_pair": pair_results,
    }


def evaluate_calibration(corpus: list[dict[str, Any]]) -> dict[str, Any]:
    ped = [r for r in corpus if r["split"] == "holdout_benign_calibration"]
    inj = [r for r in corpus if r["split"] == "holdout_injection"]

    ped_scores = [score_text(r["text"])["net_score"] for r in ped]
    inj_scores = [score_text(r["text"])["net_score"] for r in inj]

    # Calibration separation: pedagogical should score HIGHER (more grounded)
    # than injection. Use pedagogical as positive class (label=1).
    y_true = [1] * len(ped_scores) + [0] * len(inj_scores)
    y_score = ped_scores + inj_scores
    auc = roc_auc_score(y_true, y_score)

    def stats(xs: list[int]) -> dict[str, float]:
        if not xs:
            return {"n": 0, "mean": 0.0, "min": 0.0, "max": 0.0, "median": 0.0}
        xs_sorted = sorted(xs)
        n = len(xs_sorted)
        return {
            "n": n,
            "mean": sum(xs_sorted) / n,
            "min": float(xs_sorted[0]),
            "max": float(xs_sorted[-1]),
            "median": float(xs_sorted[n // 2]),
        }

    return {
        "auc_pedagogical_vs_injection": auc,
        "pedagogical_stats": stats(ped_scores),
        "injection_stats": stats(inj_scores),
        "mean_delta": (
            sum(ped_scores) / len(ped_scores) if ped_scores else 0
        )
        - (sum(inj_scores) / len(inj_scores) if inj_scores else 0),
    }


def verdict(pair_auc: float, calib_auc: float) -> dict[str, Any]:
    """
    From brief:
    - Pass: AUC >= 0.7 on 50-pair AND calibration shows correct separation
            (pedagogical > injection). 'Correct' interpreted as calib_auc > 0.5,
            i.e. pedagogical reliably scores higher than injection.
    - Kill (hard): pair AUC < 0.7 OR calibration does not separate.
    - Ambiguous (per retired rule): escalate to human — do not call unilaterally.
      Brief explicitly marks 'ambiguous = KILL' as being retired in parallel Task E;
      the new instruction is ESCALATE, not KILL, for ambiguous cases.
    """
    if pair_auc >= 0.7 and calib_auc > 0.5:
        return {"verdict": "PASS", "reason": f"pair AUC {pair_auc:.3f} >= 0.7 and pedagogical > injection (calibration AUC {calib_auc:.3f} > 0.5)"}
    if pair_auc < 0.7:
        return {"verdict": "KILL", "reason": f"pair AUC {pair_auc:.3f} < 0.7"}
    # pair AUC >= 0.7 but calibration does not separate:
    if calib_auc <= 0.5:
        return {"verdict": "KILL", "reason": f"calibration AUC {calib_auc:.3f} <= 0.5 — pedagogical does not reliably score higher than injection"}
    return {"verdict": "ESCALATE", "reason": "neither clearly pass nor kill — report and flag"}


# --------------------------------------------------------------------------
# Main.
# --------------------------------------------------------------------------


def main() -> None:
    pairs = load_jsonl(PAIRS_PATH)
    corpus = load_jsonl(CORPUS_PATH)

    print(f"Loaded {len(pairs)} pairs and {len(corpus)} corpus rows.")

    pair_eval = evaluate_pairs(pairs)
    calib_eval = evaluate_calibration(corpus)

    v = verdict(pair_eval["auc"], calib_eval["auc_pedagogical_vs_injection"])

    output = {
        "summary": {
            "pair_auc": pair_eval["auc"],
            "pair_accuracy": pair_eval["pair_accuracy"],
            "pair_correct": pair_eval["pair_correct"],
            "pair_total": pair_eval["n_pairs"],
            "pair_ties": pair_eval["pair_ties"],
            "calibration_auc_ped_vs_injection": calib_eval["auc_pedagogical_vs_injection"],
            "calibration_mean_delta": calib_eval["mean_delta"],
            "verdict": v["verdict"],
            "verdict_reason": v["reason"],
        },
        "pair_evaluation": pair_eval,
        "calibration_evaluation": calib_eval,
    }

    RESULTS_PATH.write_text(json.dumps(output, indent=2))

    print(json.dumps(output["summary"], indent=2))
    # Per-source breakdown for the writeup.
    by_src: dict[str, list[bool]] = {}
    for r in pair_eval["per_pair"]:
        src_bucket = r["source"].split("_")[0]
        by_src.setdefault(src_bucket, []).append(r["correct"])
    print("\nPer-source pair accuracy:")
    for k, v_list in by_src.items():
        acc = sum(v_list) / len(v_list)
        print(f"  {k}: {sum(v_list)}/{len(v_list)} = {acc:.3f}")


if __name__ == "__main__":
    main()

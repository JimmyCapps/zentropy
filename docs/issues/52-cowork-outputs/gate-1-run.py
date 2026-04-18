"""
Gate 1 experiment runner for HoneyLLM issue #52.

Runs 4 methods on the held-out corpus and reports TPR @ 1% FPR:
  1. Dialect classifier (regex over gate-1-vocabulary.json).
  2. Keyword baseline (single string set from garak goal_hijacking_attacks).
  3. ProtectAI deberta-v3-base-prompt-injection (HuggingFace).
  4. Random classifier at base rate.

Usage (from /tmp/gate1-venv):
    /tmp/gate1-venv/bin/python gate-1-run.py \
        --corpus gate-1-corpus.jsonl \
        --vocab gate-1-vocabulary.json \
        --out gate-1-results.json

The corpus and vocabulary files are committed alongside this script.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.metrics import roc_auc_score, roc_curve

KEYWORD_BASELINE = [
    "ignore previous instructions",
    "ignore the previous instructions",
    "ignore any previous and following instructions",
    "ignore all previous",
    "disregard previous",
    "forget previous",
    "system prompt",
    "you are now",
    "from now on you",
    "DAN",
    "developer mode",
    "override instructions",
    "new instructions",
    "bypass",
]


def load_corpus(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.open()]


def load_vocab(path: Path) -> list[dict]:
    return json.load(path.open())["primitives"]


def dialect_score(text: str, primitives: list[dict]) -> tuple[int, list[str]]:
    hits: list[str] = []
    for p in primitives:
        for pat in p["patterns"]:
            if re.search(pat, text, flags=re.IGNORECASE | re.MULTILINE):
                hits.append(p["id"])
                break
    return len(hits), hits


def keyword_score(text: str) -> int:
    lowered = text.lower()
    return sum(1 for k in KEYWORD_BASELINE if k.lower() in lowered)


def random_score(rng: np.random.Generator) -> float:
    return float(rng.random())


def tpr_at_fpr(scores: np.ndarray, labels: np.ndarray, target_fpr: float) -> float:
    fpr, tpr, _ = roc_curve(labels, scores)
    idx = np.searchsorted(fpr, target_fpr, side="right") - 1
    idx = max(0, min(idx, len(tpr) - 1))
    return float(tpr[idx])


def evaluate(
    method_name: str,
    scores: np.ndarray,
    labels: np.ndarray,
    fpr_target: float = 0.01,
) -> dict[str, Any]:
    auroc = roc_auc_score(labels, scores) if len(set(labels)) > 1 else float("nan")
    tpr01 = tpr_at_fpr(scores, labels, fpr_target)
    predictions = (scores >= 0.5).astype(int) if scores.dtype != bool else scores.astype(int)
    tp = int(((predictions == 1) & (labels == 1)).sum())
    fp = int(((predictions == 1) & (labels == 0)).sum())
    tn = int(((predictions == 0) & (labels == 0)).sum())
    fn = int(((predictions == 0) & (labels == 1)).sum())
    return {
        "method": method_name,
        "auroc": auroc,
        f"tpr_at_{fpr_target:.0%}_fpr": tpr01,
        "confusion": {"tp": tp, "fp": fp, "tn": tn, "fn": fn},
        "n_samples": int(len(labels)),
    }


def run_protectai(texts: list[str]) -> np.ndarray:
    from transformers import pipeline

    print("loading ProtectAI deberta-v3-base-prompt-injection ...", file=sys.stderr)
    clf = pipeline(
        "text-classification",
        model="protectai/deberta-v3-base-prompt-injection",
        truncation=True,
        max_length=512,
    )
    scores: list[float] = []
    for i, t in enumerate(texts):
        out = clf(t[:4000])[0]
        s = out["score"] if out["label"] == "INJECTION" else 1.0 - out["score"]
        scores.append(float(s))
        if (i + 1) % 50 == 0:
            print(f"  protectai {i + 1}/{len(texts)}", file=sys.stderr)
    return np.array(scores)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", required=True, type=Path)
    ap.add_argument("--vocab", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--split", default="holdout", help="holdout|holdout+calibration")
    ap.add_argument("--skip-protectai", action="store_true")
    args = ap.parse_args()

    corpus = load_corpus(args.corpus)
    vocab = load_vocab(args.vocab)

    include = {"holdout_injection", "holdout_benign"}
    if args.split == "holdout+calibration":
        include.add("holdout_benign_calibration")
    samples = [r for r in corpus if r["split"] in include]
    texts = [r["text"] for r in samples]
    labels = np.array([1 if r["split"] == "holdout_injection" else 0 for r in samples])
    print(
        f"loaded {len(samples)} samples | injection={int(labels.sum())} benign={int((1 - labels).sum())}",
        file=sys.stderr,
    )

    dialect_counts = np.array([dialect_score(t, vocab)[0] for t in texts], dtype=float)
    keyword_counts = np.array([keyword_score(t) for t in texts], dtype=float)
    rng = np.random.default_rng(42)
    random_scores = rng.random(len(texts))

    results = {
        "dialect": evaluate("dialect", dialect_counts, labels),
        "keyword": evaluate("keyword", keyword_counts, labels),
        "random": evaluate("random", random_scores, labels),
    }
    if not args.skip_protectai:
        protectai_scores = run_protectai(texts)
        results["protectai"] = evaluate("protectai", protectai_scores, labels)

    results["_meta"] = {
        "n_samples": len(samples),
        "split": args.split,
        "injection_ids": [r["id"] for r in samples if r["split"] == "holdout_injection"],
        "benign_ids": [r["id"] for r in samples if r["split"] != "holdout_injection"],
    }

    args.out.write_text(json.dumps(results, indent=2))
    print("\n=== RESULTS ===")
    for k, v in results.items():
        if k.startswith("_"):
            continue
        print(
            f"{k:12s} AUROC={v['auroc']:.3f}  TPR@1%FPR={v['tpr_at_1%_fpr']:.3f}  "
            f"confusion={v['confusion']}"
        )


if __name__ == "__main__":
    main()

"""
Gate 1 re-score for HoneyLLM issue #52 (Task A of the revised cowork plan).

Purpose
-------
Re-load the existing Gate 1 corpora (English holdout, English holdout +
calibration, Spanish translated, Mandarin translated) and recompute per-sample
scores for every method, then produce production-relevant metrics that the
original `gate-1-run.py` did not report:

  - AUROC (already in original)
  - PR-AUC (average precision)
  - F1 at the optimal threshold (on the ROC curve)
  - TPR at 1%, 5%, 10% FPR
  - For `dialect`: threshold-sweep at primitive-count k in {1,2,3,4,5}
    with precision, recall, FPR, F1
  - Median / mean / p95 inference time per sample per method
  - Compute-adjusted metric: AUROC / median_ms

The original `gate-1-run.py` is left untouched; this file is a parallel
runner as required by the Task A rules.

Usage
-----
    /tmp/gate1-venv/bin/python gate-1-rescore.py \
        --corpus gate-1-corpus.jsonl \
        --corpus-es gate-1-corpus-es.jsonl \
        --corpus-zh gate-1-corpus-zh-CN.jsonl \
        --vocab gate-1-vocabulary.json \
        --out gate-1-rescore-results.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.metrics import (
    average_precision_score,
    f1_score,
    precision_recall_curve,
    roc_auc_score,
    roc_curve,
)

# Mirrors gate-1-run.py's keyword list verbatim so the re-score is a faithful
# replay of the baseline.
KEYWORD_BASELINE: list[str] = [
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

FPR_TARGETS: tuple[float, ...] = (0.01, 0.05, 0.10)
DIALECT_K_SWEEP: tuple[int, ...] = (1, 2, 3, 4, 5)


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.open()]


def load_vocab(path: Path) -> list[dict[str, Any]]:
    return json.load(path.open())["primitives"]


def select_split(
    corpus: list[dict[str, Any]], include: set[str]
) -> tuple[list[str], np.ndarray, list[str]]:
    rows = [r for r in corpus if r["split"] in include]
    texts = [r["text"] for r in rows]
    labels = np.array(
        [1 if r["split"] == "holdout_injection" else 0 for r in rows], dtype=int
    )
    ids = [r["id"] for r in rows]
    return texts, labels, ids


def dialect_score(text: str, primitives: list[dict[str, Any]]) -> int:
    hits = 0
    for p in primitives:
        for pat in p["patterns"]:
            if re.search(pat, text, flags=re.IGNORECASE | re.MULTILINE):
                hits += 1
                break
    return hits


def keyword_score(text: str) -> int:
    lowered = text.lower()
    return sum(1 for k in KEYWORD_BASELINE if k.lower() in lowered)


def time_score(fn, texts: list[str]) -> tuple[np.ndarray, np.ndarray]:
    scores = np.zeros(len(texts), dtype=float)
    times_ms = np.zeros(len(texts), dtype=float)
    for i, t in enumerate(texts):
        t0 = time.perf_counter()
        scores[i] = float(fn(t))
        times_ms[i] = (time.perf_counter() - t0) * 1000.0
    return scores, times_ms


def tpr_at_fpr(scores: np.ndarray, labels: np.ndarray, target_fpr: float) -> float:
    fpr, tpr, _ = roc_curve(labels, scores)
    idx = int(np.searchsorted(fpr, target_fpr, side="right") - 1)
    idx = max(0, min(idx, len(tpr) - 1))
    return float(tpr[idx])


def best_f1_threshold(scores: np.ndarray, labels: np.ndarray) -> tuple[float, float]:
    # Sweep every unique score as a candidate threshold; return (best_f1, threshold).
    best_f1, best_thr = 0.0, 0.0
    uniques = np.unique(scores)
    for thr in uniques:
        preds = (scores >= thr).astype(int)
        f1 = f1_score(labels, preds, zero_division=0)
        if f1 > best_f1:
            best_f1 = float(f1)
            best_thr = float(thr)
    return best_f1, best_thr


def evaluate_method(
    method_name: str,
    scores: np.ndarray,
    labels: np.ndarray,
    times_ms: np.ndarray | None,
) -> dict[str, Any]:
    auroc = float(roc_auc_score(labels, scores)) if len(set(labels)) > 1 else float("nan")
    pr_auc = float(average_precision_score(labels, scores))
    best_f1, best_thr = best_f1_threshold(scores, labels)
    tpr_at = {f"tpr_at_{int(t * 100)}_fpr": tpr_at_fpr(scores, labels, t) for t in FPR_TARGETS}
    result: dict[str, Any] = {
        "method": method_name,
        "n_samples": int(len(labels)),
        "auroc": auroc,
        "pr_auc": pr_auc,
        "best_f1": best_f1,
        "best_f1_threshold": best_thr,
        **tpr_at,
    }
    if times_ms is not None and len(times_ms) > 0:
        result["latency_ms"] = {
            "mean": float(times_ms.mean()),
            "median": float(np.median(times_ms)),
            "p95": float(np.percentile(times_ms, 95)),
            "n": int(len(times_ms)),
        }
        if result["latency_ms"]["median"] > 0:
            result["auroc_per_ms"] = auroc / result["latency_ms"]["median"]
        else:
            result["auroc_per_ms"] = None
    return result


def dialect_sweep(scores: np.ndarray, labels: np.ndarray) -> list[dict[str, Any]]:
    # Raw primitive counts 0..16. At threshold k, prediction = (scores >= k).
    table: list[dict[str, Any]] = []
    n_pos = int(labels.sum())
    n_neg = int((1 - labels).sum())
    for k in DIALECT_K_SWEEP:
        preds = (scores >= k).astype(int)
        tp = int(((preds == 1) & (labels == 1)).sum())
        fp = int(((preds == 1) & (labels == 0)).sum())
        tn = int(((preds == 0) & (labels == 0)).sum())
        fn = int(((preds == 0) & (labels == 1)).sum())
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / n_pos if n_pos else 0.0
        fpr = fp / n_neg if n_neg else 0.0
        f1 = (
            2 * precision * recall / (precision + recall)
            if (precision + recall) > 0
            else 0.0
        )
        table.append(
            {
                "k": int(k),
                "precision": float(precision),
                "recall": float(recall),
                "fpr": float(fpr),
                "f1": float(f1),
                "tp": tp,
                "fp": fp,
                "tn": tn,
                "fn": fn,
            }
        )
    return table


def match_precision_operating_point(
    dialect_scores: np.ndarray,
    protectai_scores: np.ndarray,
    labels: np.ndarray,
) -> dict[str, Any]:
    # At what dialect threshold (integer primitive count) does dialect reach
    # ProtectAI's precision at its own "standard" operating point (score >= 0.5)?
    pa_preds = (protectai_scores >= 0.5).astype(int)
    pa_tp = int(((pa_preds == 1) & (labels == 1)).sum())
    pa_fp = int(((pa_preds == 1) & (labels == 0)).sum())
    pa_precision = pa_tp / (pa_tp + pa_fp) if (pa_tp + pa_fp) else 0.0
    pa_recall = pa_tp / int(labels.sum()) if int(labels.sum()) else 0.0
    # Sweep k from highest integer score downwards, find smallest k whose
    # precision >= pa_precision.
    max_k = int(dialect_scores.max()) if len(dialect_scores) else 0
    match: dict[str, Any] | None = None
    for k in range(1, max_k + 1):
        preds = (dialect_scores >= k).astype(int)
        tp = int(((preds == 1) & (labels == 1)).sum())
        fp = int(((preds == 1) & (labels == 0)).sum())
        if (tp + fp) == 0:
            continue
        p = tp / (tp + fp)
        r = tp / int(labels.sum()) if int(labels.sum()) else 0.0
        if p >= pa_precision and match is None:
            match = {"k": int(k), "precision": float(p), "recall": float(r)}
    return {
        "protectai_operating_point": {
            "threshold": 0.5,
            "precision": float(pa_precision),
            "recall": float(pa_recall),
        },
        "dialect_matches_protectai_precision": match,
    }


def run_protectai(texts: list[str]) -> tuple[np.ndarray, np.ndarray]:
    """Returns (scores, per-sample latency_ms). Uses MPS by default via
    transformers pipeline device selection."""
    import torch
    from transformers import pipeline

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"loading ProtectAI deberta-v3-base-prompt-injection on {device} ...", file=sys.stderr)
    clf = pipeline(
        "text-classification",
        model="protectai/deberta-v3-base-prompt-injection",
        truncation=True,
        max_length=512,
        device=device,
    )
    scores: list[float] = []
    times_ms: list[float] = []
    for i, t in enumerate(texts):
        t0 = time.perf_counter()
        out = clf(t[:4000])[0]
        elapsed = (time.perf_counter() - t0) * 1000.0
        s = out["score"] if out["label"] == "INJECTION" else 1.0 - out["score"]
        scores.append(float(s))
        times_ms.append(elapsed)
        if (i + 1) % 50 == 0:
            print(f"  protectai {i + 1}/{len(texts)}", file=sys.stderr)
    return np.array(scores), np.array(times_ms)


def score_split(
    label: str,
    corpus: list[dict[str, Any]],
    include_splits: set[str],
    vocab: list[dict[str, Any]],
    skip_protectai: bool,
) -> dict[str, Any]:
    texts, labels, ids = select_split(corpus, include_splits)
    print(
        f"[{label}] n={len(texts)} injection={int(labels.sum())} benign={int((1 - labels).sum())}",
        file=sys.stderr,
    )

    dialect_scores, dialect_times = time_score(lambda t: dialect_score(t, vocab), texts)
    keyword_scores, keyword_times = time_score(lambda t: keyword_score(t), texts)
    rng = np.random.default_rng(42)
    random_scores = rng.random(len(texts))
    # Random "latency" is effectively zero; don't report per-ms for it.

    split_result: dict[str, Any] = {
        "n_samples": int(len(labels)),
        "n_injection": int(labels.sum()),
        "n_benign": int((1 - labels).sum()),
        "methods": {
            "dialect": evaluate_method("dialect", dialect_scores, labels, dialect_times),
            "keyword": evaluate_method("keyword", keyword_scores, labels, keyword_times),
            "random": evaluate_method("random", random_scores, labels, None),
        },
        "dialect_threshold_sweep": dialect_sweep(dialect_scores, labels),
        "per_sample_scores": {
            "ids": ids,
            "labels": labels.tolist(),
            "dialect": dialect_scores.tolist(),
            "keyword": keyword_scores.tolist(),
        },
    }

    if not skip_protectai:
        pa_scores, pa_times = run_protectai(texts)
        split_result["methods"]["protectai"] = evaluate_method(
            "protectai", pa_scores, labels, pa_times
        )
        split_result["operating_point"] = match_precision_operating_point(
            dialect_scores, pa_scores, labels
        )
        split_result["per_sample_scores"]["protectai"] = pa_scores.tolist()

    return split_result


def print_summary(all_results: dict[str, Any]) -> None:
    print("\n=== RESCORE SUMMARY ===")
    for split_name, split in all_results.items():
        if split_name.startswith("_"):
            continue
        print(f"\n-- {split_name} (n={split['n_samples']}) --")
        header = f"{'method':10s} {'AUROC':>6s} {'PR-AUC':>7s} {'F1*':>5s} {'TPR@1':>6s} {'TPR@5':>6s} {'TPR@10':>6s} {'med ms':>8s} {'AUROC/ms':>10s}"
        print(header)
        for m_name, m in split["methods"].items():
            lat = m.get("latency_ms") or {}
            med = lat.get("median", float("nan"))
            apms = m.get("auroc_per_ms")
            apms_s = f"{apms:.4f}" if isinstance(apms, float) else "   n/a"
            print(
                f"{m_name:10s} {m['auroc']:.3f}  {m['pr_auc']:.3f}  {m['best_f1']:.2f}  "
                f"{m['tpr_at_1_fpr']:.2f}   {m['tpr_at_5_fpr']:.2f}   {m['tpr_at_10_fpr']:.2f}   "
                f"{med:6.2f}   {apms_s}"
            )
        print("  dialect sweep:")
        for row in split["dialect_threshold_sweep"]:
            print(
                f"    k={row['k']}  P={row['precision']:.3f}  R={row['recall']:.3f}  "
                f"FPR={row['fpr']:.3f}  F1={row['f1']:.3f}"
            )
        if "operating_point" in split:
            op = split["operating_point"]
            pa = op["protectai_operating_point"]
            match = op["dialect_matches_protectai_precision"]
            if match is not None:
                print(
                    f"  match-protectai-precision: ProtectAI P={pa['precision']:.3f}, "
                    f"dialect matches at k={match['k']} (P={match['precision']:.3f}, "
                    f"R={match['recall']:.3f})"
                )
            else:
                print(
                    f"  match-protectai-precision: ProtectAI P={pa['precision']:.3f} — "
                    f"no dialect threshold reaches that precision on this split."
                )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", required=True, type=Path)
    ap.add_argument("--corpus-es", required=True, type=Path)
    ap.add_argument("--corpus-zh", required=True, type=Path)
    ap.add_argument("--vocab", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--skip-protectai", action="store_true")
    args = ap.parse_args()

    corpus_en = load_jsonl(args.corpus)
    corpus_es = load_jsonl(args.corpus_es)
    corpus_zh = load_jsonl(args.corpus_zh)
    vocab = load_vocab(args.vocab)

    splits = {
        "holdout_en": (corpus_en, {"holdout_injection", "holdout_benign"}),
        "holdout_en_calibration": (
            corpus_en,
            {"holdout_injection", "holdout_benign", "holdout_benign_calibration"},
        ),
        "holdout_es": (corpus_es, {"holdout_injection", "holdout_benign"}),
        "holdout_zh": (corpus_zh, {"holdout_injection", "holdout_benign"}),
    }

    all_results: dict[str, Any] = {}
    for label, (corpus, include) in splits.items():
        all_results[label] = score_split(label, corpus, include, vocab, args.skip_protectai)

    all_results["_meta"] = {
        "vocab_path": str(args.vocab),
        "fpr_targets": list(FPR_TARGETS),
        "dialect_k_sweep": list(DIALECT_K_SWEEP),
        "keyword_baseline": KEYWORD_BASELINE,
        "script": "gate-1-rescore.py",
        "note": (
            "Per-sample `dialect` and `keyword` scores are integer primitive/keyword counts. "
            "Per-sample `protectai` scores are P(INJECTION) from the HuggingFace pipeline."
        ),
    }

    args.out.write_text(json.dumps(all_results, indent=2))
    print_summary(all_results)


if __name__ == "__main__":
    main()

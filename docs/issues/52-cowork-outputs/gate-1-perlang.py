"""
Gate 1 per-language runner for HoneyLLM issue #52 (Task B of the revised cowork plan).

Purpose
-------
Extends the Task-A rescore harness so that any combination of
`--vocab` (primitive pack) × `--corpus` (language-specific holdout JSONL) can
be scored. Used to test whether the cross-lingual collapse seen in Gate 1 is a
vocabulary problem (fixable with per-language packs) or a hypothesis problem
(regex dialect is inherently language-bound).

This file does NOT overwrite gate-1-rescore.py. It imports most of its helpers
verbatim and only changes the driver so we can mix-and-match vocab ↔ corpus.

Metrics mirror Task A:
    - AUROC, PR-AUC, Best-F1
    - TPR at 1%, 5%, 10% FPR
    - Dialect threshold sweep for k ∈ {1..5}
    - Median / mean / p95 latency per sample
    - AUROC / median_ms (compute-adjusted)

Usage
-----
Single run:

    /tmp/gate1-venv/bin/python gate-1-perlang.py \\
        --vocab gate-1-vocabulary-es.json \\
        --corpus gate-1-corpus-es.jsonl \\
        --label es_vocab_on_es_corpus \\
        --out out.json

Matrix run (runs all 7 cells of vocab × corpus with one invocation — no
ProtectAI, since ProtectAI is vocab-agnostic and already produced by the Task-A
rescore):

    /tmp/gate1-venv/bin/python gate-1-perlang.py --matrix \\
        --out gate-1-perlang-results.json
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
    roc_auc_score,
    roc_curve,
)


FPR_TARGETS: tuple[float, ...] = (0.01, 0.05, 0.10)
DIALECT_K_SWEEP: tuple[int, ...] = (1, 2, 3, 4, 5)


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.open()]


def load_vocab(path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    payload = json.load(path.open())
    return payload["primitives"], payload.get("_meta", {})


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


def dialect_breakdown(
    text: str, primitives: list[dict[str, Any]]
) -> dict[str, bool]:
    """Which primitives fired on this text. Used for FP auditing."""
    hits: dict[str, bool] = {}
    for p in primitives:
        fired = False
        for pat in p["patterns"]:
            if re.search(pat, text, flags=re.IGNORECASE | re.MULTILINE):
                fired = True
                break
        hits[p["id"]] = fired
    return hits


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
    auroc = (
        float(roc_auc_score(labels, scores)) if len(set(labels.tolist())) > 1 else float("nan")
    )
    pr_auc = float(average_precision_score(labels, scores))
    best_f1, best_thr = best_f1_threshold(scores, labels)
    tpr_at = {
        f"tpr_at_{int(t * 100)}_fpr": tpr_at_fpr(scores, labels, t) for t in FPR_TARGETS
    }
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


def score_vocab_corpus(
    label: str,
    vocab_path: Path,
    corpus_path: Path,
    include: set[str],
) -> dict[str, Any]:
    vocab, vocab_meta = load_vocab(vocab_path)
    corpus = load_jsonl(corpus_path)
    texts, labels, ids = select_split(corpus, include)
    print(
        f"[{label}] vocab={vocab_path.name} corpus={corpus_path.name} "
        f"n={len(texts)} injection={int(labels.sum())} benign={int((1 - labels).sum())}",
        file=sys.stderr,
    )

    scores, times_ms = time_score(lambda t: dialect_score(t, vocab), texts)
    # Per-primitive breakdown for post-hoc analysis (small payload: booleans).
    breakdown = [dialect_breakdown(t, vocab) for t in texts]

    split_result: dict[str, Any] = {
        "label": label,
        "vocab_path": str(vocab_path.name),
        "corpus_path": str(corpus_path.name),
        "include_splits": sorted(include),
        "n_samples": int(len(labels)),
        "n_injection": int(labels.sum()),
        "n_benign": int((1 - labels).sum()),
        "methods": {
            "dialect": evaluate_method("dialect", scores, labels, times_ms),
        },
        "dialect_threshold_sweep": dialect_sweep(scores, labels),
        "per_sample_scores": {
            "ids": ids,
            "labels": labels.tolist(),
            "dialect": scores.tolist(),
        },
        "per_sample_primitive_hits": [
            {"id": ids[i], "label": int(labels[i]), "primitives": breakdown[i]}
            for i in range(len(ids))
        ],
        "vocab_meta": vocab_meta,
    }
    return split_result


def print_summary(all_results: dict[str, Any]) -> None:
    print("\n=== PER-LANG SUMMARY ===")
    print(
        f"{'run':40s} {'n':>4s} {'AUROC':>6s} {'PR-AUC':>7s} {'F1*':>5s} "
        f"{'TPR@1':>6s} {'TPR@5':>6s} {'TPR@10':>6s} {'med ms':>8s} {'AUROC/ms':>10s}"
    )
    for label, split in all_results.items():
        if label.startswith("_"):
            continue
        m = split["methods"]["dialect"]
        lat = m.get("latency_ms") or {}
        med = lat.get("median", float("nan"))
        apms = m.get("auroc_per_ms")
        apms_s = f"{apms:.4f}" if isinstance(apms, float) else "   n/a"
        print(
            f"{label:40s} {split['n_samples']:>4d} {m['auroc']:.3f}  {m['pr_auc']:.3f}  "
            f"{m['best_f1']:.2f}  {m['tpr_at_1_fpr']:.2f}   {m['tpr_at_5_fpr']:.2f}   "
            f"{m['tpr_at_10_fpr']:.2f}   {med:6.2f}   {apms_s}"
        )
    print("\nDialect threshold sweep (k=1..5) per run:")
    for label, split in all_results.items():
        if label.startswith("_"):
            continue
        print(f"-- {label} --")
        for row in split["dialect_threshold_sweep"]:
            print(
                f"    k={row['k']}  P={row['precision']:.3f}  R={row['recall']:.3f}  "
                f"FPR={row['fpr']:.3f}  F1={row['f1']:.3f}"
            )


DEFAULT_DIR = Path(__file__).resolve().parent


def resolve(p: str | Path) -> Path:
    path = Path(p)
    if path.is_absolute():
        return path
    if path.exists():
        return path
    return DEFAULT_DIR / path


def matrix_runs() -> list[tuple[str, Path, Path, set[str]]]:
    """The seven cells Task B requires. Format: (label, vocab, corpus, include)."""
    en_holdout = {"holdout_injection", "holdout_benign"}
    return [
        (
            "en_vocab__en_corpus",
            resolve("gate-1-vocabulary.json"),
            resolve("gate-1-corpus.jsonl"),
            en_holdout,
        ),
        (
            "es_vocab__es_corpus",
            resolve("gate-1-vocabulary-es.json"),
            resolve("gate-1-corpus-es.jsonl"),
            en_holdout,
        ),
        (
            "zh_vocab__zh_corpus",
            resolve("gate-1-vocabulary-zh-CN.json"),
            resolve("gate-1-corpus-zh-CN.jsonl"),
            en_holdout,
        ),
        (
            "en_vocab__es_corpus",
            resolve("gate-1-vocabulary.json"),
            resolve("gate-1-corpus-es.jsonl"),
            en_holdout,
        ),
        (
            "en_vocab__zh_corpus",
            resolve("gate-1-vocabulary.json"),
            resolve("gate-1-corpus-zh-CN.jsonl"),
            en_holdout,
        ),
        (
            "es_vocab__zh_corpus",
            resolve("gate-1-vocabulary-es.json"),
            resolve("gate-1-corpus-zh-CN.jsonl"),
            en_holdout,
        ),
        (
            "zh_vocab__es_corpus",
            resolve("gate-1-vocabulary-zh-CN.json"),
            resolve("gate-1-corpus-es.jsonl"),
            en_holdout,
        ),
    ]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vocab", type=Path)
    ap.add_argument("--corpus", type=Path)
    ap.add_argument("--label", type=str, default="run")
    ap.add_argument("--matrix", action="store_true")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument(
        "--include-splits",
        default="holdout_injection,holdout_benign",
        help="Comma-separated list of split values to include. Default is the English-holdout pair.",
    )
    args = ap.parse_args()

    include = set(args.include_splits.split(","))

    all_results: dict[str, Any] = {}
    if args.matrix:
        for label, vocab_path, corpus_path, inc in matrix_runs():
            all_results[label] = score_vocab_corpus(label, vocab_path, corpus_path, inc)
    else:
        if not args.vocab or not args.corpus:
            raise SystemExit(
                "Either --matrix or both --vocab and --corpus are required."
            )
        all_results[args.label] = score_vocab_corpus(
            args.label, args.vocab, args.corpus, include
        )

    all_results["_meta"] = {
        "script": "gate-1-perlang.py",
        "fpr_targets": list(FPR_TARGETS),
        "dialect_k_sweep": list(DIALECT_K_SWEEP),
        "matrix": bool(args.matrix),
        "note": (
            "Dialect scores are integer primitive counts 0..16. "
            "ProtectAI and keyword baselines are NOT re-run here; their numbers are "
            "in gate-1-rescore-results.json (Task A artefact) since they do not "
            "depend on the vocabulary being tested."
        ),
    }

    args.out.write_text(json.dumps(all_results, indent=2))
    print_summary(all_results)


if __name__ == "__main__":
    main()

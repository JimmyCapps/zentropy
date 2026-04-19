"""Gate C — two-stage pre-filter pipeline for HoneyLLM issue #52 (Task C).

Stage 1 (dialect regex): score ∈ 0..16.  If score == 0 → BENIGN fast-path
(skip Stage 2).  If score >= k_reject → FLAGGED (trust dialect, skip
Stage 2; the verdict is INJECTION).  Otherwise → UNCERTAIN (route to
Stage 2).

Stage 2 (ProtectAI deberta-v3-base-prompt-injection): runs only on
UNCERTAIN rows.  Final verdict uses the model's 0.5 threshold.

Inputs: gate-1-corpus{,-es,-zh-CN}.jsonl + gate-1-vocabulary{,-es,-zh-CN}.json
(all frozen Task A/B artefacts).

Outputs: gate-c-protectai-cache.json (model scores, cached so replays skip
model inference), gate-c-mixed-corpus-{en,es,zh-CN}.jsonl (1%-rate mixed
corpora), gate-c-results.json (metrics matrix lang × base-rate × k_reject).

Usage:
    /tmp/gate1-venv/bin/python gate-c-prefilter.py \\
        --precompute --generate-corpora --evaluate --out gate-c-results.json
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
)


DEFAULT_DIR = Path(__file__).resolve().parent

LANGUAGES: tuple[str, ...] = ("en", "es", "zh-CN")
LANG_FILE_SLUG: dict[str, str] = {"en": "en", "es": "es", "zh-CN": "zh-CN"}

CORPUS_FILES: dict[str, str] = {
    "en": "gate-1-corpus.jsonl",
    "es": "gate-1-corpus-es.jsonl",
    "zh-CN": "gate-1-corpus-zh-CN.jsonl",
}
VOCAB_FILES: dict[str, str] = {
    "en": "gate-1-vocabulary.json",
    "es": "gate-1-vocabulary-es.json",
    "zh-CN": "gate-1-vocabulary-zh-CN.json",
}

# Benign-pool splits per language.  For en we have 400 train + 100 holdout + 50
# calibration = 550 benign samples.  For es/zh we have 50 holdout benign each.
BENIGN_SPLITS: dict[str, tuple[str, ...]] = {
    "en": ("train_benign", "holdout_benign", "holdout_benign_calibration"),
    "es": ("holdout_benign",),
    "zh-CN": ("holdout_benign",),
}
# Injection pool: we use only holdout_injection (100 en / 50 es / 50 zh).  The
# training injections are vocabulary-seed-adjacent and using them would leak.
INJECTION_SPLITS: dict[str, tuple[str, ...]] = {
    "en": ("holdout_injection",),
    "es": ("holdout_injection",),
    "zh-CN": ("holdout_injection",),
}

# Pedagogical-calibration negatives (English only; es/zh do not have this split).
# Carried as a separate, optional evaluation so we can re-check whether the
# two-stage pipeline helps or hurts the pedagogical-FP mode.
PEDAGOGICAL_SPLITS: dict[str, tuple[str, ...]] = {
    "en": ("holdout_benign_calibration",),
    "es": (),
    "zh-CN": (),
}

# Base rates we evaluate.  At 1% the injection count is enough to produce
# stable TPR/FPR measurements; at 0.1% we subsample injections so the rate is
# hit exactly and document the resulting n_injection.
BASE_RATES: tuple[float, ...] = (0.01, 0.001)

# k_reject thresholds to evaluate.
K_REJECT_VALUES: tuple[int, ...] = (1, 2, 3)

# Target mixed-corpus size (before rounding to integer injection counts).  With
# 10000 for en we hit 100 injection at 1% and 10 at 0.1%; for es/zh we cap at
# the available holdout (50 inj) and grow the benign side with replacement.
CORPUS_SIZES: dict[str, dict[float, int]] = {
    "en": {0.01: 10000, 0.001: 10000},
    "es": {0.01: 5000, 0.001: 5000},
    "zh-CN": {0.01: 5000, 0.001: 5000},
}

# ProtectAI threshold defined by the model's own pipeline convention.
PROTECTAI_THRESHOLD: float = 0.5

# Dialect latency measurements (per-language medians, ms).  Taken from
# gate-1-rescore-results.json and gate-1-perlang-results.json.  We use these
# rather than re-measuring so the end-to-end latency numbers are consistent
# with Tasks A/B.
DIALECT_MEDIAN_MS: dict[str, float] = {
    "en": 6.22,
    "es": 22.08,
    "zh-CN": 18.53,
}
# ProtectAI median (warm state; taken from gate-1-rescore-results.json).
PROTECTAI_MEDIAN_MS: dict[str, float] = {
    "en": 51.73,
    "es": 50.01,
    "zh-CN": 48.03,
}


def resolve(p: str | Path) -> Path:
    path = Path(p)
    if path.is_absolute():
        return path
    if path.exists():
        return path
    return DEFAULT_DIR / path


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.open()]


def load_vocab(path: Path) -> list[dict[str, Any]]:
    return json.load(path.open())["primitives"]


def dialect_score(text: str, primitives: list[dict[str, Any]]) -> int:
    hits = 0
    for p in primitives:
        for pat in p["patterns"]:
            if re.search(pat, text, flags=re.IGNORECASE | re.MULTILINE):
                hits += 1
                break
    return hits


# ----- Stage 1 pool loading ------------------------------------------------


def load_pool(
    lang: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Returns (injection_rows, benign_rows, pedagogical_rows) for a language.

    Rows are the raw JSONL dicts augmented with an injected ``pool`` field so
    downstream code can recognise them after shuffling."""
    corpus_path = resolve(CORPUS_FILES[lang])
    rows = load_jsonl(corpus_path)
    inj_splits = set(INJECTION_SPLITS[lang])
    ben_splits = set(BENIGN_SPLITS[lang])
    ped_splits = set(PEDAGOGICAL_SPLITS[lang])

    injection: list[dict[str, Any]] = []
    benign: list[dict[str, Any]] = []
    pedagogical: list[dict[str, Any]] = []
    for r in rows:
        s = r["split"]
        if s in inj_splits:
            injection.append({**r, "pool": "injection"})
        elif s in ped_splits:
            pedagogical.append({**r, "pool": "pedagogical"})
        elif s in ben_splits:
            benign.append({**r, "pool": "benign"})
    return injection, benign, pedagogical


# ----- ProtectAI cache -----------------------------------------------------


def run_protectai_batch(texts: list[str]) -> list[float]:
    import torch
    from transformers import pipeline

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(
        f"loading ProtectAI deberta-v3-base-prompt-injection on {device} ...",
        file=sys.stderr,
    )
    clf = pipeline(
        "text-classification",
        model="protectai/deberta-v3-base-prompt-injection",
        truncation=True,
        max_length=512,
        device=device,
    )
    scores: list[float] = []
    for i, t in enumerate(texts):
        out = clf(t[:4000])[0]
        score = out["score"] if out["label"] == "INJECTION" else 1.0 - out["score"]
        scores.append(float(score))
        if (i + 1) % 100 == 0:
            print(f"  protectai {i + 1}/{len(texts)}", file=sys.stderr)
    return scores


def build_protectai_cache(out_path: Path) -> dict[str, Any]:
    """Score ProtectAI once on every benign/injection/pedagogical row across
    all three languages, then persist by row id for later resampling."""
    cache: dict[str, Any] = {}
    for lang in LANGUAGES:
        inj, ben, ped = load_pool(lang)
        all_rows = inj + ben + ped
        texts = [r["text"] for r in all_rows]
        ids = [r["id"] for r in all_rows]
        print(
            f"[protectai] lang={lang} n_total={len(texts)} "
            f"(inj={len(inj)} ben={len(ben)} ped={len(ped)})",
            file=sys.stderr,
        )
        t0 = time.perf_counter()
        scores = run_protectai_batch(texts)
        elapsed = time.perf_counter() - t0
        print(
            f"[protectai] lang={lang} done in {elapsed:.1f}s "
            f"({elapsed * 1000 / max(1, len(texts)):.1f} ms/sample)",
            file=sys.stderr,
        )
        cache[lang] = {rid: score for rid, score in zip(ids, scores)}

    out_path.write_text(json.dumps(cache, indent=2))
    return cache


def load_protectai_cache(path: Path) -> dict[str, Any]:
    return json.load(path.open())


# ----- Mixed-corpus construction ------------------------------------------


def build_mixed_corpus(
    lang: str,
    rate: float,
    total_size: int,
    rng: np.random.Generator,
    injection_rows: list[dict[str, Any]],
    benign_rows: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Construct a mixed corpus at the requested base rate.

    Strategy:
    - n_injection = max(1, round(total_size * rate)).  If the injection pool
      is smaller than n_injection we sample with replacement; otherwise
      without.  For rates below 1/n_injection_pool we subsample injections.
    - n_benign = total_size - n_injection.  Benigns are sampled with
      replacement from the benign pool (this is the documented caveat —
      reusing benigns duplicates text but doesn't inflate TPR/FPR estimates
      because the dialect score of a text is deterministic).
    - Every row receives a stable synthetic id ``mixed_<lang>_<rate>_<seed>_
      <position>`` so downstream post-hoc analysis can trace a row back to its
      source.
    """
    n_injection = max(1, int(round(total_size * rate)))
    n_benign = total_size - n_injection

    inj_pool = injection_rows
    ben_pool = benign_rows
    if n_injection > len(inj_pool):
        inj_indices = rng.choice(len(inj_pool), size=n_injection, replace=True)
        inj_sample_mode = "with_replacement"
    else:
        inj_indices = rng.choice(len(inj_pool), size=n_injection, replace=False)
        inj_sample_mode = "without_replacement"
    # Benigns always sampled with replacement when n_benign > pool size;
    # otherwise without (preserves uniqueness).
    if n_benign > len(ben_pool):
        ben_indices = rng.choice(len(ben_pool), size=n_benign, replace=True)
        ben_sample_mode = "with_replacement"
    else:
        ben_indices = rng.choice(len(ben_pool), size=n_benign, replace=False)
        ben_sample_mode = "without_replacement"

    rows: list[dict[str, Any]] = []
    seed = int(rng.bit_generator.state["state"]["state"] & 0xFFFFFFFF)
    for i, idx in enumerate(inj_indices):
        src = inj_pool[int(idx)]
        rows.append(
            {
                "id": f"mixed_{LANG_FILE_SLUG[lang]}_{rate}_{seed:x}_{i:06d}_inj",
                "label": 1,
                "source_id": src["id"],
                "source_split": src["split"],
                "text": src["text"],
                "lang": lang,
                "rate": rate,
            }
        )
    for i, idx in enumerate(ben_indices):
        src = ben_pool[int(idx)]
        rows.append(
            {
                "id": f"mixed_{LANG_FILE_SLUG[lang]}_{rate}_{seed:x}_{i:06d}_ben",
                "label": 0,
                "source_id": src["id"],
                "source_split": src["split"],
                "text": src["text"],
                "lang": lang,
                "rate": rate,
            }
        )
    rng.shuffle(rows)
    meta = {
        "lang": lang,
        "rate": rate,
        "total_size": len(rows),
        "n_injection": n_injection,
        "n_benign": n_benign,
        "inj_pool_size": len(inj_pool),
        "ben_pool_size": len(ben_pool),
        "inj_sample_mode": inj_sample_mode,
        "ben_sample_mode": ben_sample_mode,
        "seed": seed,
    }
    return rows, meta


def emit_mixed_corpus(rows: list[dict[str, Any]], out_path: Path) -> None:
    with out_path.open("w") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


# ----- Two-stage pipeline --------------------------------------------------


def two_stage_decisions(
    dialect_scores: np.ndarray,
    protectai_scores: np.ndarray,
    k_reject: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Run the pipeline and return three parallel arrays, length n_rows:

    - stage1_verdict : int array, values in {0 BENIGN, 1 UNCERTAIN, 2 FLAGGED}.
        0 → dialect score == 0            (prune to BENIGN, skip Stage 2)
        1 → 0 < score < k_reject          (route to Stage 2 — UNCERTAIN)
        2 → score >= k_reject             (flag as INJECTION *as-is*, skip
                                           Stage 2 — the Task A/B observation
                                           that k=2 hits precision=1.0 on the
                                           monolingual holdout motivates
                                           trusting dialect at high k without
                                           paying ProtectAI)
    - stage2_invoked : bool array; True when ProtectAI ran (UNCERTAIN only).
    - final_verdict  : int array, values in {0 BENIGN, 1 INJECTION}.

    Note on k_reject=1: at k=1 there is no UNCERTAIN band (0 < count < 1 is
    empty for integer counts), so every non-zero row is FLAGGED and no row
    hits Stage 2 at all.  This is the "dialect-only" degenerate case and is
    what Task A's k=1 row measured.  Included for completeness so the table
    shows the continuum k=1 (dialect only) → k=2 / k=3 (two-stage) → k=∞
    (ProtectAI-alone baseline).
    """
    stage1 = np.where(
        dialect_scores == 0,
        0,
        np.where(dialect_scores >= k_reject, 2, 1),
    ).astype(int)
    stage2_invoked = stage1 == 1
    # Final verdict:
    #  stage1 == 0 (BENIGN fast-path) → 0
    #  stage1 == 1 (UNCERTAIN)        → ProtectAI's verdict
    #  stage1 == 2 (FLAGGED)          → 1 (trust dialect at high k)
    pa_verdict = (protectai_scores >= PROTECTAI_THRESHOLD).astype(int)
    final = np.where(
        stage1 == 0,
        0,
        np.where(stage1 == 2, 1, pa_verdict),
    ).astype(int)
    return stage1, stage2_invoked, final


def classification_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
) -> dict[str, float]:
    tp = int(((y_pred == 1) & (y_true == 1)).sum())
    fp = int(((y_pred == 1) & (y_true == 0)).sum())
    tn = int(((y_pred == 0) & (y_true == 0)).sum())
    fn = int(((y_pred == 0) & (y_true == 1)).sum())
    n_pos = tp + fn
    n_neg = fp + tn
    tpr = tp / n_pos if n_pos else 0.0
    fpr = fp / n_neg if n_neg else 0.0
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tpr
    f1 = (
        2 * precision * recall / (precision + recall)
        if (precision + recall) > 0
        else 0.0
    )
    return {
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "tpr": float(tpr),
        "fpr": float(fpr),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
    }


def prune_metrics(
    labels: np.ndarray,
    stage1: np.ndarray,
) -> dict[str, float]:
    """Prune rate = fraction of rows Stage 1 called BENIGN.
    Prune precision = of the pruned rows, fraction truly benign.  If
    prune_precision < 1.0 we have leaked injection into the BENIGN fast-path.
    """
    pruned_mask = stage1 == 0
    n_total = len(labels)
    n_pruned = int(pruned_mask.sum())
    prune_rate = n_pruned / n_total if n_total else 0.0
    # Precision = (benign & pruned) / pruned
    pruned_benign = int(((pruned_mask) & (labels == 0)).sum())
    pruned_injection = int(((pruned_mask) & (labels == 1)).sum())
    prune_precision = pruned_benign / n_pruned if n_pruned else float("nan")
    return {
        "n_total": n_total,
        "n_pruned": n_pruned,
        "prune_rate": float(prune_rate),
        "pruned_benign": pruned_benign,
        "pruned_injection": pruned_injection,
        "prune_precision": float(prune_precision),
    }


def latency_metrics(
    lang: str,
    stage1: np.ndarray,
    stage2_invoked: np.ndarray,
) -> dict[str, float]:
    """Effective per-chunk latency under the two-stage pipeline.

    Every chunk pays the dialect cost; chunks not pruned also pay the
    ProtectAI cost.  We use the language-specific medians from Tasks A/B to
    stay consistent with their numbers — re-measuring here would introduce
    noise without changing the architecture claim.
    """
    dialect_ms = DIALECT_MEDIAN_MS[lang]
    protectai_ms = PROTECTAI_MEDIAN_MS[lang]
    n_total = len(stage1)
    n_stage2 = int(stage2_invoked.sum())
    effective_ms = dialect_ms + (n_stage2 / n_total) * protectai_ms if n_total else 0.0
    protectai_alone_ms = protectai_ms
    ratio_to_protectai_alone = (
        effective_ms / protectai_alone_ms if protectai_alone_ms else float("nan")
    )
    return {
        "dialect_median_ms": dialect_ms,
        "protectai_median_ms": protectai_ms,
        "effective_ms_per_chunk": float(effective_ms),
        "protectai_alone_ms_per_chunk": float(protectai_alone_ms),
        "ratio_to_protectai_alone": float(ratio_to_protectai_alone),
    }


def protectai_alone_metrics(
    labels: np.ndarray,
    protectai_scores: np.ndarray,
) -> dict[str, float]:
    preds = (protectai_scores >= PROTECTAI_THRESHOLD).astype(int)
    stats = classification_metrics(labels, preds)
    auroc = (
        float(roc_auc_score(labels, protectai_scores))
        if len(set(labels.tolist())) > 1
        else float("nan")
    )
    pr_auc = (
        float(average_precision_score(labels, protectai_scores))
        if len(set(labels.tolist())) > 1
        else float("nan")
    )
    return {**stats, "auroc": auroc, "pr_auc": pr_auc}


# ----- Evaluation driver ---------------------------------------------------


def flag_precision(
    labels: np.ndarray,
    stage1: np.ndarray,
) -> dict[str, Any]:
    """FLAGGED fast-path precision: of the chunks Stage 1 called INJECTION
    (score >= k_reject) *without* ProtectAI confirmation, what fraction are
    actually injection?  This is the ≥0.99 bar the FLAGGED-as-injection
    fast-path must clear to be safe to use, mirroring the prune_precision
    bar on the BENIGN fast-path side."""
    flagged_mask = stage1 == 2
    n_flagged = int(flagged_mask.sum())
    tp = int(((flagged_mask) & (labels == 1)).sum())
    fp = int(((flagged_mask) & (labels == 0)).sum())
    return {
        "n_flagged": n_flagged,
        "flagged_true_injection": tp,
        "flagged_false_injection": fp,
        "flag_precision": float(tp / n_flagged) if n_flagged else float("nan"),
    }


def evaluate_cell(
    lang: str,
    rate: float,
    k_reject: int,
    rows: list[dict[str, Any]],
    dialect_scores: np.ndarray,
    pa_scores: np.ndarray,
    labels: np.ndarray,
) -> dict[str, Any]:
    """dialect_scores / pa_scores / labels are precomputed by the caller so
    this function only varies k_reject across the three thresholds."""
    stage1, stage2_invoked, final = two_stage_decisions(
        dialect_scores, pa_scores, k_reject
    )
    two_stage_stats = classification_metrics(labels, final)
    prune_stats = prune_metrics(labels, stage1)
    latency_stats = latency_metrics(lang, stage1, stage2_invoked)
    protectai_only = protectai_alone_metrics(labels, pa_scores)
    flag_stats = flag_precision(labels, stage1)

    return {
        "lang": lang,
        "rate": rate,
        "k_reject": k_reject,
        "n_total": int(len(rows)),
        "n_injection": int(labels.sum()),
        "n_benign": int((1 - labels).sum()),
        "two_stage": two_stage_stats,
        "prune": prune_stats,
        "flag": flag_stats,
        "latency": latency_stats,
        "protectai_alone": protectai_only,
        "stage1_counts": {
            "benign_fastpath": int((stage1 == 0).sum()),
            "uncertain": int((stage1 == 1).sum()),
            "flagged": int((stage1 == 2).sum()),
        },
        "stage2_invocations": int(stage2_invoked.sum()),
    }


def evaluate_pedagogical(
    lang: str,
    k_reject: int,
    vocab: list[dict[str, Any]],
    protectai_cache: dict[str, float],
    pedagogical_rows: list[dict[str, Any]],
    injection_rows: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Replay the two-stage pipeline on the 50 pedagogical articles + 100
    injection holdouts, to re-answer the Task-D-flagged question: does the
    two-stage pipeline behave better / worse / same as ProtectAI-alone on
    pedagogical content?  en-only.
    """
    if not pedagogical_rows:
        return None
    texts = pedagogical_rows + injection_rows
    labels = np.array(
        [0] * len(pedagogical_rows) + [1] * len(injection_rows), dtype=int
    )
    dialect_scores = np.array(
        [dialect_score(r["text"], vocab) for r in texts], dtype=int
    )
    pa_scores = np.array(
        [float(protectai_cache[r["id"]]) for r in texts], dtype=float
    )
    stage1, stage2_invoked, final = two_stage_decisions(
        dialect_scores, pa_scores, k_reject
    )
    return {
        "lang": lang,
        "k_reject": k_reject,
        "n_pedagogical": len(pedagogical_rows),
        "n_injection": len(injection_rows),
        "two_stage": classification_metrics(labels, final),
        "protectai_alone": protectai_alone_metrics(labels, pa_scores),
        "prune": prune_metrics(labels, stage1),
        "pedagogical_pruned_as_benign": int(
            ((stage1 == 0) & (labels == 0)).sum()
        ),
        "pedagogical_flagged_by_protectai": int(
            ((stage2_invoked) & (labels == 0) & (pa_scores >= PROTECTAI_THRESHOLD)).sum()
        ),
    }


# ----- Orchestration --------------------------------------------------------


def run_precompute(protectai_cache_path: Path) -> dict[str, Any]:
    return build_protectai_cache(protectai_cache_path)


def run_generate_corpora(
    rng_seed: int,
    protectai_cache: dict[str, Any],
) -> dict[str, Any]:
    """Build per-language mixed corpora at every base rate and emit the
    matching JSONL.  Returns an in-memory dict keyed by (lang, rate) for the
    evaluator to reuse."""
    corpora: dict[tuple[str, float], list[dict[str, Any]]] = {}
    metas: dict[str, Any] = {}
    rng = np.random.default_rng(rng_seed)
    for lang in LANGUAGES:
        inj, ben, _ = load_pool(lang)
        for rate in BASE_RATES:
            total_size = CORPUS_SIZES[lang][rate]
            # Use a fresh rng seeded deterministically per (lang, rate) so the
            # corpora are reproducible.
            rng_cell = np.random.default_rng(
                rng_seed + hash((lang, rate)) % (2**31)
            )
            rows, meta = build_mixed_corpus(
                lang, rate, total_size, rng_cell, inj, ben
            )
            corpora[(lang, rate)] = rows
            slug = LANG_FILE_SLUG[lang]
            out_path = resolve(f"gate-c-mixed-corpus-{slug}.jsonl") if rate == 0.01 else None
            # Only emit the 1% corpus to disk per the brief's "pick what fits"
            # rule; the 0.1% corpus inflates the JSONL sizes disproportionately
            # and is exercised in-memory only.
            if out_path is not None:
                emit_mixed_corpus(rows, out_path)
            metas[f"{lang}__{rate}"] = meta
    return {"corpora": corpora, "metas": metas}


def run_evaluate(
    corpora_bundle: dict[str, Any],
    protectai_cache: dict[str, Any],
) -> dict[str, Any]:
    corpora: dict[tuple[str, float], list[dict[str, Any]]] = corpora_bundle["corpora"]
    metas: dict[str, Any] = corpora_bundle["metas"]
    results_by_cell: list[dict[str, Any]] = []
    for lang in LANGUAGES:
        vocab = load_vocab(resolve(VOCAB_FILES[lang]))
        pa_lang = protectai_cache[lang]
        for rate in BASE_RATES:
            rows = corpora[(lang, rate)]
            # Precompute dialect + ProtectAI + labels once per (lang, rate).
            labels = np.array([r["label"] for r in rows], dtype=int)
            print(
                f"[evaluate] lang={lang} rate={rate} n={len(rows)} "
                f"— running dialect scorer",
                file=sys.stderr,
            )
            dialect_scores = np.array(
                [dialect_score(r["text"], vocab) for r in rows], dtype=int
            )
            pa_scores = np.array(
                [float(pa_lang[r["source_id"]]) for r in rows], dtype=float
            )
            for k_reject in K_REJECT_VALUES:
                cell = evaluate_cell(
                    lang, rate, k_reject, rows,
                    dialect_scores, pa_scores, labels,
                )
                cell["corpus_meta"] = metas[f"{lang}__{rate}"]
                results_by_cell.append(cell)

    # Pedagogical subanalysis (en only).
    pedagogical_results: list[dict[str, Any]] = []
    for lang in LANGUAGES:
        vocab = load_vocab(resolve(VOCAB_FILES[lang]))
        pa_lang = protectai_cache[lang]
        _, _, ped = load_pool(lang)
        if not ped:
            continue
        inj, _, _ = load_pool(lang)
        for k_reject in K_REJECT_VALUES:
            res = evaluate_pedagogical(lang, k_reject, vocab, pa_lang, ped, inj)
            if res is not None:
                pedagogical_results.append(res)

    return {"cells": results_by_cell, "pedagogical": pedagogical_results}


def print_summary(results: dict[str, Any]) -> None:
    print("\n=== GATE C — TWO-STAGE PIPELINE SUMMARY ===")
    header = (
        f"{'lang':6s} {'rate':>7s} {'k':>2s} {'n':>6s} "
        f"{'prune_rate':>11s} {'prune_prec':>11s} {'TPR_2s':>7s} "
        f"{'FPR_2s':>7s} {'prec_2s':>7s} {'ratio':>6s}"
    )
    print(header)
    for c in results["cells"]:
        pr = c["prune"]
        two = c["two_stage"]
        lat = c["latency"]
        print(
            f"{c['lang']:6s} {c['rate']:>7.4f} {c['k_reject']:>2d} "
            f"{c['n_total']:>6d} {pr['prune_rate']:>11.4f} "
            f"{pr['prune_precision']:>11.4f} "
            f"{two['tpr']:>7.4f} {two['fpr']:>7.4f} "
            f"{two['precision']:>7.4f} {lat['ratio_to_protectai_alone']:>6.3f}"
        )
    if results["pedagogical"]:
        print("\n-- Pedagogical calibration (en, 50 pedagogical + 100 injection) --")
        for c in results["pedagogical"]:
            print(
                f"lang={c['lang']} k={c['k_reject']}  "
                f"two_stage FPR={c['two_stage']['fpr']:.3f} "
                f"TPR={c['two_stage']['tpr']:.3f} | "
                f"PA-only FPR={c['protectai_alone']['fpr']:.3f} "
                f"TPR={c['protectai_alone']['tpr']:.3f} | "
                f"pedagogical_pruned_as_benign={c['pedagogical_pruned_as_benign']}/"
                f"{c['n_pedagogical']}"
            )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--precompute", action="store_true")
    ap.add_argument("--generate-corpora", action="store_true")
    ap.add_argument("--evaluate", action="store_true")
    ap.add_argument(
        "--protectai-cache",
        type=Path,
        default=resolve("gate-c-protectai-cache.json"),
    )
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    if args.precompute:
        if args.protectai_cache.exists():
            print(
                f"protectai cache exists at {args.protectai_cache}; "
                "reusing rather than re-running model inference. "
                "Delete the file to force a fresh pass.",
                file=sys.stderr,
            )
            cache = load_protectai_cache(args.protectai_cache)
        else:
            cache = run_precompute(args.protectai_cache)
    else:
        cache = load_protectai_cache(args.protectai_cache)

    if args.generate_corpora:
        corpora_bundle = run_generate_corpora(args.seed, cache)
    else:
        # We still need the corpora to evaluate; regenerate in-memory from seed
        # but don't rewrite the JSONL files.
        corpora_bundle = run_generate_corpora(args.seed, cache)

    if args.evaluate:
        eval_results = run_evaluate(corpora_bundle, cache)
        eval_results["_meta"] = {
            "script": "gate-c-prefilter.py",
            "languages": list(LANGUAGES),
            "base_rates": list(BASE_RATES),
            "k_reject_values": list(K_REJECT_VALUES),
            "corpus_sizes": {k: {str(r): v for r, v in CORPUS_SIZES[k].items()} for k in CORPUS_SIZES},
            "protectai_threshold": PROTECTAI_THRESHOLD,
            "dialect_median_ms": DIALECT_MEDIAN_MS,
            "protectai_median_ms": PROTECTAI_MEDIAN_MS,
            "seed": args.seed,
            "protectai_cache_path": str(args.protectai_cache.name),
            "note": (
                "Stage 2 (ProtectAI) scores are cached per source_id so "
                "resampling benigns with replacement does not re-invoke the "
                "model.  Per-chunk latency uses the Task A/B medians rather "
                "than re-measured values to keep the architecture comparison "
                "consistent across reports."
            ),
        }
        args.out.write_text(json.dumps(eval_results, indent=2))
        print_summary(eval_results)


if __name__ == "__main__":
    main()

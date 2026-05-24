"""Token-overlap helpers for semantic matching.

A real eval harness in Phase 5+ should swap this for embedding-based
similarity (likely Voyage), but the dependency cost isn't justified
for v1 — the seed dataset has short, technical summaries where token
overlap is a strong signal. The threshold is tunable.

Whatever swaps in must keep `summary_match`'s signature stable; it is
the only public surface this module exposes to the rest of the harness.
"""

from __future__ import annotations

import re

_TOKEN_RE = re.compile(r"[A-Za-z0-9_]+")

# Short, deliberately conservative stoplist. Bigger stoplists hurt
# precision on technical summaries ("not", "null", "no" all carry signal).
_STOPWORDS: frozenset[str] = frozenset(
    {
        "a",
        "an",
        "the",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "to",
        "of",
        "in",
        "on",
        "at",
        "for",
        "with",
        "by",
        "from",
        "as",
        "and",
        "or",
        "but",
        "this",
        "that",
        "it",
        "its",
        "when",
        "where",
        "which",
        "who",
        "what",
        "how",
        "why",
        "do",
        "does",
        "did",
        "has",
        "have",
        "had",
        "can",
        "will",
        "would",
        "should",
        "could",
        "may",
        "might",
        "into",
        "than",
        "then",
        "so",
        "if",
    }
)

DEFAULT_SUMMARY_MATCH_THRESHOLD = 0.2


def tokenize(text: str) -> set[str]:
    """Lowercase, split on non-word, drop stopwords and 1-char tokens.

    A tiny suffix-strip ("trailing s") handles plurals cheaply without
    pulling a stemmer in. We don't lemmatize verb tenses on purpose:
    "raises" vs "raised" are similar enough under Jaccard that the
    cost of a real stemmer (snowball etc.) doesn't pay for itself.
    """
    out: set[str] = set()
    for raw in _TOKEN_RE.findall(text.lower()):
        if len(raw) <= 1 or raw in _STOPWORDS:
            continue
        # Cheap plural collapse: "users" -> "user", but leave "ss" / "is".
        if raw.endswith("s") and not raw.endswith("ss") and len(raw) > 3:
            raw = raw[:-1]
        out.add(raw)
    return out


def jaccard(a: set[str], b: set[str]) -> float:
    """Jaccard similarity. 1.0 when both sides are empty; 0.0 when one is."""
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def summary_match(
    predicted: str,
    truth: str,
    threshold: float = DEFAULT_SUMMARY_MATCH_THRESHOLD,
) -> bool:
    """True when `predicted` and `truth` share enough tokens to count as a match."""
    return jaccard(tokenize(predicted), tokenize(truth)) >= threshold


def summary_similarity(predicted: str, truth: str) -> float:
    """Raw Jaccard score, exposed for diagnostics."""
    return jaccard(tokenize(predicted), tokenize(truth))

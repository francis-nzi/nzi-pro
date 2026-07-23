"""Keyword-scoring "Suggest Spend Line" matcher.

Ranks the Admin Centre's curated spend_lines (see
api/admin_spend_lines_routes.py) against a client's raw GL/nominal ledger
line text (description + reference code) by counting how many of each
Spend Line's admin-defined keywords appear in that text. Deliberately a
simple, deterministic substring-overlap score rather than fuzzy/trigram
matching or an ML model -- matches how search already works everywhere
else in this codebase, and keeps "why was this suggested" fully
explainable to a client or admin.
"""
from __future__ import annotations

import re
from typing import Any

_WORD_RE = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> set[str]:
    return set(_WORD_RE.findall(text.lower()))


def suggest_spend_lines(con, text: str, limit: int = 5) -> list[dict[str, Any]]:
    """Returns up to `limit` active spend_lines ranked by keyword-overlap
    score against `text` (a GL description, optionally with the reference
    code appended), highest score first. Only returns lines with at least
    one keyword hit -- never pads the result with unrelated lines."""
    text_tokens = _tokenize(text)
    if not text_tokens:
        return []

    rows = con.execute(
        """
        SELECT spend_line_id, label, keywords, factor_db_id, scope, category, report_label
        FROM spend_lines
        WHERE is_active = TRUE
        """
    ).fetchall()

    scored: list[tuple[int, dict[str, Any]]] = []
    for row in rows:
        spend_line_id, label, keywords, factor_db_id, scope, category, report_label = row
        keyword_tokens: set[str] = set()
        for kw in str(keywords or "").split(","):
            keyword_tokens |= _tokenize(kw)
        keyword_tokens |= _tokenize(str(label or ""))
        if not keyword_tokens:
            continue
        score = len(text_tokens & keyword_tokens)
        if score > 0:
            scored.append(
                (
                    score,
                    {
                        "spend_line_id": int(spend_line_id),
                        "label": label,
                        "factor_db_id": int(factor_db_id) if factor_db_id is not None else None,
                        "scope": scope,
                        "category": category,
                        "report_label": report_label,
                        "score": score,
                    },
                )
            )

    scored.sort(key=lambda item: (-item[0], item[1]["label"] or ""))
    return [item[1] for item in scored[:limit]]

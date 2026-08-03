"""Title-case normalization for the DEFRA/DESNZ-style "separator dash" report
labels (e.g. "Freighting goods - HGV (all diesel) - All artics - Average
laden"), as opposed to the USEEIO/ecoinvent-style labels elsewhere in the
same factor tables, which are already correctly formatted sentence-case and
must not be touched by this.

PRESERVE_CASING and _DIGIT_TOKEN_FIXUPS were built from the actual vocabulary
in production (see the case_when session that ran this) -- not guessed --
by extracting every short mixed/upper-case token already present across the
~32.7k separator-dash rows.
"""
from __future__ import annotations

import re

# Case-insensitive lookup -> canonical form. Acronyms/codes that a naive
# str.capitalize() would otherwise mangle (HGV -> Hgv, UK -> Uk, etc.).
PRESERVE_CASING: dict[str, str] = {
    "wtt": "WTT",
    "hgv": "HGV", "hgvs": "HGVs",
    "uk": "UK",
    "ev": "EV", "evs": "EVs",
    "lpg": "LPG",
    "cng": "CNG",
    "hfc": "HFC",
    "teu": "TEU",
    "hfe": "HFE",
    "mpv": "MPV",
    "lng": "LNG",
    "weee": "WEEE",
    "pfc": "PFC",
    "hcfc": "HCFC",
    "cfc": "CFC",
    "roro": "RoRo",
    "hdpe": "HDPE", "ldpe": "LDPE", "lldpe": "LLDPE",
    "pet": "PET", "pp": "PP", "ps": "PS", "pvc": "PVC",
    "gwp": "GWP",
    "dwt": "dwt",
    "kg": "kg",
    "cem": "CEM",
    "opc": "OPC",
    "ggbs": "GGBS",
    "eccs": "ECCS",
    "clt": "CLT",
    "rf": "RF",
    "me": "ME",
    "lm": "LM",
    "ceu": "CEU",
    "hvo": "HVO",
    "it": "IT",
    # Roman numerals used for vehicle/van weight classes (e.g. "Class II").
    "i": "I", "ii": "II", "iii": "III", "iv": "IV",
}

# Small connector words stay lowercase unless they're the first word of the
# whole label -- matches the convention already used by existing correctly-
# formatted category names in this dataset (e.g. "Fuels and Energy Related
# Activities" keeps "and" lowercase). Deliberately excludes "All" -- it's a
# quantifier/determiner, not a connector, and reads correctly capitalized
# ("All HGVs", "All rigids").
_SMALL_WORDS = {"and", "or", "to", "of", "in", "on", "by", "the", "a", "an", "for", "with", "up", "per", "from"}

# Tokens where a letter run is glued to a digit (m3, CO2e, 4x4, kWh) -- the
# main word-by-word pass below splits on letter/non-letter boundaries, so it
# can't see these as a single unit. Fixed up afterward via whole-word,
# case-insensitive substitution instead.
_DIGIT_TOKEN_FIXUPS: list[tuple[str, str]] = [
    (r"\bco2e\b", "CO2e"),
    (r"\bco2\b", "CO2"),
    (r"\bch4\b", "CH4"),
    (r"\bn2o\b", "N2O"),
    (r"\bsf6\b", "SF6"),
    (r"\bm3\b", "m3"),
    (r"\bkwh\b", "kWh"),
    (r"\b4x4\b", "4x4"),
]

# "33t" (a weight-class abbreviation, e.g. "Articulated (>33t)") tokenizes as
# digit "33" + letter "t" -- the general pass capitalizes any standalone
# letter run, turning it into "33T". Confirmed live: outside the Refrigerants
# category (excluded entirely, see EXCLUDED_CATEGORIES below), this is the
# *only* digit-glued letter suffix that appears anywhere in the dataset.
_TONNE_ABBREVIATION_FIXUP = (r"(?<=\d)T\b", "t")

# Refrigerant blend/molecule codes (R401B, HFC-227ea, R1234yf, HFE-449sl) are
# ASHRAE-standard chemical designations -- the trailing letters after the
# digits are semantically fixed and must never be re-cased. Confirmed live:
# every digit-glued-suffix row outside this category is the tonnes case
# above; every one inside it is a chemical code. Excluding the whole
# category is deliberately conservative rather than trying to pattern-match
# "chemical code" vs "abbreviation" within mixed text.
#
# Cement and Mortar / Concrete / Steel / Timber (~184 rows combined) carry
# their own dense, idiosyncratic engineering notation (CEM II/A-P, GGBS,
# OPC, ECCS, CLT grade codes) discovered only by exhaustive scanning, not
# by pattern -- excluded on the same "small volume, high risk of a missed
# domain-specific code" logic rather than continuing to special-case codes
# one at a time.
EXCLUDED_CATEGORIES = {"Refrigerants", "Cement and Mortar", "Concrete", "Steel", "Timber"}

_WORD_RE = re.compile(r"[A-Za-z]+")

# Mode-qualifier segments that are redundant given the activity itself (cars,
# rail, walking, buses, etc. can only be land transport) -- dropped outright.
# "air"/"sea" are NOT in this set: those genuinely distinguish one activity
# from another (confirmed live: "land" never co-occurs with "air"/"sea" in
# the same label, and is never the label's last segment -- always safe to
# drop with real content left over).
_REDUNDANT_SEGMENTS = {"land"}

# "WTT" (Well-to-Tank) is a genuine prefix marker, applied at two tiers of a
# category in the source data -- "WTT- <category> - WTT- <subcategory> -
# <detail>" -- not duplicate information, but written twice per label as a
# structural convention. Confirmed live: never appears 3+ times in a single
# label (268 distinct labels have exactly 2, 51 have exactly 1 -- already
# fine, left alone), so "keep the first, drop the rest" is unambiguous.
_REPEATED_MARKER_SEGMENTS = {"wtt"}


def _apply_word_casing(text: str) -> str:
    """Title-cases free text without mangling acronyms, units, Roman
    numerals, or numeric ranges (which have no letters and so pass through
    this untouched regardless). The first word of the whole string is always
    capitalized; small connector words elsewhere stay lowercase."""
    if not text.strip():
        return text

    seen_first_word = False
    out_parts: list[str] = []
    last_end = 0
    for match in _WORD_RE.finditer(text):
        out_parts.append(text[last_end:match.start()])
        word = match.group(0)
        key = word.lower()
        if key in PRESERVE_CASING:
            out_parts.append(PRESERVE_CASING[key])
        elif key in _SMALL_WORDS and seen_first_word:
            out_parts.append(key)
        else:
            out_parts.append(word.capitalize())
        seen_first_word = True
        last_end = match.end()
    out_parts.append(text[last_end:])
    result = "".join(out_parts)

    for pattern, canonical in _DIGIT_TOKEN_FIXUPS:
        result = re.sub(pattern, canonical, result, flags=re.IGNORECASE)
    result = re.sub(*_TONNE_ABBREVIATION_FIXUP, result)

    return result


def split_top_level_segments(text: str) -> list[str]:
    """Splits on a genuine separator dash (space-adjacent, e.g. " - " or
    "word- ") but never inside parentheses -- so a numeric range like
    "(>3.5 - 33t)" survives as one segment instead of being torn in half.
    Confirmed live: 2,524 rows have a " - "-shaped numeric range inside
    parens that a paren-naive splitter would have corrupted."""
    segments: list[str] = []
    current: list[str] = []
    depth = 0
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "(":
            depth += 1
            current.append(ch)
            i += 1
            continue
        if ch == ")":
            depth = max(0, depth - 1)
            current.append(ch)
            i += 1
            continue
        if depth == 0 and ch == "-":
            space_before = i > 0 and text[i - 1] == " "
            space_after = i + 1 < n and text[i + 1] == " "
            if space_before or space_after:
                segments.append("".join(current))
                current = []
                i += 2 if space_after else 1
                continue
        current.append(ch)
        i += 1
    segments.append("".join(current))
    return [s.strip() for s in segments if s.strip()]


def _restructure_segments(segments: list[str]) -> list[str]:
    """Drops redundant mode-qualifier segments (see _REDUNDANT_SEGMENTS),
    collapses a repeated marker segment like "WTT" down to its first
    occurrence (see _REPEATED_MARKER_SEGMENTS), and collapses
    immediately-repeated segments (e.g. "Water supply - Water supply -
    Water supply" -> "Water supply"; "Hotel stay - Hotel stay - Egypt" ->
    "Hotel stay - Egypt"). The marker-collapse runs before the adjacent
    dedup pass on purpose: removing a repeated "WTT" (or a "land" segment
    sitting between two "WTT"s) can bring an already-duplicated segment like
    "heat and steam" into adjacency, which the final pass then catches."""
    filtered = [s for s in segments if s.strip().lower() not in _REDUNDANT_SEGMENTS]

    seen_marker: set[str] = set()
    marker_filtered: list[str] = []
    for seg in filtered:
        key = seg.strip().lower()
        if key in _REPEATED_MARKER_SEGMENTS:
            if key in seen_marker:
                continue
            seen_marker.add(key)
        marker_filtered.append(seg)

    deduped: list[str] = []
    for seg in marker_filtered:
        if deduped and seg.strip().lower() == deduped[-1].strip().lower():
            continue
        deduped.append(seg)
    return deduped


def titlecase_report_label(text: str) -> str:
    """Full normalization pipeline for a DEFRA-style report label: drop
    redundant "land" mode qualifiers, collapse adjacent duplicate segments,
    rejoin as "First segment: remaining segments space-joined", then apply
    acronym-safe title casing to the result. A single-segment label (no
    separator dash) passes through the casing pass with no colon inserted."""
    text = str(text or "")
    if not text.strip():
        return text

    segments = _restructure_segments(split_top_level_segments(text))
    if len(segments) <= 1:
        rejoined = segments[0] if segments else text
    else:
        rejoined = f"{segments[0]}: {' '.join(segments[1:])}"

    return _apply_word_casing(rejoined)


# A label is in-scope for this cleanup only if it has a genuine separator
# dash (space-adjacent, e.g. " - " or "word- ") -- NOT a tight compound-word
# hyphen like "Plug-in", "Single-family", "Dry-cleaning", which are already
# correctly formatted USEEIO-style labels and must be left alone. Confirmed
# live: 32,703 rows match this; excludes the ~4,800 "contains a dash but is
# actually a compound word" false positives that a plain "%-%" LIKE would
# have caught.
SEPARATOR_DASH_REGEX = r"( -|- )"

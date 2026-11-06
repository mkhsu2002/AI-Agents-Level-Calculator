"""AI Agents Level Calculator scoring: a deterministic local formula, designed for this app.

Inputs are evidence fields. Each field has a value and a status:
  verified  - a Clocked Extract or Fill call found it in the source text
              with a source quote and position.
  estimated - the user supplied the number without source evidence, or a
              Clocked call returned low confidence. It counts at half weight.
  missing   - no value was supplied and no evidence was found. It counts
              as zero and is shown as missing, never silently scored.

A score that rests on any estimated or missing field is flagged
provisional. The formula never invents a value for a missing field.

Six dimensions, locked by the user on 2026-11-06. Each returns 0 to 100:
  IDENTITY    = 100 * (0.6 * min(persona_items / 8, 1)
                       + 0.4 * min(memory_entries / 60, 1))
  KNOWLEDGE   = 100 * (0.5 * min(domains / 10, 1)
                       + 0.5 * min(memory_entries / 80, 1))
  SKILL       = 100 * (0.6 * min(skills / 8, 1)
                       + 0.4 * min(reasoning_examples / 5, 1))
  SPAN        = 100 * (0.3 * min(platforms / 5, 1)
                       + 0.3 * min(goals_done / 20, 1)
                       + 0.4 * min(deliveries / 100, 1))
  RELIABILITY = 100 * (0.7 * pass_rate
                       + 0.3 * min(fixes_acknowledged / 4, 1))
  INTEGRITY   = 100 * (0.4 * honesty + 0.4 * verified_share
                       + 0.2 * screen_pass)
  Integrity is measured by the Clocked pipeline itself, not by
  self-report: honesty is the Decide honesty grade (high 0.9, medium
  0.6, low 0.3, weighted by its probability), verified_share is the
  share of filled claims that Verify confirmed against the source
  text, and screen_pass is 1 when the Guard injection screen passed
  and Protect redaction ran, else 0. When score() is called without
  pipeline signals, honesty falls back to the honesty_disclosed
  field, verified_share to the share of verified fields, and
  screen_pass to 1.

Composite is the mean of all six dimension scores, rounded to an
integer. XP = 100 * skills + 80 * domains + 40 * goals_done
+ 25 * deliveries, with estimated fields at half value and missing
fields at zero. Level L requires 50 * L * (L - 1) XP.
Audit confidence is the mean field weight over all profile fields
(verified 1.0, estimated 0.5, missing 0), as a share from 0 to 1.
"""

from .config import DIMENSIONS, LEVEL_TITLES, PROFILE_FIELDS

WEIGHTS = {"verified": 1.0, "estimated": 0.5, "missing": 0.0}


def _clamp01(x):
    return max(0.0, min(1.0, x))


def _field(fields, name):
    """Return (value, weight, status) for one evidence field."""
    entry = fields.get(name) or {}
    status = entry.get("status", "missing")
    if status not in WEIGHTS:
        status = "missing"
    value = entry.get("value")
    if value is None:
        status = "missing"
        value = 0
    return value, WEIGHTS[status], status


def _num(fields, name):
    value, weight, _status = _field(fields, name)
    try:
        return float(value) * weight
    except (TypeError, ValueError):
        return 0.0


def _raw(fields, name):
    """Unweighted numeric value, or 0 when missing or not a number."""
    value, _weight, _status = _field(fields, name)
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _dimension_identity(fields):
    return 100.0 * (
        0.6 * _clamp01(_num(fields, "persona_items") / 8.0)
        + 0.4 * _clamp01(_num(fields, "memory_entries") / 60.0)
    )


def _dimension_knowledge(fields):
    return 100.0 * (
        0.5 * _clamp01(_num(fields, "domains") / 10.0)
        + 0.5 * _clamp01(_num(fields, "memory_entries") / 80.0)
    )


def _dimension_skill(fields):
    return 100.0 * (
        0.6 * _clamp01(_num(fields, "skills") / 8.0)
        + 0.4 * _clamp01(_num(fields, "reasoning_examples") / 5.0)
    )


def _dimension_span(fields):
    return 100.0 * (
        0.3 * _clamp01(_num(fields, "platforms") / 5.0)
        + 0.3 * _clamp01(_num(fields, "goals_done") / 20.0)
        + 0.4 * _clamp01(_num(fields, "deliveries") / 100.0)
    )


def _dimension_reliability(fields):
    pass_rate = _clamp01(_num(fields, "pass_rate"))
    return 100.0 * (
        0.7 * pass_rate + 0.3 * _clamp01(_num(fields, "fixes_acknowledged") / 4.0)
    )


def _dimension_integrity(fields, integrity=None):
    if integrity:
        honesty = _clamp01(float(integrity.get("honesty", 0.0)))
        verified_share = _clamp01(float(integrity.get("verified_share", 0.0)))
        screen_pass = 1.0 if integrity.get("screen_pass") else 0.0
    else:
        _hvalue, hweight, _hstatus = _field(fields, "honesty_disclosed")
        honesty = (1.0 if _hvalue is True else 0.0) * hweight
        verified = [e for e in fields.values() if (e or {}).get("status") == "verified"]
        verified_share = len(verified) / len(fields) if fields else 0.0
        screen_pass = 1.0 if fields else 0.0
    return 100.0 * (0.4 * honesty + 0.4 * verified_share + 0.2 * screen_pass)


_COMPUTERS = {
    "IDENTITY": _dimension_identity,
    "KNOWLEDGE": _dimension_knowledge,
    "SKILL": _dimension_skill,
    "SPAN": _dimension_span,
    "RELIABILITY": _dimension_reliability,
    "INTEGRITY": _dimension_integrity,
}


def level_for_xp(xp):
    level = 1
    while 50 * (level + 1) * level <= xp:
        level += 1
    return level


def title_for_level(level):
    for low, high, title in LEVEL_TITLES:
        if low <= level <= high:
            return title
    return "Legend"


def score(fields, integrity=None):
    """Score verified/estimated/missing evidence fields.

    fields: dict of name -> {"value": ..., "status": "verified"|"estimated"|"missing"}
    integrity: optional dict from the Clocked pipeline with honesty,
    verified_share, and screen_pass for the INTEGRITY dimension.
    Returns a dict with dimensions, composite, xp, level, title,
    audit_confidence, provisional flag, and per-field status.
    """
    dimensions = {}
    for dim in DIMENSIONS:
        key = dim["key"]
        fn = _COMPUTERS[key]
        if key == "INTEGRITY":
            dimensions[key] = round(fn(fields, integrity))
        else:
            dimensions[key] = round(fn(fields))

    composite = round(sum(dimensions.values()) / len(dimensions)) if dimensions else 0

    xp = (
        100 * _num(fields, "skills")
        + 80 * _num(fields, "domains")
        + 40 * _num(fields, "goals_done")
        + 25 * _num(fields, "deliveries")
    )
    xp = int(round(xp))
    level = level_for_xp(xp)

    statuses = {}
    weights = []
    for spec in PROFILE_FIELDS:
        name = spec["name"]
        entry = fields.get(name) or {}
        status = entry.get("status", "missing")
        if status not in WEIGHTS:
            status = "missing"
        if entry.get("value") is None:
            status = "missing"
        statuses[name] = status
        weights.append(WEIGHTS[status])
    audit_confidence = round(sum(weights) / len(weights), 2) if weights else 0.0
    provisional = any(s in ("estimated", "missing") for s in statuses.values())

    return {
        "dimensions": dimensions,
        "dimension_order": [d["key"] for d in DIMENSIONS],
        "dimension_labels": [d["label"] for d in DIMENSIONS],
        "composite": composite,
        "xp": xp,
        "level": level,
        "title": title_for_level(level),
        "audit_confidence": audit_confidence,
        "provisional": provisional,
        "field_status": statuses,
    }

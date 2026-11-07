"""Clocked API client for AI Agents Level Calculator.

Two modes, always explicit:
  live - calls the real Clocked API through the official clocked-sdk.
         Requires the CLOCKED_API_KEY environment variable. The key is
         read server-side only and is never sent to the browser.
  mock - deterministic offline stand-in with the same return shapes.
         Used for the demo, for tests, and when no key is configured.
         Mock results are always labelled mock in the UI and in the
         audit output, so a mock audit can never be mistaken for a live one.

SDK note, verified by installing it on 2026-11-06: pip install
clocked-sdk works (version 0.7.0 in this repo's venv) and
from clocked_sdk import Clocked imports fine. The Introduction page
claim that no SDK exists is outdated; the Quickstart page is right.
The SDK method signatures below were read from the installed package:
decide(state, questions), extract(text, fields), fill(text, fields),
grounding(documents, claims), injection(text), pii(text). Results are
dicts. If the SDK ever changes, the raw HTTP fallback is:
POST https://clocked.rezolve.ai/clocked/<endpoint> with JSON and the
Authorization: Bearer <key> header. The SDK source, not the docs
authentication page, is the evidence for the Bearer header: the docs
page names X-CLOCKED-KEY, but the SDK sends Bearer and the docs
header was rejected in live tests on 2026-11-06.

Live request shapes, verified against the real API on 2026-11-06
(free trial key, no card attached; failed calls cost 0 credits):
- Decide: questions is a mapping name -> {type: "choice", target,
  options, criteria, fallback}; criteria is a mapping of at least
  two options to descriptions, not a list. Answers carry choice,
  probabilities, and confidence.
- Extract and Fill: both return a "fields" mapping, not "answers".
  Each field has value (string), start/end char positions,
  confidence, and p_verify; Fill with type "extract" also returns
  a typed "number". Fill fields need a "type": number and text
  fields use "extract", boolean fields use "yes_no".
- Grounding: needs documents, claims, AND a non-empty "answer"
  string (the joined claims work). Each claim returns verdict
  "supported" / contradicted / not stated, plus a supported score.
- PII: the response carries no redacted text, only "entities" with
  type, value, start, end, and confidence. Redaction is done here
  from those spans.
- Injection: verdicts are "benign" for safe input, "risky" style
  verdicts otherwise; risk is "low" / "high".

Credit model, from the official docs: cost is ceil(model_time_ms / 25)
per successful call, failed calls cost 0. Measured live on 2026-11-06
from the X-Clocked-Credits response header: one probe run cost
Protect 2, Guard 2, Extract 2, Fill 3, Decide 1, Verify 1 (11
total), and a re-run of the full demo audit cost 14
(Protect 1, Guard 1, Extract 3, Fill 4, Decide 1, Verify 4), so a
full audit costs about 11 to 14 credits, varying with input size
and model time. The earlier 40 to 60 estimate came from the docs'
average timings and was wrong; the formula checks out exactly
against the measured model times (for example Protect took 42 ms,
ceil(42 / 25) = 2). Far below the 20,000 free credits (4,000 trial
plus 16,000 from the code CLOCKEDHACKATHON).
"""

import os
import re

BASE_URL = "https://clocked.rezolve.ai/clocked"

MOCK_CREDITS = {
    "decide": 1,
    "extract": 2,
    "fill": 3,
    "grounding": 1,
    "injection": 2,
    "pii": 2,
}

INJECTION_PATTERNS = [
    r"ignore (all )?(previous|prior|above) instructions",
    r"disregard (all )?(previous|prior|above) instructions",
    r"you are now ",
    r"override your (instructions|rules|system)",
    r"reveal your (system prompt|instructions|api key|secret)",
    r"system prompt",
]

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"\+?\d[\d\s().-]{7,}\d")
LONG_DIGITS_RE = re.compile(r"\b\d{9,}\b")


def _credits_from_usage(result, endpoint):
    usage = (result or {}).get("usage") or {}
    cost = usage.get("cost_credits")
    if isinstance(cost, (int, float)):
        return int(cost)
    return MOCK_CREDITS.get(endpoint, 1)


def _credits_from_result(sdk_result, body, endpoint):
    """Real settled credits live on the SDK Result object, read from
    the X-Clocked-Credits response header. The response body itself
    carries no cost field, so reading only the body falls back to the
    mock constants and overstates the cost. (That is how the earlier
    48-credit figure happened: it was the fallback sum, not measured.)
    """
    credits = getattr(sdk_result, "credits", None)
    if isinstance(credits, int):
        return credits
    return _credits_from_usage(body, endpoint)


def _coerce_value(field):
    """Turn a live field entry into a typed value.

    The API returns value as a string, plus a typed "number" for
    numeric fields. Boolean yes_no answers come back as true/false
    or "yes"/"no" strings.
    """
    if "number" in field and isinstance(field["number"], (int, float)):
        return field["number"]
    value = field.get("value")
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("true", "yes"):
            return True
        if lowered in ("false", "no"):
            return False
        try:
            number = float(value.strip())
            return int(number) if number.is_integer() else number
        except (TypeError, ValueError):
            return value
    return value


def _parse_fields_result(text, fields):
    """Turn a live Extract/Fill "fields" mapping into answers + missing.

    answers: name -> {value, confidence, sources[{quote, start_char, end_char}]}.
    A field with no value counts as missing, never invented.
    """
    answers = {}
    missing = []
    for name, field in (fields or {}).items():
        if not isinstance(field, dict):
            continue
        value = _coerce_value(field)
        if value is None:
            missing.append({"name": name, "reason": "not established"})
            continue
        start, end = field.get("start"), field.get("end")
        sources = []
        if isinstance(start, int) and isinstance(end, int) and 0 <= start < end <= len(text):
            line_start = text.rfind("\n", 0, start) + 1
            line_end = text.find("\n", end)
            line_end = len(text) if line_end == -1 else line_end
            sources.append({
                "quote": text[line_start:line_end].strip(),
                "start_char": line_start,
                "end_char": line_end,
            })
        answers[name] = {
            "value": value,
            "confidence": float(field.get("confidence") or 0.0),
            "sources": sources,
        }
    return answers, missing


class ClockedClient:
    """One client for both modes. mode is 'live' or 'mock'."""

    def __init__(self, mode=None):
        if mode is None:
            mode = "live" if os.environ.get("CLOCKED_API_KEY") else "mock"
        if mode not in ("live", "mock"):
            raise ValueError("mode must be live or mock")
        self.mode = mode
        self._sdk = None
        if mode == "live":
            from clocked_sdk import Clocked

            self._sdk = Clocked()

    # -- Protect (PII) -------------------------------------------------
    def pii(self, text):
        if self.mode == "mock":
            return self._mock_pii(text)
        sdk_result = self._sdk.pii(text=text)
        result = dict(sdk_result)
        entities = result.get("entities") or []
        # The API returns entity spans, not redacted text, so redact here.
        findings = []
        spans = []
        for ent in entities:
            start, end = ent.get("start"), ent.get("end")
            if isinstance(start, int) and isinstance(end, int) and start < end:
                findings.append({"type": ent.get("type"), "start": start, "end": end})
                spans.append((start, end, ent.get("type", "pii")))
        redacted = text
        for start, end, kind in sorted(spans, reverse=True):
            redacted = redacted[:start] + "[REDACTED:%s]" % str(kind).upper() + redacted[end:]
        return {
            "redacted_text": redacted,
            "findings": findings,
            "credits": _credits_from_result(sdk_result, result, "pii"),
            "raw": result,
        }

    def _mock_pii(self, text):
        findings = []
        redacted = text
        for match in EMAIL_RE.finditer(text):
            findings.append({"type": "email", "start": match.start(), "end": match.end()})
        redacted = EMAIL_RE.sub("[REDACTED:EMAIL]", redacted)
        for match in LONG_DIGITS_RE.finditer(text):
            findings.append({"type": "long_number", "start": match.start(), "end": match.end()})
        redacted = LONG_DIGITS_RE.sub("[REDACTED:NUMBER]", redacted)
        return {
            "redacted_text": redacted,
            "findings": findings,
            "credits": MOCK_CREDITS["pii"],
            "raw": {"mock": True},
        }

    # -- Guard (injection) ---------------------------------------------
    def injection(self, text):
        if self.mode == "mock":
            return self._mock_injection(text)
        sdk_result = self._sdk.injection(text=text)
        result = dict(sdk_result)
        label = result.get("verdict") or result.get("decision") or "safe"
        risk = result.get("risk", "low")
        if isinstance(label, dict):
            risk = label.get("risk", risk)
            label = label.get("verdict", "safe")
        label = str(label)
        # The live API says "benign" for safe input; normalise it.
        if label == "benign":
            label = "safe"
        return {
            "verdict": label,
            "risk": risk,
            "credits": _credits_from_result(sdk_result, result, "injection"),
            "raw": result,
        }

    def _mock_injection(self, text):
        lowered = text.lower()
        hits = [p for p in INJECTION_PATTERNS if re.search(p, lowered)]
        if hits:
            return {"verdict": "risky", "risk": "high", "hits": hits,
                    "credits": MOCK_CREDITS["injection"], "raw": {"mock": True}}
        return {"verdict": "safe", "risk": "low", "hits": [],
                "credits": MOCK_CREDITS["injection"], "raw": {"mock": True}}

    # -- Extract --------------------------------------------------------
    def extract(self, text, fields):
        """fields: dict of name -> target question string."""
        if self.mode == "mock":
            return self._mock_extract(text, fields)
        sdk_fields = {name: {"target": target} for name, target in fields.items()}
        sdk_result = self._sdk.extract(text=text, fields=sdk_fields)
        result = dict(sdk_result)
        answers, missing = _parse_fields_result(text, result.get("fields") or {})
        return {
            "answers": answers,
            "missing": missing,
            "unsupported": result.get("unsupported", []),
            "credits": _credits_from_result(sdk_result, result, "extract"),
            "raw": result,
        }

    def _mock_extract(self, text, fields):
        answers = {}
        missing = []
        for name, _target in fields.items():
            match = re.search(
                r"(?im)^[^:\n]*\b" + re.escape(name) + r"\b\s*[:=]\s*([0-9]+(?:\.[0-9]+)?|true|false)\b",
                text,
            )
            if match:
                raw = match.group(1)
                value = raw == "true" if raw in ("true", "false") else float(raw)
                if isinstance(value, float) and value.is_integer():
                    value = int(value)
                line_start = text.rfind("\n", 0, match.start()) + 1
                line_end = text.find("\n", match.start())
                line_end = len(text) if line_end == -1 else line_end
                answers[name] = {
                    "value": value,
                    "confidence": 0.9,
                    "sources": [{
                        "quote": text[line_start:line_end].strip(),
                        "start_char": line_start,
                        "end_char": line_end,
                    }],
                }
            else:
                missing.append({"name": name, "reason": "not established"})
        return {"answers": answers, "missing": missing, "unsupported": [],
                "credits": MOCK_CREDITS["extract"], "raw": {"mock": True}}

    # -- Fill -----------------------------------------------------------
    def fill(self, text, spec_fields):
        """spec_fields: list of dicts with name, kind, kind_hint."""
        if self.mode == "mock":
            return self._mock_fill(text, spec_fields)
        sdk_fields = {}
        for f in spec_fields:
            # Live Fill fields need a "type": number and text fields
            # are "extract", boolean fields are "yes_no".
            kind = f["kind"]
            entry = {"type": "yes_no" if kind == "boolean" else "extract"}
            if f.get("kind_hint"):
                entry["kind_hint"] = f["kind_hint"]
            if f.get("options"):
                entry["options"] = f["options"]
            sdk_fields[f["name"]] = entry
        sdk_result = self._sdk.fill(text=text, fields=sdk_fields)
        result = dict(sdk_result)
        answers, missing = _parse_fields_result(text, result.get("fields") or {})
        return {
            "values": answers,
            "missing": missing,
            "unsupported": result.get("unsupported", []),
            "credits": _credits_from_result(sdk_result, result, "fill"),
            "raw": result,
        }

    def _mock_fill(self, text, spec_fields):
        extracted = self._mock_extract(text, {f["name"]: f.get("kind_hint", f["name"]) for f in spec_fields})
        values = {}
        for name, answer in extracted["answers"].items():
            values[name] = answer
        return {"values": values, "missing": extracted["missing"],
                "unsupported": [], "credits": MOCK_CREDITS["fill"],
                "raw": {"mock": True}}

    # -- Decide ---------------------------------------------------------
    def decide(self, state, questions):
        """questions: dict of name -> {type, target, options, criteria, fallback}.

        Live Decide requires type "choice" and criteria as a mapping
        of at least two options to descriptions, not a list.
        """
        if self.mode == "mock":
            return self._mock_decide(state, questions)
        sdk_result = self._sdk.decide(state=state, questions=questions)
        result = dict(sdk_result)
        return {
            "answers": result.get("answers", {}),
            "credits": _credits_from_result(sdk_result, result, "decide"),
            "raw": result,
        }

    def _mock_decide(self, state, questions):
        answers = {}
        for name, q in questions.items():
            options = q.get("options", [])
            if not options:
                continue
            if name == "autonomy_tier":
                choice = "domain_full" if "domain_full" in options else options[-1]
            elif name == "honesty_grade":
                choice = "high" if "high" in options else options[-1]
            else:
                choice = options[0]
            probs = {o: (0.7 if o == choice else 0.3 / max(len(options) - 1, 1)) for o in options}
            answers[name] = {"choice": choice, "deviated": False, "probabilities": probs}
        return {"answers": answers, "credits": MOCK_CREDITS["decide"],
                "raw": {"mock": True}}

    # -- Verify / grounding ---------------------------------------------
    def grounding(self, documents, claims):
        if self.mode == "mock":
            return self._mock_grounding(documents, claims)
        # Live grounding requires a non-empty "answer" string as well
        # as documents and claims; the joined claims serve as it.
        answer = "; ".join(claims)
        sdk_result = self._sdk.grounding(documents=documents, claims=claims, answer=answer)
        result = dict(sdk_result)
        answers = {}
        for item in result.get("claims") or []:
            claim = item.get("claim")
            if not claim:
                continue
            verdict = str(item.get("verdict", "")).lower()
            if verdict == "supported":
                label = "true"
            elif verdict in ("contradicted", "refuted"):
                label = "false"
            else:
                label = "unsupported"
            answers[claim] = {
                "label": label,
                "confidence": float(item.get("supported") or 0.0),
                "explanation": "Clocked verdict: %s (supported %.2f)." % (verdict, float(item.get("supported") or 0.0)),
            }
        return {
            "answers": answers,
            "credits": _credits_from_result(sdk_result, result, "grounding"),
            "raw": result,
        }

    def _mock_grounding(self, documents, claims):
        source = "\n".join(documents)
        answers = {}
        for claim in claims:
            numbers = re.findall(r"\d+(?:\.\d+)?", claim)
            supported = all(n in source for n in numbers) if numbers else False
            answers[claim] = {
                "label": "true" if supported else "unsupported",
                "confidence": 0.9 if supported else 0.4,
                "explanation": "Claim numbers found in source text." if supported else "No matching evidence in source text.",
            }
        return {"answers": answers, "credits": MOCK_CREDITS["grounding"],
                "raw": {"mock": True}}

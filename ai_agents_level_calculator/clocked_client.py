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

Credit model, from the official docs: cost is ceil(model_time_ms / 25)
per successful call, failed calls cost 0. Measured averages are about
1 credit for Decide, 8 for Extract, 13 for Fill, about 13 for Protect.
A full audit makes about 6 calls and costs roughly 40 to 60 credits,
far below the 20,000 free credits (4,000 trial plus 16,000 from the
code CLOCKEDHACKATHON).
"""

import os
import re

BASE_URL = "https://clocked.rezolve.ai/clocked"

MOCK_CREDITS = {
    "decide": 1,
    "extract": 8,
    "fill": 13,
    "grounding": 11,
    "injection": 2,
    "pii": 13,
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
        result = dict(self._sdk.pii(text=text))
        return {
            "redacted_text": result.get("redacted_text") or result.get("redacted") or text,
            "findings": result.get("findings", []),
            "credits": _credits_from_usage(result, "pii"),
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
        result = dict(self._sdk.injection(text=text))
        verdict = result.get("verdict") or result.get("decision") or {}
        if isinstance(verdict, dict):
            risk = verdict.get("risk", "low")
            label = verdict.get("verdict", "safe")
        else:
            risk, label = "low", str(verdict)
        return {
            "verdict": label,
            "risk": risk,
            "credits": _credits_from_usage(result, "injection"),
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
        result = dict(self._sdk.extract(text=text, fields=sdk_fields))
        return {
            "answers": result.get("answers", {}),
            "missing": result.get("missing", []),
            "unsupported": result.get("unsupported", []),
            "credits": _credits_from_usage(result, "extract"),
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
            entry = {"kind": f["kind"]}
            if f.get("kind_hint"):
                entry["kind_hint"] = f["kind_hint"]
            if f.get("options"):
                entry["options"] = f["options"]
            sdk_fields[f["name"]] = entry
        result = dict(self._sdk.fill(text=text, fields=sdk_fields))
        return {
            "values": result.get("values", {}),
            "missing": result.get("missing", []),
            "unsupported": result.get("unsupported", []),
            "credits": _credits_from_usage(result, "fill"),
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
        """questions: dict of name -> {target, options, criteria, fallback}."""
        if self.mode == "mock":
            return self._mock_decide(state, questions)
        result = dict(self._sdk.decide(state=state, questions=questions))
        return {
            "answers": result.get("answers", {}),
            "credits": _credits_from_usage(result, "decide"),
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
        result = dict(self._sdk.grounding(documents=documents, claims=claims))
        return {
            "answers": result.get("answers", result.get("claims", {})),
            "credits": _credits_from_usage(result, "grounding"),
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

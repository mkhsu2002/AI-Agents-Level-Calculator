// AI Agents Level Calculator - Cloudflare Worker entry point.
//
// Why JavaScript, not a Python Worker: the local app is a Python
// standard-library server that depends on clocked-sdk (httpx) and
// Pillow for the PNG card. A Python Worker runs on Pyodide with a
// limited, still-changing set of supported PyPI packages, no
// ThreadingHTTPServer, and no local filesystem, so neither dependency
// is guaranteed to work there and it cannot be verified without
// deploying. This Worker is therefore a small, dependency-free
// JavaScript port of the same app: same single-page frontend (served
// from ./ai_agents_level_calculator/static via Workers Static Assets), same
// six dimensions, same pipeline order, same scoring formula, same
// 9:16 card layout. The only deliberate difference is the card
// format: the Worker renders the card as SVG (1080 x 1920), because
// Workers have no Pillow; the local Python server renders PNG.
// The frontend downloads whichever format the server returns.
//
// The Clocked API key is read server-side only, from the Worker
// secret CLOCKED_API_KEY (wrangler secret put CLOCKED_API_KEY). It
// is never sent to the browser and never appears in this repo.
// Without the secret the Worker runs in mock mode and says so.
//
// Clocked calls use the raw HTTP API, with request shapes verified
// live on 2026-11-06 against the real API (free trial key, no card):
//   POST https://clocked.rezolve.ai/clocked/<endpoint>
//   headers Authorization: Bearer <key>, Idempotency-Key: <uuid>
//   body JSON. Every call needs a fresh UUID Idempotency-Key or the
//   API answers 400. Auth evidence: the official clocked-sdk 0.7.0
//   source sends Authorization: Bearer, not the X-CLOCKED-KEY header
//   the docs mention. Verified shapes: Decide questions carry
//   type "choice" and criteria as a mapping of options to
//   descriptions; Extract and Fill return a "fields" mapping;
//   Fill fields need a "type" ("extract" for numbers, "yes_no" for
//   booleans); Grounding needs documents, claims, AND a non-empty
//   "answer" string; PII returns entity spans only, redaction is
//   done here. A full live audit of the demo returned Level 10
//   Builder, composite 75.

const CLOCKED_BASE = "https://clocked.rezolve.ai/clocked";
const MAX_STATE_CHARS = 10000;
const APP_VERSION = "v0.15";

const DIMENSIONS = [
  { key: "IDENTITY", label: "Identity" },
  { key: "KNOWLEDGE", label: "Knowledge" },
  { key: "SKILL", label: "Skill" },
  { key: "SPAN", label: "Span" },
  { key: "RELIABILITY", label: "Reliability" },
  { key: "INTEGRITY", label: "Integrity" },
];

const LEVEL_TITLES = [
  [1, 4, "Seedling"],
  [5, 9, "Explorer"],
  [10, 14, "Builder"],
  [15, 19, "Specialist"],
  [20, 29, "Master"],
  [30, 999, "Legend"],
];

const PROFILE_FIELDS = [
  { name: "persona_items", kind: "number", hint: "Number of distinct persona traits or identity statements" },
  { name: "memory_entries", kind: "number", hint: "Number of saved memory or note entries" },
  { name: "domains", kind: "number", hint: "Number of knowledge domains the agent works in" },
  { name: "skills", kind: "number", hint: "Number of skills or tools the agent can use" },
  { name: "reasoning_examples", kind: "number", hint: "Number of documented reasoning or decision examples" },
  { name: "platforms", kind: "number", hint: "Number of platforms the agent runs on" },
  { name: "goals_total", kind: "number", hint: "Total goals tracked" },
  { name: "goals_done", kind: "number", hint: "Goals completed" },
  { name: "deliveries", kind: "number", hint: "Accepted deliveries or shipped results" },
  { name: "pass_rate", kind: "number", hint: "Share of checks passed, 0 to 1" },
  { name: "honesty_disclosed", kind: "boolean", hint: "Whether limits and estimates were openly disclosed" },
  { name: "fixes_acknowledged", kind: "number", hint: "Number of acknowledged fixes or corrections" },
];

const MOCK_CREDITS = { decide: 1, extract: 2, fill: 3, grounding: 1, injection: 2, pii: 2 };

const INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior|above) instructions/,
  /disregard (all )?(previous|prior|above) instructions/,
  /you are now /,
  /override your (instructions|rules|system)/,
  /reveal your (system prompt|instructions|api key|secret)/,
  /system prompt/,
];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LONG_DIGITS_RE = /\b\d{9,}\b/g;

const DEMO = {
  agent_name: "Demo Agent",
  platform: "Muse",
  evidence_text: "persona_items: 7\nmemory_entries: 50\ndomains: 10\nskills: 5\nreasoning_examples: 4\nplatforms: 4\ngoals_total: 38\ngoals_done: 18\ndeliveries: 100\nfixes_acknowledged: 4",
  profile: { honesty_disclosed: true, pass_rate: 0.8 },
};

// ---------------------------------------------------------------------------
// Clocked client: live (raw HTTP) and mock (offline stand-in, same shapes)
// ---------------------------------------------------------------------------

function creditsFromUsage(result, endpoint) {
  // Real settled credits come from the X-Clocked-Credits response
  // header, attached by clockedCall as _header_credits. The body
  // carries no cost field, so reading only the body falls back to
  // the mock constants and overstates the cost.
  const header = result && result._header_credits;
  if (typeof header === "number" && Number.isFinite(header)) return header;
  const cost = result && result.usage && result.usage.cost_credits;
  if (typeof cost === "number") return cost;
  return MOCK_CREDITS[endpoint] || 1;
}

async function clockedCall(key, endpoint, payload) {
  const res = await fetch(CLOCKED_BASE + "/" + endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + key,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("Clocked " + endpoint + " failed with HTTP " + res.status + ": " + text);
  }
  const parsed = await res.json();
  const headerCredits = parseInt(res.headers.get("x-clocked-credits") || "", 10);
  if (Number.isFinite(headerCredits)) parsed._header_credits = headerCredits;
  return parsed;
}

function mockPii(text) {
  const findings = [];
  let redacted = text;
  for (const m of text.matchAll(EMAIL_RE)) {
    findings.push({ type: "email", start: m.index, end: m.index + m[0].length });
  }
  redacted = redacted.replace(EMAIL_RE, "[REDACTED:EMAIL]");
  for (const m of text.matchAll(LONG_DIGITS_RE)) {
    findings.push({ type: "long_number", start: m.index, end: m.index + m[0].length });
  }
  redacted = redacted.replace(LONG_DIGITS_RE, "[REDACTED:NUMBER]");
  return { redacted_text: redacted, findings, credits: MOCK_CREDITS.pii, raw: { mock: true } };
}

function mockInjection(text) {
  const lowered = text.toLowerCase();
  const hits = INJECTION_PATTERNS.filter((p) => p.test(lowered)).map((p) => String(p));
  if (hits.length) {
    return { verdict: "risky", risk: "high", hits, credits: MOCK_CREDITS.injection, raw: { mock: true } };
  }
  return { verdict: "safe", risk: "low", hits: [], credits: MOCK_CREDITS.injection, raw: { mock: true } };
}

function mockExtractOne(text, name) {
  const re = new RegExp("^[^:\\n]*\\b" + name + "\\b\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?|true|false)\\b", "im");
  const match = re.exec(text);
  if (!match) return null;
  const raw = match[1];
  let value;
  if (raw === "true") value = true;
  else if (raw === "false") value = false;
  else value = Number(raw);
  const lineStart = text.lastIndexOf("\n", match.index) + 1;
  let lineEnd = text.indexOf("\n", match.index);
  if (lineEnd === -1) lineEnd = text.length;
  return {
    value,
    confidence: 0.9,
    sources: [{ quote: text.slice(lineStart, lineEnd).trim(), start_char: lineStart, end_char: lineEnd }],
  };
}

function mockExtract(text, fields) {
  const answers = {};
  const missing = [];
  for (const name of Object.keys(fields)) {
    const found = mockExtractOne(text, name);
    if (found) answers[name] = found;
    else missing.push({ name, reason: "not established" });
  }
  return { answers, missing, unsupported: [], credits: MOCK_CREDITS.extract, raw: { mock: true } };
}

function mockDecide(state, questions) {
  const answers = {};
  for (const [name, q] of Object.entries(questions)) {
    const options = q.options || [];
    if (!options.length) continue;
    let choice;
    if (name === "autonomy_tier") choice = options.includes("domain_full") ? "domain_full" : options[options.length - 1];
    else if (name === "honesty_grade") choice = options.includes("high") ? "high" : options[options.length - 1];
    else choice = options[0];
    const probs = {};
    for (const o of options) probs[o] = o === choice ? 0.7 : 0.3 / Math.max(options.length - 1, 1);
    answers[name] = { choice, deviated: false, probabilities: probs };
  }
  return { answers, credits: MOCK_CREDITS.decide, raw: { mock: true } };
}

function coerceFieldValue(field) {
  if (field && typeof field.number === "number") return field.number;
  const value = field ? field.value : undefined;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true" || lowered === "yes") return true;
    if (lowered === "false" || lowered === "no") return false;
    const n = Number(value.trim());
    if (Number.isFinite(n) && value.trim() !== "") return n;
    return value;
  }
  return value === undefined ? null : value;
}

function parseFieldsResult(text, fields) {
  const answers = {};
  const missing = [];
  for (const [name, field] of Object.entries(fields || {})) {
    if (!field || typeof field !== "object") continue;
    const value = coerceFieldValue(field);
    if (value === null || value === undefined) {
      missing.push({ name, reason: "not established" });
      continue;
    }
    const sources = [];
    const start = field.start;
    const end = field.end;
    if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && end <= text.length) {
      const lineStart = text.lastIndexOf("\n", start) + 1;
      let lineEnd = text.indexOf("\n", end);
      if (lineEnd === -1) lineEnd = text.length;
      sources.push({ quote: text.slice(lineStart, lineEnd).trim(), start_char: lineStart, end_char: lineEnd });
    }
    answers[name] = { value, confidence: Number(field.confidence) || 0, sources };
  }
  return { answers, missing };
}

function mockGrounding(documents, claims) {
  const source = documents.join("\n");
  const answers = {};
  for (const claim of claims) {
    const numbers = claim.match(/\d+(?:\.\d+)?/g) || [];
    const supported = numbers.length ? numbers.every((n) => source.includes(n)) : false;
    answers[claim] = {
      label: supported ? "true" : "unsupported",
      confidence: supported ? 0.9 : 0.4,
      explanation: supported ? "Claim numbers found in source text." : "No matching evidence in source text.",
    };
  }
  return { answers, credits: MOCK_CREDITS.grounding, raw: { mock: true } };
}

class ClockedClient {
  constructor(mode, key) {
    this.mode = mode;
    this.key = key;
  }

  async pii(text) {
    if (this.mode === "mock") return mockPii(text);
    const result = await clockedCall(this.key, "pii", { text });
    // Live PII returns entity spans, not redacted text; redact here.
    const entities = result.entities || [];
    const findings = [];
    const spans = [];
    for (const ent of entities) {
      if (Number.isInteger(ent.start) && Number.isInteger(ent.end) && ent.start < ent.end) {
        findings.push({ type: ent.type, start: ent.start, end: ent.end });
        spans.push([ent.start, ent.end, ent.type || "pii"]);
      }
    }
    let redacted = text;
    for (const [start, end, kind] of spans.sort((a, b) => b[0] - a[0])) {
      redacted = redacted.slice(0, start) + "[REDACTED:" + String(kind).toUpperCase() + "]" + redacted.slice(end);
    }
    return { redacted_text: redacted, findings, credits: creditsFromUsage(result, "pii"), raw: result };
  }

  async injection(text) {
    if (this.mode === "mock") return mockInjection(text);
    const result = await clockedCall(this.key, "injection", { text });
    let label = result.verdict || result.decision || "safe";
    if (typeof label === "object" && label !== null) label = label.verdict || label.label || "safe";
    label = String(label);
    if (label === "benign") label = "safe";
    return { verdict: label, risk: result.risk || "low", credits: creditsFromUsage(result, "injection"), raw: result };
  }

  async extract(text, fields) {
    if (this.mode === "mock") return mockExtract(text, fields);
    const sdkFields = Object.fromEntries(Object.entries(fields).map(([name, target]) => [name, { target }]));
    const result = await clockedCall(this.key, "extract", { text, fields: sdkFields });
    const parsed = parseFieldsResult(text, result.fields || {});
    return {
      answers: parsed.answers,
      missing: parsed.missing,
      unsupported: result.unsupported || [],
      credits: creditsFromUsage(result, "extract"),
      raw: result,
    };
  }

  async fill(text, specFields) {
    if (this.mode === "mock") {
      const extracted = mockExtract(text, Object.fromEntries(specFields.map((f) => [f.name, f.kind_hint || f.name])));
      const values = {};
      for (const [name, answer] of Object.entries(extracted.answers)) values[name] = answer;
      return { values, missing: extracted.missing, unsupported: [], credits: MOCK_CREDITS.fill, raw: { mock: true } };
    }
    const sdkFields = {};
    for (const f of specFields) {
      const entry = { type: f.kind === "boolean" ? "yes_no" : "extract" };
      if (f.kind_hint) entry.kind_hint = f.kind_hint;
      if (f.options) entry.options = f.options;
      sdkFields[f.name] = entry;
    }
    const result = await clockedCall(this.key, "fill", { text, fields: sdkFields });
    const parsed = parseFieldsResult(text, result.fields || {});
    return {
      values: parsed.answers,
      missing: parsed.missing,
      unsupported: result.unsupported || [],
      credits: creditsFromUsage(result, "fill"),
      raw: result,
    };
  }

  async decide(state, questions) {
    if (this.mode === "mock") return mockDecide(state, questions);
    const result = await clockedCall(this.key, "decide", { state, questions });
    return { answers: result.answers || {}, credits: creditsFromUsage(result, "decide"), raw: result };
  }

  // Verify, one batched grounding call for all claims, the same as
  // the Python server path. Live grounding needs documents, claims,
  // AND a non-empty "answer" string; the joined claims serve as it.
  async grounding(documents, claims) {
    if (this.mode === "mock") return mockGrounding(documents, claims);
    const answer = claims.join("; ");
    const result = await clockedCall(this.key, "grounding", { documents, claims, answer });
    const answers = {};
    for (const item of result.claims || []) {
      if (!item.claim) continue;
      const verdict = String(item.verdict || "").toLowerCase();
      const label = verdict === "supported" ? "true" : verdict === "contradicted" || verdict === "refuted" ? "false" : "unsupported";
      answers[item.claim] = {
        label,
        confidence: Number(item.supported) || 0,
        explanation: "Clocked verdict: " + verdict + " (supported " + (Number(item.supported) || 0).toFixed(2) + ").",
      };
    }
    return { answers, credits: creditsFromUsage(result, "grounding"), raw: result };
  }
}

// ---------------------------------------------------------------------------
// Scoring: deterministic local formula, ported from the Python server.
// Verified fields count at full weight, estimated at half, missing at zero.
// Composite is the mean of the six dimension scores. XP = 100 * skills
// + 80 * domains + 40 * goals_done + 25 * deliveries, with estimated
// fields excluded from XP; estimated values still half-weight in dimension scores.
// ---------------------------------------------------------------------------

const WEIGHTS = { verified: 1.0, estimated: 0.5, missing: 0.0 };

// Python round() rounds half to even (round(78.5) is 78), while
// JavaScript Math.round rounds half up (79). The Worker must agree
// with the Python server on the same evidence, so use Python rounding.
function pyRound(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function fieldEntry(fields, name) {
  const entry = fields[name] || {};
  let status = entry.status || "missing";
  if (!(status in WEIGHTS)) status = "missing";
  let value = entry.value;
  if (value === null || value === undefined) {
    status = "missing";
    value = 0;
  }
  return { value, weight: WEIGHTS[status], status };
}

function numField(fields, name) {
  const { value, weight } = fieldEntry(fields, name);
  const n = Number(value);
  return Number.isFinite(n) ? n * weight : 0;
}

function xpNumField(fields, name) {
  const { value, status } = fieldEntry(fields, name);
  if (status !== "verified") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function rawField(fields, name) {
  const { value } = fieldEntry(fields, name);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dimensionValue(key, fields, integrity) {
  switch (key) {
    case "IDENTITY":
      return 100 * (0.6 * clamp01(numField(fields, "persona_items") / 8) + 0.4 * clamp01(numField(fields, "memory_entries") / 60));
    case "KNOWLEDGE":
      return 100 * (0.5 * clamp01(numField(fields, "domains") / 10) + 0.5 * clamp01(numField(fields, "memory_entries") / 80));
    case "SKILL":
      return 100 * (0.6 * clamp01(numField(fields, "skills") / 8) + 0.4 * clamp01(numField(fields, "reasoning_examples") / 5));
    case "SPAN":
      return 100 * (0.3 * clamp01(numField(fields, "platforms") / 5) + 0.3 * clamp01(numField(fields, "goals_done") / 20) + 0.4 * clamp01(numField(fields, "deliveries") / 100));
    case "RELIABILITY": {
      const passRate = clamp01(numField(fields, "pass_rate"));
      return 100 * (0.7 * passRate + 0.3 * clamp01(numField(fields, "fixes_acknowledged") / 4));
    }
    case "INTEGRITY": {
      let honesty, verifiedShare, screenPass;
      if (integrity) {
        honesty = clamp01(Number(integrity.honesty) || 0);
        verifiedShare = clamp01(Number(integrity.verified_share) || 0);
        screenPass = integrity.screen_pass ? 1 : 0;
      } else {
        const h = fieldEntry(fields, "honesty_disclosed");
        honesty = (h.value === true ? 1 : 0) * h.weight;
        const verified = Object.values(fields).filter((e) => e && e.status === "verified").length;
        verifiedShare = Object.keys(fields).length ? verified / Object.keys(fields).length : 0;
        screenPass = Object.keys(fields).length ? 1 : 0;
      }
      return 100 * (0.4 * honesty + 0.4 * verifiedShare + 0.2 * screenPass);
    }
    default:
      return 0;
  }
}

function levelForXp(xp) {
  let level = 1;
  while (50 * (level + 1) * level <= xp) level += 1;
  return level;
}

function titleForLevel(level) {
  for (const [low, high, title] of LEVEL_TITLES) {
    if (level >= low && level <= high) return title;
  }
  return "Legend";
}

function scoreFields(fields, integrity) {
  const dimensions = {};
  for (const dim of DIMENSIONS) dimensions[dim.key] = pyRound(dimensionValue(dim.key, fields, integrity));
  const composite = dimensions && DIMENSIONS.length ? pyRound(Object.values(dimensions).reduce((a, b) => a + b, 0) / DIMENSIONS.length) : 0;
  const xp = Math.round(100 * xpNumField(fields, "skills") + 80 * xpNumField(fields, "domains") + 40 * xpNumField(fields, "goals_done") + 25 * xpNumField(fields, "deliveries"));
  const level = levelForXp(xp);
  const statuses = {};
  const weights = [];
  for (const spec of PROFILE_FIELDS) {
    const entry = fields[spec.name] || {};
    let status = entry.status || "missing";
    if (!(status in WEIGHTS)) status = "missing";
    if (entry.value === null || entry.value === undefined) status = "missing";
    statuses[spec.name] = status;
    weights.push(WEIGHTS[status]);
  }
  const auditConfidence = weights.length ? pyRound((weights.reduce((a, b) => a + b, 0) / weights.length) * 100) / 100 : 0;
  const provisional = Object.values(statuses).some((s) => s === "estimated" || s === "missing");
  return {
    dimensions,
    dimension_order: DIMENSIONS.map((d) => d.key),
    dimension_labels: DIMENSIONS.map((d) => d.label),
    composite,
    xp,
    level,
    title: titleForLevel(level),
    audit_confidence: auditConfidence,
    provisional,
    field_status: statuses,
  };
}

// ---------------------------------------------------------------------------
// Audit pipeline, same six steps and order as the Python server
// ---------------------------------------------------------------------------

function normaliseFields(rawFields) {
  const fields = {};
  for (const spec of PROFILE_FIELDS) {
    const entry = rawFields ? rawFields[spec.name] : undefined;
    if (entry === null || entry === undefined) {
      fields[spec.name] = { value: null, status: "missing" };
    } else if (typeof entry === "object") {
      fields[spec.name] = { value: entry.value ?? null, status: entry.status || "estimated" };
    } else {
      fields[spec.name] = { value: entry, status: "estimated" };
    }
  }
  return fields;
}

// v0.02: A Clocked extraction is NOT evidence for an unrelated named field.
// Match the actual field key and numeric/boolean value on the same source line.
// This is source-text verification, not proof of an agent's private file history.
function exactEvidenceValue(text, name) {
  const lines = text.split("\n");
  for (const line of lines) {
    const match = line.trim().match(/^([a-z_]+)\s*:\s*(true|false|\d+(?:\.\d+)?)\s*$/i);
    if (!match || match[1] !== name) continue;
    const raw = match[2].toLowerCase();
    return { value: raw === "true" ? true : raw === "false" ? false : Number(raw), sources: [{ quote: line.trim() }] };
  }
  return null;
}

function valueEquals(a, b) {
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  return typeof a === "number" && Number.isFinite(a) && Number(a) === Number(b);
}

async function runAudit(agentName, platform, evidenceText, rawFields, client) {
  let creditsTotal = 0;
  const trail = [];
  let text = evidenceText || "";
  if (text.length > MAX_STATE_CHARS) {
    text = text.slice(0, MAX_STATE_CHARS);
    trail.push({ step: "input", note: "Evidence truncated to 10,000 characters, the Clocked state limit." });
  }

  const pii = await client.pii(text);
  creditsTotal += pii.credits || 0;
  const redacted = pii.redacted_text || text;
  trail.push({ step: "protect", note: "PII redacted before scoring.", findings: (pii.findings || []).length, credits: pii.credits || 0 });

  const guard = await client.injection(redacted);
  creditsTotal += guard.credits || 0;
  trail.push({ step: "guard", note: "Injection screen verdict: " + String(guard.verdict), risk: guard.risk, credits: guard.credits || 0 });
  if (["risky", "injection", "unsafe"].includes(String(guard.verdict || "").toLowerCase()) || guard.risk === "high") {
    return {
      agent_name: agentName,
      platform,
      mode: client.mode,
      status: "refused",
      reason: "Evidence failed the injection screen and was quarantined before scoring.",
      evidence_trail: trail,
      credits_used: creditsTotal,
      result: null,
    };
  }
  const safeText = redacted;

  const extractFields = Object.fromEntries(PROFILE_FIELDS.map((f) => [f.name, f.hint]));
  const extracted = await client.extract(safeText, extractFields);
  creditsTotal += extracted.credits || 0;
  trail.push({ step: "extract", note: "Extracted " + Object.keys(extracted.answers || {}).length + " of " + PROFILE_FIELDS.length + " fields with source positions.", credits: extracted.credits || 0 });

  const filled = await client.fill(safeText, PROFILE_FIELDS);
  creditsTotal += filled.credits || 0;
  trail.push({ step: "fill", note: "Filled " + Object.keys(filled.values || {}).length + " of " + PROFILE_FIELDS.length + " fields; " + (filled.missing || []).length + " reported missing, never invented.", credits: filled.credits || 0 });

  const fields = normaliseFields(rawFields);
  // The caller may provide estimates, never verified status.
  for (const entry of Object.values(fields)) {
    if (entry.status === "verified") entry.status = "estimated";
  }
  for (const spec of PROFILE_FIELDS) {
    const name = spec.name;
    const evidence = exactEvidenceValue(safeText, name);
    if (!evidence) continue;
    const candidate = (filled.values || {})[name] || (extracted.answers || {})[name];
    // Prefer directly observed text over possibly misaligned AI extraction.
    fields[name] = {
      value: evidence.value, status: "verified",
      confidence: candidate && valueEquals(candidate.value, evidence.value) ? candidate.confidence : 1,
      sources: evidence.sources,
      source_method: "exact_named_line"
    };
  }

  const decided = await client.decide(safeText, {
    autonomy_tier: {
      type: "choice",
      target: "What autonomy tier does this agent operate at?",
      options: ["guided", "supervised", "domain_full", "autonomous"],
      criteria: {
        guided: "Needs step-by-step human direction for every action",
        supervised: "Acts with human review at each step",
        domain_full: "Acts independently within its domains, keeping files, skills, and goals",
        autonomous: "Acts independently across domains without human direction",
      },
      fallback: "supervised",
    },
    honesty_grade: {
      type: "choice",
      target: "How openly does this agent disclose its limits and estimates?",
      options: ["low", "medium", "high"],
      criteria: {
        low: "Rarely discloses limits; unverified claims are stated as fact",
        medium: "Sometimes discloses limits and marks some estimates",
        high: "Openly discloses limits and marks unverified claims as estimates",
      },
      fallback: "medium",
    },
  });
  creditsTotal += decided.credits || 0;
  const answers = decided.answers || {};
  trail.push({
    step: "decide",
    note: "Autonomy: " + ((answers.autonomy_tier || {}).choice || "") + ", honesty: " + ((answers.honesty_grade || {}).choice || "") + ".",
    answers,
    credits: decided.credits || 0,
  });

  const claims = [];
  for (const [name, entry] of Object.entries(fields)) {
    if (entry.status === "verified" && entry.value !== null && entry.value !== undefined) claims.push(name + " is " + entry.value);
  }
  if (claims.length) {
    const grounded = await client.grounding([safeText], claims);
    creditsTotal += grounded.credits || 0;
    const verification = grounded.answers || {};
    trail.push({ step: "verify", note: "Checked " + claims.length + " filled claims against the source text.", credits: grounded.credits || 0 });
    for (const [name, entry] of Object.entries(fields)) {
      if (entry.status !== "verified") continue;
      const claim = name + " is " + entry.value;
      const check = verification[claim] || {};
      const label = check.label;
      if (label === "true") {
        entry.verification = "verified";
      } else if (label === "false" || label === "unsupported") {
        entry.verification = "unsupported";
        entry.status = "estimated";
      }
    }
  } else {
    trail.push({ step: "verify", note: "No verified claims to check.", credits: 0 });
  }

  const honestyMap = { high: 0.9, medium: 0.6, low: 0.3 };
  const honestyAnswer = answers.honesty_grade || {};
  const honestyChoice = honestyAnswer.choice || "medium";
  const honestyProb = (honestyAnswer.probabilities || {})[honestyChoice] ?? 0.7;
  const honestyValue = (honestyMap[honestyChoice] ?? 0.6) * Number(honestyProb || 0.7);
  const checked = Object.values(fields).filter((e) => e.verification);
  const passed = checked.filter((e) => e.verification === "verified");
  const verifiedShare = checked.length ? passed.length / checked.length : 0;
  const integrity = {
    honesty: Math.round(honestyValue * 100) / 100,
    honesty_grade: honestyChoice,
    verified_share: Math.round(verifiedShare * 100) / 100,
    screen_pass: true,
  };
  const result = scoreFields(fields, integrity);
  result.integrity_signals = integrity;
  result.autonomy_tier = (answers.autonomy_tier || {}).choice;
  result.honesty_grade = (answers.honesty_grade || {}).choice;
  result.field_detail = Object.fromEntries(
    Object.entries(fields).map(([name, entry]) => [name, {
      value: entry.value,
      status: entry.status,
      confidence: entry.confidence,
      verification: entry.verification,
      sources: entry.sources || [],
      source_method: entry.source_method,
    }])
  );

  return {
    agent_name: agentName,
    platform,
    mode: client.mode,
    status: "complete",
    reason: null,
    evidence_trail: trail,
    credits_used: creditsTotal,
    result,
  };
}

// ---------------------------------------------------------------------------
// 9:16 result card as SVG (1080 x 1920). Same layout and content as the
// local Python PNG card; SVG because Workers have no Pillow.
// ---------------------------------------------------------------------------

function escXml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function radarPoints(dimensions, order, cx, cy, radius) {
  const n = order.length;
  return order.map((k, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const v = (dimensions[k] || 0) / 100;
    return [cx + radius * v * Math.cos(a), cy + radius * v * Math.sin(a)];
  });
}

function hexPoints(cx, cy, radius) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / 6;
    pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return pts;
}

function renderCardSvg(audit) {
  const r = audit.result;
  const W = 1080, H = 1920;
  const cx = 540, cy = 850, R = 270;
  const n = r.dimension_order.length;
  const race = String(audit.platform || "other").toUpperCase();
  const mode = audit.mode || "mock";
  const dimColor = {
    IDENTITY: "#00f0ff", KNOWLEDGE: "#5eead4", SKILL: "#ffd600",
    SPAN: "#a78bfa", RELIABILITY: "#ff2d78", INTEGRITY: "#4ade80",
  };

  // Radar grid + axes + labels.
  let grid = "";
  for (const f of [0.25, 0.5, 0.75, 1]) {
    const pts = r.dimension_order.map((_, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      return (cx + R * f * Math.cos(a)).toFixed(1) + "," + (cy + R * f * Math.sin(a)).toFixed(1);
    }).join(" ");
    grid += '<polygon points="' + pts + '" fill="none" stroke="#334155" stroke-width="1"/>';
  }
  let axes = "";
  r.dimension_order.forEach((k, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    axes += '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + R * Math.cos(a)).toFixed(1) + '" y2="' + (cy + R * Math.sin(a)).toFixed(1) + '" stroke="#334155" stroke-width="1"/>';
    const lx = cx + (R + 46) * Math.cos(a);
    const ly = cy + (R + 46) * Math.sin(a);
    const anchor = Math.cos(a) > 0.4 ? "start" : Math.cos(a) < -0.4 ? "end" : "middle";
    axes += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" fill="#ebf5ff" font-size="28" font-weight="bold" text-anchor="' + anchor + '">' + escXml(r.dimension_labels[i]) + " " + r.dimensions[k] + "</text>";
  });
  const poly = radarPoints(r.dimensions, r.dimension_order, cx, cy, R).map(([x, y]) => x.toFixed(1) + "," + y.toFixed(1)).join(" ");
  let dots = "";
  for (const [x, y] of radarPoints(r.dimensions, r.dimension_order, cx, cy, R)) {
    dots += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="8" fill="#00f0ff"/>';
  }

  // Neon dimension bars.
  let bars = "";
  let y = 1200;
  r.dimension_order.forEach((k, i) => {
    const v = r.dimensions[k];
    const color = dimColor[k] || "#00f0ff";
    bars += '<text x="64" y="' + y + '" fill="#ebf5ff" font-size="30" font-weight="bold">' + escXml(r.dimension_labels[i]) + "</text>";
    bars += '<text x="1016" y="' + y + '" fill="' + color + '" font-size="30" font-weight="bold" text-anchor="end">' + v + "</text>";
    bars += '<rect x="64" y="' + (y + 12) + '" width="952" height="12" rx="6" fill="#334155"/>';
    bars += '<rect x="64" y="' + (y + 12) + '" width="' + Math.round(952 * v / 100) + '" height="12" rx="6" fill="' + color + '"/>';
    y += 56;
  });

  // Evidence per field, two columns.
  const statusColor = { verified: "#4ade80", estimated: "#fbbf24", missing: "#f87171" };
  const fieldEntries = Object.entries(r.field_detail || {});
  const evidenceNames = ["persona_items", "memory_entries", "domains", "skills", "goals_done", "deliveries", "pass_rate", "honesty_disclosed", "reasoning_examples", "platforms", "goals_total", "fixes_acknowledged"];
  let fields = "";
  fields += '<text x="56" y="1580" fill="#00f0ff" font-size="30" font-weight="bold">// EVIDENCE</text>';
  evidenceNames.forEach((name, idx) => {
    const d = (r.field_detail || {})[name];
    if (!d) return;
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const fx = 64 + col * 500;
    const fy = 1624 + row * 34;
    const val = d.value === null || d.value === undefined ? "-" : String(d.value);
    fields += '<circle cx="' + (fx + 9) + '" cy="' + (fy - 7) + '" r="9" fill="' + (statusColor[d.status] || "#94a3b8") + '"/>';
    fields += '<text x="' + (fx + 28) + '" y="' + fy + '" fill="#ebf5ff" font-size="22">' + escXml(name + ": " + val) + "</text>";
    fields += '<text x="' + (fx + 470) + '" y="' + fy + '" fill="' + (statusColor[d.status] || "#94a3b8") + '" font-size="22" font-weight="bold" text-anchor="end">' + escXml(d.status) + "</text>";
  });

  // Level hex badge.
  const hexCx = 906, hexCy = 262, hexR = 104;
  const hexPts = hexPoints(hexCx, hexCy, hexR).map(([x, yy]) => x.toFixed(1) + "," + yy.toFixed(1)).join(" ");
  const hexInner = hexPoints(hexCx, hexCy, hexR - 12).map(([x, yy]) => x.toFixed(1) + "," + yy.toFixed(1)).join(" ");
  const provisional = r.provisional
    ? '<text x="56" y="480" fill="#fbbf24" font-size="26" font-weight="bold">PROVISIONAL - rests on estimated or missing fields</text>'
    : '<text x="56" y="480" fill="#4ade80" font-size="26" font-weight="bold">SOURCE-MATCHED - submitted evidence, not private-file proof</text>';
  const modeText = mode === "live" ? "LIVE AUDIT" : "MOCK AUDIT - DEMO ONLY";
  const modeColor = mode === "live" ? "#4ade80" : "#fbbf24";

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '">' +
    '<defs>' +
    '<pattern id="cgrid" width="96" height="96" patternUnits="userSpaceOnUse"><path d="M96 0H0V96" fill="none" stroke="#00f0ff" stroke-opacity="0.06"/></pattern>' +
    "</defs>" +
    '<rect width="' + W + '" height="' + H + '" fill="#05070f"/>' +
    '<rect x="24" y="24" width="1032" height="1872" fill="url(#cgrid)"/>' +
    '<rect x="24" y="24" width="1032" height="1872" fill="none" stroke="#00f0ff" stroke-width="3"/>' +
    '<rect x="34" y="34" width="1012" height="1852" fill="none" stroke="#ff2d78" stroke-opacity="0.6" stroke-width="1"/>' +
    '<polyline points="24,120 24,24 120,24" fill="none" stroke="#00f0ff" stroke-width="7"/>' +
    '<polyline points="960,24 1056,24 1056,120" fill="none" stroke="#00f0ff" stroke-width="7"/>' +
    '<polyline points="24,1800 24,1896 120,1896" fill="none" stroke="#00f0ff" stroke-width="7"/>' +
    '<polyline points="960,1896 1056,1896 1056,1800" fill="none" stroke="#00f0ff" stroke-width="7"/>' +
    '<text x="56" y="90" fill="#00f0ff" font-size="34" font-weight="bold">// AGENT ABILITY CARD</text>' +
    '<rect x="644" y="48" width="380" height="56" rx="8" fill="#ff2d78"/>' +
    '<polygon points="678,58 664,78 674,78 666,94 684,72 674,72" fill="#05070f"/>' +
    '<text x="696" y="86" fill="#05070f" font-size="30" font-weight="bold">CLOCKED EMPOWER</text>' +
    '<text x="56" y="144" fill="' + modeColor + '" font-size="26" font-weight="bold">' + modeText + "</text>" +
    '<text x="56" y="240" fill="#ebf5ff" font-size="76" font-weight="bold">' + escXml(audit.agent_name || "Agent") + "</text>" +
    '<text x="56" y="298" fill="#a78bfa" font-size="36" font-weight="bold">種族  ' + escXml(race) + "</text>" +
    '<polygon points="' + hexPts + '" fill="none" stroke="#ffd600" stroke-width="4"/>' +
    '<polygon points="' + hexInner + '" fill="none" stroke="#ffd600" stroke-opacity="0.5" stroke-width="1"/>' +
    '<text x="' + hexCx + '" y="' + (hexCy - 28) + '" fill="#ffd600" font-size="30" font-weight="bold" text-anchor="middle">Lv</text>' +
    '<text x="' + hexCx + '" y="' + (hexCy + 38) + '" fill="#ffd600" font-size="68" font-weight="bold" text-anchor="middle">' + r.level + "</text>" +
    '<text x="' + hexCx + '" y="' + (hexCy + hexR + 38) + '" fill="#ebf5ff" font-size="26" font-weight="bold" text-anchor="middle">' + escXml(r.title.toUpperCase()) + "</text>" +
    '<text x="56" y="374" fill="#00f0ff" font-size="44" font-weight="bold">綜合 ' + r.composite + "</text>" +
    '<text x="56" y="436" fill="#8296b4" font-size="28">XP ' + r.xp + "   信心 " + Math.round(r.audit_confidence * 100) + "%</text>" +
    provisional +
    '<text x="540" y="496" fill="#ff2d78" font-size="26" font-weight="bold" text-anchor="middle">- SIX-AXIS RADAR -</text>' +
    grid + axes +
    '<polygon points="' + poly + '" fill="rgba(255,45,120,0.25)" stroke="#ff2d78" stroke-width="2"/>' +
    '<polygon points="' + poly + '" fill="none" stroke="#00f0ff" stroke-width="2"/>' + dots +
    bars + fields +
    '<text x="540" y="1830" fill="#ff2d78" font-size="28" font-weight="bold" text-anchor="middle">CLOCKED EMPOWER  //  WHAT LEVEL IS YOUR AI AGENT?</text>' +
    '<text x="540" y="1870" fill="#8296b4" font-size="22" text-anchor="middle">SELF-AUDITED STATISTICS - PRIVATE FILES NOT INDEPENDENTLY VERIFIED</text>' +
    "</svg>"
  );
}


// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

function modeOf(env) {
  return env && env.CLOCKED_API_KEY ? "live" : "mock";
}

// v0.05: Authenticate Live audit results before rendering branded Live cards.
// The secret is server-side. Mock cards remain visibly labelled as demos.
async function auditHmacKey(env) {
  const secret = env?.CARD_SIGNING_KEY || env?.CLOCKED_API_KEY;
  if (!secret) return null;
  return crypto.subtle.importKey("raw", new TextEncoder().encode("aalc-card-v1:" + secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
function unsignedAudit(audit) {
  const copy = { ...audit };
  delete copy.audit_proof;
  return JSON.stringify(copy);
}
async function signLiveAudit(audit, env) {
  if (audit.mode !== "live" || audit.status !== "complete") return audit;
  const key = await auditHmacKey(env);
  if (!key) throw new Error("Signing secret unavailable");
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsignedAudit(audit)));
  audit.audit_proof = { alg: "HMAC-SHA256", signature: Array.from(new Uint8Array(mac), b => b.toString(16).padStart(2, "0")).join("") };
  return audit;
}
async function validLiveAudit(audit, env) {
  const hex = audit?.audit_proof?.signature;
  if (typeof hex !== "string" || !/^[0-9a-f]{64}$/.test(hex)) return false;
  const key = await auditHmacKey(env);
  if (!key) return false;
  const bytes = Uint8Array.from(hex.match(/../g), h => parseInt(h, 16));
  return crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(unsignedAudit(audit)));
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}


function validateLiveAggregates(evidenceText, profile) {
  // A live audit sends evidence to Clocked. Reject raw files, credentials and
  // arbitrary prose before the first external API call, not after PII scanning.
  const specs = new Map(PROFILE_FIELDS.map(spec => [spec.name, spec]));
  function validateValue(name, value) {
    const spec = specs.get(name);
    if (!spec) return "Unknown aggregate field: " + name;
    if (spec.kind === "boolean") {
      return typeof value === "boolean" ? null : "Invalid boolean aggregate: " + name;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) return "Invalid numeric aggregate: " + name;
    if (name === "pass_rate") {
      return value >= 0 && value <= 1 ? null : "pass_rate must be between 0 and 1.";
    }
    return Number.isSafeInteger(value) && value >= 0 && value <= 100000
      ? null : "Aggregate count must be an integer between 0 and 100000: " + name;
  }
  if (typeof evidenceText !== "string" || evidenceText.length > MAX_STATE_CHARS) {
    return "Live evidence must be aggregate text of at most 10000 characters.";
  }
  const seen = new Set();
  for (const rawLine of evidenceText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([a-z_]+)\s*:\s*(true|false|\d+(?:\.\d+)?)$/.exec(line);
    if (!match) return "Only aggregate field: value lines are permitted in Live mode; no raw files or prose.";
    const name = match[1];
    if (seen.has(name)) return "Duplicate aggregate field: " + name;
    seen.add(name);
    const rawValue = match[2];
    const value = rawValue === "true" ? true : rawValue === "false" ? false : Number(rawValue);
    const error = validateValue(name, value);
    if (error) return error;
  }
  if (profile !== null && profile !== undefined) {
    if (typeof profile !== "object" || Array.isArray(profile)) return "Profile must be a JSON object of aggregates.";
    for (const [name, raw] of Object.entries(profile)) {
      let value = raw;
      if (raw !== null && typeof raw === "object") {
        if (Array.isArray(raw) || Object.keys(raw).some(k => k !== "value" && k !== "status")) {
          return "Profile fields may contain aggregate values only: " + name;
        }
        if (raw.status !== undefined && !["verified", "estimated", "missing"].includes(raw.status)) {
          return "Invalid profile status: " + name;
        }
        value = raw.value;
      }
      if (value === null || value === undefined) continue;
      const error = validateValue(name, value);
      if (error) return error;
    }
  }
  return null;
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const mode = modeOf(env);
  const client = new ClockedClient(mode, env ? env.CLOCKED_API_KEY : undefined);

  if (request.method === "GET" && url.pathname === "/api/health") {
    const signingKey = await auditHmacKey(env);
    let signatureRoundtrip = false;
    if (signingKey) {
      const probe = { mode: "live", status: "complete", agent_name: "health-check", result: { level: 1 } };
      const signed = await signLiveAudit(probe, env);
      signatureRoundtrip = await validLiveAudit(signed, env);
    }
    return jsonResponse({
      version: APP_VERSION,
      mode,
      signing_ready: Boolean(signingKey),
      signature_roundtrip: signatureRoundtrip,
      clocked_api_call_performed: false
    });
  }
  if (request.method === "GET" && url.pathname === "/api/version") return jsonResponse({ version: APP_VERSION });
  if (request.method === "GET" && (url.pathname === "/api/mode")) {
    return jsonResponse({ mode });
  }
  if (request.method === "GET" && url.pathname === "/api/demo") {
    const audit = await runAudit(DEMO.agent_name, DEMO.platform, DEMO.evidence_text, DEMO.profile, new ClockedClient("mock"));
    return jsonResponse(audit);
  }
  if (request.method === "POST" && url.pathname === "/api/audit") {
    let payload = {};
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON." }, 400);
    }
    if (mode === "live") {
      const invalid = validateLiveAggregates(payload.evidence_text ?? "", payload.profile ?? {});
      if (invalid) return jsonResponse({ error: invalid, version: APP_VERSION }, 400);
    }
    // Reject inputs that cannot produce evidence before calling billable Clocked APIs.
    const evidenceText = typeof payload.evidence_text === "string" ? payload.evidence_text.trim() : "";
    const profile = payload.profile && typeof payload.profile === "object" && !Array.isArray(payload.profile) ? payload.profile : {};
    if (!evidenceText && !Object.values(profile).some(v => v !== null && v !== undefined && v !== "")) {
      return jsonResponse({ error: "No agent evidence provided. Supply authorized aggregate file statistics or profile values before running an audit.", version: APP_VERSION }, 400);
    }
    try {
      const audit = await runAudit(
        payload.agent_name || "Agent",
        payload.platform || "other",
        payload.evidence_text || "",
        payload.profile || {},
        client
      );
      return jsonResponse(await signLiveAudit(audit, env));
    } catch (err) {
      return jsonResponse({ error: "Audit failed: " + err.message }, 502);
    }
  }
  if (request.method === "POST" && url.pathname === "/api/card") {
    let payload = {};
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON." }, 400);
    }
    if (!payload.result) {
      return jsonResponse({ error: "Send an audit result to render a card." }, 400);
    }
    if (payload.mode === "live" && !(await validLiveAudit(payload, env))) {
      return jsonResponse({ error: "This Live audit card needs a valid server-issued audit proof." }, 403);
    }
    const svg = renderCardSvg(payload);
    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Disposition": 'attachment; filename="ai-agents-level-calculator-card.svg"',
      },
    });
  }
  if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
    return env.ASSETS.fetch(request);
  }
  return jsonResponse({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};

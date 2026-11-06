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
// Clocked calls use the raw HTTP API:
//   POST https://clocked.rezolve.ai/clocked/<endpoint>
//   header Authorization: Bearer <key>, body JSON.
// Auth evidence: the official clocked-sdk 0.7.0 source sends
// Authorization: Bearer, not the X-CLOCKED-KEY header the docs
// mention. Live mode is still unverified because no working key
// has been tested yet.

const CLOCKED_BASE = "https://clocked.rezolve.ai/clocked";
const MAX_STATE_CHARS = 10000;

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

const MOCK_CREDITS = { decide: 1, extract: 8, fill: 13, grounding: 11, injection: 2, pii: 13 };

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
  agent_name: "Fang",
  platform: "Muse",
  evidence_text: "persona_items: 7\nmemory_entries: 50\ndomains: 10\nskills: 5\nreasoning_examples: 4\nplatforms: 4\ngoals_total: 38\ngoals_done: 18\ndeliveries: 100\nfixes_acknowledged: 4",
  profile: { honesty_disclosed: true, pass_rate: 0.8 },
};

// ---------------------------------------------------------------------------
// Clocked client: live (raw HTTP) and mock (offline stand-in, same shapes)
// ---------------------------------------------------------------------------

function creditsFromUsage(result, endpoint) {
  const cost = result && result.usage && result.usage.cost_credits;
  if (typeof cost === "number") return cost;
  return MOCK_CREDITS[endpoint] || 1;
}

async function clockedCall(key, endpoint, payload) {
  const res = await fetch(CLOCKED_BASE + "/" + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("Clocked " + endpoint + " failed with HTTP " + res.status + ": " + text);
  }
  return res.json();
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
    const result = await clockedCall(this.key, "pii", { state: text });
    return {
      redacted_text: result.redacted_text || result.redacted || text,
      findings: result.findings || [],
      credits: creditsFromUsage(result, "pii"),
      raw: result,
    };
  }

  async injection(text) {
    if (this.mode === "mock") return mockInjection(text);
    const result = await clockedCall(this.key, "injection", { state: text });
    const verdict = result.verdict || result.decision || {};
    let risk = result.risk || "low";
    let label = "safe";
    if (typeof verdict === "object" && verdict !== null) {
      risk = verdict.risk || risk;
      label = verdict.verdict || verdict.label || "safe";
    } else if (typeof verdict === "string") {
      label = verdict;
    }
    return { verdict: label, risk, credits: creditsFromUsage(result, "injection"), raw: result };
  }

  async extract(text, fields) {
    if (this.mode === "mock") return mockExtract(text, fields);
    const questions = Object.entries(fields).map(([name, target]) => ({ name, target }));
    const result = await clockedCall(this.key, "extract", { state: text, questions });
    return {
      answers: result.answers || {},
      missing: result.missing || [],
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
    const fields = specFields.map((f) => {
      const entry = { name: f.name, kind: f.kind };
      if (f.kind_hint) entry.kind_hint = f.kind_hint;
      if (f.options) entry.options = f.options;
      return entry;
    });
    const result = await clockedCall(this.key, "fill", { spec: { fields }, state: text });
    return {
      values: result.values || {},
      missing: result.missing || [],
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

  // Verify, one grounding call per claim, using the documented raw
  // shape { state: <claim>, sources: [<evidence>] }. This costs more
  // credits than the Python server path, where the official SDK
  // checks all claims in one call; see DEPLOY.md for the estimate.
  async grounding(documents, claims) {
    if (this.mode === "mock") return mockGrounding(documents, claims);
    const source = documents.join("\n");
    const answers = {};
    let credits = 0;
    for (const claim of claims) {
      const result = await clockedCall(this.key, "grounding", { state: claim, sources: [source] });
      credits += creditsFromUsage(result, "grounding");
      const byKey = result.answers && result.answers[claim];
      if (byKey) {
        answers[claim] = { label: byKey.label || byKey.value, confidence: byKey.confidence, explanation: byKey.explanation };
      } else if (result.answers && typeof result.answers.label === "string") {
        answers[claim] = { label: result.answers.label, confidence: result.answers.confidence, explanation: result.answers.explanation };
      } else if (typeof result.label === "string") {
        answers[claim] = { label: result.label, confidence: result.confidence, explanation: result.explanation };
      } else {
        answers[claim] = { label: "unsupported", confidence: 0.4, explanation: "Grounding response had no per-claim label." };
      }
    }
    return { answers, credits, raw: { mock: false } };
  }
}

// ---------------------------------------------------------------------------
// Scoring: deterministic local formula, ported from the Python server.
// Verified fields count at full weight, estimated at half, missing at zero.
// Composite is the mean of the six dimension scores. XP = 100 * skills
// + 80 * domains + 40 * goals_done + 25 * deliveries, with estimated
// fields at half value. Level L requires 50 * L * (L - 1) XP.
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
  const xp = Math.round(100 * numField(fields, "skills") + 80 * numField(fields, "domains") + 40 * numField(fields, "goals_done") + 25 * numField(fields, "deliveries"));
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
  for (const [name, answer] of Object.entries(filled.values || {})) {
    if (name in fields) {
      fields[name] = { value: answer.value, status: "verified", confidence: answer.confidence, sources: answer.sources || [] };
    }
  }
  for (const [name, answer] of Object.entries(extracted.answers || {})) {
    if (name in fields && fields[name].status !== "verified") {
      fields[name] = { value: answer.value, status: "verified", confidence: answer.confidence, sources: answer.sources || [] };
    }
  }

  const decided = await client.decide(safeText, {
    autonomy_tier: {
      target: "What autonomy tier does this agent operate at?",
      options: ["guided", "supervised", "domain_full", "autonomous"],
      criteria: ["Whether the evidence shows the agent acting without step-by-step human direction", "Whether the evidence shows persistent files, skills, and goals"],
      fallback: "supervised",
    },
    honesty_grade: {
      target: "How openly does this agent disclose its limits and estimates?",
      options: ["low", "medium", "high"],
      criteria: ["Whether limits and estimates are disclosed in the evidence", "Whether unverified claims are marked as estimates"],
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

function renderCardSvg(audit) {
  const r = audit.result;
  const W = 1080, H = 1920;
  const cx = 540, cy = 720, R = 300;
  const n = r.dimension_order.length;
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
    const lx = cx + (R + 24) * Math.cos(a);
    const ly = cy + (R + 24) * Math.sin(a);
    const anchor = Math.cos(a) > 0.4 ? "start" : Math.cos(a) < -0.4 ? "end" : "middle";
    axes += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" fill="#f0f4f8" font-size="26" font-weight="bold" text-anchor="' + anchor + '">' + escXml(r.dimension_labels[i]) + " " + r.dimensions[k] + "</text>";
  });
  const poly = radarPoints(r.dimensions, r.dimension_order, cx, cy, R).map(([x, y]) => x.toFixed(1) + "," + y.toFixed(1)).join(" ");
  let bars = "";
  let y = 1110;
  r.dimension_order.forEach((k, i) => {
    const v = r.dimensions[k];
    bars += '<text x="80" y="' + y + '" fill="#f0f4f8" font-size="28" font-weight="bold">' + escXml(r.dimension_labels[i]) + " - " + v + "</text>";
    bars += '<rect x="80" y="' + (y + 12) + '" width="920" height="12" rx="6" fill="#334155"/>';
    bars += '<rect x="80" y="' + (y + 12) + '" width="' + Math.round(920 * v / 100) + '" height="12" rx="6" fill="#5eead4"/>';
    y += 52;
  });
  const statusColor = { verified: "#4ade80", estimated: "#fbbf24", missing: "#f87171" };
  let fields = "";
  const fieldEntries = Object.entries(r.field_detail || {});
  fields += '<text x="80" y="1470" fill="#f0f4f8" font-size="28" font-weight="bold">Evidence per field</text>';
  fieldEntries.forEach(([name, d], idx) => {
    const col = idx < 6 ? 0 : 1;
    const row = idx % 6;
    const fx = col === 0 ? 80 : 560;
    const fy = 1510 + row * 34;
    const val = d.value === null || d.value === undefined ? "-" : String(d.value);
    fields += '<text x="' + fx + '" y="' + fy + '" fill="#cbd5e1" font-size="22">' + escXml(name) + ": " + escXml(val) + '</text>';
    fields += '<text x="' + (fx + 420) + '" y="' + fy + '" fill="' + (statusColor[d.status] || "#94a3b8") + '" font-size="22" font-weight="bold" text-anchor="end">' + escXml(d.status) + "</text>";
  });
  const provisional = r.provisional
    ? '<text x="80" y="1830" fill="#fbbf24" font-size="26" font-weight="bold">PROVISIONAL - rests on estimated or missing fields</text>'
    : '<text x="80" y="1830" fill="#4ade80" font-size="26" font-weight="bold">All scored fields verified</text>';
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '">' +
    '<rect width="' + W + '" height="' + H + '" fill="#0d1220"/>' +
    '<text x="48" y="100" fill="#5eead4" font-size="52" font-weight="bold">AI Agents Level Calculator</text>' +
    '<text x="48" y="200" fill="#f0f4f8" font-size="64" font-weight="bold">Level ' + r.level + " - " + escXml(r.title) + "</text>" +
    '<text x="48" y="270" fill="#a78bfa" font-size="40" font-weight="bold">Composite ' + r.composite + " - " + escXml(audit.agent_name || "Agent") + "</text>" +
    '<text x="48" y="320" fill="#94a3b8" font-size="26">Audit confidence ' + Math.round(r.audit_confidence * 100) + "% - XP " + r.xp + " - mode: " + escXml(audit.mode || "mock") + "</text>" +
    grid + axes +
    '<polygon points="' + poly + '" fill="rgba(94,234,212,0.35)" stroke="#5eead4" stroke-width="3"/>' +
    bars + fields + provisional +
    '<text x="48" y="1870" fill="#94a3b8" font-size="24">Paste the AI Agents Level Calculator link to your agent and ask for its level chart.</text>' +
    "</svg>"
  );
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

function modeOf(env) {
  return env && env.CLOCKED_API_KEY ? "live" : "mock";
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const mode = modeOf(env);
  const client = new ClockedClient(mode, env ? env.CLOCKED_API_KEY : undefined);

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
    try {
      const audit = await runAudit(
        payload.agent_name || "Agent",
        payload.platform || "other",
        payload.evidence_text || "",
        payload.profile || {},
        client
      );
      return jsonResponse(audit);
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

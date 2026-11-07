// Zero-credit production smoke test. No Clocked audit is run.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The custom hostname is protected by site WAF and returns HTTP 403 to GitHub-hosted runners.
// CI targets the same Pages deployment using its default hostname; custom-domain checks run externally.
const base = process.env.AALC_BASE_URL || "https://ai-agents-level-calculator.pages.dev";
const localSource = readFileSync(new URL("../worker/src/index.js", import.meta.url), "utf8");
const expected = process.env.AALC_EXPECT_VERSION || localSource.match(/const APP_VERSION = "([^"]+)"/)?.[1];
if (!expected) throw new Error("Cannot determine expected version.");

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function api(path, init) {
  const response = await fetch(new URL(path, base), { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, contentType: response.headers.get("content-type") || "" };
}
async function waitVersion() {
  for (let n = 0; n < 12; n++) {
    try {
      const r = await api("/api/version");
      if (r.status === 200 && r.data.version === expected) return;
      console.log("Awaiting production version", expected, "observed", r.data?.version || r.status);
    } catch (err) {
      console.log("Awaiting production endpoint", String(err.message || err));
    }
    await sleep(15000);
  }
  throw new Error("Production did not reach " + expected);
}

await waitVersion();
const health = await api("/api/health");
assert.equal(health.status, 200);
assert.equal(health.data.mode, "live");
assert.equal(health.data.signing_ready, true);
assert.equal(health.data.signature_roundtrip, true);
assert.equal(health.data.clocked_api_call_performed, false);
console.log("PASS live signing health");

async function mcp(method, params = {}) {
  const r = await api("/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.jsonrpc, "2.0");
  return r.data.result;
}
const init = await mcp("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "aalc-smoke", version: "1" } });
assert.equal(init.serverInfo.name, "ai-agents-level-calculator");
const tools = await mcp("tools/list");
for (const name of ["get_scoring_rules", "run_level_audit", "get_level_card"]) {
  assert.ok(tools.tools.some(tool => tool.name === name), "missing " + name);
}
const rules = await mcp("tools/call", { name: "get_scoring_rules", arguments: {} });
assert.ok(rules.content?.[0]?.text.includes("private source files"));
console.log("PASS MCP tool discovery and rules");

const badAudit = await api("/api/audit", { method: "POST", body: JSON.stringify({ agent_name: "No Evidence", platform: "Other", evidence_text: "", profile: {} }) });
assert.equal(badAudit.status, 400);
console.log("PASS empty evidence rejected without Clocked calls");

const unsafe = await api("/api/audit", { method: "POST", body: JSON.stringify({
  agent_name: "Synthetic Smoke", platform: "Other",
  evidence_text: "skills: 3\nraw private notes", profile: {}
}) });
assert.equal(unsafe.status, 400);
assert.match(unsafe.data.error, /aggregate/i);
console.log("PASS Live preflight rejects non-aggregate text with zero Clocked calls");

const oversized = await api("/api/audit", { method: "POST", body: JSON.stringify({
  agent_name: "Synthetic Smoke", platform: "Other",
  evidence_text: "skills: 100001", profile: {}
}) });
assert.equal(oversized.status, 400);
console.log("PASS out-of-range counts rejected with zero Clocked calls");

const forged = await api("/api/card", { method: "POST", body: JSON.stringify({ mode: "live", agent_name: "Fake", result: { level: 99, title: "Legend" } }) });
assert.equal(forged.status, 403);
console.log("PASS forged Live card rejected");

const demo = await api("/api/demo");
assert.equal(demo.status, 200);
assert.equal(demo.data.mode, "mock");
const card = await api("/api/card", { method: "POST", body: JSON.stringify(demo.data) });
assert.equal(card.status, 200);
assert.match(card.contentType, /svg/);
assert.match(card.data, /PRIVATE FILES NOT INDEPENDENTLY VERIFIED/);
console.log("PASS marked demo card generation");
console.log("ALL ZERO-CREDIT PRODUCTION CHECKS PASSED", expected);

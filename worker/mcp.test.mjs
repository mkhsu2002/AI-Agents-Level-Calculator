import test from "node:test";
import assert from "node:assert/strict";
import worker from "./src/mcp-entry.js";

const env = { ASSETS: { fetch: async () => new Response("assets") } };
let nextId = 1;
async function rpc(method, params = {}, overrideEnv = env) {
  const res = await worker.fetch(new Request("https://test.example/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params })
  }), overrideEnv);
  return { response: res, body: await res.json() };
}
test("initialization and tools discovery", async () => {
  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "node-test", version: "1.0" } });
  assert.equal(init.body.result.serverInfo.name, "ai-agents-level-calculator");
  const list = await rpc("tools/list");
  assert.deepEqual(list.body.result.tools.map(x => x.name), ["get_scoring_rules", "run_level_audit", "get_level_card"]);
});
test("rules specify permission and source limitations", async () => {
  const {body} = await rpc("tools/call", { name: "get_scoring_rules", arguments: {} });
  const rules = JSON.parse(body.result.content[0].text);
  assert.match(rules.policy, /Only inspect files/);
  assert.match(rules.limitations, /not prove/);
  assert.equal(rules.fields.length, 12);
});
test("agent audit follows unchanged Clocked mock pipeline", async () => {
  const {body} = await rpc("tools/call", {
    name: "run_level_audit", arguments: {
      agent_name: "Fang", platform: "Muse",
      evidence_text: "persona_items: 7\nmemory_entries: 50\ndomains: 10\nskills: 5\nreasoning_examples: 4\nplatforms: 4\ngoals_total: 38\ngoals_done: 18\ndeliveries: 100\nfixes_acknowledged: 4",
      profile: { honesty_disclosed: true, pass_rate: 0.8 }
    }
  });
  assert.equal(body.result.isError, false);
  const data = JSON.parse(body.result.content[0].text);
  assert.equal(data.mode, "mock");
  assert.equal(data.result.level, 10);
  assert.equal(data.result.composite, 78);
  assert.equal(Object.hasOwn(data, "evidence_basis"), false); // audit payload remains canonical
});
test("card can be rendered as SVG resource", async () => {
  const demo = await worker.fetch(new Request("https://test.example/api/demo"), env);
  const audit = await demo.json();
  const {body} = await rpc("tools/call", { name: "get_level_card", arguments: { audit } });
  assert.equal(body.result.content[0].resource.mimeType, "image/svg+xml");
  assert.match(body.result.content[0].resource.text, /<svg/);
});
test("invalid inputs rejected without invoking audit", async () => {
  const {body} = await rpc("tools/call", { name: "run_level_audit", arguments: { agent_name: "X", platform: "Other", evidence_text: 15 } });
  assert.equal(body.result.isError, true);
});
test("other web and REST routes remain available", async () => {
  const resp = await worker.fetch(new Request("https://test.example/api/demo"), env);
  assert.equal(resp.status, 200);
  const app = await worker.fetch(new Request("https://test.example/"), env);
  assert.equal(await app.text(), "assets");
});
test("MCP notifications receive 202", async () => {
  const res = await worker.fetch(new Request("https://test.example/mcp", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
  }), env);
  assert.equal(res.status, 202);
});


test("v0.15 MCP Live audit shares aggregate-only preflight", async () => {
  const liveEnv = { ...env, CLOCKED_API_KEY: "synthetic-test-only" };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("MCP must not call Clocked for raw text"); };
  try {
    const { body } = await rpc("tools/call", {
      name: "run_level_audit",
      arguments: {
        agent_name: "Privacy test", platform: "Other",
        evidence_text: "skills: 3\nprivate source text", profile: {}
      }
    }, liveEnv);
    assert.equal(body.result.isError, true);
    assert.match(body.result.content[0].text, /aggregate/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("v0.16 MCP Live rejects profile-only submissions without Clocked calls", async () => {
  const liveEnv = { ...env, CLOCKED_API_KEY: "synthetic-test-only" };
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("Clocked must not be contacted"); };
  try {
    const { body } = await rpc("tools/call", {
      name: "run_level_audit",
      arguments: {
        agent_name: "Privacy test", platform: "Other",
        evidence_text: "", profile: { skills: 3 }
      }
    }, liveEnv);
    assert.equal(body.result.isError, true);
    assert.match(body.result.content[0].text, /aggregate evidence line/i);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("v0.18 MCP audit emits privacy-safe correlation log without evidence", async () => {
  const entries = [];
  const previous = console.info;
  console.info = (line) => entries.push(line);
  const privateCanary = "SECRET_CANARY_MUST_NEVER_APPEAR";
  try {
    const { response, body } = await rpc("tools/call", {
      name: "run_level_audit",
      arguments: {
        agent_name: privateCanary, platform: "Muse",
        evidence_text: "skills: 2", profile: {}
      }
    });
    assert.equal(response.status, 200);
    const id = body.result._meta["aalc/request_id"];
    assert.match(id, /^[0-9a-f-]{36}$/i);
    assert.equal(response.headers.get("X-AALC-Request-ID"), id);
    assert.equal(entries.length, 1);
    const entry = JSON.parse(entries[0]);
    assert.equal(entry.request_id, id);
    assert.equal(entry.tool, "run_level_audit");
    assert.equal(entry.success, true);
    assert.ok(Number.isFinite(entry.duration_ms));
    assert.doesNotMatch(entries[0], /SECRET_CANARY|skills: 2|evidence_text|profile/);
  } finally {
    console.info = previous;
  }
});

test("v0.18 rejected MCP audit still emits non-sensitive failure log", async () => {
  const entries = [];
  const previous = console.info;
  console.info = (line) => entries.push(line);
  try {
    const { body } = await rpc("tools/call", {
      name: "run_level_audit",
      arguments: { agent_name: "Rejected", platform: "Muse", evidence_text: 99 }
    });
    assert.equal(body.result.isError, true);
    const entry = JSON.parse(entries[0]);
    assert.equal(entry.success, false);
    assert.equal(entry.request_id, body.result._meta["aalc/request_id"]);
    // Parse metadata fields: random UUIDs can contain "99" by coincidence.
    assert.deepEqual(Object.keys(entry).sort(), ["duration_ms", "kind", "request_id", "service", "success", "tool"].sort());
    assert.equal(entry.tool, "run_level_audit");
    assert.equal(entry.kind, "mcp_tool");
  } finally {
    console.info = previous;
  }
});

test("v0.21 MCP keeps audit JSON intact for subsequent get_level_card", async () => {
  const data = {
    agent_name: "Roundtrip", platform: "other",
    evidence_text: "skills: 3\\ndomains: 1", profile: {}
  };
  const auditCall = await rpc("tools/call", {
    name: "run_level_audit", arguments: data
  });
  assert.equal(auditCall.body.result.isError, false);
  const audit = JSON.parse(auditCall.body.result.content[0].text);
  assert.equal(Object.hasOwn(audit, "evidence_basis"), false);
  assert.equal(Object.hasOwn(audit, "audit_proof"), false);
  const card = await rpc("tools/call", {
    name: "get_level_card", arguments: { audit }
  });
  assert.equal(card.body.result.isError, false);
  assert.match(card.body.result.content[0].resource.text, /<svg/);
});

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
  assert.match(data.evidence_basis, /self-audited/);
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

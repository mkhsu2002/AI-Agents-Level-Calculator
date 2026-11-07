import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/[[path]].js";

const env = { ASSETS: { fetch: async () => new Response("pages-static-assets") } };

function handle(path, opts = {}) {
  return onRequest({
    request: new Request("https://aalc.flypigai.ca" + path, opts),
    env
  });
}

test("Pages adapter passes through REST audit route", async () => {
  const response = await handle("/api/demo");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "complete");
  assert.equal(body.result.level, 10);
});

test("Pages adapter passes through MCP initialize route", async () => {
  const response = await handle("/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "pages-test", version: "1" } }
    })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.serverInfo.name, "ai-agents-level-calculator");
});

test("Pages adapter preserves agent entry", async () => {
  const response = await handle("/agent");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /MCP/);
});

test("Pages adapter uses static asset binding for static fallback", async () => {
  const response = await handle("/");
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "pages-static-assets");
});

test("v0.19 /agent provides one-instruction agent onboarding and MCP endpoint", async () => {
  const response = await handle("/agent");
  assert.equal(response.status, 200);
  const guide = await response.text();
  assert.match(guide, /ONE-INSTRUCTION START:/);
  assert.match(guide, /only genuine, authorized local record counts/);
  assert.match(guide, /\/mcp/);
  assert.match(guide, /one Live audit/);
  assert.match(guide, /request ID/);
  assert.match(guide, /Never send private contents or invent records/);
});

test("v0.20 frontend distinguishes self-reported source matching from independent verification", async () => {
  const fs = await import("node:fs/promises");
  const html = await fs.readFile(new URL("../ai_agents_level_calculator/static/index.html", import.meta.url), "utf8");
  assert.ok(html.includes("verified: 'source-matched (self-reported)'"));
  assert.ok(html.includes("const label = fieldStatusLabels[d.status]"));
  assert.ok(!html.includes(" + d.status + '</td></tr>'"));
});

test("v0.23 browser card download defaults to PNG and checks HTTP failures", async () => {
  const fs = await import("node:fs/promises");
  const html = await fs.readFile(new URL("../ai_agents_level_calculator/static/index.html", import.meta.url), "utf8");
  assert.ok(html.includes("Download shareable 9:16 card (PNG)"));
  assert.ok(html.includes("async function svgToPng(svgBlob)"));
  assert.ok(html.includes("canvas.width = 1080"));
  assert.ok(html.includes("canvas.height = 1920"));
  assert.ok(html.includes("'image/png'"));
  assert.ok(html.includes("if (!response.ok)"));
  assert.ok(html.includes("Card download failed:"));
  assert.ok(html.includes("URL.revokeObjectURL(sourceUrl)"));
});

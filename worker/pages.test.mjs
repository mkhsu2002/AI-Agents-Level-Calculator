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

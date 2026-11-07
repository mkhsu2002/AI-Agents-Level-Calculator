// Stateless MCP Streamable HTTP facade around the existing Clocked audit pipeline.
// The agent reads only files it is permitted to access, locally. Never send private
// memory, prompts, secrets, raw conversations, or file paths to this endpoint.
import baseWorker from "./index.js";

const VERSION = "v0.17";
const PROTOCOL = "2025-03-26";
const MAX_BYTES = 32_000;
const FIELDS = [
  "persona_items", "memory_entries", "domains", "skills",
  "reasoning_examples", "platforms", "goals_total", "goals_done",
  "deliveries", "pass_rate", "honesty_disclosed", "fixes_acknowledged"
];
const TOOLS = [
  {
    name: "get_scoring_rules",
    description: "Read the current six-dimension rating and privacy rules before collecting permitted local file statistics.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "run_level_audit",
    description: "Audit an agent's locally-collected, privacy-safe evidence statistics through Clocked and the deterministic score engine. Do not submit secret file contents. Self-reported counts are not independently verified.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["agent_name", "platform", "evidence_text"],
      properties: {
        agent_name: { type: "string", maxLength: 100 },
        platform: { type: "string", maxLength: 60 },
        evidence_text: { type: "string", maxLength: 10000, description: "Aggregate numeric evidence lines only, e.g. skills: 5. Never include raw private files." },
        profile: { type: "object", description: "Optional user supplied values; these are estimates unless grounded in evidence.", additionalProperties: true }
      }
    }
  },
  {
    name: "get_level_card",
    description: "Render a previously generated audit result as a 1080x1920 SVG image, returned as a base64 MCP resource.",
    inputSchema: {
      type: "object", required: ["audit"], additionalProperties: false,
      properties: { audit: { type: "object", description: "Complete JSON audit response from run_level_audit" } }
    }
  }
];

function rpc(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
function error(id, code, message, status = 200) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
function toolText(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }], isError: false };
}
function validateEvidence(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "Expected JSON object.";
  if (typeof args.agent_name !== "string" || !args.agent_name.trim() || args.agent_name.length > 100) return "Invalid agent_name.";
  if (typeof args.platform !== "string" || !args.platform.trim() || args.platform.length > 60) return "Invalid platform.";
  if (typeof args.evidence_text !== "string" || args.evidence_text.length > 10000) return "evidence_text must be a string of at most 10000 characters.";
  if (args.profile != null && (typeof args.profile !== "object" || Array.isArray(args.profile))) return "profile must be an object.";
  return null;
}
function rules() {
  return {
    protocol_version: "1.0.0", implementation_version: VERSION,
    policy: "Only inspect files for which the user and platform grant access; never upload raw private memories, system prompts, credentials or conversation text.",
    fields: FIELDS, allowed_field_statuses: ["verified", "estimated", "missing"],
    data_sources: ["local file counts", "local task or delivery logs", "locally derived aggregate statistics"],
    limitations: "The server can confirm formula consistency and compare submitted claims with submitted evidence, not prove that private source files exist.",
    scoring: "The deterministic scoring formulas are published in ai_agents_level_calculator/scoring.py and worker/src/index.js.",
    workflow: "Read accessible files locally, derive aggregate counts, submit only non-sensitive evidence_text and optional profile. Clocked analyzes submitted evidence server-side.",
    submission_format_example: "persona_items: 7\nmemory_entries: 50\ndomains: 10\nskills: 5\nreasoning_examples: 4\nplatforms: 4\ngoals_total: 38\ngoals_done: 18\ndeliveries: 100\nfixes_acknowledged: 4"
  };
}
async function callTool(name, args, env, request) {
  if (name === "get_scoring_rules") return toolText(rules());
  if (name === "run_level_audit") {
    const invalid = validateEvidence(args);
    if (invalid) return { content: [{ type: "text", text: invalid }], isError: true };
    const endpoint = new URL("/api/audit", request.url).toString();
    const result = await baseWorker.fetch(new Request(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_name: args.agent_name, platform: args.platform, evidence_text: args.evidence_text, profile: args.profile || {} })
    }), env);
    const payload = await result.json();
    if (!result.ok) return { content: [{ type: "text", text: JSON.stringify(payload) }], isError: true };
    return toolText({ ...payload, evidence_basis: "self-audited; counts are not independently validated" });
  }
  if (name === "get_level_card") {
    if (!args || !args.audit || typeof args.audit !== "object" || !args.audit.result) {
      return { content: [{ type: "text", text: "Provide a complete audit with a result." }], isError: true };
    }
    const endpoint = new URL("/api/card", request.url).toString();
    const response = await baseWorker.fetch(new Request(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args.audit)
    }), env);
    if (!response.ok) return { content: [{ type: "text", text: "Could not render card." }], isError: true };
    return { content: [{ type: "resource", resource: { uri: "agent-rpg://card.svg", mimeType: "image/svg+xml", text: await response.text() } }], isError: false };
  }
  return { content: [{ type: "text", text: "Unknown tool." }], isError: true };
}

export async function handleMcp(request, env) {
  if (request.method === "GET") return new Response("Stateless MCP endpoint. Send JSON-RPC POST with initialize, tools/list or tools/call.", { status: 405, headers: { Allow: "POST, OPTIONS" } });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS" } });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) return error(null, -32600, "Use application/json.", 415);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BYTES) return error(null, -32600, "Request too large.", 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BYTES) return error(null, -32600, "Request too large.", 413);
  let message;
  try { message = JSON.parse(raw); } catch { return error(null, -32700, "Invalid JSON."); }
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string" || Array.isArray(message)) return error(message?.id ?? null, -32600, "Invalid JSON-RPC request.");
  if (message.id === undefined || message.id === null) return new Response(null, { status: 202 });
  const id = message.id;
  if (message.method === "initialize") {
    return rpc(id, { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "ai-agents-level-calculator", version: "1.0.0" }, instructions: "Read scoring rules first. Send only user-authorized aggregate statistics. Clocked analyzes the submitted data; source file existence is not independently proven." });
  }
  if (message.method === "ping") return rpc(id, {});
  if (message.method === "tools/list") return rpc(id, { tools: TOOLS });
  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments || {};
    if (!TOOLS.some(t => t.name === name)) return error(id, -32602, "Unknown tool.");
    try { return rpc(id, await callTool(name, args, env, request)); }
    catch (e) { return rpc(id, { content: [{ type: "text", text: "Audit service error: " + String(e?.message || e) }], isError: true }); }
  }
  return error(id, -32601, "Method not found.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") return handleMcp(request, env);
    if (request.method === "GET" && url.pathname === "/agent") {
      const guide = [
        "# AI Agents Level Calculator: Agent Entry",
        "",
        "Goal: compute experience-based RPG levels from files and records the agent may actually access, NOT from generic underlying LLM ability.",
        "",
        "## 1. Obtain consent and inventory local evidence",
        "Ask the user to approve any access and external submission. Read only local files already accessible within your agent platform.",
        "Count actual supported persona, memory, domain, skill, goal, delivery and correction records.",
        "Optional local script: tools/agent_inventory.py in https://github.com/mkhsu2002/AI-Agents-Level-Calculator .",
        "It only counts regular files in directories explicitly supplied as arguments; one file is not necessarily one memory item or completed task.",
        "If the platform cannot access the source, mark that field unknown. Never invent the number.",
        "",
        "## 2. Protect privacy",
        "Do not send private file contents, user conversations, personal addresses, authentication tokens, passwords, system prompts or raw file paths.",
        "Review the aggregate statistics before sending them to this external site. Clocked receives the submitted aggregate text.",
        "",
        "## 3. Connect",
        "MCP Streamable HTTP endpoint: " + url.origin + "/mcp",
        "MCP tools: get_scoring_rules, run_level_audit, get_level_card.",
        "Clients must support configuring a remote MCP server. Reading this URL alone does not install MCP tools.",
        "For agents without MCP use POST " + url.origin + "/api/audit with JSON {agent_name, platform, evidence_text, profile}.",
        "",
        "## 4. Submit only observed statistics",
        "First call get_scoring_rules. Use evidence_text with one exact named numeric fact per line.",
        "Example: skills: 3; goals_done: 2 (send as separate newline-delimited lines).",
        "Do not provide a field you cannot count. The service rejects entirely empty reports.",
        "",
        "## 5. Read and report the result",
        "Call run_level_audit, then get_level_card with the returned complete audit.",
        "Report six dimensions, XP, level, mode, provisional status and evidence basis.",
        "Self-audited source matching is not independent proof of the underlying private files.",
        "The service does not create a permanent account or send recovery email in this release."
      ].join("\n");
      return new Response(guide, {
        headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" }
      });
    }
    return baseWorker.fetch(request, env);
  }
};

# Agent MCP entry (experimental)

This branch adds an MCP Streamable HTTP entry at `/mcp` to the existing Cloudflare Worker. The existing web UI, `/api/audit`, `/api/card`, scoring formulas, and Clocked pipeline remain in place.

## Connect

Deploy the Worker from this branch. Configure the Cloudflare Worker secret `CLOCKED_API_KEY` for live Clocked evaluation. Supply your deployment URL ending in `/mcp` to an MCP-compatible client that supports Streamable HTTP. A plain web link does not install an MCP tool automatically.

The endpoint is stateless JSON-RPC over HTTP POST. Supported methods: `initialize`, `ping`, `tools/list`, and `tools/call`. Tools:
- `get_scoring_rules`: field list, permitted sources and privacy policy.
- `run_level_audit`: accepts an agent name, platform, aggregated evidence text, optional profile; delegates to existing `/api/audit` and Clocked.
- `get_level_card`: accepts a prior audit result and returns SVG markup as an MCP resource.

An alternate human-readable agent entry is available at `/agent`. Existing REST API is still supported for clients without MCP.

## What an agent should do

1. Ask its user for permission to inspect accessible files and use the external audit service.
2. Inspect only files and records it actually has permission to access; gather aggregate counts relevant to the documented fields. Skip unavailable file types and leave them missing.
3. Do not send full files, private memory text, conversation transcripts, API keys, system prompts, individual filenames, raw email addresses, or other personal data.
4. Call `get_scoring_rules`, then `run_level_audit`. The service executes Clocked Extract / Fill / Decide / Verify, and the repository's original deterministic scoring logic.
5. Review result and optionally call `get_level_card`. Only present the actual result and its mode, not any invented grade or verified status.

The MCP server cannot directly read an agent's files. The agent must use its platform's authorized local tools. Platforms without access to private files cannot be assessed from those hidden files, and the MCP connection does not change that.

## Evidence accuracy

Source-supported values mean the submitted text contains supporting information, not that the remote service has independently witnessed the original local files. The result includes `evidence_basis: self-audited; counts are not independently validated`. No server-side storage or persistent Agent UUID is introduced by this branch.

## Deployment and testing

```sh
node --test worker/test.mjs worker/mcp.test.mjs
wrangler deploy
wrangler secret put CLOCKED_API_KEY
```

Deployment must be carried out by the repository owner. This branch does not deploy itself.

Example JSON-RPC requests (`Content-Type: application/json`):

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"sample-agent","version":"1"}}}
```

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"run_level_audit","arguments":{"agent_name":"Nova","platform":"Other","evidence_text":"skills: 5\nmemory_entries: 10"}}}
```

## Production hardening

This branch is an integration prototype, not an open public commercial API. Before exposing a credit-consuming Clocked endpoint broadly, add authentication / quotas / rate limiting; request-size and output limits; controlled retention and consent; and full live SDK integration tests. MCP protocol clients can vary in how they negotiate transports and MIME types, so check with the actual intended Muse or Dot client before public launch.

## Optional local metadata inventory

For agents with permitted local filesystem access, the opt-in scanner counts regular files in explicitly supplied category directories. It does not read file contents, follow symlinks, or upload anything:

```sh
python3 tools/agent_inventory.py --memory-dir /path/to/authorized/memory --skills-dir /path/to/authorized/skills
```

Review the printed JSON before giving the `evidence_text` to `run_level_audit`. Each file counts as one entry in its chosen category; do not call a file count a validated memory-item or completed-task count unless the directory really contains one record per file. Omit categories for which that relationship is unknown.

To test the scanner: `python3 -m unittest tests.test_agent_inventory -v`.

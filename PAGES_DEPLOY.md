# Cloudflare Pages deployment

This repo supports two deployment options: Cloudflare Workers using `wrangler.toml`, and Cloudflare Pages using `functions/[[path]].js`. The Pages adapter routes API requests through the existing Clocked audit engine and MCP gateway. The static UI is published from `ai_agents_level_calculator/static`.

## GitHub-integrated Cloudflare Pages setup

1. In Cloudflare Dashboard, go to Workers & Pages > Create > Pages > Connect to Git. Select GitHub repository `mkhsu2002/AI-Agents-Level-Calculator`, production branch `main`.
2. Framework preset: None; build command: leave blank; build output directory: `ai_agents_level_calculator/static`. Root directory: repo root.
3. Pages Functions are discovered from `functions/[[path]].js` at repo root. Ensure the Pages project includes the repo's functions directory.
4. Under project Settings > Variables and Secrets, add `CLOCKED_API_KEY` as an encrypted secret for production. Never put it in the Git repository or the front-end assets.
5. Deploy and verify: GET `/api/mode`, GET `/api/demo`, POST `/api/audit`, and POST JSON-RPC to `/mcp`. The provided `_routes.json` routes only /api/*, /mcp and /agent through Pages Functions.
6. Only after verifying the *.pages.dev URL, connect the custom domain `agents.flypigai.ca` under Pages > Custom domains. Keep `flypigai.ca` unchanged. Cloudflare DNS for `agents` should point to the Pages project as instructed by Cloudflare (typically managed automatically when the domain is in the same account).

## Test commands

```sh
node --test worker/test.mjs worker/mcp.test.mjs
python3 -m unittest discover -s tests -v
```

## Sample MCP initialize

```sh
curl -s -X POST https://YOUR-PAGES-PROJECT.pages.dev/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}'
```

## Security and production notes

- The MCP and REST audit routes currently permit anonymous requests. Before sharing a public endpoint backed by a billable Clocked API key, add Cloudflare WAF rate limiting, bot controls, or appropriate authentication / quotas.
- There is no database or permanent Agent UUID yet; audit outputs are presently stateless.
- Clocked analyzes submitted evidence. It cannot independently verify that the private local source files exist.
- The apex `flypigai.ca` currently hosts an existing website. Changing its Pages custom-domain binding would disrupt that site. Do not change apex domain routing until the user explicitly decides to replace or move that site.

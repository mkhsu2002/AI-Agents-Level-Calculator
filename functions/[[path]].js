// Cloudflare Pages Functions adapter. Routes are constrained by the static
// _routes.json: only /api/*, /mcp, /agent invoke this function.
// All other files are served directly as Pages static assets.
import application from "../worker/src/mcp-entry.js";

export async function onRequest(context) {
  return application.fetch(context.request, context.env);
}

# Deploying AI Agents Level Calculator on Cloudflare (manual steps)

The user deploys this themselves; this file is the exact checklist.
Nothing here is deployed automatically, and no credential is in this repo.

## What gets deployed

- A Cloudflare Worker (`worker/src/index.js`, configured by
  `wrangler.toml`) that serves the single-page frontend and the audit
  API (`/api/mode`, `/api/demo`, `/api/audit`, `/api/card`).
- The frontend is served from `./ai_agents_level_calculator/static`
  via Workers Static Assets, so it is the same page as the local
  Python server serves. One URL, one button, one card.
- The Worker calls the Clocked API server-side with the
  `CLOCKED_API_KEY` Worker secret. The key never reaches the browser.

## Why a JavaScript Worker, not a Python Worker

The local app is a Python standard-library server that depends on
`clocked-sdk` (httpx) and Pillow for the PNG card. A Python Worker
runs on Pyodide with a limited, still-changing set of supported PyPI
packages, no `ThreadingHTTPServer`, and no local filesystem, so
neither dependency is guaranteed to work there, and that cannot be
verified without deploying. The Worker is therefore a small,
dependency-free JavaScript port of the same app: same six
dimensions, same pipeline order, same scoring formula, same 9:16
card layout.

Two deliberate differences from the local Python server:

1. **Card format.** The Worker renders the result card as SVG
   (1080 x 1920) instead of PNG, because Workers have no Pillow.
   Same layout, same content. The frontend downloads whichever
   format the server returns (`.svg` from the Worker, `.png`
   locally).
2. **Verify cost.** The Worker checks all filled claims in one
   batched grounding call, the same as the Python server, so a live
   Worker audit costs the same 40 to 60 credits. (An earlier draft
   used one grounding call per claim from the documented shape;
   live testing on 2026-11-06 showed the batched shape works and
   the per-claim shape does not.) Mock mode costs nothing.

## Prerequisites

- The repo pushed to GitHub at
  https://github.com/mkhsu2002/AI-Agents-Level-Calculator
  (public, default branch `main`).
- Node.js 18 or newer on the machine doing the deploy.
- A Cloudflare account. The Worker runs on the free tier.
- A Clocked account API key. Create it in the Clocked account
  profile. Live mode was verified on 2026-11-06 with a free trial
  key (no card attached): a full audit of the Fang demo returned
  Level 10 Builder, composite 75, for 48 credits. Still verify the
  live audit right after deploy as described below, with your own
  key.

## Steps

### 1. Install Wrangler and log in

```sh
npm install -g wrangler
wrangler login
```

`wrangler login` opens the Cloudflare dashboard in the browser.
Approve the login there. This authorises only the local Wrangler
install; it does not store any credential in the repo.

### 2. Clone the repo and deploy

```sh
git clone https://github.com/mkhsu2002/AI-Agents-Level-Calculator.git
cd AI-Agents-Level-Calculator
wrangler deploy
```

Wrangler prints the live URL when it finishes, like
`https://ai-agents-level-calculator.<your-subdomain>.workers.dev`.
That URL is the one to paste to agents.

To check the config without deploying, run:

```sh
wrangler deploy --dry-run
```

### 3. Set the Clocked secret (live mode)

Without this step the Worker runs in mock mode and the page says
so. The secret is stored by Cloudflare, not in the repo.

```sh
wrangler secret put CLOCKED_API_KEY
```

Paste the Clocked account API key when prompted. It is not echoed
and is never written to a file. To rotate it later, run the same
command again with the new key.

To confirm the secret exists (without showing its value):

```sh
wrangler secret list
```

### 4. Verify the live URL

Open the Worker URL in a browser and check, in order:

1. The page loads and shows `LIVE MODE - real Clocked calls`
   (not mock mode).
2. Press **Try the Fang demo**. It returns Level 10 Builder,
   composite 78, provisional (mock demo, statistics only).
3. Fill the form with a small piece of real evidence and press
   **Run audit**. A live audit returns a level, a composite, six
   dimension scores, and an evidence trail with per-step credits.
4. Press **Download 9:16 card**. It downloads an SVG card,
   1080 x 1920.
5. In the Cloudflare dashboard, check the Worker logs and the
   Clocked account credit balance to confirm calls were made and
   charged at the expected rate.

If step 1 still shows mock mode, the secret is missing or the
Worker was deployed before the secret was set; run
`wrangler deploy` again after `wrangler secret put` and re-check.
If a live audit returns an error, check the Worker logs first:
the error message names the failing Clocked endpoint and the
HTTP status. A 401 means the secret is not a valid Clocked
account API key; rotate it with `wrangler secret put`.

## Updating after a change

```sh
git pull
wrangler deploy
```

The frontend is part of the repo, so a deploy always ships the
current page with the current Worker code. No separate Pages
project is needed.

## Local development of the Worker (optional)

```sh
npx wrangler dev
```

This runs the Worker locally without deploying. Add the secret
for local testing with a `.dev.vars` file containing
`CLOCKED_API_KEY=<key>`; `.dev.vars` is git-ignored, never commit
it. Without it, local dev runs in mock mode.

## What this repo does not do

- No GitHub Actions, no CI deploy, no Cloudflare API token in the
  repo. Deploys are manual, by the user, from their own machine.
- No user data is stored: audits are processed in memory, uploads
  are never written to disk, and the Worker keeps no history.

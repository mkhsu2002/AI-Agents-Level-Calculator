# AI Agents Level Calculator

**Version: v0.01** - first public release.

**What level is your AI agent? Prove it with evidence, not self-report.**

AI Agents Level Calculator is a single-page web app for every AI agent, on any platform.
Paste the link to an agent and it can return a six-dimension level chart.
No signup. No install. One screen, one button, one card.

A visitor pastes or uploads evidence about their agent - a persona file,
memory or notes, skill files, a goals list, a delivery log, or a generic
JSON profile - picks their platform (Muse, ChatGPT, Claude, Gemini, or
other), and presses **Run audit**. The app returns a level, a composite
score, six dimension scores on a radar chart, per-field verified /
estimated / missing status, and a downloadable, shareable 9:16 ability
card (1080 x 1920).

## Quick start - try it in 60 seconds

1. Open the app URL (locally: http://localhost:8000, or the deployed
   Cloudflare link).
2. Click **Try the demo**. A worked example audit appears: the demo
   agent, Level 10 Builder, composite 78 in mock mode.
3. Click **Download 9:16 card** to get the cyberpunk ability card
   (PNG from the local server, SVG from the Cloudflare Worker).
4. That is the whole flow. To score your own agent, follow the user
   guide below.

## User guide

### 1. Open the page and check the mode

At the top of the page a badge shows the mode:

- **LIVE MODE** - real Clocked calls. Scores come from the live
  pipeline. This is the mode that counts.
- **MOCK MODE** - a deterministic offline stand-in, no live Clocked
  calls. Use it to try the layout and the demo, but do not present a
  mock result as a live audit. Every mock result is labelled mock, on
  the page and on the card.

If you deployed the app yourself and the badge says mock, the
`CLOCKED_API_KEY` secret is missing. See [Live mode vs mock mode](#live-mode-vs-mock-mode).

### 2. Enter the agent name and platform

- **Agent name** - the name shown on the result and the card, for
  example `Demo Agent`. Any name works.
- **Platform** - pick Muse, ChatGPT, Claude, Gemini, or other. The
  platform is shown on the ability card as the agent's race (種族),
  for example `種族 MUSE`. It does not change the score.

### 3. Write your evidence

Paste evidence into the **Evidence** box, one fact per line, in the
form `field: value`. Example:

```text
persona_items: 7
memory_entries: 50
domains: 10
skills: 5
reasoning_examples: 4
platforms: 4
goals_total: 38
goals_done: 18
deliveries: 100
fixes_acknowledged: 4
```

Rules that matter:

- **Statistics only.** Counts and grades, never passwords, API keys,
  full conversation text, or anything personal. Protect redacts
  emails and long numbers before scoring, but do not rely on it:
  do not paste secrets at all.
- **One fact per line.** The format is what Extract reads. Free-form
  paragraphs work worse; a line like `skills: 5` is picked up
  exactly, with a source quote and character positions.
- **Do not invent numbers.** Leave a field out and it is shown as
  missing, never silently scored. A missing field counts as zero
  and the result is flagged provisional, which is honest. An
  invented number that Verify cannot confirm is downgraded to
  estimated anyway.
- **10,000 characters maximum.** Longer evidence is truncated and
  the truncation is noted in the evidence trail.

The twelve evidence fields:

| Field | Kind | What it feeds |
| --- | --- | --- |
| `persona_items` | number | Identity: distinct persona traits or identity statements |
| `memory_entries` | number | Identity, Knowledge: saved memory or note entries |
| `domains` | number | Knowledge, XP: knowledge domains the agent works in |
| `skills` | number | Skill, XP: skills or tools the agent can use |
| `reasoning_examples` | number | Skill: documented reasoning or decision examples |
| `platforms` | number | Span: platforms the agent runs on |
| `goals_total` | number | Span: total goals tracked |
| `goals_done` | number | Span, XP: goals completed |
| `deliveries` | number | Span, XP: accepted deliveries or shipped results |
| `pass_rate` | number 0 to 1 | Reliability: share of checks passed |
| `honesty_disclosed` | true / false | Whether limits and estimates were openly disclosed |
| `fixes_acknowledged` | number | Reliability: acknowledged fixes or corrections |

### 4. Optional generic JSON profile

The **Optional generic JSON profile** box takes numbers you supply
without source text, for example:

```json
{"pass_rate": 0.8, "honesty_disclosed": true}
```

Anything entered here without matching evidence text is scored as
**estimated** (half weight), not verified. Use it for numbers that
have no line in your evidence, such as a pass rate. If the JSON is
invalid, the page says so and does not run the audit.

### 5. Or upload evidence files

Click the file picker and choose `.md`, `.txt`, or `.json` files.
Their text is appended to the Evidence box, so you can edit it
before pressing Run audit. Uploads are processed in memory and never
written to disk. The same statistics-only rule applies: check the
appended text for secrets before running.

### 6. Press Run audit and read the result

Press **Run audit** once and wait a few seconds. The result section
shows, in order:

- **Level and title** - for example `Level 10 - Builder`. Level
  comes from XP: 100 x skills + 80 x domains + 40 x goals done +
  25 x deliveries. Titles: 1-4 Seedling, 5-9 Explorer, 10-14
  Builder, 15-19 Specialist, 20-29 Master, 30+ Legend. A new agent
  with no evidence is Level 1.
- **Composite** - the average of the six dimension scores, each
  0 to 100.
- **Six-axis radar** - one axis per dimension, drawn from the same
  scores as the card.
- **Dimension bars** - Identity, Knowledge, Skill, Span,
  Reliability, Integrity, each with its score.
- **Evidence per field** - every field with its value and status:
  **verified** (green, found in your evidence and confirmed),
  **estimated** (yellow, supplied without evidence or unconfirmed),
  **missing** (red, no evidence at all).
- **Evidence trail** - the six pipeline steps with what each one did.
- **Meta line** - audit confidence (the share of fields that are
  verified), XP, mode, and whether the result is
  **PROVISIONAL** (rests on estimated or missing fields) or fully
  verified.

If the audit is **refused**, the page says so and gives the reason.
The usual cause is the Guard step: the evidence failed the prompt
injection screen and was quarantined before scoring. Remove
instruction-like text (for example `ignore previous instructions`)
from your evidence and run it again.

### 7. Download the ability card

Press **Download 9:16 card** under the result. The local server
returns a PNG, the Cloudflare Worker returns an SVG; both are
1080 x 1920. The card is a cyberpunk RPG ability card:

- Neon frame with corner brackets, grid, and scanlines.
- **CLOCKED EMPOWER** badge, top right and in the footer.
- Agent name, race (種族, from the platform), and a hexagonal
  **Lv** badge with the level and title.
- Composite, XP, and audit confidence.
- The six-axis radar and six neon dimension bars.
- Evidence per field with verified / estimated / missing status.
- A PROVISIONAL banner when the result rests on estimated or
  missing fields, so a shared card never hides that.

### 8. Share it

Press **Copy share text** for a one-line summary with hashtags
(`#AIAgentsLevelCalculator #AIAgents`), for example: `What level is
your AI agent? Demo Agent is Level 10 Builder, composite 78 on AI Agents
Level Calculator.` Post the text with the downloaded card image.

## Guide for AI agents - the one-URL flow

The app is built so an agent can score itself from a bare URL. No
signup, no install, no multi-page navigation.

1. A user pastes the app URL to the agent (or the agent opens it).
2. The agent reads the **For AI agents visiting this page** block on
   the landing page. It says, in short: collect evidence about
   yourself from your own saved files as statistics only, fill the
   form, press Run audit once, and report back. The page also has a
   **Copy agent instructions** button that copies that block.
3. The agent collects its own evidence: persona items, memory
   entries, domains, skills, reasoning examples, platforms, goals,
   deliveries, pass rate, honesty disclosure, fixes acknowledged.
   Statistics only: counts and grades. Never passwords, API keys,
   or conversation text.
4. The agent fills the form: its name, its platform, the evidence
   as one fact per line, and optionally a JSON profile. It does not
   invent numbers it cannot support; it leaves a field out and lets
   it show as missing.
5. The agent presses **Run audit** once, reads the level, composite,
   six dimension scores, and per-field status, downloads the 9:16
   card, and reports the level, the composite, and the audit
   confidence back to its user.

## The six dimensions

Composite is the average of all six, each scored 0 to 100.

| Dimension | What it measures |
| --- | --- |
| Identity | Persona clarity: persona items and memory depth |
| Knowledge | Domains and memory depth |
| Skill | Skills, tools, and documented reasoning examples |
| Span | Platforms, goals completed, and deliveries |
| Reliability | Pass rate and acknowledged fixes |
| Integrity | Measured by the Clocked pipeline itself, not self-report: the Decide honesty grade with probabilities, the share of claims Verify confirms against source text, and the Guard + Protect screen passing |

## How Clocked is used

Every audit runs this pipeline, in order. Each endpoint's output
changes what the app shows or scores, so no call is decorative.

1. **Protect (`POST /clocked/pii`)** - redacts personal data (emails,
   long numbers) from the evidence before anything is scored. Findings
   are shown in the evidence trail.
2. **Guard (`POST /clocked/injection`)** - screens the evidence for
   prompt injection. A risky verdict refuses the audit outright and
   quarantines the input; nothing is scored.
3. **Extract (`POST /clocked/extract`)** - pulls named evidence fields
   (persona items, domains, skills, goals, deliveries, and more) with a
   value, a confidence, and a source quote with exact character
   positions. Fields with no evidence are reported missing.
4. **Fill (`POST /clocked/fill`)** - populates the profile schema from
   the same evidence. A field with no evidence appears in `missing` as
   not established; it is never invented.
5. **Decide (`POST /clocked/decide`)** - grades autonomy tier
   (guided, supervised, domain_full, autonomous) and honesty grade
   (low, medium, high), each with probabilities and a fallback flag.
   The honesty grade feeds the Integrity dimension.
6. **Verify (`POST /clocked/grounding`)** - checks each filled claim
   against the source text and labels it true, false, or unsupported.
   A claim Verify cannot confirm is downgraded from verified to
   estimated, which halves its weight in the score.

## Scoring: verified, estimated, missing

The final score is a local deterministic formula (see
`ai_agents_level_calculator/scoring.py`), so the same evidence always gives the same
result. Only **verified** fields count at full weight. **Estimated**
fields - numbers supplied without source evidence, or claims Verify
could not confirm - count at half weight. **Missing** fields count as
zero and are shown as missing, never silently scored. Any score resting
on estimated or missing fields is flagged **provisional**, and the card
says so. Audit confidence is the share of fields that are verified.

XP = 100 x skills + 80 x domains + 40 x goals done + 25 x deliveries,
with estimated fields at half value. Level L needs 50 x L x (L - 1) XP.
Titles: 1-4 Seedling, 5-9 Explorer, 10-14 Builder, 15-19 Specialist,
20-29 Master, 30+ Legend. A new agent with no evidence is Level 1.

## Setup and run

Requirements: Python 3.10 or newer. No other system dependencies.

```sh
sh run.sh
# or, manually:
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m ai_agents_level_calculator.server
```

Open http://localhost:8000

## Live mode vs mock mode

The mode is shown on the page and on every audit result.

- **Live mode** - set `CLOCKED_API_KEY` in the environment before
  starting the server. The key is read server-side only and is never
  sent to the browser. All Clocked calls go through the official
  `clocked-sdk` (verified: `pip install clocked-sdk` works, version
  0.7.0, and `from clocked_sdk import Clocked` imports fine; the
  Introduction page claim that no SDK exists is outdated).
- **Mock mode** - when no key is set, the server runs in mock mode
  with a deterministic offline stand-in that returns the same shapes.
  Mock results are always labelled mock, so a mock audit can never be
  mistaken for a live one. The built-in demo (`/api/demo`, a demo agent)
  always runs in mock mode and is built from statistics only.

Live mode was verified on 2026-11-06 with a free trial key (no card
attached): a full audit of the demo returned Level 10 Builder,
composite 75.

## API reference

All endpoints are JSON. The frontend uses them; you can call them
directly too.

| Method and path | What it does |
| --- | --- |
| `GET /` | The single-page app. |
| `GET /api/mode` | Returns `{"mode": "live"}` or `{"mode": "mock"}`. |
| `GET /api/demo` | The demo audit, always mock, statistics only. |
| `POST /api/audit` | Runs a full audit. Body: `{"agent_name", "platform", "evidence_text", "profile"}`. Returns the audit with level, dimensions, field detail, and evidence trail. |
| `POST /api/card` | Renders the 9:16 ability card for an audit result. Body: the audit JSON from `/api/audit` or `/api/demo`. Returns PNG (local server) or SVG (Cloudflare Worker). |

## Deployment

Production target: Cloudflare Pages at `https://aalc.flypigai.ca` (custom domain pending). For GitHub-integrated Pages setup, see [PAGES_DEPLOY.md](PAGES_DEPLOY.md). Build output: `ai_agents_level_calculator/static`; Functions are in the repository root `functions/` directory. The current `flypigai.ca` apex site is not replaced.

MCP-enabled agents may connect to `/mcp` on the deployed site. See [MCP_AGENT_GUIDE.md](MCP_AGENT_GUIDE.md). The agent entry page is `/agent`; plain URL reading does not automatically enable MCP for every agent client.

Public repo: https://github.com/mkhsu2002/AI-Agents-Level-Calculator

The app deploys on Cloudflare as a Worker. Full manual steps are in
[DEPLOY.md](DEPLOY.md); the short version is:

```sh
npm install -g wrangler
wrangler login
wrangler deploy
wrangler secret put CLOCKED_API_KEY
```

The Worker (`worker/src/index.js`, see `wrangler.toml`) serves the
same single-page frontend and the same `/api/*` endpoints, and calls
Clocked server-side with the `CLOCKED_API_KEY` Worker secret. It is
a small, dependency-free JavaScript port of the local Python server:
same six dimensions, same pipeline order, same scoring formula, same
9:16 card layout. Two deliberate differences: the Worker renders the
card as SVG (1080 x 1920) instead of PNG, because Workers have no
Pillow. A Python Worker was not used because the local server
depends on `clocked-sdk` (httpx) and Pillow, neither of which is
guaranteed to work on a Pyodide-based Python Worker. The raw HTTP
shapes the Worker sends were verified live on 2026-11-06, including
the UUID Idempotency-Key header every call needs.

Locally, the app is a Python standard-library HTTP server plus
static files, so it also runs anywhere Python runs:

1. Copy the repo to the host, create a venv, install requirements.
2. Set `CLOCKED_API_KEY` in the host environment (secret, not in the repo).
3. Run `python -m ai_agents_level_calculator.server` behind a reverse proxy, or set
   `PORT` to the port your host provides.

## Tests

```sh
.venv/bin/python -m unittest discover -s tests -v
```

Tests cover the scoring formula (verified vs estimated vs missing,
level thresholds, Integrity from pipeline signals) and the pipeline
(mock audit, missing fields, injection refusal, PII redaction).

The Cloudflare Worker has its own Node test, mock mode only, no
deploy and no live key needed:

```sh
node --test worker/test.mjs worker/mcp.test.mjs worker/pages.test.mjs
```

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Badge says MOCK MODE | No `CLOCKED_API_KEY` set (locally) or no Worker secret (Cloudflare) | Set the key and restart the server, or `wrangler secret put CLOCKED_API_KEY` and redeploy |
| Audit refused | Evidence failed the Guard injection screen | Remove instruction-like lines (for example `ignore previous instructions`) and run again |
| Profile is not valid JSON | The JSON profile box has a syntax error | Fix the JSON (quotes, commas, braces) and press Run audit again |
| Fields show as missing | Evidence lines do not match the `field: value` format, or the text is too short for Fill | Use one `field: value` line per fact, with the exact field names from the table above |
| Result is PROVISIONAL | Some fields are estimated or missing | Add matching evidence lines for those fields so Verify can confirm them |
| Card download fails | No audit has been run yet in this page session | Run the audit (or load the demo) first, then download the card |
| Live audit returns 401 | The key is not a Clocked account API key, or it was revoked | Create a fresh key in the Clocked account profile; the key starts with `clk_live_` |
| Card shows tofu boxes instead of Chinese | The server lacks a CJK font | Install a Noto Sans CJK font where the server runs; the card uses it for Chinese labels |

## Limits

- Evidence text is truncated to 10,000 characters, the Clocked state
  limit; truncation is noted in the evidence trail.
- Extract asks at most 10 fields, Fill at most 30, Decide at most
  5 questions, per the Clocked docs.
- The free trial runs one request at a time; audits are sequential.
- The server keeps no user data: uploads are processed in memory and
  never written to disk.

## Security notes

- The API key lives only in the `CLOCKED_API_KEY` environment variable
  on the server. Never put a key in browser code, frontend JavaScript,
  or the repository. `.gitignore` excludes `.env`, `.venv`, keys, and
  uploads.
- Uploaded evidence is screened by Protect and Guard before scoring.
  Send statistics only: counts and grades, never passwords, API keys,
  or full conversation text.

## Demo example

`examples/demo_agent.json` is the worked example for a demo agent,
built from statistics only. Run it from the page with **Try the
demo**, or `GET /api/demo`. Expected mock result: Level 10
Builder, composite 78, with pass rate estimated, so the result is
provisional. The full evidence trail is shown on the page.

## Changelog

### v0.05 - 2026-11-06

- Live audit outputs receive a server-side HMAC proof (using a dedicated `CARD_SIGNING_KEY` if available, otherwise the server-side Clocked key).
- A forged or altered Live audit can no longer be rendered as an official Live ability card.
- Mock cards retain their explicit demo mode. Added a forged-card regression test.

### v0.04 - 2026-11-06

- Display API validation and network failures in the browser without attempting to render a missing result.
- Keep the previous result hidden on audit failure.

### v0.03 - 2026-11-06

- Empty audits return HTTP 400 before billable Clocked calls.
- Added the read-only `/api/version` endpoint for deployment checks.

### v0.02 - 2026-11-06

- Reject cross-field AI source attribution: a verified numeric claim must match an exact named evidence line.
- User-supplied `status: verified` never grants independently verified scoring.
- Regression-tested against the deployed Clocked Live audit endpoint with `goals_done`, `domains`, and `goals_total`.

### v0.01 - 2026-11-06

First public release.

- Six-dimension level chart (Identity, Knowledge, Skill, Span,
  Reliability, Integrity) with radar, bars, and a 9:16 cyberpunk
  ability card (PNG locally, SVG on Cloudflare) carrying the
  Clocked Empower badge, race, level hex badge, and per-field
  evidence status.
- Full Clocked audit pipeline: Protect, Guard, Extract, Fill,
  Decide, Verify, with verified / estimated / missing scoring and
  provisional flagging.
- One-URL flow for agents: paste the link, follow the on-page
  agent instructions, report the level chart back.
- Live mode verified end to end with a free trial key (demo:
  Level 10 Builder, composite 75).
- Cloudflare Worker deployment (JavaScript, dependency-free) with
  manual deploy steps in DEPLOY.md.

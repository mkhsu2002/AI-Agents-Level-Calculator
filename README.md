# AI Agents Level Calculator

**What level is your AI agent? Prove it with evidence, not self-report.**

AI Agents Level Calculator is a single-page web app for every AI agent, on any platform.
Paste the link to an agent and it can return a six-dimension level chart.
No signup. No install. One screen, one button, one card.

A visitor pastes or uploads evidence about their agent - a persona file,
memory or notes, skill files, a goals list, a delivery log, or a generic
JSON profile - picks their platform (Muse, ChatGPT, Claude, Gemini, or
other), and presses **Run audit**. The app returns a level, a composite
score, six dimension scores on a radar chart, per-field verified /
estimated / missing status, and a downloadable, shareable 9:16 result
card (1080 x 1920).

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

## The one-URL flow

The landing page is the whole app. It also carries a short agent
instruction block that an agent visiting the URL can follow step by
step: collect evidence from its own saved files as statistics only,
fill the form, press Run audit once, and report the level, composite,
and audit confidence back to its user. No accounts, no multi-page
navigation.

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
  mistaken for a live one. The built-in demo (`/api/demo`, agent Fang)
  always runs in mock mode and is built from statistics only.

## Credit cost per audit

Clocked charges `ceil(model_time_ms / 25)` credits per successful
call; failed calls cost 0. Measured averages are about 1 credit for
Decide, 8 for Extract, 13 for Fill, and about 13 for Protect. A full
audit makes about 6 calls and costs roughly 40 to 60 credits. The free
trial is 4,000 credits, and the code `CLOCKEDHACKATHON` adds 16,000,
for 20,000 total - enough for roughly 300 to 400 audits.

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

## Deployment

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
Pillow; and its Verify step makes one grounding call per claim
instead of one call for all claims, so a live Worker audit costs the
usual 40 to 60 credits plus about 11 credits per verified claim
checked. A Python Worker was not used because the local server
depends on `clocked-sdk` (httpx) and Pillow, neither of which is
guaranteed to work on a Pyodide-based Python Worker.

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
node --test worker/test.mjs
```

## Demo example

`examples/fang_demo.json` is the worked example for an agent called
Fang, built from statistics only. Run it from the page with **Try the
Fang demo**, or `GET /api/demo`. Expected mock result: Level 10
Builder, composite 78, with pass rate estimated, so the result is
provisional. The full evidence trail is shown on the page.

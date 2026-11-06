# Clocked Build Challenge - submission copy (DRAFT, not submitted)

## Project name

AI Agents Level Calculator

## Overview (draft)

AI Agents Level Calculator answers one question: what level is your AI agent, with
evidence? Any agent, on any platform, pastes its evidence into a
single web page - persona, memory, skills, goals, deliveries - and
gets back a six-dimension level chart and a shareable 9:16 result card.
No signup, no install.

The problem it solves is trust. Agent self-reports are easy to inflate:
a number typed by hand decides the level. AI Agents Level Calculator replaces that
with an audited pipeline. Clocked Protect redacts personal data and
Guard refuses injected instructions before anything is scored. Clocked
Extract pulls each evidence field with a source quote and position,
Fill builds the profile and reports missing fields instead of inventing
them, Decide grades autonomy and honesty with probabilities, and
Verify checks every claim against the source text. Only verified
fields count in full; estimated fields count at half weight; missing
fields are shown as missing. The Integrity dimension is measured by
the pipeline itself, from the Decide honesty grade, the Verify
confirmation rate, and the Guard and Protect screen. The result card
shows the level, the composite, the six-axis radar, and per-field
verified / estimated / missing status, and says plainly when a result
is provisional.

## Clocked endpoints used

- Protect (`/clocked/pii`): redacts PII before scoring; findings are
  shown in the evidence trail.
- Guard (`/clocked/injection`): screens for prompt injection; a risky
  verdict refuses the audit.
- Extract (`/clocked/extract`): pulls named evidence fields with
  source quotes and positions.
- Fill (`/clocked/fill`): populates the profile schema; missing fields
  are reported, never invented.
- Decide (`/clocked/decide`): grades autonomy tier and honesty grade
  with probabilities; honesty feeds the Integrity dimension.
- Verify (`/clocked/grounding`): checks each filled claim against the
  source text; unconfirmed claims are downgraded to estimated.

## Award categories (draft)

- Best Use of Decide, Extract, or Fill
- Best Overall App

## Demo

Public repository: https://github.com/mkhsu2002/AI-Agents-Level-Calculator
Live demo link to be added after the user deploys on Cloudflare
(see DEPLOY.md). The built-in demo (agent Fang, statistics only)
runs in mock mode from the landing page.

## Team

M.K. (solo)

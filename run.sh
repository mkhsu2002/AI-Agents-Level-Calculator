#!/bin/sh
# Run AI Agents Level Calculator locally. Creates the venv on first run.
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install -q -r requirements.txt
echo "Starting AI Agents Level Calculator. Set CLOCKED_API_KEY for live mode; without it, mock mode runs."
.venv/bin/python -m ai_agents_level_calculator.server

"""AI Agents Level Calculator configuration.

The dimension list is the single place that controls the radar chart and
the scoring. The count is defined here: six dimensions, locked by the
user on 2026-11-06. Every dimension entry needs a matching compute
function in scoring.py.
"""

# Active dimensions, in radar order. Locked to six by the user on 2026-11-06.
# Each entry: key, short label, full name. The radar chart and the
# composite score both read this list, so the count is defined here.
DIMENSIONS = [
    {"key": "IDENTITY", "label": "Identity", "name": "Identity"},
    {"key": "KNOWLEDGE", "label": "Knowledge", "name": "Knowledge"},
    {"key": "SKILL", "label": "Skill", "name": "Skill"},
    {"key": "SPAN", "label": "Span", "name": "Span"},
    {"key": "RELIABILITY", "label": "Reliability", "name": "Reliability"},
    {"key": "INTEGRITY", "label": "Integrity", "name": "Integrity"},
]

# Level thresholds: XP needed to reach level L is 50 * L * (L - 1).
# Level 1 needs 0 XP, level 2 needs 100, level 8 needs 2800, level 9 needs 3600.
LEVEL_TITLES = [
    (1, 4, "Seedling"),
    (5, 9, "Explorer"),
    (10, 14, "Builder"),
    (15, 19, "Specialist"),
    (20, 29, "Master"),
    (30, 999, "Legend"),
]

MAX_STATE_CHARS = 10000
MAX_EXTRACT_FIELDS = 10
MAX_FILL_FIELDS = 30
MAX_DECIDE_QUESTIONS = 5

# Evidence fields the audit understands. kind is number, boolean, or text.
# Every field carries a status: verified, estimated, or missing.
PROFILE_FIELDS = [
    {"name": "persona_items", "kind": "number", "hint": "Number of distinct persona traits or identity statements"},
    {"name": "memory_entries", "kind": "number", "hint": "Number of saved memory or note entries"},
    {"name": "domains", "kind": "number", "hint": "Number of knowledge domains the agent works in"},
    {"name": "skills", "kind": "number", "hint": "Number of skills or tools the agent can use"},
    {"name": "reasoning_examples", "kind": "number", "hint": "Number of documented reasoning or decision examples"},
    {"name": "platforms", "kind": "number", "hint": "Number of platforms the agent runs on"},
    {"name": "goals_total", "kind": "number", "hint": "Total goals tracked"},
    {"name": "goals_done", "kind": "number", "hint": "Goals completed"},
    {"name": "deliveries", "kind": "number", "hint": "Accepted deliveries or shipped results"},
    {"name": "pass_rate", "kind": "number", "hint": "Share of checks passed, 0 to 1"},
    {"name": "honesty_disclosed", "kind": "boolean", "hint": "Whether limits and estimates were openly disclosed"},
    {"name": "fixes_acknowledged", "kind": "number", "hint": "Number of acknowledged fixes or corrections"},
]

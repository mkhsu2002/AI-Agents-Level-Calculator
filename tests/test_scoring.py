"""Unit tests for the AI Agents Level Calculator scoring formula."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ai_agents_level_calculator.config import DIMENSIONS
from ai_agents_level_calculator.scoring import level_for_xp, score, title_for_level


def fields(**values):
    out = {}
    for name, value in values.items():
        if isinstance(value, tuple):
            out[name] = {"value": value[0], "status": value[1]}
        else:
            out[name] = {"value": value, "status": "verified"}
    return out


class TestDimensions(unittest.TestCase):
    def test_six_dimensions(self):
        self.assertEqual(len(DIMENSIONS), 6)
        keys = [d["key"] for d in DIMENSIONS]
        self.assertEqual(keys, ["IDENTITY", "KNOWLEDGE", "SKILL", "SPAN", "RELIABILITY", "INTEGRITY"])

    def test_composite_is_mean_of_six(self):
        result = score(fields(persona_items=8, memory_entries=80, domains=10,
                              skills=8, reasoning_examples=5, platforms=5,
                              goals_total=20, goals_done=20, deliveries=100,
                              pass_rate=1.0, honesty_disclosed=True,
                              fixes_acknowledged=4))
        self.assertEqual(result["dimensions"]["IDENTITY"], 100)
        self.assertEqual(result["dimensions"]["SKILL"], 100)
        self.assertEqual(result["composite"], 100)

    def test_missing_fields_score_zero_not_silent(self):
        result = score(fields())
        for value in result["dimensions"].values():
            self.assertEqual(value, 0)
        self.assertTrue(result["provisional"])
        self.assertEqual(result["audit_confidence"], 0.0)
        self.assertEqual(result["level"], 1)

    def test_estimated_counts_half(self):
        full = dict(persona_items=8, memory_entries=80, domains=10, skills=8,
                    reasoning_examples=5, platforms=5, goals_total=20, goals_done=20,
                    deliveries=100, pass_rate=1.0, honesty_disclosed=True,
                    fixes_acknowledged=4)
        estimated_full = {k: (v, "estimated") for k, v in full.items()}
        verified = score(fields(**full))
        estimated = score(fields(**estimated_full))
        self.assertEqual(verified["xp"], 100 * 8 + 80 * 10 + 40 * 20 + 25 * 100)
        self.assertEqual(estimated["xp"], 0)  # unsupported estimates cannot create XP
        self.assertTrue(estimated["provisional"])
        self.assertFalse(verified["provisional"])
        self.assertEqual(verified["audit_confidence"], 1.0)
        self.assertEqual(estimated["audit_confidence"], 0.5)

    def test_missing_never_invented(self):
        result = score(fields(skills=8))
        self.assertEqual(result["field_status"]["domains"], "missing")
        self.assertEqual(result["dimensions"]["KNOWLEDGE"], 0)


class TestLevels(unittest.TestCase):
    def test_thresholds(self):
        self.assertEqual(level_for_xp(0), 1)
        self.assertEqual(level_for_xp(99), 1)
        self.assertEqual(level_for_xp(100), 2)
        self.assertEqual(level_for_xp(4500), 10)
        self.assertEqual(level_for_xp(4520), 10)
        self.assertEqual(level_for_xp(5499), 10)
        self.assertEqual(level_for_xp(5500), 11)

    def test_titles(self):
        self.assertEqual(title_for_level(1), "Seedling")
        self.assertEqual(title_for_level(8), "Explorer")
        self.assertEqual(title_for_level(10), "Builder")
        self.assertEqual(title_for_level(30), "Legend")


class TestIntegrity(unittest.TestCase):
    def test_integrity_uses_pipeline_signals(self):
        base = fields(persona_items=8, memory_entries=60, domains=10,
                      skills=8, reasoning_examples=5, platforms=5,
                      goals_total=20, goals_done=20, deliveries=100,
                      pass_rate=1.0, honesty_disclosed=True, fixes_acknowledged=4)
        high = score(base, integrity={"honesty": 0.9, "verified_share": 1.0, "screen_pass": True})
        low = score(base, integrity={"honesty": 0.3, "verified_share": 0.0, "screen_pass": False})
        self.assertEqual(high["dimensions"]["INTEGRITY"], 96)
        self.assertEqual(low["dimensions"]["INTEGRITY"], 12)
        self.assertLess(low["composite"], high["composite"])


if __name__ == "__main__":
    unittest.main()

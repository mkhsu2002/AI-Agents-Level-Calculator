import tempfile
import unittest
from pathlib import Path

from tools.agent_inventory import compile_manifest, inventory_file_count


class InventoryTests(unittest.TestCase):
    def test_counts_opted_in_files_without_contents(self):
        with tempfile.TemporaryDirectory() as root:
            memory = Path(root) / "memory"
            memory.mkdir()
            (memory / "item1.md").write_text("private memory text")
            sub = memory / "archive"
            sub.mkdir()
            (sub / "item2.md").write_text("other private memory")
            result = compile_manifest({"memory": str(memory)})
            self.assertEqual(result["counts"], {"memory_entries": 2})
            self.assertEqual(result["evidence_text"], "memory_entries: 2")
            self.assertNotIn("private memory", str(result))
            self.assertIs(result["upload_performed"], False)

    def test_rejects_non_directory(self):
        with self.assertRaises(ValueError):
            inventory_file_count("/a-nonexistent-agent-directory-00000")

    def test_unknown_category(self):
        with self.assertRaises(ValueError):
            compile_manifest({"private_messages": "/tmp"})


if __name__ == "__main__":
    unittest.main()

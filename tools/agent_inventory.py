#!/usr/bin/env python3
"""Permission-scoped, metadata-only agent file inventory.

No file contents are read. Nothing is uploaded. All scanned directories must
be named explicitly by the user or agent using --memory-dir, --skills-dir,
--deliveries-dir, etc. Directory count is NOT proof of task completion.
"""
import argparse
import json
from pathlib import Path

CATEGORIES = {
    "memory": "memory_entries",
    "skills": "skills",
    "delivery": "deliveries",
    "persona": "persona_items",
    "reasoning": "reasoning_examples",
    "domain": "domains",
    "goal_done": "goals_done",
    "goal_total": "goals_total",
    "fix": "fixes_acknowledged",
}
MAX_FILES = 100000


def inventory_file_count(directory):
    """Count direct and nested regular files, without following symlinks."""
    root = Path(directory).expanduser()
    if root.is_symlink() or not root.is_dir():
        raise ValueError(f"Not a non-symlink directory: {directory}")
    count = 0
    pending = [root]
    while pending:
        current = pending.pop()
        for child in current.iterdir():
            if child.is_symlink():
                continue
            if child.is_dir():
                pending.append(child)
            elif child.is_file():
                count += 1
                if count > MAX_FILES:
                    raise ValueError("Too many files; limit per category is 100000")
    return count


def compile_manifest(inputs):
    """Only categories with explicit directories are reported; unknown stays unknown."""
    counts = {}
    for category, directory in inputs.items():
        if category not in CATEGORIES:
            raise ValueError(f"Unknown category: {category}")
        counts[CATEGORIES[category]] = inventory_file_count(directory)
    return {
        "schema_version": "1.0",
        "method": "explicit-directory-metadata-count",
        "counts": counts,
        "limitations": (
            "One file is counted as one entry in the explicitly selected category. "
            "No content, task success, file quality, or actual agent ownership is verified."
        ),
        "evidence_text": "\n".join(f"{key}: {value}" for key, value in counts.items()),
        "upload_performed": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for category in CATEGORIES:
        parser.add_argument(f"--{category.replace('_', '-')}-dir",
                            dest=category, metavar="PATH", help=f"Authorized {category} directory")
    args = parser.parse_args()
    supplied = {key: value for key, value in vars(args).items() if value is not None}
    if not supplied:
        parser.error("Specify one or more explicitly authorized category directories")
    result = compile_manifest(supplied)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseInventoryManifest } from "../ai_agents_level_calculator/static/inventory-import.mjs";

function manifest(counts, extras = {}) {
  return JSON.stringify({
    schema_version: "1.0", method: "explicit-directory-metadata-count",
    counts, evidence_text: "SECRET: should never be sent",
    upload_performed: false, ...extras
  });
}
test("only numeric category counts survive local import", () => {
  const text = parseInventoryManifest(manifest({ memory_entries: 2, skills: 3 }));
  assert.equal(text, "memory_entries: 2\nskills: 3");
  assert.doesNotMatch(text, /SECRET|evidence_text|file|path/i);
});
test("raw source files and non-manifest JSON cannot become submitted evidence", () => {
  for (const raw of ["# private memory", '{"memory_entries":2}', '{"foo":']) {
    assert.throws(() => parseInventoryManifest(raw));
  }
});
test("unsafe, invented or wrongly typed count values are rejected", () => {
  for (const counts of [
    { memory_entries: "../secrets" }, { memory_entries: -1 },
    { memory_entries: 100001 }, { memory_entries: "10" },
    { private_file_contents: 2 }, {}
  ]) assert.throws(() => parseInventoryManifest(manifest(counts)));
  assert.throws(() => parseInventoryManifest(manifest({ skills: 1 }, { upload_performed: true })));
});
test("frontend no longer appends raw uploaded source files to evidence", () => {
  const page = readFileSync(new URL("../ai_agents_level_calculator/static/index.html", import.meta.url), "utf8");
  assert.match(page, /parseInventoryManifest\(await file\.text\(\)\)/);
  assert.match(page, /<script type="module">/);
  assert.doesNotMatch(page, /multiple accept="\.md/);
  assert.doesNotMatch(page, /box\.value \+=.*f\.text\(\)/);
});

// Browser-local conversion of permitted metadata counts to aggregate evidence.
// The original file content and all free-form JSON properties are never submitted.
const COUNT_FIELDS = new Set([
  "memory_entries", "skills", "deliveries", "persona_items",
  "reasoning_examples", "domains", "goals_done", "goals_total",
  "fixes_acknowledged"
]);
export function parseInventoryManifest(jsonText) {
  let manifest;
  try { manifest = JSON.parse(jsonText); }
  catch { throw new Error("Not valid JSON."); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
      manifest.schema_version !== "1.0" ||
      manifest.method !== "explicit-directory-metadata-count" ||
      manifest.upload_performed !== false) {
    throw new Error("Unsupported inventory; use tools/agent_inventory.py.");
  }
  const counts = manifest.counts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts) ||
      !Object.keys(counts).length) {
    throw new Error("Inventory has no category counts.");
  }
  const lines = [];
  for (const [field, value] of Object.entries(counts)) {
    if (!COUNT_FIELDS.has(field) || !Number.isSafeInteger(value) ||
        value < 0 || value > 100000) {
      throw new Error("Unsupported count field or value.");
    }
    lines.push(field + ": " + value);
  }
  return lines.join("\n");
}

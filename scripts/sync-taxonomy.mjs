// Copies the shared tag taxonomy and style presets from api/ into web/.
// Run after editing api/app/domain/*.json:  node scripts/sync-taxonomy.mjs
// Pass --check to fail (exit 1) when the copies are out of date (for CI).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["taxonomy.json", "style_presets.json"];
const check = process.argv.includes("--check");
let stale = false;

for (const f of files) {
  const src = join(root, "api/app/domain", f);
  const dst = join(root, "web/src/lib", f);
  const content = readFileSync(src, "utf8");
  const current = existsSync(dst) ? readFileSync(dst, "utf8") : null;
  if (current === content) continue;
  if (check) {
    console.error(`out of date: web/src/lib/${f}`);
    stale = true;
  } else {
    writeFileSync(dst, content);
    console.log(`synced web/src/lib/${f}`);
  }
}
if (stale) process.exit(1);

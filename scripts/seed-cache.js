// scripts/seed-cache.js
//
// Local trend-pool cache, no Blobs, no schedule, no deploy. Runs collect()
// against live sources and writes .cache/trends-<category>.json in the same
// shape crawl-trends.js writes into Blobs — the read layer (lib/pool.js)
// doesn't care which one it's reading from.
//
// Iterating on the Sonnet prompt (Step 3) means running it many times against
// the same pool. Re-crawling live sources on every run is slow, rude to the
// sources, and makes results non-reproducible — freezing the pool here makes
// prompt changes the only variable.
//
// Usage:
//   node scripts/seed-cache.js --all
//   node scripts/seed-cache.js --category ai
//   node scripts/seed-cache.js --all --max-age 12   (skip categories whose cache is <=12h old)

import { mkdir, writeFile, readFile } from "fs/promises";
import path from "path";
import { ACTIVE, CATEGORIES } from "../netlify/functions/lib/categories.js";
import { collect } from "../netlify/functions/lib/collect.js";

const CACHE_DIR = path.resolve(process.cwd(), ".cache");

function parseArgs(argv) {
  const args = { all: false, category: null, maxAgeHours: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") args.all = true;
    else if (a === "--category") args.category = argv[++i];
    else if (a === "--max-age") args.maxAgeHours = Number(argv[++i]);
  }
  return args;
}

function cachePath(cat) {
  return path.join(CACHE_DIR, `trends-${cat}.json`);
}

async function isFresh(cat, maxAgeHours) {
  if (maxAgeHours == null) return false;
  try {
    const raw = await readFile(cachePath(cat), "utf8");
    const data = JSON.parse(raw);
    const ageHours = (Date.now() - Date.parse(data.fetched_at)) / 36e5;
    return Number.isFinite(ageHours) && ageHours <= maxAgeHours;
  } catch {
    return false;
  }
}

async function seedOne(cat, maxAgeHours) {
  if (!CATEGORIES[cat]) throw new Error(`unknown category: ${cat}`);
  if (await isFresh(cat, maxAgeHours)) {
    console.log(`[seed-cache] ${cat}: fresh (<= ${maxAgeHours}h old), skipping`);
    return;
  }
  console.log(`[seed-cache] ${cat}: collecting...`);
  const result = await collect(cat);
  const payload = { fetched_at: new Date().toISOString(), ...result };
  await writeFile(cachePath(cat), JSON.stringify(payload, null, 2));
  console.log(
    `[seed-cache] ${cat}: wrote ${result.items.length} items, healthy=${result.health.healthy}, sources=${result.health.unique_sources}`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = args.all ? ACTIVE : args.category ? [args.category] : null;
  if (!targets) {
    console.error("Usage: node scripts/seed-cache.js --all | --category <name> [--max-age <hours>]");
    process.exitCode = 1;
    return;
  }
  await mkdir(CACHE_DIR, { recursive: true });
  for (const cat of targets) {
    await seedOne(cat, args.maxAgeHours);
  }
}

main().catch((e) => {
  console.error("[seed-cache] failed:", e);
  process.exitCode = 1;
});

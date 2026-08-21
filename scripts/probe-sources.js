#!/usr/bin/env node
// Phase 2 crawl probe. Run this on your machine — the Claude sandbox blocks
// 4 of the 5 source hosts, so this is the only place the full crawl gets tested.
//
//   node scripts/probe-sources.js              # all active categories, summary
//   node scripts/probe-sources.js web3         # one category
//   node scripts/probe-sources.js web3 --raw   # dump every normalized item
//   node scripts/probe-sources.js --json > probe.json
//
// Set GITHUB_TOKEN first — unauthenticated search is 10 req/min and this script
// will hit that.

import { CATEGORIES, ACTIVE } from "../netlify/functions/lib/categories.js";
import { fetchHN } from "../netlify/functions/lib/sources/hn.js";
import { fetchGitHub } from "../netlify/functions/lib/sources/github.js";
import { fetchGoogleTrends } from "../netlify/functions/lib/sources/google-trends.js";
import { fetchProductHunt } from "../netlify/functions/lib/sources/product-hunt.js";
import { fetchCoinGecko } from "../netlify/functions/lib/sources/coingecko.js";
import { pipeline } from "../netlify/functions/lib/rank.js";

const args = process.argv.slice(2);
const RAW = args.includes("--raw");
const JSON_OUT = args.includes("--json");
const only = args.filter((a) => !a.startsWith("--"));
const cats = only.length ? only : ACTIVE;

const ADAPTERS = {
  hn: fetchHN,
  github: fetchGitHub,
  producthunt: fetchProductHunt,
  coingecko: fetchCoinGecko,
  googletrends: fetchGoogleTrends,
};

const out = [];
for (const cat of cats) {
  const cfg = CATEGORIES[cat];
  if (!cfg) { console.error(`unknown category: ${cat}`); continue; }
  const perSource = {};
  const all = [];
  for (const [name, fn] of Object.entries(ADAPTERS)) {
    const t0 = Date.now();
    let items = [];
    try { items = await fn(cfg); } catch (e) { items = []; console.error(`  ${name} threw: ${e.message}`); }
    perSource[name] = { count: items.length, ms: Date.now() - t0, sample: items[0] || null };
    all.push(...items);
  }
  const { items, health } = pipeline(all);
  out.push({ category: cat, label: cfg.label, perSource, health, items });

  if (JSON_OUT) continue;
  console.log(`\n${"=".repeat(72)}\n${cfg.label}  (${cat})\n${"=".repeat(72)}`);
  for (const [n, s] of Object.entries(perSource)) {
    const flag = s.count === 0 ? "  <-- EMPTY" : "";
    console.log(` ${n.padEnd(13)} ${String(s.count).padStart(3)} items  ${String(s.ms).padStart(5)}ms${flag}`);
    if (s.sample) console.log(`   ${JSON.stringify(s.sample).slice(0, 150)}`);
  }
  console.log(`\n HEALTH ${health.healthy ? "OK" : "DEGRADED"} | cached ${health.total} | sources ${health.unique_sources} | dupes removed ${health.dupes_removed} | median age ${health.median_age_days}d`);
  console.log(` mix: ${JSON.stringify(health.per_source)}`);
  console.log(`\n TOP ${RAW ? items.length : 12}:`);
  items.slice(0, RAW ? items.length : 12).forEach((i, n) =>
    console.log(`  ${String(n + 1).padStart(2)}. [${i.score.toFixed(3)}] ${i.source.padEnd(12)} ${i.signal.padEnd(9)} ${i.title.slice(0, 78)}`));
}
if (JSON_OUT) console.log(JSON.stringify(out, null, 2));

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

import { CATEGORIES, ACTIVE, REFERENCE_ONLY_SOURCES } from "../netlify/functions/lib/categories.js";
import { fetchHN } from "../netlify/functions/lib/sources/hn.js";
import { fetchGitHub } from "../netlify/functions/lib/sources/github.js";
import { fetchGoogleTrends } from "../netlify/functions/lib/sources/google-trends.js";
import { fetchProductHunt } from "../netlify/functions/lib/sources/product-hunt.js";
import { fetchCoinGecko } from "../netlify/functions/lib/sources/coingecko.js";
import { fetchXList, getXListBilling } from "../netlify/functions/lib/sources/x-list.js";
import { fetchLobsters } from "../netlify/functions/lib/sources/lobsters.js";
import { fetchArxiv } from "../netlify/functions/lib/sources/arxiv.js";
import { fetchDexScreener } from "../netlify/functions/lib/sources/dexscreener.js";
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
  xlist: (cfg, cat) => fetchXList(cfg, cat),
  lobsters: fetchLobsters,
  arxiv: fetchArxiv,
  dexscreener: fetchDexScreener,
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
    try { items = await fn(cfg, cat); } catch (e) { items = []; console.error(`  ${name} threw: ${e.message}`); }
    perSource[name] = { count: items.length, ms: Date.now() - t0, sample: items[0] || null };
    all.push(...items);
  }

  // Task 1: Google Trends stays a raw record but never enters the cache or
  // the health gate's unique-source count — mirrors collect.js exactly.
  const reference = all.filter((i) => REFERENCE_ONLY_SOURCES.includes(i.source));
  const cacheable = all.filter((i) => !REFERENCE_ONLY_SOURCES.includes(i.source));

  // BUG FIX (found while touching this file, not part of the task list):
  // this probe called pipeline(all) with no cfg, so weightOverride (e.g.
  // web3's github: 0.5) was never actually applied here — every prior probe
  // run under-reported how much GitHub was discounted for web3. Passing cfg
  // through now, matching collect.js's real call.
  const { items, health } = pipeline(cacheable, undefined, cfg);
  out.push({ category: cat, label: cfg.label, perSource, health, items, reference });

  if (JSON_OUT) continue;
  console.log(`\n${"=".repeat(72)}\n${cfg.label}  (${cat})\n${"=".repeat(72)}`);
  for (const [n, s] of Object.entries(perSource)) {
    const isReference = REFERENCE_ONLY_SOURCES.includes(n);
    const flag = s.count === 0 ? "  <-- EMPTY" : isReference ? "  (reference only, excluded from cache/health)" : "";
    console.log(` ${n.padEnd(13)} ${String(s.count).padStart(3)} items  ${String(s.ms).padStart(5)}ms${flag}`);
    if (s.sample) console.log(`   ${JSON.stringify(s.sample).slice(0, 150)}`);
  }
  console.log(`\n HEALTH ${health.healthy ? "OK" : "DEGRADED"} | cached ${health.total} | sources ${health.unique_sources} | dupes removed ${health.dupes_removed} | corroborated ${health.corroborated_items} | median age ${health.median_age_days}d`);
  console.log(` mix: ${JSON.stringify(health.per_source)}`);
  console.log(`\n TOP ${RAW ? items.length : 12}:`);
  items.slice(0, RAW ? items.length : 12).forEach((i, n) =>
    console.log(`  ${String(n + 1).padStart(2)}. [${i.score.toFixed(3)}] ${i.source.padEnd(12)} ${i.signal.padEnd(9)}${(i.corroborated_sources?.length ?? 1) > 1 ? ` (+${i.corroborated_sources.length - 1} corroborating)` : ""} ${i.title.slice(0, 70)}`));
}

const billing = getXListBilling();
if (!JSON_OUT) {
  let line;
  if (billing.fetched) line = `1 fetch, ${billing.rawCount} posts read, ~$${billing.estimatedSpendUSD}`;
  else if (billing.attempted) line = `request failed, $0 billed (rejected before data returned) — ${JSON.stringify(billing.lastError)}`;
  else line = "no X_BEARER_TOKEN set — adapter no-op'd, $0 spent, 0 requests made.";
  console.log(`\nX List billing: ${line}`);
}

if (JSON_OUT) console.log(JSON.stringify({ categories: out, x_list_billing: billing }, null, 2));

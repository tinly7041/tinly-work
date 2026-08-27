#!/usr/bin/env node
// scripts/competitor-report.js
//
// Phase 2.7 CLI harness, same role as scripts/generate-report.js: no
// frontend, no gate, no lead capture, no confirm screen — those don't exist
// yet (see the Phase 2.7 report). Two modes:
//
//   Entity mode — live query + matcher-precision check, no API key needed:
//     node scripts/competitor-report.js --entity "Aerodrome" --category web3
//     node scripts/competitor-report.js --entity "Retool" --category saas --refresh
//
//   Hammer mode — fix-pass brief item 1's VERIFY: bypasses the cache
//   entirely and calls fetchCompetitorNews live N times, spaced, printing
//   each call's retry attempts and whether it still came back empty after
//   retries. Used to try to catch Google News RSS's intermittent-empty
//   behavior in the wild, not to simulate one:
//     node scripts/competitor-report.js --entity "Uniswap" --category web3 --hammer 12
//
//   Brand mode — full end-to-end run (classify -> category pool -> entity
//   cache -> read-pulse), requires ANTHROPIC_API_KEY:
//     node scripts/competitor-report.js --brand "Uniswap" --url uniswap.org --competitor "Aerodrome"
//     node scripts/competitor-report.js --brand "Uniswap" --url uniswap.org   # blank competitor -> Haiku inference
//
// --refresh forces a live re-fetch even if a cache entry is already fresh
// (entity mode only) — useful for repeatedly re-verifying query precision
// against live results without waiting out the 7-day TTL.

import { classifyBrand, CLASSIFY_MODEL } from "../netlify/functions/lib/classify.js";
import { loadCategoryPool } from "../netlify/functions/lib/pool.js";
import { generatePulseRead } from "../netlify/functions/lib/read-pulse.js";
import { CATEGORIES } from "../netlify/functions/lib/categories.js";
import { computeCost } from "../netlify/functions/lib/pricing.js";
import { refreshCompetitorEntity } from "../netlify/functions/lib/competitor-fetch.js";
import { fetchCompetitorNews, buildCompetitorQuery } from "../netlify/functions/lib/sources/competitor-news.js";

function parseArgs(argv) {
  const args = { entity: null, category: null, brand: null, url: null, competitor: null, refresh: false, json: false, debug: false, hammer: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--entity") args.entity = argv[++i];
    else if (a === "--category") args.category = argv[++i];
    else if (a === "--brand") args.brand = argv[++i];
    else if (a === "--url") args.url = argv[++i];
    else if (a === "--competitor") args.competitor = argv[++i];
    else if (a === "--refresh") args.refresh = true;
    else if (a === "--json") args.json = true;
    else if (a === "--debug") args.debug = true;
    else if (a === "--hammer") args.hammer = Number(argv[++i]);
  }
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- hammer mode: try to catch the empty-window in the wild ----------

async function runHammerMode(args) {
  if (!CATEGORIES[args.category]) {
    console.error(`Unknown category "${args.category}". Known: ${Object.keys(CATEGORIES).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Hammering "${args.entity}" (${args.category}) x${args.hammer}, bypassing cache, spaced 2s apart...\n`);
  let emptyAfterRetries = 0;
  let recoveredByRetry = 0;
  let immediateHits = 0;
  for (let i = 1; i <= args.hammer; i++) {
    const { query, items, fetch_meta } = await fetchCompetitorNews(args.entity, args.category);
    const tag = fetch_meta.exhausted_empty ? "EMPTY AFTER RETRIES" : fetch_meta.attempts > 1 ? "RECOVERED ON RETRY" : "OK (1st attempt)";
    console.log(`[${i}/${args.hammer}] attempts=${fetch_meta.attempts} exhausted_empty=${fetch_meta.exhausted_empty} http_error=${fetch_meta.http_error || "none"} raw_kept=${items.length} — ${tag}`);
    if (items[0]) console.log(`         e.g. "${items[0].title}"`);
    if (fetch_meta.exhausted_empty) emptyAfterRetries++;
    else if (fetch_meta.attempts > 1) recoveredByRetry++;
    else immediateHits++;
    if (i < args.hammer) await sleep(2000);
  }
  console.log(`\nQuery used throughout: ${buildCompetitorQuery(args.entity, args.category)}`);
  console.log(`Summary: ${immediateHits} ok on first attempt, ${recoveredByRetry} recovered by retry, ${emptyAfterRetries} still empty after all retries — out of ${args.hammer} total live calls.`);
}

// ---------- entity mode: live query + matcher precision ----------

async function runEntityMode(args) {
  if (!CATEGORIES[args.category]) {
    console.error(`Unknown category "${args.category}". Known: ${Object.keys(CATEGORIES).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const { query, items, rejected, fetch_meta, status } = args.refresh
    ? await fetchCompetitorNews(args.entity, args.category).then((r) => ({ ...r, status: undefined }))
    : await refreshCompetitorEntity(args.entity, args.category, { force: false }).then((r) => ({
        query: r.query,
        items: r.items,
        rejected: r.rejected,
        from_cache: r.from_cache,
        fetch_meta: r.fetch_meta,
        status: r.status,
      }));

  if (args.json) {
    console.log(JSON.stringify({ entity: args.entity, category: args.category, query, items, rejected, fetch_meta, status }, null, 2));
    return;
  }

  console.log(`${"=".repeat(72)}\nEntity: ${args.entity}  (category: ${args.category})\n${"=".repeat(72)}`);
  console.log(`Query sent: ${query}`);
  if (fetch_meta) console.log(`Fetch: attempts=${fetch_meta.attempts} exhausted_empty=${fetch_meta.exhausted_empty} http_error=${fetch_meta.http_error || "none"}${status ? ` status=${status}` : ""}`);
  console.log(`Items returned (post entity+category filter): ${items.length}`);
  console.log(`Items rejected: ${rejected.length}`);
  console.log("");
  console.log("SURVIVORS:");
  if (!items.length) console.log("  (none)");
  for (const i of items) console.log(`  [kept] ${i.title}\n         ${i.url}`);
  console.log("");
  console.log("REJECTS:");
  if (!rejected.length) console.log("  (none)");
  for (const r of rejected) console.log(`  [${r.reason}] ${r.title}`);
  console.log("");
}

// ---------- brand mode: full end-to-end run ----------

async function safeLoadPool(catKey) {
  if (!catKey) return { pool: null, error: null };
  try {
    const pool = await loadCategoryPool(catKey);
    return { pool, error: pool ? null : "no cache file and no Blobs entry" };
  } catch (e) {
    return { pool: null, error: e.message };
  }
}

async function runBrandMode(args) {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    console.error("ANTHROPIC_API_KEY is not set — brand mode needs a real classify + Pass 1/2 call.");
    process.exitCode = 1;
    return;
  }

  const cls = await classifyBrand({ brandName: args.brand, website: args.url, anthropicApiKey });
  const classifyCost = computeCost(cls._usage, cls._model || CLASSIFY_MODEL);

  const primaryPoolInfo = await safeLoadPool(cls.primary);
  const secondaryPoolInfo = cls.secondary ? await safeLoadPool(cls.secondary) : { pool: null, error: null };

  // Competitor resolution: user-supplied name is authoritative (skips
  // inference); blank falls back to classify's own inferred_competitors,
  // computed on the SAME call above — see classify.js.
  const competitorsSource = args.competitor ? "user" : "inferred";
  const competitorNames = args.competitor ? [args.competitor] : cls.inferred_competitors || [];
  const competitors = competitorNames.map((name) => ({ name, source: competitorsSource }));

  // CLI-harness-only: this script IS the not-yet-built background function's
  // stand-in for live verification, so it forces a live refresh here rather
  // than reading cache-only like read-pulse.js does in the real (future)
  // request path. Never do this from generate-pulse.js or read-pulse.js
  // itself — see competitor-fetch.js's header.
  const competitorResults = [];
  for (const name of competitorNames) {
    const r = await refreshCompetitorEntity(name, cls.primary, { force: args.refresh });
    competitorResults.push({ name, ...r });
  }
  const competitorItems = competitorResults.flatMap((r) => r.items || []);

  const { result: read, debug: readDebug } = await generatePulseRead({
    brandName: args.brand,
    website: args.url,
    brandRead: cls.brand_read,
    primaryCategory: cls.primary,
    secondaryCategory: cls.secondary,
    primaryPool: primaryPoolInfo.pool,
    secondaryPool: secondaryPoolInfo.pool,
    competitors,
    competitorItems,
    anthropicApiKey,
  });

  if (args.json) {
    console.log(JSON.stringify({ classify: cls, competitorsSource, competitorNames, competitorResults, read, readDebug }, null, 2));
    return;
  }

  const categoryLabel = CATEGORIES[cls.primary]?.label || cls.primary;
  console.log(`${"=".repeat(72)}\n${args.brand} (${args.url}) — ${categoryLabel}\n${"=".repeat(72)}`);
  console.log(`Classify: primary=${cls.primary} secondary=${cls.secondary || "none"} confidence=${cls.confidence}`);
  console.log(`Competitors (${competitorsSource}): ${competitorNames.length ? competitorNames.join(", ") : "(none named or inferred)"}`);
  for (const r of competitorResults) {
    console.log(`  - ${r.name}: query="${r.query}" ${r.items.length} items (from_cache=${r.from_cache})`);
    for (const i of r.items) console.log(`      ${i.title}`);
  }
  console.log("");
  if (read.quiet) {
    console.log(read.pulse_summary);
  } else {
    console.log(read.pulse_summary);
    console.log("");
    read.items.forEach((item, idx) => {
      console.log(`${idx + 1}. [${item.relevance}] ${item.headline}`);
      console.log(`   ${item.url}`);
    });
  }
  console.log("");
  const directCount = read.items?.filter((i) => i.relevance === "direct").length || 0;
  console.log(`Standards: ${readDebug.standards?.pass ? "PASS" : `FAIL — ${readDebug.standards?.failed_standard}`} · direct=${directCount}`);
  const totalCost = (classifyCost?.usd || 0) + (readDebug.total_cost || 0);
  console.log(`Cost: $${totalCost.toFixed(6)}`);

  if (args.debug) {
    console.log("");
    console.log("=== DEBUG ===");
    console.log(JSON.stringify(readDebug, null, 2));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.entity && args.hammer) return runHammerMode(args);
  if (args.entity) return runEntityMode(args);
  if (args.brand && args.url) return runBrandMode(args);
  console.error(
    'Usage:\n  node scripts/competitor-report.js --entity "<name>" --category <ai|web3|fintech|saas> [--refresh] [--json]\n  node scripts/competitor-report.js --entity "<name>" --category <cat> --hammer <N>\n  node scripts/competitor-report.js --brand "<name>" --url <domain> [--competitor "<name>"] [--refresh] [--debug] [--json]'
  );
  process.exitCode = 1;
}

main().catch((e) => {
  console.error("[competitor-report] failed:", e);
  process.exitCode = 1;
});

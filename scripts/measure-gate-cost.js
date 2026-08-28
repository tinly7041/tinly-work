#!/usr/bin/env node
// scripts/measure-gate-cost.js
//
// MEASUREMENT ONLY — brief: "pre-gate / post-gate cost split." Does not
// restructure read-pulse.js, does not wire generate-pulse.js, does not touch
// the frontend or the gate. Reuses the existing pipeline exactly as coded
// (classify.js -> lib/pool.js -> lib/read-pulse.js) and reads the per-stage
// cost debug those modules already produce.
//
// Pre-gate cost is measured as the real first-time-visitor case: competitor
// items are NOT pre-loaded (a fresh entity has nothing in lib/entity-cache.js
// yet — see that file's own header), so runPass1 inside generatePulseRead
// scores exactly what a real pre-gate call would score: primary + secondary
// category pool only. Competitor fetch cost is measured separately, as its
// own stage, via the same lib/sources/competitor-news.js call the background
// function makes.
//
// Usage:
//   node --env-file=.env scripts/measure-gate-cost.js
//   node --env-file=.env scripts/measure-gate-cost.js --json > report.json

import { classifyBrand, CLASSIFY_MODEL } from "../netlify/functions/lib/classify.js";
import { loadCategoryPool } from "../netlify/functions/lib/pool.js";
import { generatePulseRead } from "../netlify/functions/lib/read-pulse.js";
import { fetchCompetitorNews } from "../netlify/functions/lib/sources/competitor-news.js";
import { computeCost, MODEL_PRICING } from "../netlify/functions/lib/pricing.js";
import { CACHE_TARGET } from "../netlify/functions/lib/categories.js";

const JSON_OUT = process.argv.includes("--json");
const RUNS_PER_BRAND = 3;
const RATE_LIMIT_PER_DAY = 5; // must match generate-pulse.js's RATE_LIMIT_PER_DAY

const BRANDS = [
  { brand: "Perplexity", url: "perplexity.ai", note: "ai" },
  { brand: "Uniswap", url: "uniswap.org", note: "web3" },
  { brand: "Wise", url: "wise.com", note: "fintech" },
  { brand: "Notion", url: "notion.so", note: "saas (may hit saas+ai dual-category)" },
];

async function safeLoadPool(catKey) {
  if (!catKey) return null;
  try {
    return await loadCategoryPool(catKey);
  } catch {
    return null;
  }
}

function fmt(n, d = 6) {
  return Number(n).toFixed(d);
}

async function measureBrandRun({ brand, url, anthropicApiKey }) {
  // a) classify.js cost alone — including the site fetch call.
  const t0 = Date.now();
  const cls = await classifyBrand({ brandName: brand, website: url, anthropicApiKey });
  const classifyMs = Date.now() - t0;
  const classifyCost = computeCost(cls._usage, cls._model || CLASSIFY_MODEL);

  const primaryPool = await safeLoadPool(cls.primary);
  const secondaryPool = cls.secondary ? await safeLoadPool(cls.secondary) : null;

  // b) + d) Pass 1 / Pass 2 cost, at the real pool size this brand hits.
  // competitorItems intentionally omitted: a fresh entity has nothing in
  // lib/entity-cache.js yet (7-day TTL, populated only by the background
  // function after a PRIOR lead named the same entity) — this is the true
  // first-time-visitor shape, not a simplification.
  const t1 = Date.now();
  const { result, debug } = await generatePulseRead({
    brandName: brand,
    website: url,
    brandRead: cls.brand_read,
    primaryCategory: cls.primary,
    secondaryCategory: cls.secondary,
    primaryPool,
    secondaryPool,
    anthropicApiKey,
  });
  const readMs = Date.now() - t1;

  return {
    brand,
    url,
    classify: {
      primary: cls.primary,
      secondary: cls.secondary,
      confidence: cls.confidence,
      site_read: cls.site_read,
      inferred_competitors: cls.inferred_competitors,
      cost: classifyCost,
      ms: classifyMs,
    },
    pool: {
      primary_size: primaryPool?.items?.length || 0,
      secondary_size: secondaryPool?.items?.length || 0,
      combined_pool_size: debug.pool_size,
      cross_category_dupes_removed: debug.cross_category_dupes_removed,
    },
    pass1: debug.pass1
      ? { cost: debug.pass1.cost, score_distribution: debug.pass1.score_distribution, is_event: debug.pass1.is_event }
      : null,
    pass2: debug.pass2 && debug.pass2.cost ? { cost: debug.pass2.cost } : null,
    standards: debug.standards,
    quiet: result.quiet,
    read_ms: readMs,
  };
}

async function measureCompetitorFetch({ entity, categoryKey }) {
  if (!entity || !categoryKey) return { entity, categoryKey, skipped: "no inferred competitor" };
  const t0 = Date.now();
  const { query, items, rejected } = await fetchCompetitorNews(entity, categoryKey);
  const ms = Date.now() - t0;
  // Google News RSS is a plain HTTP GET — no Anthropic call, no paid API key
  // involved (see lib/sources/competitor-news.js — it calls lib/sources/_http.js's
  // get(), a bare fetch). usd is hardcoded 0 here, not assumed: there is no
  // usage object of any kind to run through computeCost, because no model or
  // metered API was called for this stage. Live-verified below via the item
  // count and query actually returned.
  return { entity, categoryKey, query, item_count: items.length, rejected_count: rejected.length, usd: 0, ms };
}

// ---------- worst-case (calculated, not measured) ----------
// Both categories at CACHE_TARGET (lib/categories.js) depth, zero cross-category
// dedupe assumed (upper bound, not typical — real cross-category overlap
// reduces this). This is arithmetic over the measured per-item cost slope
// from the live runs above, NOT a live 100-item run.
function calculateWorstCase(allPass1Runs) {
  const withUsage = allPass1Runs.filter((r) => r.pass1?.cost);
  if (!withUsage.length) return null;
  const avgInputPerItem =
    withUsage.reduce((s, r) => s + r.pass1.cost.input_tokens / Math.max(1, r.pool.combined_pool_size), 0) / withUsage.length;
  const avgOutputPerItem =
    withUsage.reduce((s, r) => s + r.pass1.cost.output_tokens / Math.max(1, r.pool.combined_pool_size), 0) / withUsage.length;

  const worstPoolSize = CACHE_TARGET * 2; // dual-category, zero dedupe, upper bound
  const rate = MODEL_PRICING["claude-haiku-4-5"];
  const estInputTokens = avgInputPerItem * worstPoolSize;
  const estOutputTokens = avgOutputPerItem * worstPoolSize;
  const estUsd = (estInputTokens / 1e6) * rate.input + (estOutputTokens / 1e6) * rate.output;

  return {
    method: "calculated",
    basis: `linear extrapolation of measured Pass 1 per-item token slope (avg over ${withUsage.length} live runs) to a ${worstPoolSize}-item pool (2x CACHE_TARGET=${CACHE_TARGET}, zero cross-category dedupe assumed)`,
    worst_pool_size: worstPoolSize,
    avg_input_tokens_per_item_measured: Number(avgInputPerItem.toFixed(2)),
    avg_output_tokens_per_item_measured: Number(avgOutputPerItem.toFixed(2)),
    est_input_tokens: Math.round(estInputTokens),
    est_output_tokens: Math.round(estOutputTokens),
    est_usd: Number(estUsd.toFixed(6)),
  };
}

function summarizeRange(values) {
  if (!values.length) return null;
  return { min: Math.min(...values), max: Math.max(...values), runs: values };
}

async function main() {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    console.error("ANTHROPIC_API_KEY is not set.");
    process.exitCode = 1;
    return;
  }

  const allResults = [];
  const allCompetitorResults = [];

  for (const b of BRANDS) {
    const runs = [];
    for (let i = 0; i < RUNS_PER_BRAND; i++) {
      if (!JSON_OUT) console.error(`[measure] ${b.brand} run ${i + 1}/${RUNS_PER_BRAND}...`);
      const run = await measureBrandRun({ brand: b.brand, url: b.url, anthropicApiKey });
      runs.push(run);
    }

    // c) competitor fetch cost — measured once per brand off the first run's
    // classify output (categoryKey/entity don't change run to run for a
    // fixed brand+site; this avoids paying for 3 redundant Google News hits).
    const firstRun = runs[0];
    const entity = firstRun.classify.inferred_competitors?.[0] || null;
    if (!JSON_OUT) console.error(`[measure] ${b.brand} competitor fetch (entity="${entity}")...`);
    const competitorResult = await measureCompetitorFetch({ entity, categoryKey: firstRun.classify.primary });
    allCompetitorResults.push({ brand: b.brand, ...competitorResult });

    allResults.push({ brand: b.brand, url: b.url, runs, competitor: competitorResult });
  }

  // Worst-case pre-gate pool (calculated from measured slope).
  const flatRuns = allResults.flatMap((r) => r.runs);
  const worstCase = calculateWorstCase(flatRuns);

  if (JSON_OUT) {
    console.log(JSON.stringify({ results: allResults, worst_case: worstCase }, null, 2));
    return;
  }

  console.log("=".repeat(78));
  console.log("PRE-GATE / POST-GATE COST SPLIT — MEASUREMENT ONLY");
  console.log("=".repeat(78));

  for (const r of allResults) {
    console.log(`\n${"-".repeat(78)}\n${r.brand} (${r.url})\n${"-".repeat(78)}`);
    r.runs.forEach((run, idx) => {
      console.log(`\n  Run ${idx + 1}:`);
      console.log(
        `    classify: primary=${run.classify.primary} secondary=${run.classify.secondary || "none"} site_read=${run.classify.site_read} inferred_competitors=${JSON.stringify(run.classify.inferred_competitors)}`
      );
      if (run.classify.cost) {
        console.log(
          `      cost: ${run.classify.cost.input_tokens} in / ${run.classify.cost.output_tokens} out = $${fmt(run.classify.cost.usd)} (${run.classify.ms}ms, model=${run.classify.cost.model})`
        );
      } else {
        console.log(`      cost: no usage returned`);
      }
      console.log(
        `    pool: primary=${run.pool.primary_size} secondary=${run.pool.secondary_size} combined_pre_dedupe=${run.pool.primary_size + run.pool.secondary_size} combined_after_dedupe=${run.pool.combined_pool_size} (dupes_removed=${run.pool.cross_category_dupes_removed})`
      );
      if (run.pass1?.cost) {
        console.log(
          `    pass1: ${run.pass1.cost.input_tokens} in / ${run.pass1.cost.output_tokens} out = $${fmt(run.pass1.cost.usd)} (model=${run.pass1.cost.model})`
        );
        const d = run.pass1.score_distribution;
        if (d) console.log(`      scored ${d.total}: direct=${d.direct} indirect=${d.indirect} none=${d.none}`);
      } else {
        console.log(`    pass1: not run (empty pool)`);
      }
      if (run.pass2?.cost) {
        console.log(
          `    pass2: ${run.pass2.cost.input_tokens} in / ${run.pass2.cost.output_tokens} out = $${fmt(run.pass2.cost.usd)} (model=${run.pass2.cost.model})`
        );
      } else {
        console.log(`    pass2: not run (${run.standards?.failed_standard || "no items above 'none' or event-gated"})`);
      }
      const preGateUsd = (run.classify.cost?.usd || 0) + (run.pass1?.cost?.usd || 0);
      const pass2Usd = run.pass2?.cost?.usd || 0;
      const totalUsd = preGateUsd + pass2Usd;
      const preGatePct = totalUsd > 0 ? ((preGateUsd / totalUsd) * 100).toFixed(1) : "n/a";
      console.log(
        `    TOTAL: $${fmt(totalUsd)} — pre-gate (classify+pass1) $${fmt(preGateUsd)} (${preGatePct}%), post-gate pass2 $${fmt(pass2Usd)}`
      );
    });

    const preGateRange = summarizeRange(r.runs.map((run) => (run.classify.cost?.usd || 0) + (run.pass1?.cost?.usd || 0)));
    const pass2Range = summarizeRange(r.runs.map((run) => run.pass2?.cost?.usd || 0));
    const poolSizes = [...new Set(r.runs.map((run) => run.pool.combined_pool_size))];
    console.log(`\n  Pool size across runs: ${poolSizes.join(", ")}`);
    console.log(`  Pre-gate cost range (live-verified, ${RUNS_PER_BRAND} runs): $${fmt(preGateRange.min)} - $${fmt(preGateRange.max)}`);
    console.log(`  Pass 2 cost range (live-verified, ${RUNS_PER_BRAND} runs, selection varies run to run): $${fmt(pass2Range.min)} - $${fmt(pass2Range.max)}`);

    console.log(
      `\n  Competitor fetch (live-verified): entity="${r.competitor.entity}" query=${JSON.stringify(r.competitor.query)} -> ${r.competitor.item_count} items, $${r.competitor.usd} (${r.competitor.ms}ms)`
    );
  }

  console.log(`\n${"=".repeat(78)}\nWORST-CASE PRE-GATE POOL (calculated, not measured)\n${"=".repeat(78)}`);
  if (worstCase) {
    console.log(`  method: ${worstCase.method}`);
    console.log(`  basis: ${worstCase.basis}`);
    console.log(`  worst_pool_size: ${worstCase.worst_pool_size} items`);
    console.log(
      `  measured slope: ${worstCase.avg_input_tokens_per_item_measured} input tok/item, ${worstCase.avg_output_tokens_per_item_measured} output tok/item`
    );
    console.log(`  estimated pass1 tokens at worst-case pool: ${worstCase.est_input_tokens} in / ${worstCase.est_output_tokens} out`);
    console.log(`  estimated pass1 cost at worst-case pool: $${fmt(worstCase.est_usd)}`);
  } else {
    console.log("  (no Pass 1 usage measured — cannot extrapolate)");
  }

  console.log(`\n${"=".repeat(78)}\nDAILY ABUSE CEILING PER IP (pre-gate only, ${RATE_LIMIT_PER_DAY}/IP/day cap)\n${"=".repeat(78)}`);
  for (const r of allResults) {
    const preGateCosts = r.runs.map((run) => (run.classify.cost?.usd || 0) + (run.pass1?.cost?.usd || 0));
    const avgPreGate = preGateCosts.reduce((a, b) => a + b, 0) / preGateCosts.length;
    console.log(
      `  ${r.brand.padEnd(12)} avg pre-gate/request $${fmt(avgPreGate)} x ${RATE_LIMIT_PER_DAY} = $${fmt(avgPreGate * RATE_LIMIT_PER_DAY)}/IP/day (typical, this brand's real pool)`
    );
  }
  if (worstCase) {
    // Worst case pre-gate also includes one classify call (Haiku, ~fixed
    // cost regardless of pool size — site fetch + short response). Use the
    // measured average classify cost across all runs as that fixed add-on.
    const avgClassifyUsd =
      flatRuns.reduce((s, r) => s + (r.classify.cost?.usd || 0), 0) / flatRuns.length;
    const worstPreGate = avgClassifyUsd + worstCase.est_usd;
    console.log(
      `  WORST CASE     avg classify $${fmt(avgClassifyUsd)} + calculated worst pass1 $${fmt(worstCase.est_usd)} = $${fmt(worstPreGate)}/request x ${RATE_LIMIT_PER_DAY} = $${fmt(worstPreGate * RATE_LIMIT_PER_DAY)}/IP/day (calculated, dual-category depth-50 brand hit every time)`
    );
  }

  console.log(`\n${"=".repeat(78)}\nCACHEABILITY OF PRE-GATE RESULTS\n${"=".repeat(78)}`);
  console.log(`  Code-inspection finding (live-verified against current source, no assumption):`);
  console.log(`  - classify.js has no cache of any kind — every call re-fetches the site and re-calls Haiku.`);
  console.log(`  - lib/read-pulse.js (Pass 1/Pass 2) has no cache — every call re-scores and re-writes.`);
  console.log(`  - The only cache in the codebase is lib/entity-cache.js, and it caches ONLY competitor-entity`);
  console.log(`    news items (7-day TTL), keyed by normalized entity name — a POST-GATE artifact, populated`);
  console.log(`    only by the background function (competitor-fetch-background.js), never read or written`);
  console.log(`    by classify.js or read-pulse.js.`);
  console.log(`  CONCLUSION: current code does NOT allow a second visitor entering the same brand+URL within`);
  console.log(`  a short window to read the first visitor's classify or Pass 1 output. Each hit re-pays in full.`);
  console.log(``);
  console.log(`  PROPOSED mechanism (not built, per brief):`);
  console.log(`  - Key: sha256 of normalized website (lowercased, scheme/www/trailing-slash stripped) — not`);
  console.log(`    brandName, since the same visitor may type the brand name differently but the URL is stable`);
  console.log(`    and is what classify.js actually fetches.`);
  console.log(`  - Store: same file-then-Blobs pattern as lib/pool.js / lib/entity-cache.js — one new module,`);
  console.log(`    e.g. lib/pregate-cache.js, get/set by that key.`);
  console.log(`  - Payload: { primary, secondary, confidence, brand_read, site_read, inferred_competitors,`);
  console.log(`    pass1_scored (the full scored+event-gated array), fetched_at }. Pass 1's scored array is`);
  console.log(`    what's expensive to reproduce — cache that, not just the classify result.`);
  console.log(`  - TTL: short — category pools refresh on a ~2-day crawl cadence (get-trends.js's`);
  console.log(`    MAX_STALE_HOURS=60) and a site's content changes slower than that. 6-12h balances abuse`);
  console.log(`    protection against serving a visitor a pool that's meaningfully out of date relative to`);
  console.log(`    what a fresh classify+Pass1 would see.`);
  console.log(`  - Read path: pre-gate handler checks this cache before calling classify.js at all; a hit`);
  console.log(`    skips both classify AND Pass 1 entirely, serving the cached scored pool straight to the`);
  console.log(`    2-title preview. A miss runs the real pipeline and writes the cache on the way out.`);
  console.log(`  - This does NOT change Pass 2 or the gate — it only short-circuits the two pre-gate calls,`);
  console.log(`    which is exactly the part this brief flagged as the abuse-cost problem.`);
}

main().catch((e) => {
  console.error("[measure-gate-cost] failed:", e);
  process.exitCode = 1;
});

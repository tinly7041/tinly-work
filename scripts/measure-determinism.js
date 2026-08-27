#!/usr/bin/env node
// scripts/measure-determinism.js
//
// Fix-pass brief, items 2a/2b — MEASURE ONLY, no fix implemented here.
//
// Two modes:
//
//   --pass1 mode: freezes classify + category pool + competitor items ONCE,
//   then calls generatePulseRead N times against the EXACT same frozen
//   inputs. This isolates Pass 1/Pass 2's own determinism from classify's —
//   brand mode in competitor-report.js re-classifies (and can re-infer
//   competitors) on every run, which would confound this measurement.
//     node scripts/measure-determinism.js --pass1 --brand "Wise" --url wise.com --runs 3
//     node scripts/measure-determinism.js --pass1 --brand "Notion" --url notion.so --runs 3
//
//   --classify mode: calls classifyBrand N times with identical input,
//   reports primary/secondary each time.
//     node scripts/measure-determinism.js --classify --brand "Notion" --url notion.so --runs 3
//
// Requires ANTHROPIC_API_KEY. Reads category pools from .cache/ — does NOT
// reseed them (per instruction: freeze the pool between runs).

import { classifyBrand } from "../netlify/functions/lib/classify.js";
import { loadCategoryPool } from "../netlify/functions/lib/pool.js";
import { generatePulseRead } from "../netlify/functions/lib/read-pulse.js";
import { refreshCompetitorEntity } from "../netlify/functions/lib/competitor-fetch.js";

function parseArgs(argv) {
  const args = { mode: null, brand: null, url: null, competitor: null, runs: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pass1") args.mode = "pass1";
    else if (a === "--classify") args.mode = "classify";
    else if (a === "--brand") args.brand = argv[++i];
    else if (a === "--url") args.url = argv[++i];
    else if (a === "--competitor") args.competitor = argv[++i];
    else if (a === "--runs") args.runs = Number(argv[++i]);
  }
  return args;
}

async function safeLoadPool(catKey) {
  if (!catKey) return null;
  try {
    return await loadCategoryPool(catKey);
  } catch {
    return null;
  }
}

async function runClassifyMode(args) {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    console.error("ANTHROPIC_API_KEY is not set.");
    process.exitCode = 1;
    return;
  }
  console.log(`classifyBrand x${args.runs}, identical input each time: brandName="${args.brand}", website="${args.url}"\n`);
  for (let i = 1; i <= args.runs; i++) {
    const cls = await classifyBrand({ brandName: args.brand, website: args.url, anthropicApiKey });
    console.log(`[run ${i}] primary=${cls.primary} secondary=${cls.secondary || "null"} confidence=${cls.confidence} inferred_competitors=${JSON.stringify(cls.inferred_competitors)}`);
  }
}

async function runPass1Mode(args) {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    console.error("ANTHROPIC_API_KEY is not set.");
    process.exitCode = 1;
    return;
  }

  // Freeze classify ONCE — this run's category/brand_read/competitors is
  // the fixed input for every one of the N read-pulse runs below.
  const cls = await classifyBrand({ brandName: args.brand, website: args.url, anthropicApiKey });
  console.log(`Frozen classify (called once): primary=${cls.primary} secondary=${cls.secondary || "null"} confidence=${cls.confidence}`);

  const primaryPool = await safeLoadPool(cls.primary);
  const secondaryPool = cls.secondary ? await safeLoadPool(cls.secondary) : null;
  console.log(`Frozen pools (read from .cache/, NOT reseeded): primary=${primaryPool?.items?.length ?? "MISSING"} items, secondary=${secondaryPool?.items?.length ?? "n/a"} items`);

  const competitorNames = args.competitor ? [args.competitor] : cls.inferred_competitors || [];
  const competitorsSource = args.competitor ? "user" : "inferred";
  const competitors = competitorNames.map((name) => ({ name, source: competitorsSource }));

  // Freeze competitor items ONCE too (force a live fetch this one time, then
  // every subsequent call in this process reads the now-fresh cache — no
  // --refresh on later reads, so the SAME items feed every run).
  const competitorResults = [];
  for (const name of competitorNames) {
    const r = await refreshCompetitorEntity(name, cls.primary, { force: true });
    competitorResults.push({ name, ...r });
  }
  const competitorItems = competitorResults.flatMap((r) => r.items || []);
  console.log(`Frozen competitor items (called once): ${competitorNames.join(", ") || "(none)"} — ${competitorItems.length} total items`);
  console.log("");

  console.log(`generatePulseRead x${args.runs}, identical frozen input each time:\n`);
  for (let i = 1; i <= args.runs; i++) {
    const { result, debug } = await generatePulseRead({
      brandName: args.brand,
      website: args.url,
      brandRead: cls.brand_read,
      primaryCategory: cls.primary,
      secondaryCategory: cls.secondary,
      primaryPool,
      secondaryPool,
      competitors,
      competitorItems,
      anthropicApiKey,
    });
    const directCount = result.items?.filter((it) => it.relevance === "direct").length || 0;
    const pass = debug.standards?.pass;
    const parseAttempts = debug.pass2?.parse_attempts ?? "n/a";
    const recovered = debug.pass2?.recovered_by_retry;
    console.log(`[run ${i}] pass1_direct=${debug.pass1?.score_distribution?.direct ?? "n/a"} pass1_indirect=${debug.pass1?.score_distribution?.indirect ?? "n/a"} pass1_none=${debug.pass1?.score_distribution?.none ?? "n/a"} | final_direct=${directCount} | standards=${pass ? "PASS" : `FAIL(${debug.standards?.failed_standard})`} | pass2_parse_attempts=${parseAttempts}${recovered ? " (RECOVERED BY RETRY)" : ""}`);
    if (!result.quiet) {
      for (const it of result.items) console.log(`         [${it.relevance}] ${it.headline}`);
    } else {
      console.log(`         (quiet: ${result.pulse_summary})`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "classify") return runClassifyMode(args);
  if (args.mode === "pass1") return runPass1Mode(args);
  console.error(
    'Usage:\n  node scripts/measure-determinism.js --pass1 --brand "<name>" --url <domain> [--competitor "<name>"] --runs <N>\n  node scripts/measure-determinism.js --classify --brand "<name>" --url <domain> --runs <N>'
  );
  process.exitCode = 1;
}

main().catch((e) => {
  console.error("[measure-determinism] failed:", e);
  process.exitCode = 1;
});

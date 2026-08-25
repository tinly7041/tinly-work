#!/usr/bin/env node
// scripts/generate-report.js
//
// Backend CLI harness for the Phase 2.5 trend-pulse report. No frontend, no
// gate, no lead capture — skips Turnstile, IP rate limiting, Apps Script,
// email, and all four UI states (those are Phase 3.5/4).
//
// Chain: classify (with live site fetch) -> load pool from .cache/ (falls
// back to Blobs) -> Sonnet read -> enforce action standards -> print.
//
// Usage:
//   node scripts/generate-report.js --brand "Avis" --url avis.xyz
//   node scripts/generate-report.js --brand "Avis" --url avis.xyz --json
//   node scripts/generate-report.js --brand "Avis" --url avis.xyz --debug

import { classifyBrand, CLASSIFY_MODEL } from "../netlify/functions/lib/classify.js";
import { loadCategoryPool } from "../netlify/functions/lib/pool.js";
import { generatePulseRead } from "../netlify/functions/lib/read-pulse.js";
import { CATEGORIES } from "../netlify/functions/lib/categories.js";
import { computeCost } from "../netlify/functions/lib/pricing.js";

function parseArgs(argv) {
  const args = { brand: null, url: null, json: false, debug: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--brand") args.brand = argv[++i];
    else if (a === "--url") args.url = argv[++i];
    else if (a === "--json") args.json = true;
    else if (a === "--debug") args.debug = true;
  }
  return args;
}

// The harness reads cache, never crawls. If a category has no local file and
// no Blobs entry (or Blobs isn't configured in this environment at all — the
// normal case running locally outside a Netlify site context), that's a real
// "no pool" state, not a crash.
async function safeLoadPool(catKey) {
  if (!catKey) return { pool: null, error: null };
  try {
    const pool = await loadCategoryPool(catKey);
    return { pool, error: pool ? null : "no cache file and no Blobs entry" };
  } catch (e) {
    return { pool: null, error: e.message };
  }
}

function formatReport({ brandName, website, cls, read }) {
  const categoryLabel = CATEGORIES[cls.primary]?.label || cls.primary;
  const secondaryLabel = cls.secondary ? ` + ${CATEGORIES[cls.secondary]?.label || cls.secondary}` : "";

  const lines = [];
  lines.push(`TREND PULSE — ${brandName} (${website})`);
  lines.push(`Category: ${categoryLabel}${secondaryLabel} · Confidence: ${cls.confidence} · Site read: ${cls.site_read ? "yes" : "no"}`);
  lines.push("");
  lines.push(cls.brand_read);
  lines.push("");
  lines.push("---");
  lines.push("");

  if (read.quiet) {
    lines.push(read.pulse_summary);
    lines.push("");
    lines.push("(category is quiet this cycle — no items cleared the action standard; run with --debug to see why)");
    return lines.join("\n");
  }

  lines.push(read.pulse_summary);
  lines.push("");
  read.items.forEach((item, idx) => {
    lines.push(`${idx + 1}. ${item.headline} — ${item.relevance} · ${item.effort}`);
    lines.push(`   ${item.url}`);
    lines.push(`   Why now: ${item.why_now}`);
    lines.push(`   So what: ${item.so_what}`);
    lines.push(`   Payoff: ${item.payoff}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

function formatDebug({ cls, primaryPoolInfo, secondaryPoolInfo, readDebug, classifyCost }) {
  const lines = ["", "=== DEBUG ===", "", "Classifier:"];
  lines.push(`  primary: ${cls.primary}`);
  lines.push(`  secondary: ${cls.secondary}`);
  lines.push(`  confidence: ${cls.confidence}`);
  lines.push(`  site_read: ${cls.site_read}`);
  lines.push(`  brand_read: ${cls.brand_read}`);
  lines.push("");
  lines.push("Pool:");

  const poolLine = (label, key, info) => {
    if (!key) return null;
    const size = info.pool?.items?.length ?? 0;
    const meta = info.pool
      ? `source=${info.pool._source}, healthy=${info.pool.health?.healthy}`
      : info.error || "missing";
    return `  ${label} (${key}): ${size} items — ${meta}`;
  };
  lines.push(poolLine("primary", cls.primary, primaryPoolInfo));
  const secLine = poolLine("secondary", cls.secondary, secondaryPoolInfo);
  if (secLine) lines.push(secLine);
  lines.push(
    `  combined after cross-category dedupe: ${readDebug.pool_size ?? 0} items (${
      readDebug.cross_category_dupes_removed ?? 0
    } cross-category dupes removed)`
  );

  lines.push("");
  lines.push("Pass 1 (scoring):");
  if (readDebug.pass1) {
    const d = readDebug.pass1.score_distribution;
    lines.push(`  model: ${readDebug.pass1.model}`);
    if (d) {
      lines.push(`  scored: ${d.total} total — direct: ${d.direct}, indirect: ${d.indirect}, none: ${d.none}`);
      lines.push(`  top 10 scores: ${JSON.stringify(d.top_10_scores)}`);
    }
    const ev = readDebug.pass1.is_event;
    if (ev) {
      lines.push(`  is_event gate: ${ev.in} in / ${ev.dropped} dropped / ${ev.out} out`);
      if (ev.dropped_titles.length) {
        lines.push("  dropped titles:");
        for (const t of ev.dropped_titles) lines.push(`    - ${t}`);
      }
    }
  } else {
    lines.push("  (not run — pool was empty)");
  }

  lines.push("");
  lines.push("Pass 2 (write):");
  if (readDebug.pass2) {
    lines.push(`  model: ${readDebug.pass2.model}`);
    const downgrades = readDebug.pass2.relevance_downgrades || [];
    const payoffDrops = readDebug.pass2.payoff_violations_dropped || [];
    lines.push(`  relevance downgrades applied: ${downgrades.length}${downgrades.length ? " — " + JSON.stringify(downgrades) : ""}`);
    lines.push(`  payoff violations dropped: ${payoffDrops.length}${payoffDrops.length ? " — " + JSON.stringify(payoffDrops) : ""}`);
  } else {
    lines.push("  (not run — no items scored above 'none')");
  }

  lines.push("");
  lines.push("Action standards:");
  lines.push(`  final item count: ${readDebug.raw_item_count ?? 0}`);
  if (readDebug.standards) {
    if (readDebug.standards.pass) {
      lines.push(`  direct: ${readDebug.standards.direct_count}, unique sources: ${readDebug.standards.unique_sources}`);
      lines.push("  result: PASS");
    } else {
      lines.push(`  result: FAIL — ${readDebug.standards.failed_standard} (${readDebug.standards.detail || "n/a"})`);
    }
  }

  lines.push("");
  lines.push("Token usage & cost:");
  if (classifyCost) {
    lines.push(`  classify (${classifyCost.model}): ${classifyCost.input_tokens} in / ${classifyCost.output_tokens} out = $${classifyCost.usd}`);
  }
  if (readDebug.pass1?.cost) {
    const c = readDebug.pass1.cost;
    lines.push(`  pass1 (${c.model}): ${c.input_tokens} in / ${c.output_tokens} out = $${c.usd}`);
  }
  if (readDebug.pass2?.cost) {
    const c = readDebug.pass2.cost;
    lines.push(`  pass2 (${c.model}): ${c.input_tokens} in / ${c.output_tokens} out = $${c.usd}`);
  }
  const total = (classifyCost?.usd || 0) + (readDebug.total_cost || 0);
  lines.push(`  total: $${total.toFixed(6)}`);

  return lines.filter((l) => l !== null).join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.brand || !args.url) {
    console.error('Usage: node scripts/generate-report.js --brand "<name>" --url <domain> [--json] [--debug]');
    process.exitCode = 1;
    return;
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    console.error("ANTHROPIC_API_KEY is not set.");
    process.exitCode = 1;
    return;
  }

  const cls = await classifyBrand({ brandName: args.brand, website: args.url, anthropicApiKey });

  const primaryPoolInfo = await safeLoadPool(cls.primary);
  const secondaryPoolInfo = cls.secondary ? await safeLoadPool(cls.secondary) : { pool: null, error: null };

  const { result: read, debug: readDebug } = await generatePulseRead({
    brandName: args.brand,
    website: args.url,
    brandRead: cls.brand_read,
    primaryCategory: cls.primary,
    secondaryCategory: cls.secondary,
    primaryPool: primaryPoolInfo.pool,
    secondaryPool: secondaryPoolInfo.pool,
    anthropicApiKey,
  });

  const classifyCost = computeCost(cls._usage, cls._model || CLASSIFY_MODEL);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          classify: {
            primary: cls.primary,
            secondary: cls.secondary,
            confidence: cls.confidence,
            brand_read: cls.brand_read,
            site_read: cls.site_read,
          },
          read,
        },
        null,
        2
      )
    );
  } else {
    console.log(formatReport({ brandName: args.brand, website: args.url, cls, read }));
  }

  if (args.debug) {
    console.log(formatDebug({ cls, primaryPoolInfo, secondaryPoolInfo, readDebug, classifyCost }));
  }
}

main().catch((e) => {
  console.error("[generate-report] failed:", e);
  process.exitCode = 1;
});

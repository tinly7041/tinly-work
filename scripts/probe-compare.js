#!/usr/bin/env node
// Phase 2B — side-by-side comparison. EVALUATION ONLY.
// Reddit and X columns come from probe-reddit.json / probe-x.json (run those
// scripts first). HN is fetched live via the existing, already-shipped
// netlify/functions/lib/sources/hn.js — the control, since it's the only
// current source producing usable items. No ranking, no percentile, no
// round-robin: raw score and raw age only, straight comparison.
//
//   node scripts/probe-reddit.js --json > probe-reddit.json
//   node scripts/probe-x.js --json > probe-x.json
//   node scripts/probe-compare.js

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { CATEGORIES, ACTIVE } from "../netlify/functions/lib/categories.js";

const { fetchHN } = await import(
  pathToFileURL(resolve(process.cwd(), "netlify/functions/lib/sources/hn.js")).href
);

function loadJSON(path) {
  const full = resolve(process.cwd(), path);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, "utf8"));
}

const redditData = loadJSON("probe-reddit.json");
const xData = loadJSON("probe-x.json");

function ageDays(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Number(((Date.now() - t) / 864e5).toFixed(2)) : null;
}

function redditRows(cat) {
  const entry = redditData?.find((c) => c.category === cat);
  if (!entry || !entry.posts?.length) return { rows: [], note: entry ? "0 items (see errors in probe-reddit.json)" : "probe-reddit.json missing this category" };
  const rows = entry.posts.slice(0, 10).map((p) => ({
    title: p.title,
    url: p.url || p.permalink, // display fallback only — raw dual-url data lives in probe-reddit.json
    score: p.score,
    age_days: ageDays(p.created_utc),
  }));
  return { rows, note: null };
}

function xRows() {
  const items = xData?.result?.items;
  if (!items || !items.length) {
    const reason = xData?.hasToken
      ? "token present but no trend items returned — see probe-x.json steps"
      : "no X_BEARER_TOKEN — no request could be made";
    return { rows: [], note: reason };
  }
  // X trends carry no per-item timestamp — age is not computable from this shape.
  const rows = items.slice(0, 10).map((t) => ({
    title: t.name,
    url: t.url || `https://x.com/search?q=${encodeURIComponent(t.name)}`,
    score: t.tweet_volume ?? null,
    age_days: null,
  }));
  return { rows, note: null };
}

async function hnRows(cat) {
  const cfg = CATEGORIES[cat];
  const items = await fetchHN(cfg);
  items.sort((a, b) => (b.raw ?? 0) - (a.raw ?? 0));
  return items.slice(0, 10).map((i) => ({
    title: i.title,
    url: i.url,
    score: i.raw,
    age_days: ageDays(i.date),
  }));
}

function printTable(label, rows, note) {
  console.log(`\n  -- ${label} --`);
  if (note) console.log(`     (${note})`);
  if (!rows.length) return;
  rows.forEach((r, i) =>
    console.log(
      `  ${String(i + 1).padStart(2)}. [score ${String(r.score ?? "?").padStart(6)}] [${String(r.age_days ?? "?").padStart(5)}d] ${(r.title || "").slice(0, 60).padEnd(60)} ${r.url || ""}`
    )
  );
}

const out = [];
for (const cat of ACTIVE) {
  const reddit = redditRows(cat);
  const x = xRows();
  const hn = await hnRows(cat);

  out.push({ category: cat, reddit: reddit.rows, reddit_note: reddit.note, x: x.rows, x_note: x.note, hn });

  console.log(`\n${"=".repeat(80)}\n${cat}\n${"=".repeat(80)}`);
  printTable("REDDIT (top 10)", reddit.rows, reddit.note);
  printTable("X (top 10)", x.rows, x.note);
  printTable("HN — CONTROL (top 10)", hn, null);
}

if (process.argv.includes("--json")) {
  console.log("\n" + JSON.stringify(out, null, 2));
}

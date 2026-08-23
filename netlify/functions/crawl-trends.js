import { getStore } from "@netlify/blobs";
import { ACTIVE } from "./lib/categories.js";
import { collect } from "./lib/collect.js";
import { getXListBilling } from "./lib/sources/x-list.js";
import { _resetFailures, _failures } from "./lib/sources/_http.js";

// Store name is namespaced via env var so a staging deploy can never write
// into production's cache — verified before the first staging run, not
// after (see Step 3 report). Defaults to "trends" so production, which sets
// no override, is completely unaffected.
const STORE_NAME = process.env.BLOBS_STORE_NAME || "trends";
const TRIAL_LOG_KEY = "trial-log";

function scoreStats(items, source) {
  const scores = items.filter((i) => i.source === source).map((i) => i.score);
  if (!scores.length) return null;
  const sorted = [...scores].sort((a, b) => a - b);
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
  };
}

// Daily scheduled crawl. This is the ONLY place a source is ever called.
// The user request path (get-trends.js) reads Blobs and nothing else.
export default async () => {
  const store = getStore(STORE_NAME);
  const report = [];
  const today = new Date().toISOString().slice(0, 10);
  const dayEntries = [];

  for (const cat of ACTIVE) {
    _resetFailures();
    try {
      const result = await collect(cat);
      await store.setJSON(cat, { fetched_at: new Date().toISOString(), ...result });
      report.push({ cat, ...result.health });
      console.log(`[crawl] ${cat}`, JSON.stringify(result.health));

      const perSourceScoreStats = {};
      for (const src of new Set(result.items.map((i) => i.source))) {
        perSourceScoreStats[src] = scoreStats(result.items, src);
      }
      const corroborated = result.items
        .filter((i) => (i.corroborated_sources?.length ?? 1) > 1)
        .map((i) => ({ title: i.title, sources: i.corroborated_sources }));

      dayEntries.push({
        category: cat,
        error: null,
        health: result.health,
        per_source_score_stats: perSourceScoreStats,
        corroborated,
        failures: [..._failures],
      });
    } catch (e) {
      // Do NOT overwrite the existing blob on failure. Yesterday's cache beats
      // an empty one — the read path must always have something to serve.
      console.error(`[crawl] ${cat} FAILED, keeping previous blob — ${e.message}`);
      report.push({ cat, error: e.message });
      dayEntries.push({ category: cat, error: e.message, failures: [..._failures] });
    }
  }

  // X List's fetch is process-wide (once per crawl, not per category) — log
  // it once at the day level rather than duplicating it under every category.
  const xList = getXListBilling();

  const existingLog = (await store.get(TRIAL_LOG_KEY, { type: "json" })) || [];
  existingLog.push({ date: today, ran_at: new Date().toISOString(), categories: dayEntries, x_list: xList });
  await store.setJSON(TRIAL_LOG_KEY, existingLog);

  return new Response(JSON.stringify({ ran_at: new Date().toISOString(), report }), {
    headers: { "content-type": "application/json" },
  });
};

export const config = { schedule: "@daily" };

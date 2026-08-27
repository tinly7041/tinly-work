import { getStore } from "@netlify/blobs";
import { ACTIVE } from "./lib/categories.js";
import { collect } from "./lib/collect.js";
import { getXListBilling } from "./lib/sources/x-list.js";
import { _resetFailures, _failures } from "./lib/sources/_http.js";
import { shouldRunCategory, nextState, shouldSendHeartbeat, buildCategorySummary, evaluateAlerts, formatAlertEmail } from "./lib/health.js";

// Store name is namespaced via env var so a staging deploy can never write
// into production's cache — verified before the first staging run, not
// after (see Step 3 report). Defaults to "trends" so production, which sets
// no override, is completely unaffected.
const STORE_NAME = process.env.BLOBS_STORE_NAME || "trends";
const TRIAL_LOG_KEY = "trial-log";
const CRAWL_STATE_KEY = "crawl-state";

// Apps Script POST — same pattern as generate-pulse.js's postReportToAppsScript,
// duplicated rather than shared because that file is CommonJS (`require`) and
// this one is ESM (`import`) under this repo's mixed module setup; not worth
// an out-of-scope module-system unification for one shared POST helper.
async function postHealthAlert(fetchImpl, appsScriptUrl, appsScriptSecret, { subject, body }) {
  const res = await fetchImpl(appsScriptUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: appsScriptSecret, action: "health", subject, body }),
  });
  if (!res.ok) throw new Error(`Apps Script health POST responded ${res.status}`);
  return res;
}

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

// Cron stays @daily — see lib/health.js's file header for why "every 2 days,
// retry next day on failure" has to live in code (shouldRunCategory) rather
// than in the schedule string. A day where every category is skipped
// (not due, nothing failed) costs one cheap Blobs read and returns; it never
// touches a source.
//
// This is the ONLY place a source is ever called. The user request path
// (get-trends.js) reads Blobs and nothing else.
export default async (req, { fetchImpl = fetch, getStoreImpl = getStore } = {}) => {
  const store = getStoreImpl(STORE_NAME);
  const report = [];
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  const dayEntries = [];

  const crawlState = (await store.get(CRAWL_STATE_KEY, { type: "json" })) || {};
  const categorySummaries = [];

  for (const cat of ACTIVE) {
    const catState = crawlState[cat];
    if (!shouldRunCategory(catState)) {
      report.push({ cat, skipped: "not_due" });
      dayEntries.push({ category: cat, skipped: "not_due" });
      categorySummaries.push(buildCategorySummary({ category: cat, outcome: "skipped_not_due", state: catState }));
      continue;
    }

    _resetFailures();
    try {
      const result = await collect(cat);
      await store.setJSON(cat, { fetched_at: nowIso, ...result });
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
      crawlState[cat] = nextState(catState, true, nowIso);
      categorySummaries.push(
        buildCategorySummary({ category: cat, outcome: "ok", result, failures: [..._failures], state: crawlState[cat] })
      );
    } catch (e) {
      // Do NOT overwrite the existing blob on failure. Yesterday's cache beats
      // an empty one — the read path must always have something to serve.
      console.error(`[crawl] ${cat} FAILED, keeping previous blob — ${e.message}`);
      report.push({ cat, error: e.message });
      dayEntries.push({ category: cat, error: e.message, failures: [..._failures] });
      crawlState[cat] = nextState(catState, false, nowIso);
      categorySummaries.push(buildCategorySummary({ category: cat, outcome: "failed", error: e.message, state: crawlState[cat] }));
    }
  }

  await store.setJSON(CRAWL_STATE_KEY, crawlState);

  // X List's fetch is process-wide (once per crawl, not per category) — log
  // it once at the day level rather than duplicating it under every category.
  const xList = getXListBilling();

  const existingLog = (await store.get(TRIAL_LOG_KEY, { type: "json" })) || [];
  existingLog.push({ date: today, ran_at: nowIso, categories: dayEntries, x_list: xList });
  await store.setJSON(TRIAL_LOG_KEY, existingLog);

  // Health alert — alert-only, never on plain success. See lib/health.js for
  // the condition list; the weekly heartbeat is unconditional so silence
  // elsewhere reads as "healthy," not "the alerter died."
  const alerts = evaluateAlerts(categorySummaries);
  const heartbeatState = crawlState.__heartbeat;
  const isHeartbeat = shouldSendHeartbeat(heartbeatState);
  if ((alerts.length || isHeartbeat) && process.env.APPS_SCRIPT_URL && process.env.APPS_SCRIPT_SECRET) {
    const { subject, body } = formatAlertEmail({ ranAt: nowIso, categorySummaries, alerts, isHeartbeat });
    try {
      await postHealthAlert(fetchImpl, process.env.APPS_SCRIPT_URL, process.env.APPS_SCRIPT_SECRET, { subject, body });
      if (isHeartbeat) {
        crawlState.__heartbeat = { lastSentAt: nowIso };
        await store.setJSON(CRAWL_STATE_KEY, crawlState);
      }
    } catch (e) {
      // The alert itself failing must not fail the crawl — the crawl result
      // is already durably written above regardless of whether anyone got
      // told about it.
      console.error("[crawl] health alert POST failed —", e.message);
    }
  }

  return new Response(JSON.stringify({ ran_at: nowIso, report, alerts }), {
    headers: { "content-type": "application/json" },
  });
};

export const config = { schedule: "@daily" };

// netlify/functions/lib/health.js
//
// Depth-50 brief, Step 4 — crawl cadence + health telemetry.
//
// PROPOSED SURFACE (see report for the write-up this shipped against):
// one per-crawl object, one entry per category, carrying exactly what the
// brief asked for and nothing invented beyond it: which sources succeeded,
// which failed, item counts per category, and cache age. Consumed by
// crawl-trends.js, which is the only caller — kept here, not inline, so the
// gating/alert logic is unit-testable without a live crawl (same reasoning
// as matcher.js / qualify.js sitting in lib/ instead of collect.js).
//
// Netlify scheduled functions have one static cron expression — there is no
// API to reschedule a run based on what the last one did. "Every 2 days,
// retry next day on failure" is therefore NOT encoded in the cron string
// (impossible: a schedule can't conditionally shorten itself). The cron
// stays `@daily` (crawl-trends.js's `config.schedule`) so the function is
// always eligible to run; shouldRunCategory() below is what actually makes
// it "every 2 days" in the common case — a day where nothing is due is a
// fast no-op, not a real crawl.

export const CADENCE_DAYS = 2;
export const STALE_HOURS = 72; // alert floor — see evaluateAlerts
export const HEARTBEAT_DAYS = 7;

function hoursSince(iso) {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 36e5;
}

// state shape (per category), persisted in Blobs under CRAWL_STATE_KEY:
//   { lastSuccessAt: iso|null, lastAttemptAt: iso|null, lastAttemptOk: boolean }
//
// Failure does not push the next attempt further out than a success would
// have — it pulls it IN to "tomorrow." A category that has never succeeded
// (no lastSuccessAt) or whose last attempt failed is always due; otherwise
// due once CADENCE_DAYS have passed since the last SUCCESS (not the last
// attempt — an attempt that failed isn't a reason to wait longer).
export function shouldRunCategory(state) {
  if (!state || !state.lastSuccessAt) return true;
  if (state.lastAttemptOk === false) return true;
  return hoursSince(state.lastSuccessAt) >= CADENCE_DAYS * 24;
}

export function nextState(prevState, ok, nowIso = new Date().toISOString()) {
  return {
    lastSuccessAt: ok ? nowIso : prevState?.lastSuccessAt || null,
    lastAttemptAt: nowIso,
    lastAttemptOk: ok,
  };
}

export function shouldSendHeartbeat(heartbeatState) {
  return hoursSince(heartbeatState?.lastSentAt) / 24 >= HEARTBEAT_DAYS;
}

// Canonicalizes a failure source name to the top-level adapter it belongs
// to — news-feeds records per-outlet failures ("newsfeeds:Ars Technica AI")
// so one dead feed is diagnosable, but "which sources succeeded/failed" at
// the category level should read as "newsfeeds", not 17 separate rows.
function topLevelSource(name) {
  return name.split(":")[0];
}

// One category's contribution to the per-crawl health summary. `outcome` is
// "ok" | "failed" | "skipped_not_due" — skipped categories carry no fresh
// counts (nothing ran) but still report cache age, since that's exactly the
// number that matters when a category has been skipped for a while.
export function buildCategorySummary({ category, outcome, result, error, failures, state }) {
  const cacheAgeHours = Number(hoursSince(state?.lastSuccessAt).toFixed(1));
  if (outcome === "skipped_not_due") {
    return { category, outcome, cache_age_hours: cacheAgeHours };
  }
  if (outcome === "failed") {
    return { category, outcome, error, cache_age_hours: cacheAgeHours };
  }
  const failedSources = [...new Set((failures || []).map((f) => topLevelSource(f.source)))];
  return {
    category,
    outcome,
    item_count: result.items.length,
    per_source_counts: result.health.per_source,
    healthy: result.health.healthy,
    sources_failed: failedSources,
    source_failure_detail: failures || [],
    cache_age_hours: cacheAgeHours,
  };
}

// Alert conditions, exactly as specified: any source failure, any category
// below the health floor, cache age > STALE_HOURS, or zero items in any
// category that actually ran. Never fires on success alone — that's the
// weekly heartbeat's job (checked separately, unconditionally, so silence
// elsewhere is distinguishable from a dead alerter rather than a quiet week).
export function evaluateAlerts(categorySummaries) {
  const alerts = [];
  for (const c of categorySummaries) {
    if (c.outcome === "failed") {
      alerts.push({ type: "crawl_failed", category: c.category, detail: c.error });
    }
    if (c.sources_failed?.length) {
      alerts.push({ type: "source_failure", category: c.category, detail: c.sources_failed.join(", ") });
    }
    if (c.outcome === "ok" && c.healthy === false) {
      alerts.push({ type: "health_floor", category: c.category, detail: `per_source=${JSON.stringify(c.per_source_counts)}` });
    }
    if (c.outcome === "ok" && c.item_count === 0) {
      alerts.push({ type: "zero_items", category: c.category, detail: "0 items in ranked cache" });
    }
    if (c.cache_age_hours > STALE_HOURS) {
      alerts.push({ type: "stale_cache", category: c.category, detail: `${c.cache_age_hours}h since last success` });
    }
  }
  return alerts;
}

export function formatAlertEmail({ ranAt, categorySummaries, alerts, isHeartbeat }) {
  const lines = [];
  if (isHeartbeat && !alerts.length) {
    lines.push("Weekly heartbeat — the trend-pulse crawl alerter is alive. No issues to report.");
  } else {
    lines.push(`${alerts.length} issue(s) found in the ${ranAt} crawl:`);
    lines.push("");
    for (const a of alerts) lines.push(`- [${a.type}] ${a.category}: ${a.detail}`);
  }
  lines.push("");
  lines.push("Per-category status:");
  for (const c of categorySummaries) {
    if (c.outcome === "skipped_not_due") {
      lines.push(`  ${c.category}: skipped (not due), cache age ${c.cache_age_hours}h`);
    } else if (c.outcome === "failed") {
      lines.push(`  ${c.category}: FAILED — ${c.error}, cache age ${c.cache_age_hours}h`);
    } else {
      lines.push(
        `  ${c.category}: ${c.item_count} items, healthy=${c.healthy}, per_source=${JSON.stringify(c.per_source_counts)}, cache age ${c.cache_age_hours}h${
          c.sources_failed.length ? `, failed sources: ${c.sources_failed.join(", ")}` : ""
        }`
      );
    }
  }
  const subject = isHeartbeat && !alerts.length
    ? "[trend-pulse] weekly heartbeat — all quiet"
    : `[trend-pulse] ${alerts.length} health alert(s) — ${ranAt}`;
  return { subject, body: lines.join("\n") };
}

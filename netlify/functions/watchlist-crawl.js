// netlify/functions/watchlist-crawl.js
//
// Action A — watchlist pre-warm. Weekly scheduled crawl into the SAME shared
// cache lib/entity-cache.js already exposes (lib/competitor-fetch.js's
// refreshCompetitorEntity), filtered at request time by whatever a lead
// actually names — this file adds no new cache, no new read path, just a
// proactive writer so the entities in lib/watchlist.js are usually already
// warm by the time a lead names one.
//
// Netlify scheduled functions carry one static cron expression (same
// platform constraint as crawl-trends.js/lib/health.js) — @weekly is the
// cadence, full stop, nothing conditional in code either: Google News RSS
// is a plain, free HTTP GET (confirmed $0 live, gate-cost-report.md), so
// there's no cost reason to skip an entity just because its old cache entry
// hasn't expired yet. Every run force-refreshes every watchlist entity.
//
// Fails soft, per-entity — same shape as competitor-fetch-background.js:
// one bad entity or a dead fetch must not stop the rest of the list.
//
// This is not the health/alert system category crawls use (crawl-trends.js,
// lib/health.js) — entity-cache failures already fail soft to an
// empty-but-fresh cache entry per lib/competitor-fetch.js's existing
// contract, and the brief doesn't ask for alerting on this crawl.

import { getStore } from "@netlify/blobs";
import { WATCHLIST_ENTITIES } from "./lib/watchlist.js";
import { refreshCompetitorEntity } from "./lib/competitor-fetch.js";

export default async (req, { getStoreImpl = getStore } = {}) => {
  const nowIso = new Date().toISOString();
  const results = [];

  for (const { entity, category } of WATCHLIST_ENTITIES) {
    try {
      const result = await refreshCompetitorEntity(entity, category, { getStore: getStoreImpl, force: true });
      const itemCount = result.items?.length || 0;
      console.log(
        `[watchlist-crawl] ${entity} (${category}): ${itemCount} item(s) — ${result.items
          ?.slice(0, 3)
          .map((i) => `"${i.title}"`)
          .join(", ") || "none"}`
      );
      results.push({ entity, category, ok: true, item_count: itemCount });
    } catch (e) {
      console.error(`[watchlist-crawl] ${entity} (${category}) FAILED — ${e.message}`);
      results.push({ entity, category, ok: false, error: e.message });
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`[watchlist-crawl] done: ${results.length - failed}/${results.length} entities refreshed ok`);

  return new Response(JSON.stringify({ ran_at: nowIso, results }), {
    headers: { "content-type": "application/json" },
  });
};

export const config = { schedule: "@weekly" };

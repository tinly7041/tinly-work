// netlify/functions/pulse-rescan.js
//
// Competitor-edit re-run (State 2 "Add competitors"). Takes the brand
// context + an updated competitor list, loads cache-only items for each,
// re-runs runPreGate with the updated set. Returns the same shape as
// pulse-preview.js so the frontend can swap in new results.
//
// Fires only on a cache hit — if zero competitor entities are cached,
// returns the unchanged pre-gate result (degrade to category-only).

import { getStore } from "@netlify/blobs";
import { loadCategoryPool } from "./lib/pool.js";
import { getCachedEntity } from "./lib/entity-cache.js";
import { runPreGate, ACTION_STANDARDS } from "./lib/read-pulse.js";
import { classifyQuiet } from "./lib/quiet-taxonomy.js";

const MAX_STALE_HOURS = 60;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const { brandName, website, brandRead, primaryCategory, secondaryCategory, competitors: rawCompetitors } = body;
  if (!brandName || !primaryCategory) return json(400, { error: "missing_fields" });

  const competitors = (rawCompetitors || []).map((c) =>
    typeof c === "string" ? { name: c, source: "user" } : c
  );

  // Load category pools
  const primaryPool = await loadCategoryPool(primaryCategory, { getStore });
  const secondaryPool = secondaryCategory ? await loadCategoryPool(secondaryCategory, { getStore }) : null;

  const poolAgeHours = primaryPool?.fetched_at ? (Date.now() - Date.parse(primaryPool.fetched_at)) / 3_600_000 : Infinity;
  const poolStale = poolAgeHours > MAX_STALE_HOURS;
  const poolThin = primaryPool?.health?.healthy === false;

  // Load competitor items — cache only, never fetch
  const competitorItems = [];
  for (const comp of competitors) {
    try {
      const cached = await getCachedEntity(comp.name, { getStore });
      if (cached?.items) {
        for (const item of cached.items) {
          competitorItems.push({ ...item, entity: comp.name });
        }
      }
    } catch {
      // Cache miss — degrade silently
    }
  }

  // Fires only on a cache hit. Zero hits means none of the edited
  // competitor names have anything in the entity cache yet (a brand-new
  // name the weekly watchlist crawl hasn't reached, or a typo) — re-running
  // Pass 1 here would burn a Haiku call for a pool that's byte-identical to
  // what pulse-preview.js already scored. No-op instead: echo the updated
  // competitor list back so the client can render it, but leave the
  // existing pre-gate results (preGateItems/top) untouched client-side.
  if (competitorItems.length === 0) {
    return json(200, {
      status: "no_change",
      reason: "no_cache_hit",
      brand: brandName,
      website,
      category: primaryCategory,
      secondaryCategory,
      brandRead,
      competitors: competitors.map((c) => ({ name: c.name, source: c.source })),
    });
  }

  // Re-run pre-gate with updated competitor set
  const preGate = await runPreGate({
    primaryPool,
    secondaryPool,
    competitorItems,
    brandName,
    website,
    brandRead,
    primaryCategory,
    secondaryCategory,
    competitors,
    fetchImpl: fetch,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  const directCount = preGate.scored.filter((s) => s.relevance === "direct").length;
  const quietCause = classifyQuiet({
    poolThin,
    poolStale,
    competitorItemCount: competitorItems.length,
    direct: directCount,
    minDirect: ACTION_STANDARDS.minDirect,
  });

  const previewItems = preGate.top.slice(0, 2).map((s) => ({
    title: s.item.title,
    source: s.item.source,
    relevance: s.relevance,
  }));

  return json(200, {
    status: "ok",
    brand: brandName,
    website,
    category: primaryCategory,
    secondaryCategory,
    brandRead,
    competitors: competitors.map((c) => ({ name: c.name, source: c.source })),
    preGateItems: previewItems,
    quiet_cause: quietCause,
    top: preGate.top,
    debug: {
      pool_size: preGate.pool.length,
      competitor_item_count: competitorItems.length,
      pool_stale: poolStale,
      pool_thin: poolThin,
      pass1_cost: preGate.pass1Cost,
    },
  });
};

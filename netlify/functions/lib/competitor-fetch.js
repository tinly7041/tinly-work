// netlify/functions/lib/competitor-fetch.js
//
// Phase 2.7 — orchestrates one entity's competitor-news refresh: check the
// shared cache, and only call out to a live source when the cache is
// missing or stale. Called ONLY from the background function
// (netlify/functions/competitor-fetch-background.js), never from
// read-pulse.js or generate-pulse.js — "no source call in the user request
// path" is enforced by NOT calling this module from either of those, not by
// anything inside this file.
//
// Fails soft, always: a fetch failure here must never break the lead's
// report. If Google News errors or returns nothing, this writes (or leaves)
// an empty-but-fresh cache entry rather than throwing — read-pulse.js reads
// whatever the cache has (possibly nothing) and degrades to a normal quiet
// result exactly like a thin category pool does today. There is no
// "broken report" path.
//
// Fix-pass brief, item 1b: `status` on the cache entry distinguishes a
// genuine verdict from an unresolved one — see entity-cache.js for how the
// TTL responds to it. Values:
//   "ok"                     — real items, or confirmed empty after every
//                               retry attempt succeeded HTTP-wise
//   "empty_retries_exhausted" — every retry attempt succeeded but parsed to
//                               zero items — Google's intermittent-empty
//                               behavior, not a real "no coverage" verdict
//   "fetch_error"            — an HTTP/network error, or an orchestration-
//                               level error (e.g. an unknown categoryKey) —
//                               equally not a real verdict, same short TTL

import { getCachedEntity, setCachedEntity } from "./entity-cache.js";
import { fetchCompetitorNews } from "./sources/competitor-news.js";

export async function refreshCompetitorEntity(entityName, categoryKey, { getStore, force = false } = {}) {
  if (!force) {
    // A cache-read failure (e.g. Netlify Blobs unconfigured — the normal
    // case running this locally outside a Netlify site context) degrades to
    // "nothing cached," same as a genuine cache miss — it must not be
    // indistinguishable from every other failure mode this module already
    // fails soft on.
    let cached = null;
    try {
      cached = await getCachedEntity(entityName, { getStore });
    } catch (e) {
      console.warn(`[competitor-fetch] cache read failed for "${entityName}" — ${e.message}`);
    }
    if (cached) return { ...cached, from_cache: true };
  }

  let query = null;
  let items = [];
  let rejected = [];
  let error = null;
  let fetch_meta = null;
  try {
    ({ query, items, rejected, fetch_meta } = await fetchCompetitorNews(entityName, categoryKey));
  } catch (e) {
    // Reaching here means something outside the Google News call itself —
    // e.g. an unknown categoryKey thrown by buildCompetitorQuery. Degrade to
    // an empty result rather than let one bad entity kill the whole
    // background invocation.
    error = e.message;
  }

  const status = error || fetch_meta?.http_error ? "fetch_error" : fetch_meta?.exhausted_empty ? "empty_retries_exhausted" : "ok";
  // Fix-pass brief, item 1c: an empty window must be visible, not silent.
  if (status !== "ok") {
    console.warn(`[competitor-fetch] "${entityName}" (${categoryKey}) — status=${status}, fetch_meta=${JSON.stringify(fetch_meta)}, error=${error || "none"}`);
  }

  const entry = await setCachedEntity(entityName, { category: categoryKey, query, items, rejected, error, status, fetch_meta }, { getStore });
  return { ...entry, from_cache: false };
}

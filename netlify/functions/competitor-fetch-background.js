// netlify/functions/competitor-fetch-background.js
//
// POST { entities: [{ name, category }, ...] }
//
// Phase 2.7 — the ONLY place a competitor-entity source is ever called for a
// live lead, mirroring crawl-trends.js's role for category sources ("This is
// the ONLY place a source is ever called"). Runs AFTER the lead is stored —
// invoked fire-and-forget by whatever stores the lead (not built yet; see
// the Phase 2.7 report for why generate-pulse.js isn't wired to call this
// yet), never awaited inline in the user request path.
//
// Netlify background functions: the "-background" filename suffix is load-
// bearing, not decorative — it's what tells Netlify to run this async (up
// to 15 minutes, no request-path timeout) and respond 202 immediately,
// discarding whatever this handler returns. Uses the classic
// `exports.handler` signature (like classify-brand.js, generate-pulse.js)
// because that's the signature Netlify's background-function runtime
// requires; the v2 `export default` style crawl-trends.js/get-trends.js use
// is for scheduled/edge functions, a different mechanism.
//
// Fails soft, per-entity: one bad entity name or a dead source must not
// stop the rest of the list from refreshing.

import { refreshCompetitorEntity } from "./lib/competitor-fetch.js";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let entities;
  try {
    ({ entities } = JSON.parse(event.body || "{}"));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "invalid_json" }) };
  }

  if (!Array.isArray(entities) || !entities.length) {
    return { statusCode: 400, body: JSON.stringify({ error: "entities_required" }) };
  }

  const results = [];
  for (const { name, category } of entities) {
    try {
      const result = await refreshCompetitorEntity(name, category);
      results.push({
        name,
        category,
        ok: true,
        from_cache: result.from_cache,
        item_count: result.items?.length || 0,
        // Fix-pass brief, item 1c: surfaces the "ok" vs. "empty_retries_exhausted"
        // vs. "fetch_error" distinction here too, so an unresolved empty
        // window is visible in function logs, not indistinguishable from a
        // genuine quiet result.
        status: result.status,
        fetch_meta: result.fetch_meta,
      });
    } catch (e) {
      console.error(`[competitor-fetch-background] ${name} (${category}) failed —`, e.message);
      results.push({ name, category, ok: false, error: e.message });
    }
  }

  // Background functions discard the response body — logged for anyone
  // tailing function logs, not read by any caller.
  console.log("[competitor-fetch-background]", JSON.stringify(results));
  return { statusCode: 202, body: JSON.stringify({ status: "ok", results }) };
};

import { getStore } from "@netlify/blobs";
import { CATEGORIES } from "./lib/categories.js";

// Read path. Zero source calls. If the blob is missing or stale the caller gets
// told plainly — it does not trigger a live crawl. A user request must never be
// the thing that warms the cache.
// 2-day crawl cadence (see crawl-trends.js / lib/health.js) means cache age
// routinely reaches ~48h under normal, healthy operation — 36 fired `stale`
// through roughly half of every healthy cycle.
const MAX_STALE_HOURS = 60;
// Must match crawl-trends.js's STORE_NAME exactly, or the read path silently
// reads a different store than the one the crawl just wrote.
const STORE_NAME = process.env.BLOBS_STORE_NAME || "trends";

export default async (req) => {
  const url = new URL(req.url);
  const cat = (url.searchParams.get("category") || "").toLowerCase();
  if (!CATEGORIES[cat]) {
    return json({ error: "unknown_category", known: Object.keys(CATEGORIES) }, 400);
  }
  const store = getStore(STORE_NAME);
  const blob = await store.get(cat, { type: "json" });
  if (!blob) return json({ error: "cache_empty", category: cat }, 503);

  const ageHours = (Date.now() - Date.parse(blob.fetched_at)) / 36e5;
  return json({
    category: cat,
    label: blob.label,
    fetched_at: blob.fetched_at,
    stale: ageHours > MAX_STALE_HOURS,
    health: blob.health,
    items: blob.items,
  });
};

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

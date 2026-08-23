import { get, safe } from "./_http.js";

const API = "https://lobste.rs/hottest.json";

// Single global feed, no per-category query grammar (same shape as
// CoinGecko's "trending" endpoint) — registered wholesale into SaaS/DevTools
// per the Task 3 probe verdict, not keyword-filtered across categories.
// EVENT source: score is live, continuously-reranked community voting, and
// created_at is a real submission timestamp — confirmed live in the probe.
export async function fetchLobsters(cfg) {
  if (!cfg.lobsters) return [];
  return safe("lobsters", async () => {
    const stories = await get(API, { json: true });
    return (stories || [])
      .map((s) => ({
        title: s.title,
        url: s.url || s.comments_url,
        source: "lobsters",
        raw: s.score || 0,
        date: s.created_at,
      }))
      .filter((i) => i.title && i.url);
  });
}

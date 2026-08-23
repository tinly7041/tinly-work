import { get, safe } from "./_http.js";

const API = "https://api.dexscreener.com/latest/dex/search";

// Deliberately NOT token-boosts or token-profiles — those return a paid
// promo existing or a listing existing, the same "artifact" defect as
// GitHub. /latest/dex/search's priceChange.h1/h24 and volume.h24 are a real
// market-momentum EVENT signal: "this pair moved X% in the last hour",
// confirmed live in the Task 3 probe.
//
// No single "trending" listing exists at this endpoint — it's search-by-
// query, so it's run over Web3's own existing productHunt keyword list
// (reusing config already in categories.js rather than inventing a new
// keyword surface, same approach as the X List adapter).
export async function fetchDexScreener(cfg) {
  if (!cfg.dexscreener) return [];
  return safe("dexscreener", async () => {
    const queries = cfg.productHunt || [];
    const seen = new Map();
    for (const q of queries) {
      const j = await get(`${API}?q=${encodeURIComponent(q)}`, { json: true });
      for (const p of j?.pairs || []) {
        const key = p.pairAddress || p.url;
        if (!key || seen.has(key)) continue;
        const change24 = p.priceChange?.h24;
        const change1 = p.priceChange?.h1;
        const vol24 = p.volume?.h24 || 0;
        const symbol = `${p.baseToken?.symbol || "?"}/${p.quoteToken?.symbol || "?"}`;
        const fmtPct = (n) => (typeof n === "number" ? `${n >= 0 ? "+" : ""}${n}%` : "?");
        // A pair with no priceChange data at all carries zero momentum
        // signal — the whole reason this endpoint was chosen over
        // token-boosts/token-profiles. Serving "? (1h), ? (24h)" is the same
        // "artifact, not event" defect being fixed elsewhere; drop it.
        if (!p.url || (typeof change1 !== "number" && typeof change24 !== "number")) continue;
        seen.set(key, {
          title: `${symbol} ${fmtPct(change1)} (1h), ${fmtPct(change24)} (24h)`,
          url: p.url,
          source: "dexscreener",
          raw: vol24,
          // No per-event timestamp — priceChange/volume are rolling windows
          // ending now, not a moment. Same honesty call as coingecko.js:
          // date = fetch time, not invented.
          date: new Date().toISOString(),
        });
      }
    }
    return [...seen.values()];
  });
}

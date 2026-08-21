import { get, safe } from "./_http.js";

const API = "https://api.coingecko.com/api/v3/search/trending";

// Web3 only. Free tier, no key, ~10-30 req/min — a daily job is nowhere near it.
// No timestamp on the payload, so date = fetch time. Honest, not invented.
export async function fetchCoinGecko(cfg) {
  if (!cfg.coingecko) return [];
  return safe("coingecko", async () => {
    const j = await get(API, { json: true });
    const now = new Date().toISOString();
    const coins = (j.coins || []).map((c, i) => ({
      title: `${c.item.name} (${(c.item.symbol || "").toUpperCase()}) trending on CoinGecko`,
      url: `https://www.coingecko.com/en/coins/${c.item.id}`,
      source: "coingecko",
      raw: 20 - i, // CoinGecko returns pre-ranked; position is the score
      date: now,
    }));
    const cats = (j.categories || []).slice(0, 5).map((c, i) => ({
      title: `${c.name} sector trending on CoinGecko`,
      url: `https://www.coingecko.com/en/categories/${c.slug || c.id}`,
      source: "coingecko",
      raw: 10 - i,
      date: now,
    }));
    return [...coins, ...cats];
  });
}

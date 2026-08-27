import { get, safe } from "./_http.js";
import { recordNumericGate } from "../telemetry.js";

const API = "https://api.coingecko.com/api/v3/search/trending";

// Web3 only. Free tier, no key, ~10-30 req/min — a daily job is nowhere near it.
// No timestamp on the payload, so date = fetch time. Honest, not invented.
//
// STEP 6 DECISION (verified live 24 Aug, per brief instruction to check
// before building): /search/trending's coin entries DO carry a usable
// percentage — item.data.price_change_percentage_24h.usd — and a market cap
// at item.data.market_cap (a formatted string like "$55,384,318", parsed
// below). CoinGecko is NOT cut from the served path; unlike the sector
// "categories" entries this endpoint also returns (name + slug, no
// percentage, no market cap — the same "trending, no move attached" defect
// as the coin entries used to have, and as DexScreener's null-priceChange
// case), which ARE dropped entirely, same treatment Google Trends got and
// for the same reason: rank with no information.
const PCT_CHANGE_FLOOR = 10; // percent, absolute value
const MARKET_CAP_FLOOR = 50_000_000; // USD
const MAX_ITEMS = 3;

function parseUsd(s) {
  if (typeof s === "number") return s;
  if (typeof s !== "string") return NaN;
  return Number(s.replace(/[^0-9.-]/g, ""));
}

export async function fetchCoinGecko(cfg, { telemetry } = {}) {
  if (!cfg.coingecko) return [];
  return safe("coingecko", async () => {
    const j = await get(API, { json: true });
    const now = new Date().toISOString();

    const candidates = [];
    for (const c of j.coins || []) {
      const item = c.item;
      const pct = item?.data?.price_change_percentage_24h?.usd;
      const marketCap = parseUsd(item?.data?.market_cap);

      if (typeof pct !== "number" || !Number.isFinite(pct)) {
        if (telemetry) recordNumericGate(telemetry, "coingecko", "no_percentage");
        continue;
      }
      if (Math.abs(pct) < PCT_CHANGE_FLOOR) {
        if (telemetry) recordNumericGate(telemetry, "coingecko", "below_pct_change_floor");
        continue;
      }
      if (!Number.isFinite(marketCap) || marketCap < MARKET_CAP_FLOOR) {
        if (telemetry) recordNumericGate(telemetry, "coingecko", "below_market_cap_floor");
        continue;
      }

      const direction = pct >= 0 ? "up" : "down";
      candidates.push({
        title: `${item.name} ${direction} ${Math.abs(pct).toFixed(0)}% in 24h`,
        description: "",
        url: `https://www.coingecko.com/en/coins/${item.id}`,
        source: "coingecko",
        raw: Math.abs(pct),
        _absPct: Math.abs(pct),
        date: now,
      });
    }
    // The "categories" (sector) entries carry no percentage or market cap at
    // all — structurally cannot pass the gates above, so they are dropped
    // wholesale rather than looped over just to record every drop.
    if (telemetry && Array.isArray(j.categories) && j.categories.length) {
      for (let i = 0; i < j.categories.length; i++) recordNumericGate(telemetry, "coingecko", "no_percentage");
    }

    const kept = candidates.sort((a, b) => b._absPct - a._absPct).slice(0, MAX_ITEMS);
    const droppedByCap = candidates.length - kept.length;
    if (telemetry && droppedByCap > 0) {
      for (let i = 0; i < droppedByCap; i++) recordNumericGate(telemetry, "coingecko", "max_items_per_crawl");
    }
    return kept.map(({ _absPct, ...it }) => it);
  });
}

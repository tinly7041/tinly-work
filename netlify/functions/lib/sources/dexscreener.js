import { get, safe } from "./_http.js";
import { recordNumericGate } from "../telemetry.js";

const API = "https://api.dexscreener.com/latest/dex/search";

// Deliberately NOT token-boosts or token-profiles — those return a paid
// promo existing or a listing existing, the same "artifact" defect as
// GitHub. /latest/dex/search's priceChange.h1/h24 and volume.h24 are a real
// market-momentum EVENT signal: "this pair moved X% in the last hour",
// confirmed live in the Task 3 probe.
//
// No single "trending" listing exists at this endpoint — it's search-by-
// query. CATEGORY-GATES REWORK: the old `cfg.productHunt` keyword array this
// used to reuse for search queries is gone. Web3's `context` list (crypto,
// blockchain, Ethereum, Solana, Bitcoin, DeFi, ...) is a much better fit for
// this purpose anyway — it's a compact set of ecosystem/project names, which
// is what a token-pair search engine actually wants, versus `include`'s
// mostly-multi-word event phrases ("bridge exploit", "on-chain governance")
// that a symbol-matching search would rarely hit.
//
// STEP 6 GATES — this is where the 23 Aug defect actually lived: nine
// DexScreener rows on low-cap pairs with sub-1% moves (one with null data)
// were let through with no magnitude floor at all, then percentile-ranked
// to 0.80-0.84 purely because they were the top of a source with nothing
// else in it. Real thresholds, not percentile alone, fix that:
//   |priceChange.h24| >= 15%, liquidity.usd >= $250,000, volume.h24 >= $500,000
//   null priceChange.h24 -> drop (no percentage to gate on at all)
//   max 3 items per crawl, picked by largest |priceChange.h24|
// Title must carry the magnitude itself (`SOL/USDC down 19% in 24h on
// $2.1M volume`), not a bare pair symbol — the pair symbol alone is exactly
// the "artifact, not event" defect being fixed.
const PRICE_CHANGE_FLOOR = 15; // percent, absolute value
const LIQUIDITY_FLOOR = 250_000; // USD
const VOLUME_FLOOR = 500_000; // USD
const MAX_ITEMS = 3;

function fmtUsd(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export async function fetchDexScreener(cfg, { telemetry } = {}) {
  if (!cfg.dexscreener) return [];
  return safe("dexscreener", async () => {
    const queries = cfg.context || [];
    const seen = new Map();
    for (const q of queries) {
      const j = await get(`${API}?q=${encodeURIComponent(q)}`, { json: true });
      for (const p of j?.pairs || []) {
        const key = p.pairAddress || p.url;
        if (!key || seen.has(key)) continue;
        seen.set(key, p);
      }
    }

    const candidates = [];
    for (const p of seen.values()) {
      const change24 = p.priceChange?.h24;
      const liquidity = p.liquidity?.usd;
      const volume24 = p.volume?.h24;

      if (typeof change24 !== "number") {
        if (telemetry) recordNumericGate(telemetry, "dexscreener", "null_price_change");
        continue;
      }
      if (Math.abs(change24) < PRICE_CHANGE_FLOOR) {
        if (telemetry) recordNumericGate(telemetry, "dexscreener", "below_price_change_floor");
        continue;
      }
      if (typeof liquidity !== "number" || liquidity < LIQUIDITY_FLOOR) {
        if (telemetry) recordNumericGate(telemetry, "dexscreener", "below_liquidity_floor");
        continue;
      }
      if (typeof volume24 !== "number" || volume24 < VOLUME_FLOOR) {
        if (telemetry) recordNumericGate(telemetry, "dexscreener", "below_volume_floor");
        continue;
      }
      if (!p.url) continue;

      const symbol = `${p.baseToken?.symbol || "?"}/${p.quoteToken?.symbol || "?"}`;
      const direction = change24 >= 0 ? "up" : "down";
      candidates.push({
        title: `${symbol} ${direction} ${Math.abs(change24).toFixed(0)}% in 24h on ${fmtUsd(volume24)} volume`,
        description: "",
        url: p.url,
        source: "dexscreener",
        raw: volume24,
        _absChange24: Math.abs(change24),
        // No per-event timestamp — priceChange/volume are rolling windows
        // ending now, not a moment. Same honesty call as coingecko.js:
        // date = fetch time, not invented.
        date: new Date().toISOString(),
      });
    }

    const kept = candidates.sort((a, b) => b._absChange24 - a._absChange24).slice(0, MAX_ITEMS);
    const droppedByCap = candidates.length - kept.length;
    if (telemetry && droppedByCap > 0) {
      for (let i = 0; i < droppedByCap; i++) recordNumericGate(telemetry, "dexscreener", "max_items_per_crawl");
    }
    return kept.map(({ _absChange24, ...it }) => it);
  });
}

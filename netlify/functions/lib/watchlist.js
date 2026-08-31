// netlify/functions/lib/watchlist.js
//
// Action A — watchlist pre-warm. Single source of truth for which competitor
// entities get proactively cached ahead of a lead arriving, one table per
// category (categories.js's own keys — no separate cybersecurity row; that
// facet never had its own category to begin with, and was dropped from
// consideration for this watchlist specifically per the brief).
//
// `seedBrands` are NOT crawled — they document which lead-brand types this
// watchlist is meant to serve (Tin's own monthly manual review of whether
// the seed list still matches actual lead pipeline taste), nothing more.
// Only `entities` get fetched, by watchlist-crawl.js, into the SAME shared
// cache lib/entity-cache.js already exposes — this file adds no new storage,
// only a crawl target list.
//
// Entity names are copied verbatim from the brief in their canonical
// headline form — the form a reporter would actually use in a headline, per
// lib/sources/competitor-news.js's query-construction rules. Do NOT
// normalize, shorten, or title-case these differently: "Aerodrome Finance"
// returns real results in Google News; "Aerodrome" alone returns zero
// (live-verified, Phase 2.7). Same risk applies to every other multi-word
// entity below.

export const WATCHLIST = {
  ai: {
    label: "AI",
    seedBrands: ["OpenAI", "Anthropic", "Perplexity"],
    entities: ["ChatGPT", "Claude", "Google Gemini", "Mistral AI", "Cohere", "DeepSeek"],
  },
  web3: {
    label: "Web3 / Crypto",
    seedBrands: ["Uniswap", "Coinbase", "Circle"],
    entities: ["Aerodrome Finance", "Curve Finance", "PancakeSwap", "Binance", "Kraken", "Tether"],
  },
  fintech: {
    label: "FinTech",
    seedBrands: ["Wise", "Stripe", "Revolut"],
    entities: ["Remitly", "Payoneer", "Adyen", "Checkout.com", "Monzo", "Nubank"],
  },
  saas: {
    label: "B2B SaaS / DevTools",
    seedBrands: ["Notion", "Vercel", "Linear"],
    entities: ["Confluence", "Coda", "Airtable", "Netlify", "Jira", "Asana"],
  },
};

// Flat list of { entity, category } pairs — what watchlist-crawl.js actually
// iterates. Derived, not hand-duplicated, so WATCHLIST above stays the only
// place anyone edits the seed list.
export const WATCHLIST_ENTITIES = Object.entries(WATCHLIST).flatMap(([category, cfg]) =>
  cfg.entities.map((entity) => ({ entity, category }))
);

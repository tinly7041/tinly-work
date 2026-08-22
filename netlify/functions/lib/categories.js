// categories.js — single source of truth for Phase 2 crawl config.
// Extracted from trendpulse-category-taxonomy.xlsx (Sheet 1: category -> source map).
//
// Contract: every category MUST list its sources explicitly. No implicit fallback
// source set. If a category has no source for something, that is a visible gap,
// not a silent degrade. (This is the whole reason the 28-sector taxonomy was rejected.)

export const GEO = "VN"; // Google Trends passthrough — verified working in trend-pulse source

export const CATEGORIES = {
  ai: {
    label: "AI",
    // Keywords are per-source. GitHub uses its own query grammar; HN is looser.
    hn: ["LLM", "AI agents", "inference", "open source model", "RAG"],
    github: '"llm" OR "agent" OR "inference" OR "fine-tune"',
    githubWindowDays: 90,
    productHunt: ["ai", "agent", "llm", "gpt", "model", "copilot", "assistant"],
    coingecko: false,
    googleTrends: true,
    xList: true,
  },
  web3: {
    label: "Web3 / Crypto",
    hn: ["crypto", "onchain", "stablecoin", "zero knowledge proof", "smart contract"],
    // NOTE: bare "zk" was tested and pulls junk (a k8s console, an unrelated CN repo).
    // Tightened to phrases. See build note 3.
    github: 'solidity OR "smart contract" OR "zero-knowledge" OR "onchain"',
    githubWindowDays: 180, // wider: Web3 repo creation volume is ~6% of AI's
    productHunt: ["crypto", "web3", "onchain", "wallet", "defi", "token", "stablecoin"],
    coingecko: true,
    googleTrends: true,
    xList: true,
    // See BUILD NOTE 1c in sources/github.js — GitHub web3 results are low quality.
    // CoinGecko and HN carry this category. Do not remove GitHub entirely; it still
    // contributes to the >=3 unique-source health check.
    weightOverride: { github: 0.5 },
  },
  fintech: {
    label: "FinTech",
    hn: ["fintech", "payments infrastructure", "neobank", "open banking", "cross-border payments"],
    // "payments" alone pulled an iCloud-bypass tool. Qualified.
    github: '"payments api" OR "open banking" OR "payment orchestration" OR ledger',
    githubWindowDays: 180,
    productHunt: ["finance", "payment", "banking", "invoice", "payroll", "fintech"],
    coingecko: false,
    googleTrends: true,
    xList: true,
  },
  saas: {
    label: "B2B SaaS / DevTools",
    hn: ["developer tools", "observability", "internal tooling", "API design", "self-hosted"],
    github: '"developer-tools" OR sdk OR observability OR "self-hosted"',
    githubWindowDays: 90,
    productHunt: ["developer", "api", "saas", "no-code", "automation", "analytics"],
    coingecko: false,
    googleTrends: true,
    xList: true,
  },
  // Tier 2, still undecided (Notion open item). Off by default so it cannot
  // silently ship half-sourced. Flip `enabled` when you decide.
  cybersecurity: {
    label: "Cybersecurity",
    enabled: false,
    hn: ["security audit", "vulnerability", "supply chain attack", "pentest"],
    github: '"security audit" OR pentest OR "vulnerability scanner"',
    githubWindowDays: 180,
    productHunt: ["security", "privacy", "auth"],
    coingecko: false,
    googleTrends: false,
    xList: false,
  },
};

export const ACTIVE = Object.entries(CATEGORIES)
  .filter(([, c]) => c.enabled !== false)
  .map(([k]) => k);

// Sources that are still fetched every crawl (cheap, and useful as a raw
// record) but never enter the 40-item cache or the health gate's
// unique-source count. Google Trends landed here after live testing showed
// it returning the same undifferentiated national feed in every category —
// zero category signal, ~10 of 40 cache slots, served position 4 via
// round-robin in every category regardless of content. `healthy: true` was
// passing on a source contributing nothing; this is the fix, not a relaxed
// gate. See collect.js.
export const REFERENCE_ONLY_SOURCES = ["googletrends"];

// Source weights. Applied AFTER per-source rank-percentile, never to raw values.
// Rationale: a 2015 repo with 27k stars and an HN post with 300 points are not
// on the same scale. Percentile-then-weight is the only way these compose.
export const SOURCE_WEIGHT = {
  hn: 1.0,          // strongest category signal, real human ranking
  github: 0.9,      // strong, but "new repo with stars" != "trend" without the created: filter
  coingecko: 0.9,   // Web3 only, but the highest-intent Web3 signal available
  producthunt: 0.7, // launch signal, no vote count exposed in RSS
  xlist: 0.65,      // curated-list attention signal — real posts + real engagement,
                     // higher-intent than a raw national search feed, but still an
                     // attention/audience axis, not a category-quality one. Judgment
                     // call, not measured; revisit once there's a few weeks of data.
  googletrends: 0.6, // kept for reference-only fetches; unused for scoring now that
                     // it's excluded from the ranked pool (see REFERENCE_ONLY_SOURCES).
};

// Which relevance axis a source feeds (Phase 2.5). Passed to Sonnet as a hint,
// NOT as the answer — Sonnet still labels per brand.
export const SOURCE_SIGNAL = {
  hn: "category",
  github: "category",
  coingecko: "category",
  producthunt: "category",
  xlist: "attention",
  googletrends: "attention",
};

export const CACHE_TARGET = 40; // over-fetch so Sonnet has room to filter down to 5

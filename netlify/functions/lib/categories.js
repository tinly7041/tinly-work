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
  },
  saas: {
    label: "B2B SaaS / DevTools",
    hn: ["developer tools", "observability", "internal tooling", "API design", "self-hosted"],
    github: '"developer-tools" OR sdk OR observability OR "self-hosted"',
    githubWindowDays: 90,
    productHunt: ["developer", "api", "saas", "no-code", "automation", "analytics"],
    coingecko: false,
    googleTrends: true,
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
  },
};

export const ACTIVE = Object.entries(CATEGORIES)
  .filter(([, c]) => c.enabled !== false)
  .map(([k]) => k);

// Source weights. Applied AFTER per-source rank-percentile, never to raw values.
// Rationale: a 2015 repo with 27k stars and an HN post with 300 points are not
// on the same scale. Percentile-then-weight is the only way these compose.
export const SOURCE_WEIGHT = {
  hn: 1.0,          // strongest category signal, real human ranking
  github: 0.9,      // strong, but "new repo with stars" != "trend" without the created: filter
  coingecko: 0.9,   // Web3 only, but the highest-intent Web3 signal available
  producthunt: 0.7, // launch signal, no vote count exposed in RSS
  googletrends: 0.6,// attention signal, mostly off-category by design
};

// Which relevance axis a source feeds (Phase 2.5). Passed to Sonnet as a hint,
// NOT as the answer — Sonnet still labels per brand.
export const SOURCE_SIGNAL = {
  hn: "category",
  github: "category",
  coingecko: "category",
  producthunt: "category",
  googletrends: "attention",
};

export const CACHE_TARGET = 40; // over-fetch so Sonnet has room to filter down to 5

// categories.js — single source of truth for Phase 2 crawl config.
//
// Category-gates rework (see category-gates brief): the 23 Aug pool dump
// showed the filters were the problem, not the sources. FinTech was 15/23
// GitHub repos matching the bare word "ledger"; Web3 was 18/40 items with no
// magnitude attached. Three fixes, in order:
//   1. matcher.js — word-boundary, case-aware, phrase-aware, exclusion-first
//      matching (see that file). Every adapter uses it; nothing reimplements it.
//   2. Each category's flat keyword array is replaced by three lists —
//      include / ambiguous / exclude — plus a context list that validates
//      ambiguous matches. A bare ambiguous hit (e.g. "ledger") is not enough;
//      it needs a context term (e.g. "bank") in the same title or description.
//   3. Numeric source gates (see sources/dexscreener.js, sources/coingecko.js,
//      sources/github.js) and a 40% source-share cap on the ranked cache.
//
// Contract unchanged from Phase 2: every category MUST list its sources
// explicitly, no implicit fallback source set. categories.js is the system —
// the taxonomy spreadsheet is a record; no code reads it.
//
// The keyword sets below were argued over line by line and are implemented
// as specified, not re-derived. Two things worth flagging plainly rather
// than silently patching around (matcher.js rule 2: terms of <=4 characters
// match case-sensitively, exactly as written):
//   - A handful of ordinary short words are used as context validators —
//     "bank", "card" (fintech), "team", "seat", "org" (saas), "git" (fintech
//     exclude) — all exactly 4 characters or fewer and written lowercase.
//     Per rule 2 they only match their lowercase form, so a sentence-initial
//     "Bank of X..." or "Git repository" will not validate through that
//     specific term (other, longer context/exclude terms usually still
//     cover the same ground — e.g. "financial", "regulator" for fintech;
//     "MCP server", "coding agent" for the git-adjacent exclusions).
//   - AI's include list has bare "eval" (4 chars, lowercase, case-sensitive
//     per rule 2) — it qualifies an item outright with no context check,
//     same shape of risk "ledger" was for fintech before this rework, just
//     smaller blast radius (case-sensitive lowercase-only narrows it
//     somewhat). Flagged for the Step 8 report to watch for false positives,
//     not altered — the brief is explicit that these sets are final.

export const GEO = "VN"; // Google Trends passthrough — verified working in trend-pulse source

// ---------- security facet (Step 3) ----------
//
// Cybersecurity is a facet across all four categories, not a fifth category —
// security news is always security OF something. SECURITY_TERMS is appended
// to every category's `ambiguous` list below and validated by that same
// category's OWN `context` list, unchanged. So "prompt injection" + "LLM" ->
// AI; "drainer contract" + "on-chain" -> Web3; "transaction monitoring" +
// "bank" -> FinTech; "SOC 2" + "enterprise" -> SaaS. Security terms alone
// never qualify an item — matching only, no downstream tagging. No `facet`
// field, no security-aware ranking, no signal passed to Sonnet: security
// brands are not the ICP, so facet-aware ranking would be building for a
// buyer this product does not want.
export const SECURITY_TERMS = [
  "prompt injection", "indirect prompt injection", "jailbreak", "system prompt leakage",
  "data poisoning", "RAG poisoning", "excessive agency", "red teaming", "guardrails",
  "OWASP LLM Top 10", "NIST AI RMF", "CVE", "bug bounty", "whitehat", "threat model",
  "zero trust", "penetration test", "supply chain attack", "credential stuffing",
  "injection", "leakage", "bypass", "payload", "trigger", "exfiltration", "hardening",
];

const withSecurity = (ambiguous) => [...ambiguous, ...SECURITY_TERMS];

// ---------- news-feeds source lists (follow-up to category-gates) ----------
//
// General-news RSS/Atom outlets, one list per category, consumed by
// sources/news-feeds.js. Every candidate below was fetched live before being
// added — dead links (404), paywalled shells that return HTML instead of a
// feed, and Cloudflare bot-challenge pages were checked for and excluded.
// Two entries couldn't be reached from the dev sandbox that vetted this list
// (timeouts, not 404s) but are included anyway since that may be a sandbox
// network restriction rather than a dead feed; sources/_http.js's `safe()`
// makes a genuinely dead one a harmless no-op either way. Each is commented
// where it isn't self-explanatory.
const WEB3_NEWS_FEEDS = [
  { name: "CoinDesk", url: "http://feeds.feedburner.com/Coindesk" },
  { name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { name: "Blockworks", url: "https://blockworks.co/feed/" },
  { name: "Decrypt", url: "https://decryptmedia.com/feed/" },
  { name: "TechCrunch - Bitcoin", url: "https://techcrunch.com/tag/bitcoin/feed" },
  { name: "HackerNoon", url: "https://hackernoon.com/feed" },
  { name: "Trustnodes", url: "https://www.trustnodes.com/feed" },
  { name: "The Defiant", url: "https://thedefiant.substack.com/feed" },
  { name: "Bitcoin Optech", url: "https://bitcoinops.org/feed.xml" },
  { name: "a16z web3 weekly", url: "https://a16zcrypto.substack.com/feed" },
  { name: "Chainalysis Blog", url: "https://blog.chainalysis.com/feed/" },
  { name: "Vitalik Buterin", url: "https://vitalik.eth.limo/feed.xml" },
  { name: "Trail of Bits Blog", url: "https://blog.trailofbits.com/feed/" },
  { name: "Multicoin Capital", url: "https://multicoin.capital/rss.xml" },
  { name: "Bankless", url: "https://www.bankless.com/feed" },
  { name: "Ethereum Foundation Blog", url: "https://blog.ethereum.org/feed.xml" },
  { name: "Week in Ethereum News", url: "https://weekinethereumnews.com/feed/" }, // unreachable from vetting sandbox — see note above
];

const FINTECH_NEWS_FEEDS = [
  { name: "Finextra", url: "https://www.finextra.com/rss/headlines.aspx" },
  { name: "The Fintech Times", url: "https://thefintechtimes.com/feed/" },
  { name: "PYMNTS", url: "https://www.pymnts.com/feed/" },
  { name: "TechCrunch - Fintech", url: "https://techcrunch.com/tag/fintech/feed" },
  { name: "Sifted", url: "https://sifted.eu/feed" },
  { name: "Tearsheet", url: "https://tearsheet.co/feed/" },
  { name: "Finovate", url: "https://finovate.com/feed/" },
  { name: "Finance Magnates", url: "https://www.financemagnates.com/feed/" },
  { name: "Payments Dive", url: "https://www.paymentsdive.com/feeds/news/" },
  { name: "Global Fintech Series", url: "https://globalfintechseries.com/feed/" },
  { name: "Crowdfund Insider", url: "https://www.crowdfundinsider.com/feed/" },
  // SEA cluster — the western outlets above skew US/EU; these directly match
  // the read-pulse audience (Greater Asia / SEA). Added deliberately, not a
  // filler pick.
  { name: "Fintech News Singapore", url: "https://fintechnews.sg/feed/" },
  { name: "Fintech News Malaysia", url: "https://fintechnews.my/feed/" },
  { name: "e27", url: "https://e27.co/feed/" },
  { name: "Tech in Asia", url: "https://www.techinasia.com/feed" },
  { name: "Fintech News Vietnam", url: "https://fintechnews.vn/feed/" }, // unreachable from vetting sandbox — see note above
];

const AI_NEWS_FEEDS = [
  { name: "TechCrunch - AI", url: "https://techcrunch.com/tag/artificial-intelligence/feed" },
  { name: "VentureBeat AI", url: "https://venturebeat.com/category/ai/feed/" },
  { name: "The Verge AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { name: "Ars Technica AI", url: "https://arstechnica.com/tag/ai/feed/" },
  { name: "Wired AI", url: "https://www.wired.com/feed/tag/ai/latest/rss" },
  { name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml" },
  { name: "Google AI Blog", url: "https://blog.google/technology/ai/rss/" },
  { name: "OpenAI Blog", url: "https://openai.com/blog/rss.xml" },
  { name: "Import AI", url: "https://importai.substack.com/feed" },
  { name: "Simon Willison", url: "https://simonwillison.net/atom/everything/" },
];

export const CATEGORIES = {
  ai: {
    label: "AI",
    include: [
      "foundation model", "open-weight", "model weights", "frontier model",
      "inference", "fine-tuning", "distillation", "quantization", "RAG", "retrieval augmented",
      "context window", "tokenizer", "training run", "GPU cluster", "TPU", "model release",
      "agent framework", "tool use", "function calling", "MCP", "eval", "benchmark",
      "multimodal", "diffusion model", "text-to-video", "voice AI", "model routing",
      "AI regulation", "AI Act", "compute export", "chip export",
      "test-time compute", "reasoning model", "chain of thought", "RLHF", "DPO", "GRPO",
      "LoRA", "QLoRA", "synthetic data",
      "mixture of experts", "MoE", "Mamba", "state space model", "KV cache", "prompt caching",
      "speculative decoding", "structured output",
      "computer use", "browser use", "vision language model", "VLM", "action model",
      "vLLM", "Ollama", "TensorRT-LLM", "NPU", "LPU", "Blackwell", "B200",
      "sovereign AI", "constitutional AI", "model alignment",
    ],
    ambiguous: withSecurity([
      "agent", "model", "prompt", "embedding", "harness", "router", "gateway", "pipeline",
      "boundary", "isolation", "refusal", "alignment", "steering", "cache", "adapter", "inversion",
      "smuggling",
    ]),
    context: [
      "AI", "LLM", "machine learning", "neural", "transformer", "inference", "GPT", "Claude",
      "Gemini", "Llama", "Qwen", "DeepSeek", "model", "OpenAI", "Anthropic", "Nvidia",
    ],
    exclude: [
      "token price", "market cap", "trending on CoinGecko", "memecoin", "airdrop",
      "SQL injection", "XSS", "cross-site scripting", "botnet", "ransomware",
      "crypto drainer", "smart contract exploit", "traditional WAF",
    ],
    github: '"llm" OR "agent" OR "inference" OR "fine-tune"',
    githubWindowDays: 90,
    coingecko: false,
    googleTrends: true,
    xList: true,
    arxiv: true,
    newsFeeds: AI_NEWS_FEEDS,
  },
  web3: {
    label: "Web3 / Crypto",
    include: [
      "DEX", "AMM", "liquidity pool", "TVL", "L2", "L3", "rollup", "zk-rollup", "optimistic rollup",
      "sovereign rollup", "appchain", "modular blockchain", "data availability", "Celestia",
      "parallel EVM", "alt-VM",
      "bridge exploit", "cross-chain bridge", "staking", "restaking", "liquid restaking", "LRT",
      "AVS", "EigenLayer", "Symbiotic", "shared security", "validator", "slashing",
      "smart contract audit", "rug pull", "MEV", "tokenomics", "token unlock",
      "on-chain governance", "DAO proposal", "governance vote",
      "NFT marketplace", "depeg", "EVM", "Solana program", "account abstraction", "ERC-4337",
      "mainnet launch", "testnet", "protocol upgrade", "hard fork", "airdrop",
      "crypto regulation", "CLARITY Act", "MiCA", "VASP", "spot ETF", "custody licence",
      "stablecoin", "yield-bearing stablecoin",
      "RWA", "real world assets", "tokenized treasuries", "tokenized gold", "private credit",
      "perpetual DEX", "perps", "intent-based architecture", "solvers", "flash loan",
      "batch auction", "liquidity rebalancing", "liquidity migration",
      "Ordinals", "Runes", "Bitcoin L2", "Babylon staking", "BRC-20",
      "DePIN", "decentralized AI", "DeAI", "zkML",
      "DeSo", "decentralized social", "Farcaster", "Frames", "Lens Protocol", "TON mini-apps",
      "Sybil protection",
      "memecoin", "fair launch", "FDV", "circulating supply ratio",
      "flash loan exploit", "sandwich attack", "private mempool", "drainer contract",
      "reentrancy", "infinite approval",
      "grant program", "developer grant", "ecosystem fund",
    ],
    // AI-agent terms sit in ambiguous, not include, deliberately — Session 3
    // cut GitHub's Web3 results because they were agent bots and wallet
    // clones; as include terms these readmit them.
    ambiguous: withSecurity([
      "wallet", "token", "chain", "gas", "mint", "layer", "node", "protocol", "vault", "oracle",
      "agent", "agentic commerce", "autonomous agent", "GPU compute", "passkeys", "cabals",
    ]),
    context: [
      "crypto", "blockchain", "on-chain", "onchain", "DeFi", "Ethereum", "Solana", "Bitcoin",
      "web3", "smart contract", "decentralized", "decentralised", "ledger", "staking", "DEX",
      "Hyperliquid", "Aptos",
    ],
    exclude: [
      "Claude Code", "MCP server", "agent harness", "coding agent", "skill for",
      "SSH client", "file sharing", "bug bounty skill", "arbitrage bot", "trading bot",
      "wallet clone", "memecoin sniper", "phishing bot",
    ],
    // Bare tickers (ETH, BTC, SOL, HYPE, APT) are deliberately excluded from
    // `include` — APT is the Debian package manager, SOL appears in Spanish
    // text and as a Unix constant, HYPE is an ordinary word, and a bare
    // ticker signals nothing about what changed. Full names sit in `context`
    // instead. Do not add tickers back.
    github: 'solidity OR "smart contract" OR "zero-knowledge" OR "onchain"',
    githubWindowDays: 180, // wider: Web3 repo creation volume is ~6% of AI's
    // See BUILD NOTE 1c in sources/github.js — GitHub web3 results are low
    // quality. CoinGecko and HN carry this category.
    weightOverride: { github: 0.5 },
    coingecko: true,
    googleTrends: true,
    xList: true,
    dexscreener: true,
    newsFeeds: WEB3_NEWS_FEEDS,
  },
  fintech: {
    label: "FinTech",
    include: [
      "payments", "payment rails", "payment gateway", "neobank", "digital bank", "challenger bank",
      "stablecoin", "remittance", "cross-border payment", "money transfer",
      "KYC", "KYB", "AML", "sanctions screening", "open banking", "PSD2", "PSD3",
      "ISO 20022", "SWIFT", "ACH", "SEPA", "RTP", "FedNow", "UPI", "PromptPay", "QRIS", "VietQR", "NAPAS",
      "card issuing", "merchant acquiring", "interchange", "chargeback", "PCI DSS",
      "BNPL", "embedded finance", "banking-as-a-service", "e-money licence", "EMI licence",
      "underwriting", "credit scoring", "lending platform", "treasury management",
      "payment fraud", "transaction monitoring", "core banking", "payout", "payment orchestration",
    ],
    ambiguous: withSecurity([
      "ledger", "wallet", "settlement", "custody", "compliance", "invoice", "banking",
      "onboarding", "reconciliation", "escrow", "payout", "rails", "clearing",
    ]),
    context: [
      "payment", "bank", "financial", "finance", "money", "currency", "transaction", "fiat",
      "merchant", "card", "remittance", "regulator", "licence", "license", "fintech", "capital", "credit",
    ],
    exclude: [
      "Claude Code", "MCP server", "agent harness", "LLM", "prompt", "skill for", "coding agent",
      "repo context", "SDK for AI", "git", "CLI tool", "self-hosted note",
      "mRNA", "clinical trial", "Phase 3", "therapy", "protein", "oncology", "melanoma", "neuroscience",
    ],
    github: '"payments api" OR "open banking" OR "payment orchestration" OR ledger',
    githubWindowDays: 180,
    coingecko: false,
    googleTrends: true,
    xList: true,
    newsFeeds: FINTECH_NEWS_FEEDS,
  },
  saas: {
    label: "B2B SaaS / DevTools",
    include: [
      "B2B SaaS", "ARR", "NRR", "net revenue retention", "PLG", "product-led growth",
      "churn", "seat-based pricing", "usage-based pricing", "enterprise tier",
      "internal tools", "admin panel", "workflow automation", "RBAC", "SSO", "SAML", "SCIM",
      "multi-tenant", "API-first", "integration platform", "iPaaS", "no-code", "low-code",
      "observability", "feature flag", "developer experience", "DX",
      "SOC 2", "GDPR compliance", "data residency",
    ],
    ambiguous: withSecurity([
      "platform", "dashboard", "workflow", "integration", "automation", "connector", "governance",
    ]),
    context: [
      "SaaS", "B2B", "enterprise", "team", "workspace", "org", "seat", "subscription",
      "internal tool", "developer", "engineering team", "customer",
    ],
    exclude: ["memecoin", "token price", "trending on CoinGecko", "clinical trial", "therapy"],
    github: '"developer-tools" OR sdk OR observability OR "self-hosted"',
    githubWindowDays: 90,
    coingecko: false,
    googleTrends: true,
    xList: true,
    lobsters: true,
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

// Step 7: no source may contribute more than this share of a category's
// ranked cache. GitHub was 65% of FinTech in the 23 Aug dump. Enforced in
// rank.js's rank(), generally, for every source — not a GitHub-only patch.
export const SOURCE_SHARE_CAP = 0.4;

// Source weights. Applied AFTER per-source rank-percentile, never to raw values.
// Rationale: a 2015 repo with 27k stars and an HN post with 300 points are not
// on the same scale. Percentile-then-weight is the only way these compose.
export const SOURCE_WEIGHT = {
  hn: 1.0,          // strongest category signal, real human ranking
  github: 0.9,      // strong, but "new repo with stars" != "trend" without the created: filter
  coingecko: 0.9,   // Web3 only, but the highest-intent Web3 signal available
  dexscreener: 0.85,// Web3 only — real priceChange/volume momentum, not a promo listing
  lobsters: 0.85,   // SaaS/DevTools only — same "real human ranking" shape as HN, smaller community
  arxiv: 0.8,       // AI only — legit research signal, but rank-position proxy only (no vote count)
  producthunt: 0.7, // launch signal, no vote count exposed in RSS
  newsfeeds: 0.7,   // real editorial outlets, same "no vote count, position-in-feed
                     // proxy only" shape as Product Hunt — weighted the same for now,
                     // revisit once there's a few weeks of data on signal quality.
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
  dexscreener: "category",
  lobsters: "category",
  arxiv: "category",
  producthunt: "category",
  newsfeeds: "category",
  xlist: "attention",
  googletrends: "attention",
};

export const CACHE_TARGET = 50; // over-fetch so Sonnet has room to filter down to 5

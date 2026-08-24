import { CATEGORIES, REFERENCE_ONLY_SOURCES } from "./categories.js";
import { fetchHN } from "./sources/hn.js";
import { fetchGitHub } from "./sources/github.js";
import { fetchGoogleTrends } from "./sources/google-trends.js";
import { fetchProductHunt } from "./sources/product-hunt.js";
import { fetchCoinGecko } from "./sources/coingecko.js";
import { fetchXList } from "./sources/x-list.js";
import { fetchLobsters } from "./sources/lobsters.js";
import { fetchArxiv } from "./sources/arxiv.js";
import { fetchDexScreener } from "./sources/dexscreener.js";
import { fetchNewsFeeds } from "./sources/news-feeds.js";
import { pipeline } from "./rank.js";
import { firstItemMatch } from "./matcher.js";
import { structuralDisqualify } from "./qualify.js";
import { createTelemetry, recordExclusion, recordQualifyingDrop } from "./telemetry.js";

// Step 7 — exclusions apply centrally, to every item from every source,
// before ranking, so an excluded item never consumes a cache slot. Most
// adapters (HN, GitHub, Product Hunt, X List) already run the full include/
// ambiguous+context/exclude taxonomy via matcher.categorize() before an item
// ever reaches here — this pass is what additionally covers the sources that
// deliberately don't run categorize() at all (DexScreener/CoinGecko, gated
// purely on numeric momentum thresholds instead — see those adapters for
// why; Lobsters/ArXiv, wholesale single-category feeds by original design),
// so "exclusions beat includes, always" (matcher.js rule 5) is guaranteed
// for every source, not just the ones with their own taxonomy check. Running
// it again for the sources that already checked is redundant but harmless.
function applyExclusions(items, cfg, telemetry) {
  const kept = [];
  for (const item of items) {
    const hit = firstItemMatch(item, cfg.exclude);
    if (hit) {
      recordExclusion(telemetry, hit);
    } else {
      kept.push(item);
    }
  }
  return kept;
}

// Step 5 — a keyword match on a non-event is still a non-event. Only the
// structurally detectable cases (Ask HN prefix, listicle/"top 10" titles)
// are enforced here; see qualify.js for what's deliberately NOT built yet
// and why.
function applyQualifyingSignal(items, telemetry) {
  const kept = [];
  for (const item of items) {
    const reason = structuralDisqualify(item);
    if (reason) {
      recordQualifyingDrop(telemetry, reason);
    } else {
      kept.push(item);
    }
  }
  return kept;
}

export async function collect(catKey) {
  const cfg = CATEGORIES[catKey];
  if (!cfg) throw new Error(`unknown category: ${catKey}`);
  const telemetry = createTelemetry();

  const jobs = [
    fetchHN(cfg),
    fetchGitHub(cfg),
    fetchProductHunt(cfg),
    fetchCoinGecko(cfg, { telemetry }),
  ];
  if (cfg.googleTrends) jobs.push(fetchGoogleTrends(cfg));
  if (cfg.xList) jobs.push(fetchXList(cfg, catKey));
  if (cfg.lobsters) jobs.push(fetchLobsters(cfg));
  if (cfg.arxiv) jobs.push(fetchArxiv(cfg));
  if (cfg.dexscreener) jobs.push(fetchDexScreener(cfg, { telemetry }));
  if (cfg.newsFeeds) jobs.push(fetchNewsFeeds(cfg));
  const all = (await Promise.all(jobs)).flat();

  // Google Trends is still fetched every crawl (cheap, kept as a raw record)
  // but never enters the ranked cache or the health gate's unique-source
  // count — see REFERENCE_ONLY_SOURCES in categories.js for why.
  const reference = all.filter((i) => REFERENCE_ONLY_SOURCES.includes(i.source));
  let cacheable = all.filter((i) => !REFERENCE_ONLY_SOURCES.includes(i.source));

  cacheable = applyExclusions(cacheable, cfg, telemetry);
  cacheable = applyQualifyingSignal(cacheable, telemetry);

  const result = pipeline(cacheable, undefined, cfg, { telemetry });
  return { category: catKey, label: cfg.label, ...result, reference, gate_telemetry: telemetry };
}

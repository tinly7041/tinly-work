import { CATEGORIES, REFERENCE_ONLY_SOURCES } from "./categories.js";
import { fetchHN } from "./sources/hn.js";
import { fetchGitHub } from "./sources/github.js";
import { fetchGoogleTrends } from "./sources/google-trends.js";
import { fetchProductHunt } from "./sources/product-hunt.js";
import { fetchCoinGecko } from "./sources/coingecko.js";
import { fetchXList } from "./sources/x-list.js";
import { pipeline } from "./rank.js";

export async function collect(catKey) {
  const cfg = CATEGORIES[catKey];
  if (!cfg) throw new Error(`unknown category: ${catKey}`);
  const jobs = [fetchHN(cfg), fetchGitHub(cfg), fetchProductHunt(cfg), fetchCoinGecko(cfg)];
  if (cfg.googleTrends) jobs.push(fetchGoogleTrends(cfg));
  if (cfg.xList) jobs.push(fetchXList(cfg, catKey));
  const all = (await Promise.all(jobs)).flat();

  // Google Trends is still fetched every crawl (cheap, kept as a raw record)
  // but never enters the ranked cache or the health gate's unique-source
  // count — see REFERENCE_ONLY_SOURCES in categories.js for why.
  const reference = all.filter((i) => REFERENCE_ONLY_SOURCES.includes(i.source));
  const cacheable = all.filter((i) => !REFERENCE_ONLY_SOURCES.includes(i.source));

  const result = pipeline(cacheable, undefined, cfg);
  return { category: catKey, label: cfg.label, ...result, reference };
}

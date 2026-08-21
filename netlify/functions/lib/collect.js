import { CATEGORIES } from "./categories.js";
import { fetchHN } from "./sources/hn.js";
import { fetchGitHub } from "./sources/github.js";
import { fetchGoogleTrends } from "./sources/google-trends.js";
import { fetchProductHunt } from "./sources/product-hunt.js";
import { fetchCoinGecko } from "./sources/coingecko.js";
import { pipeline } from "./rank.js";

export async function collect(catKey) {
  const cfg = CATEGORIES[catKey];
  if (!cfg) throw new Error(`unknown category: ${catKey}`);
  const jobs = [fetchHN(cfg), fetchGitHub(cfg), fetchProductHunt(cfg), fetchCoinGecko(cfg)];
  if (cfg.googleTrends) jobs.push(fetchGoogleTrends(cfg));
  const raw = (await Promise.all(jobs)).flat();
  return { category: catKey, label: cfg.label, ...pipeline(raw, undefined, cfg) };
}

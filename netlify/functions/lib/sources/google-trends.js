import { get, safe } from "./_http.js";
import { parseItems, tag } from "../rss.js";
import { GEO } from "../categories.js";

const FEED = (geo) => `https://trends.google.com/trending/rss?geo=${geo}`;

// BUILD NOTE 2.
// This feed is NOT keyword-filtered — it is whatever a country is searching today,
// which in VN is mostly football, showbiz and weather. That is a feature, not a bug:
// this is the ONLY source feeding the `indirect` / audience-attention label in the
// Phase 2.5 spec. Every other source feeds `direct`. Do not "fix" it by filtering
// to category keywords — that would delete the indirect axis entirely.
export async function fetchGoogleTrends(_cfg, { geo = GEO, limit = 20 } = {}) {
  return safe("googletrends", async () => {
    const xml = await get(FEED(geo));
    return parseItems(xml).slice(0, limit).map((b) => {
      const term = tag(b, "title");
      const newsUrl = tag(b, "ht:news_item_url");
      const traffic = (tag(b, "ht:approx_traffic") || "0").replace(/[^\d]/g, "");
      return {
        title: tag(b, "ht:news_item_title") || term,
        url: newsUrl || `https://www.google.com/search?q=${encodeURIComponent(term || "")}`,
        source: "googletrends",
        raw: Number(traffic) || 0,
        date: tag(b, "pubDate") || new Date().toISOString(),
        term, // kept for the Sonnet prompt: the search term itself is the signal
      };
    }).filter((i) => i.title);
  });
}

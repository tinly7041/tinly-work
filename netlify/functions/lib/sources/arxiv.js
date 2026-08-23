import { get, safe } from "./_http.js";
import { parseItems, tag, link } from "../rss.js";

const API =
  "https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG&sortBy=submittedDate&sortOrder=descending&max_results=25";

// Single global feed, registered wholesale into AI (no per-category query
// grammar). Atom format — reuses the same parseItems()/link() that fixed
// Product Hunt's Atom parsing. EVENT source: sorted by submittedDate
// descending, so "published" is a real submission timestamp — "a new paper
// just dropped" rather than a repo that's simply existed since 2019.
//
// ArXiv exposes no popularity metric (no votes, no downloads), so `raw` is a
// rank-position proxy, not a magnitude — same shape as CoinGecko's
// pre-ranked list. Percentile-within-source still applies normally on top.
export async function fetchArxiv(cfg) {
  if (!cfg.arxiv) return [];
  return safe("arxiv", async () => {
    const xml = await get(API);
    const entries = parseItems(xml);
    return entries
      .map((e, i) => ({
        title: (tag(e, "title") || "").replace(/\s+/g, " ").trim(),
        url: link(e),
        source: "arxiv",
        raw: entries.length - i,
        date: tag(e, "published"),
      }))
      .filter((it) => it.title && it.url);
  });
}

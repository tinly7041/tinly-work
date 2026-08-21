import { get, safe } from "./_http.js";
import { parseItems, tag, link } from "../rss.js";

const FEED = "https://www.producthunt.com/feed";

// BUILD NOTE 3.
// PH's public RSS exposes no vote count. Score is position-in-feed (a proxy for
// PH's own ranking) decayed by recency. Do not pretend this is an upvote score.
// Feed is global and unsegmented, so category keywords filter client-side.
//
// BUILD NOTE 3b. This feed is actually Atom, not RSS 2.0: entries are <entry>
// (parseItems now matches both), and the item URL is a self-closing
// <link rel="alternate" href="..."/> rather than <link>text</link> — use link()
// instead of tag(b, "link"), which only ever finds RSS-style text-content links.
// Also no <description>; use <content> for the keyword-filter blob, and
// <published> since there's no <pubDate> either. Verified live 21 Aug: without
// these, every category returned 0 items — parser mismatch, not a quiet feed.
export async function fetchProductHunt(cfg, { limit = 50 } = {}) {
  return safe("producthunt", async () => {
    const xml = await get(FEED);
    const blocks = parseItems(xml).slice(0, limit);
    const kw = (cfg.productHunt || []).map((k) => k.toLowerCase());
    return blocks.map((b, i) => ({
      title: tag(b, "title"),
      url: (link(b) || "").split("?")[0],
      source: "producthunt",
      raw: limit - i, // position proxy
      date: tag(b, "pubDate") || tag(b, "published") || new Date().toISOString(),
      blob: `${tag(b, "title") || ""} ${tag(b, "description") || tag(b, "content") || ""}`.toLowerCase(),
    }))
      .filter((i) => i.title && i.url)
      .filter((i) => kw.length === 0 || kw.some((k) => i.blob.includes(k)))
      .map(({ blob, ...i }) => i);
  });
}

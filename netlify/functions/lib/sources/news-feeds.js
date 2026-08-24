import { get, safe } from "./_http.js";
import { parseItems, tag, link } from "../rss.js";
import { categorize } from "../matcher.js";

// A category-agnostic multi-outlet RSS/Atom source — general news outlets
// (CoinDesk, TechCrunch's fintech tag, Ethereum Foundation's blog, etc.),
// not single-project or single-topic feeds. Unlike Lobsters/ArXiv (wholesale
// feeds registered without keyword filtering by original design, because
// they're already topically homogeneous), these outlets cover broad general
// news — a Web3 outlet still runs AI or regulatory stories sometimes — so
// every item runs through the same shared matcher every other adapter uses
// (Step 1: "a single shared matcher used by every source adapter").
//
// Feed list lives in categories.js's `newsFeeds` per category, vetted live
// before being added (see category-gates follow-up: dead/paywalled/
// Cloudflare-blocked candidates were checked and excluded). One dead or
// slow feed must never take the others down with it — each feed is fetched
// under its OWN safe() call, not one safe() wrapping the whole batch.
const WINDOW_DAYS = 14;
const PER_FEED_LIMIT = 20;
const DESCRIPTION_LIMIT = 500;

function withinWindow(dateStr, windowDays) {
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return true; // no parseable date — don't drop it for that alone
  return (Date.now() - t) / 864e5 <= windowDays;
}

function fetchOneFeed({ name, url }) {
  return safe(`newsfeeds:${name}`, async () => {
    const xml = await get(url);
    const blocks = parseItems(xml).slice(0, PER_FEED_LIMIT);
    return blocks
      .map((b, idx) => ({
        title: tag(b, "title"),
        description: (tag(b, "description") || tag(b, "content:encoded") || tag(b, "content") || tag(b, "summary") || "").slice(0, DESCRIPTION_LIMIT),
        url: (link(b) || "").split("?")[0],
        source: "newsfeeds",
        // No cross-feed popularity metric available (this is a plain
        // publish-order feed, not a ranked/voted one) — position-in-feed is
        // a rank-position proxy, same honesty call as arxiv.js's `raw`.
        raw: PER_FEED_LIMIT - idx,
        date: tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || new Date().toISOString(),
        feed: name,
      }))
      .filter((i) => i.title && i.url)
      .filter((i) => withinWindow(i.date, WINDOW_DAYS));
  });
}

export async function fetchNewsFeeds(cfg) {
  const feeds = cfg.newsFeeds || [];
  if (!feeds.length) return [];

  const perFeed = await Promise.all(feeds.map(fetchOneFeed));
  const all = perFeed.flat();

  // The real gate: every item, regardless of which outlet or how prominent
  // in its own feed, must independently match the category's taxonomy.
  return all.filter((it) => categorize(it, cfg).matched);
}

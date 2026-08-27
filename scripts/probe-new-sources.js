#!/usr/bin/env node
// Task 3 probe — six untested free sources. THROWAWAY. No adapters built
// from this yet; report the shape, then decide which earn a slot.
//
// The question each source must answer: EVENT (something changed just now —
// a submission, a vote spike, a price move) or ARTIFACT (something exists,
// timelessly — a repo, a profile, a listing)? GitHub fails on exactly this;
// any new source that only returns artifacts has the same defect and can't
// supply why_now.
//
//   node scripts/probe-new-sources.js
//   node scripts/probe-new-sources.js --json > probe-new-sources.json

import { parseItems, tag, link } from "../netlify/functions/lib/rss.js";

const JSON_OUT = process.argv.includes("--json");
const UA = "tinly-work-trendpulse-probe/0.1 (github.com/tinly7041/tinly-work)";
const out = {};

async function getText(url, headers = {}, timeout = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: ctl.signal });
    const text = await res.text();
    return { status: res.status, text };
  } catch (e) {
    return { status: null, text: "", networkError: e.message };
  } finally {
    clearTimeout(t);
  }
}
async function getJSON(url, headers = {}) {
  const { status, text } = await getText(url, headers);
  let body = null, parseError = null;
  try { body = JSON.parse(text); } catch (e) { parseError = e.message; }
  return { status, body, parseError, rawSample: text.slice(0, 300) };
}

// ---------- 1. Lobste.rs ----------
async function probeLobsters() {
  const { status, body, parseError } = await getJSON("https://lobste.rs/hottest.json");
  const items = Array.isArray(body) ? body : [];
  return {
    status, parseError,
    count: items.length,
    sample: items.slice(0, 3).map((s) => ({
      title: s.title, url: s.url, score: s.score, created_at: s.created_at, comments: s.comment_count,
    })),
    verdict: "EVENT — hottest.json is a live, continuously-reranked feed (score = active upvotes right now); created_at is a real submission timestamp.",
  };
}

// ---------- 2. Bluesky ----------
async function probeBluesky() {
  const API = "https://public.api.bsky.app/xrpc";
  // Trending topics (reference's default path) — check the artifact concern directly.
  const topics = await getJSON(`${API}/app.bsky.unspecced.getTrendingTopics`);
  // Real post search (the path the task flagged as the actual differentiator).
  const search = await getJSON(`${API}/app.bsky.feed.searchPosts?q=${encodeURIComponent("AI agents")}&limit=10&sort=top`);
  const posts = search.body?.posts || [];
  return {
    trendingTopics: { status: topics.status, count: topics.body?.topics?.length ?? 0, sample: topics.body?.topics?.slice(0, 3) ?? null },
    postSearch: {
      status: search.status,
      count: posts.length,
      sample: posts.slice(0, 3).map((p) => ({
        text: p.record?.text?.slice(0, 100),
        author: p.author?.handle,
        likes: p.likeCount, reposts: p.repostCount, replies: p.replyCount,
        created_at: p.record?.createdAt,
        url: `https://bsky.app/profile/${p.author?.handle}/post/${(p.uri || "").split("/").pop()}`,
      })),
    },
    verdict: "getTrendingTopics = ARTIFACT (bare hashtag/phrase, same defect as X). searchPosts = EVENT (real post text, real engagement counts, real timestamp) — the search endpoint is the one worth adapting, not the trending-topics one.",
  };
}

// ---------- 3. DexScreener ----------
async function probeDexScreener() {
  const headers = { Accept: "application/json" };
  const boosts = await getJSON("https://api.dexscreener.com/token-boosts/top/v1", headers);
  const profiles = await getJSON("https://api.dexscreener.com/token-profiles/latest/v1", headers);
  const search = await getJSON("https://api.dexscreener.com/latest/dex/search?q=solana", headers);
  const pairs = search.body?.pairs || [];
  return {
    tokenBoosts: { status: boosts.status, count: Array.isArray(boosts.body) ? boosts.body.length : 0, sample: Array.isArray(boosts.body) ? boosts.body.slice(0, 2) : boosts.rawSample },
    tokenProfiles: { status: profiles.status, count: Array.isArray(profiles.body) ? profiles.body.length : 0, sample: Array.isArray(profiles.body) ? profiles.body.slice(0, 2) : profiles.rawSample },
    dexSearch: {
      status: search.status,
      count: pairs.length,
      sample: pairs.slice(0, 3).map((p) => ({
        name: `${p.baseToken?.symbol}/${p.quoteToken?.symbol}`,
        priceChange_h1: p.priceChange?.h1, priceChange_h24: p.priceChange?.h24,
        volume_h24: p.volume?.h24, pairCreatedAt: p.pairCreatedAt, url: p.url,
      })),
    },
    verdict: "token-boosts / token-profiles = ARTIFACT (a listing existing or being paid-promoted, not a market move). /latest/dex/search = EVENT (priceChange.h1/h24 and volume.h24 are genuine momentum signals — 'this moved X% in the last hour' is a real why_now).",
  };
}

// ---------- 4. ArXiv ----------
async function probeArxiv() {
  const url = "https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG&sortBy=submittedDate&sortOrder=descending&max_results=10";
  const { status, text } = await getText(url);
  const entries = parseItems(text); // rss.js already matches Atom <entry> (fixed for Product Hunt)
  const items = entries.map((e) => ({
    title: (tag(e, "title") || "").replace(/\s+/g, " ").trim(),
    url: link(e),
    published: tag(e, "published"),
  }));
  return {
    status, count: items.length, sample: items.slice(0, 3),
    verdict: "EVENT — sorted by submittedDate descending; published is the real submission timestamp. 'A new paper on this topic just dropped' is a genuine why_now, unlike a repo that's simply existed since 2019.",
  };
}

// ---------- 5. Indie Hackers ----------
async function probeIndieHackers() {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json, text/html, */*",
    Referer: "https://www.indiehackers.com/",
  };
  const api = await getJSON("https://www.indiehackers.com/api/stories?orderBy=hot&limit=10", headers);
  let scrape = null;
  if (api.status !== 200 || api.parseError) {
    const page = await getText("https://www.indiehackers.com/posts", headers);
    const matches = [...page.text.matchAll(/<a[^>]+href="(\/post\/[^"]+)"[^>]*>([^<]{10,100})<\/a>/g)].slice(0, 5);
    scrape = { status: page.status, matchCount: matches.length, sample: matches.map((m) => ({ path: m[1], title: m[2].trim() })) };
  }
  return {
    api: { status: api.status, parseError: api.parseError, rawSample: api.rawSample, count: Array.isArray(api.body) ? api.body.length : (api.body?.stories?.length ?? null) },
    scrapeFallback: scrape,
    verdict: null, // filled after seeing which path actually works
  };
}

// ---------- 6. LinkedIn Trending ----------
async function probeLinkedIn() {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/vnd.linkedin.normalized+json+2.1",
    "x-li-lang": "en_US",
    "x-restli-protocol-version": "2.0.0",
  };
  const voyager = await getJSON("https://www.linkedin.com/voyager/api/feed/trendingNewsArticles?q=trending&count=10", headers);
  const newsPage = await getText("https://www.linkedin.com/news/trending-topics/", {
    "User-Agent": headers["User-Agent"],
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  });
  const matches = [...newsPage.text.matchAll(/<h[23][^>]*>\s*([^<]{10,120})\s*<\/h[23]>/g)].slice(0, 5);
  return {
    voyager: { status: voyager.status, parseError: voyager.parseError, rawSample: voyager.rawSample },
    newsPageScrape: { status: newsPage.status, matchCount: matches.length, sample: matches.map((m) => m[1].trim()) },
    verdict: null,
  };
}

const probes = {
  lobsters: probeLobsters,
  bluesky: probeBluesky,
  dexscreener: probeDexScreener,
  arxiv: probeArxiv,
  indie_hackers: probeIndieHackers,
  linkedin_trending: probeLinkedIn,
};
for (const [name, fn] of Object.entries(probes)) {
  try {
    out[name] = await fn();
  } catch (e) {
    out[name] = { error: e.message };
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify(out, null, 2));
} else {
  for (const [name, result] of Object.entries(out)) {
    console.log(`\n${"=".repeat(72)}\n${name}\n${"=".repeat(72)}`);
    console.log(JSON.stringify(result, null, 2));
  }
}

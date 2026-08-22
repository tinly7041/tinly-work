#!/usr/bin/env node
// Phase 2B — Reddit source probe. EVALUATION ONLY.
// Not wired into categories.js/collect.js/rank.js — standalone script to
// produce real data on whether Reddit earns a pipeline slot.
//
// Ported from claude-world/trend-pulse's src/trend_pulse/sources/reddit.py,
// but PER-SUBREDDIT rather than r/popular. r/popular is undifferentiated
// across every category — exactly the failure mode Google Trends already
// has in the live pipeline. Same public JSON API (no OAuth), same
// requirement trend-pulse encodes: a descriptive User-Agent, or Reddit
// blocks/rate-limits much harder (60 req/min WITH a UA per their docs).
//
//   node scripts/probe-reddit.js              # all categories, summary
//   node scripts/probe-reddit.js web3         # one category
//   node scripts/probe-reddit.js --json > probe-reddit.json

const USER_AGENT = "tinly-work-trendpulse-probe/0.1 (github.com/tinly7041/tinly-work)";

// Proposed map from the task spec. Not wired anywhere — evaluation input only.
const SUBREDDITS = {
  ai: ["MachineLearning", "LocalLLaMA", "artificial", "OpenAI"],
  web3: ["ethdev", "CryptoCurrency", "defi", "solana"],
  fintech: ["fintech", "startups", "Entrepreneur"],
  saas: ["SaaS", "devops", "selfhosted", "programming"],
};

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const only = args.filter((a) => !a.startsWith("--"));
const cats = only.length ? only : Object.keys(SUBREDDITS);

async function getJSON(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  const status = res.status;
  const text = await res.text();
  let body = null;
  let parseError = null;
  try {
    body = JSON.parse(text);
  } catch (e) {
    parseError = e.message;
  }
  return { status, body, parseError, rawLength: text.length, rawSample: text.slice(0, 300) };
}

function parsePosts(json, subreddit, listing) {
  const children = json?.data?.children || [];
  return children.map((c) => {
    const p = c.data || {};
    return {
      title: p.title ?? null,
      url: p.url ?? null,
      permalink: p.permalink ? `https://reddit.com${p.permalink}` : null,
      score: typeof p.score === "number" ? p.score : null,
      num_comments: typeof p.num_comments === "number" ? p.num_comments : null,
      created_utc:
        typeof p.created_utc === "number" ? new Date(p.created_utc * 1000).toISOString() : null,
      subreddit: p.subreddit ?? subreddit,
      selftext_empty: !p.selftext || p.selftext.trim() === "",
      listing,
    };
  });
}

async function fetchSubreddit(sub) {
  const result = { subreddit: sub, top: null, hot: null, errors: [] };
  const listings = [
    ["top", `https://www.reddit.com/r/${sub}/top.json?t=week&limit=25`],
    ["hot", `https://www.reddit.com/r/${sub}/hot.json?limit=25`],
  ];
  for (const [listing, url] of listings) {
    try {
      const { status, body, parseError, rawSample } = await getJSON(url);
      if (status !== 200 || parseError || body?.error) {
        result.errors.push({ listing, status, parseError, apiError: body?.error, rawSample });
        result[listing] = { status, items: [] };
      } else {
        result[listing] = { status, items: parsePosts(body, sub, listing) };
      }
    } catch (e) {
      result.errors.push({ listing, error: e.message });
      result[listing] = { status: null, items: [] };
    }
    // Stay well under 60 req/min without being weirdly bursty.
    await new Promise((r) => setTimeout(r, 300));
  }
  return result;
}

function normUrl(u) {
  return (u || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").toLowerCase();
}

function dedupeByPermalink(posts) {
  const seen = new Map();
  for (const p of posts) {
    const key = p.permalink || p.title;
    if (!seen.has(key)) seen.set(key, { ...p, listings: [p.listing] });
    else {
      const existing = seen.get(key);
      if (!existing.listings.includes(p.listing)) existing.listings.push(p.listing);
    }
  }
  return [...seen.values()].map(({ listing, ...rest }) => rest);
}

const out = [];
for (const cat of cats) {
  const subs = SUBREDDITS[cat];
  if (!subs) {
    console.error(`unknown category: ${cat}`);
    continue;
  }
  const subResults = [];
  for (const sub of subs) subResults.push(await fetchSubreddit(sub));

  const allPosts = subResults.flatMap((r) => [...(r.top?.items || []), ...(r.hot?.items || [])]);
  const deduped = dedupeByPermalink(allPosts);
  deduped.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const urlVsPermalink = deduped.reduce(
    (acc, p) => {
      if (!p.url || !p.permalink) return acc;
      if (normUrl(p.url) === normUrl(p.permalink)) acc.same++;
      else acc.different++;
      return acc;
    },
    { same: 0, different: 0 }
  );

  const ages = deduped
    .map((p) => (p.created_utc ? (Date.now() - Date.parse(p.created_utc)) / 864e5 : null))
    .filter((a) => a !== null)
    .sort((a, b) => a - b);
  const medianAge = ages.length ? Number(ages[Math.floor(ages.length / 2)].toFixed(2)) : null;

  out.push({
    category: cat,
    subreddits: subs,
    perSubreddit: subResults.map((r) => ({
      subreddit: r.subreddit,
      top_count: r.top?.items?.length ?? 0,
      hot_count: r.hot?.items?.length ?? 0,
      top_status: r.top?.status ?? null,
      hot_status: r.hot?.status ?? null,
      errors: r.errors,
    })),
    total_unique_posts: deduped.length,
    url_vs_permalink: urlVsPermalink,
    median_age_days: medianAge,
    posts: deduped,
  });

  if (JSON_OUT) continue;
  console.log(`\n${"=".repeat(72)}\n${cat}\n${"=".repeat(72)}`);
  for (const r of subResults) {
    const flag = r.errors.length ? `  ERRORS: ${JSON.stringify(r.errors)}` : "";
    console.log(
      ` r/${r.subreddit.padEnd(20)} top:${String(r.top?.items?.length ?? 0).padStart(2)} (${r.top?.status})  hot:${String(r.hot?.items?.length ?? 0).padStart(2)} (${r.hot?.status})${flag}`
    );
  }
  console.log(
    ` TOTAL unique: ${deduped.length} | median age: ${medianAge}d | url==permalink: ${urlVsPermalink.same} | url!=permalink: ${urlVsPermalink.different}${deduped.length < 10 ? "  <-- THIN" : ""}`
  );
  console.log(` TOP 10:`);
  deduped
    .slice(0, 10)
    .forEach((p, i) =>
      console.log(
        `  ${String(i + 1).padStart(2)}. [${String(p.score).padStart(5)}] r/${(p.subreddit || "").padEnd(16)} ${(p.title || "").slice(0, 70)}`
      )
    );
}

if (JSON_OUT) console.log(JSON.stringify(out, null, 2));

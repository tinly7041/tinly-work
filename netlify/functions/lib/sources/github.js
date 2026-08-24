import { get, safe } from "./_http.js";
import { categorize } from "../matcher.js";

const API = "https://api.github.com/search/repositories";

// BUILD NOTE 1 — the important one.
// sort=stars WITHOUT created:> returns all-time star leaders, not trends.
// Verified live 21 Aug: the Web3 query returned openzeppelin-contracts (2016),
// solidity (2015); DevTools returned puppeteer (2017). `pushed:>` does not fix
// this — every large repo has a recent commit. `created:>` does.
//
// BUILD NOTE 1b. `created_at` is still the wrong value to put in `date`. Feeding it
// to the recency decay pinned every GitHub item to the score floor — a repo born
// 127 days ago that is hot THIS WEEK is not a 127-day-old trend.
// created:> filters. pushed_at scores.
//
// BUILD NOTE 1c. GitHub is a WEAK source for web3 specifically. Two query variants
// tested live 21 Aug both returned arbitrage bots, wallet clones and star-farmed
// repos in the top 6. AI returns genuinely notable projects at 10-100k stars; web3
// tops out around 2.7k and the quality is poor. web3 carries a weight override.
//
// STEP 6 GATE — min stars >= 10. GitHub's search query grammar (cfg.github)
// decides WHAT gets fetched; it has no idea whether the result is a real
// project or a five-minute fork with a description that happens to hit the
// query. A star floor is a cheap, honest proxy for "someone other than the
// author looked at this."
//
// `description` is kept as its own field (not just folded into `title`) so
// the exclude-list check can be verified against it directly. Every
// "ledger" false positive in the 23 Aug dump was in the description, not
// the repo name; excluding on name alone would have missed all of them.
//
// CATEGORY-GATES REWORK, live-verified necessary: cfg.github's boolean
// query (e.g. `... OR ledger` for fintech) is a DISCOVERY mechanism, same
// role HN's seed queries now play — it decides what GitHub's search API
// even returns, not whether an item actually belongs. Re-running the exact
// 23 Aug fintech query without a categorize() check reproduced the bug
// immediately (13 of 14 items were GitHub repos whose only fintech signal
// was the bare word "ledger" — a bounty board, a token-usage tracker, a
// personal finance CLI, a book's source-citation ledger). None of those
// contain an excluded term, so the exclude-list check alone does not catch
// them; they fail because "ledger" is `ambiguous`, not `include`, and none
// of them carry accompanying fintech context. Every adapter uses the same
// shared matcher (Step 1) — GitHub is not an exception just because it also
// has its own search grammar.
const MIN_STARS = 10;

export async function fetchGitHub(cfg, { perPage = 15 } = {}) {
  const born = new Date(Date.now() - (cfg.githubWindowDays || 90) * 864e5)
    .toISOString().slice(0, 10);
  return safe("github", async () => {
    const q = `${cfg.github} created:>${born}`;
    const u = `${API}?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${perPage}`;
    const headers = { Accept: "application/vnd.github+json" };
    // Unauthenticated search = 10 req/min. Authenticated = 30. Daily job is well
    // under either, but the probe script is not — set GITHUB_TOKEN.
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const j = await get(u, { json: true, headers });
    return (j.items || [])
      .filter((r) => (r.stargazers_count || 0) >= MIN_STARS)
      .map((r) => ({
        title: r.description ? `${r.full_name} — ${r.description}` : r.full_name,
        description: r.description || "",
        url: r.html_url,
        source: "github",
        raw: r.stargazers_count || 0,
        date: r.pushed_at,   // NOT created_at - see BUILD NOTE 1b
        born: r.created_at,
      }))
      .filter((it) => categorize(it, cfg).matched);
  });
}

import { get, safe } from "./_http.js";

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
    return (j.items || []).map((r) => ({
      title: r.description ? `${r.full_name} — ${r.description}` : r.full_name,
      url: r.html_url,
      source: "github",
      raw: r.stargazers_count || 0,
      date: r.pushed_at,   // NOT created_at - see BUILD NOTE 1b
      born: r.created_at,
    }));
  });
}

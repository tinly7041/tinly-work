# Pre-gate / post-gate cost split — measurement report

**Base commit:** `b6a5d6f` (branch `main`, working branch `claude/pre-post-gate-cost-measurement`)
**Status:** live-verified. All Anthropic API costs below are real calls against `claude-haiku-4-5` and `claude-sonnet-5`, run 2026-08-28. Nothing in this report is estimated except the section explicitly marked "calculated."

Harness: [scripts/measure-gate-cost.js](scripts/measure-gate-cost.js) — new file, measurement only. Reuses `classify.js`, `lib/pool.js`, `lib/read-pulse.js`, `lib/sources/competitor-news.js`, `lib/pricing.js` exactly as they exist on `main`. Nothing in the pipeline was restructured, `generate-pulse.js` was not touched, no cache or frontend was built.

Category pools were seeded live via `scripts/seed-cache.js --all` immediately before running (real, current source health — see caveats below).

---

## Method note: what "pre-gate" measures here

Pre-gate cost = `classify.js` cost + Pass 1 cost, with **no competitor items in the pool** — this is the real first-time-visitor case, not a simplification. `lib/entity-cache.js` (the only cache in the codebase) is keyed per competitor entity with a 7-day TTL and is populated *only* by the background function, *after* a lead is captured. A brand-new visitor's Pass 1 pool is therefore always just primary + secondary category items; competitor items don't exist yet at that point in a real request. This matches current code exactly — it isn't an assumption made for the harness.

Post-gate cost = competitor fetch (measured separately, its own stage) + Pass 2 cost, run over the same top-N Pass 1 selected exactly as `lib/read-pulse.js` does today.

---

## Per-brand results (3 runs each)

### Perplexity (ai) — perplexity.ai

| Run | Pool | Classify | Pass 1 | Pass 2 | Total | Pre-gate % |
|---|---|---|---|---|---|---|
| 1 | 50 | 782 in/104 out = $0.001302 | 3774 in/3662 out = $0.022084 | 3441 in/4718 out = $0.054062 | $0.077448 | 30.2% |
| 2 | 50 | 782 in/88 out = $0.001222 | 3759 in/3632 out = $0.021919 | 3412 in/3301 out = $0.039834 | $0.062975 | 36.7% |
| 3 | 50 | 782 in/101 out = $0.001287 | 3769 in/3774 out = $0.022639 | 3465 in/4670 out = $0.053630 | $0.077556 | 30.8% |

- Pre-gate range: **$0.023141 – $0.023926**
- Pass 2 range: **$0.039834 – $0.054062**
- Competitor fetch: entity "ChatGPT", query `"ChatGPT" AI` → 17 items, **$0** (839ms)

### Uniswap (web3) — uniswap.org

| Run | Pool | Classify | Pass 1 | Pass 2 | Total | Pre-gate % |
|---|---|---|---|---|---|---|
| 1 | 10 | 963 in/122 out = $0.001573 | 1946 in/836 out = $0.006126 | 2250 in/2158 out = $0.026080 | $0.033779 | 22.8% |
| 2 | 10 | 963 in/126 out = $0.001593 | 1951 in/814 out = $0.006021 | 2236 in/1982 out = $0.024292 | $0.031906 | 23.9% |
| 3 | 10 | 963 in/115 out = $0.001538 | 1942 in/841 out = $0.006147 | 2236 in/1465 out = $0.019122 | $0.026807 | 28.7% |

- Pre-gate range: **$0.007614 – $0.007699**
- Pass 2 range: **$0.019122 – $0.026080**
- Competitor fetch: entity "Curve Finance", query `"Curve Finance" crypto` → 2 items, **$0** (879ms)
- **Caveat:** web3's live pool was only 10 items at measurement time (source health degraded — the `Week in Ethereum News` feed failed to fetch during seeding). This is real, current data, not a synthetic thin case — see `healthy: false` in the seed-cache output.

### Wise (fintech) — wise.com

| Run | Pool | Classify | Pass 1 | Pass 2 | Total | Pre-gate % |
|---|---|---|---|---|---|---|
| 1 | 16 | 1293 in/120 out = $0.001893 | 2244 in/1259 out = $0.008539 | 3009 in/3208 out = $0.038098 | $0.048530 | 21.5% |
| 2 | 16 | 1230 in/115 out = $0.001805 | 2239 in/1298 out = $0.008729 | 3016 in/4575 out = $0.051782 | $0.062316 | 16.9% |
| 3 | 16 | 1230 in/121 out = $0.001835 | 2245 in/1290 out = $0.008695 | 3011 in/2631 out = $0.032332 | $0.042862 | 24.6% |

- Pre-gate range: **$0.010432 – $0.010534**
- Pass 2 range: **$0.032332 – $0.051782**
- Competitor fetch: entity "Remitly", query `"Remitly" fintech` → 0 items, **$0** (915ms)
- **Caveat:** fintech's live pool was 16 items at measurement time (3 news feeds returned 403/failed during seeding: Crowdfund Insider, e27, Fintech News Vietnam). Real, current data.

### Notion (saas + ai, dual-category) — notion.so

| Run | Pool | Classify | Pass 1 | Pass 2 | Total | Pre-gate % |
|---|---|---|---|---|---|---|
| 1 | 53 (3+50) | 1170 in/126 out = $0.001800 | 3945 in/4076 out = $0.024325 | 3438 in/4287 out = $0.049746 | $0.075871 | 34.4% |
| 2 | 53 (3+50) | 1170 in/116 out = $0.001750 | 3935 in/3945 out = $0.023660 | 3462 in/4063 out = $0.047554 | $0.072964 | 34.8% |
| 3 | 53 (3+50) | 1170 in/108 out = $0.001710 | 3926 in/3349 out = $0.020671 | **not run** — event gate dropped every item | $0.022381 | **100%** |

- Pre-gate range: **$0.022381 – $0.026125**
- Pass 2 range: **$0.000000 – $0.049746** (run 3 hit the quiet path — every Pass-1-scored item failed the `is_event` gate, so Pass 2 never ran; this is real pipeline behavior, not a harness bug)
- Competitor fetch: entity "Confluence", query `"Confluence" software` → 0 items, **$0** (842ms)
- Notion did hit the dual-category (saas+ai) case the brief anticipated. `saas`'s own live pool is thin (3 items — same source-health issue as fintech's feeds); `ai`'s live pool was the full 50. Combined 53, matching the "56-100" range the brief flagged, on the low end because `saas` news feeds are currently degraded.

---

## Worst-case pre-gate pool (calculated, not measured)

Both categories at `CACHE_TARGET` (50, `lib/categories.js`) depth, zero cross-category dedupe assumed (upper bound) = **100-item pool**.

Extrapolated from the measured Pass 1 token slope across all 12 live runs above (**not** a live 100-item run):

- Measured slope: 121.1 input tokens/item, 77.12 output tokens/item
- Estimated at 100 items: 12,110 in / 7,712 out
- **Estimated Pass 1 cost: $0.050669**
- Plus average measured classify cost ($0.001609) → **~$0.052278 total pre-gate, worst case**

---

## Daily abuse ceiling per IP (pre-gate only, 5/IP/day cap)

| Brand | Avg pre-gate/request | × 5/day |
|---|---|---|
| Perplexity | $0.023484 | $0.117422 |
| Uniswap | $0.007666 | $0.038330 |
| Wise | $0.010499 | $0.052493 |
| Notion | $0.024639 | $0.123193 |
| **Worst case (calculated)** | $0.052278 | **$0.261390** |

An attacker hitting the same worst-case dual-category brand from one IP costs **~$0.26/day**, pre-gate only, with nothing captured. Across the four measured real brands, typical pre-gate abuse cost per IP/day ranges **$0.038 – $0.123**.

---

## Cacheability of pre-gate results

**Finding (code inspection, live-verified against current source):**
- `classify.js` has no cache — every call re-fetches the site and re-calls Haiku.
- `lib/read-pulse.js` (Pass 1/Pass 2) has no cache — every call re-scores and re-writes.
- The only cache in the codebase, `lib/entity-cache.js`, caches **competitor-entity news only** (7-day TTL, keyed by normalized entity name), and is populated **exclusively** by the post-gate background function. It is never read or written by `classify.js` or `read-pulse.js`.

**Conclusion:** current code does **not** allow a second visitor entering the same brand+URL within a short window to read the first visitor's classify or Pass 1 output. Every hit re-pays in full, at whatever this report's per-brand numbers show.

**Proposed mechanism (not built — measurement brief only):**
- **Key:** SHA-256 of the normalized website (lowercased, scheme/`www.`/trailing-slash stripped) — not `brandName`, since a visitor may type the brand name differently but the URL is what `classify.js` actually fetches and is stable.
- **Store:** same file-then-Blobs pattern already used by `lib/pool.js` and `lib/entity-cache.js` — a new `lib/pregate-cache.js` module, `get`/`set` by that key.
- **Payload:** `{ primary, secondary, confidence, brand_read, site_read, inferred_competitors, pass1_scored, fetched_at }`. Pass 1's scored array is the expensive-to-reproduce part — cache that, not just the classify result.
- **TTL:** short, e.g. 6–12h. Category pools refresh on a ~2-day crawl cadence (`get-trends.js`'s `MAX_STALE_HOURS=60`) and a site's own content changes slower than that; a short TTL balances abuse protection against serving a visitor a pool that's already meaningfully stale relative to a fresh classify+Pass 1.
- **Read path:** the pre-gate handler checks this cache *before* calling `classify.js` at all. A hit skips classify AND Pass 1 entirely, serving the cached scored pool straight into the 2-title preview. A miss runs the real pipeline and writes the cache on the way out.
- This proposal touches only the two pre-gate calls — it does not change Pass 2, the gate, or anything downstream.

---

## Summary

- Pre-gate share of total pipeline cost ranged **17% – 37%** across normal runs, and **100%** on Notion's quiet-path run (Pass 2 never fires, so every dollar spent was pre-gate).
- Pool size is the main driver of pre-gate cost: Uniswap (10 items) pre-gate ≈ $0.0077; Notion (53 items) pre-gate ≈ $0.022–0.026 — roughly linear, consistent with Pass 1's per-item token slope.
- Worst-case dual-category pre-gate (~100 items, calculated) ≈ $0.052/request, ~4x a typical single-category brand's pre-gate cost.
- Competitor fetch is confirmed **$0** live for all 4 brands — Google News RSS is a plain HTTP GET, no metered API involved.
- Pre-gate results are **not currently cacheable** by any existing code path; a mechanism is proposed above but not built.

## Raw run log

Full console output (all 12 runs plus worst-case/abuse-ceiling/cacheability sections) is reproducible by running:

```
node --env-file=.env scripts/measure-gate-cost.js
```

or with `--json` for machine-readable output.

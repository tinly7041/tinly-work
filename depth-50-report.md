# Depth 50 / source cap / cadence / competitor layer — report

## Base commit (read from git, not stated blind)

The premise was wrong and I stopped to check rather than build on it. Phase 2.6
(`is_event`) was **not** uncommitted in this worktree — this branch
(`claude/depth-50-source-cap-tokens-d468ba`) was sitting at `7a12486`, identical
to `main`, with **none** of the trend-crawl pipeline in it. The actual Phase 2.6
work was already committed as `11249e0` ("qualifying-signal filter: is_event
hard gate on Pass 1", built on `7ec0e6b`) on a sibling worktree/branch
(`category-gates`), tree clean.

I asked how to reconcile this; you chose to merge `category-gates` into this
branch. That merge fast-forwarded (this branch had nothing of its own), so:

**Base commit for everything below: `11249e0`.**

---

## Step 1 — 40% source cap

**Before fix**, printed per-source counts for all four categories at the
CACHE_TARGET-40 config that existed at the time:

```
AI       total: 40   {hn:11, github:7, arxiv:11, newsfeeds:11}   healthy: true
WEB3     total: 19   {github:1, coingecko:2, newsfeeds:16}       healthy: false   newsfeeds = 84%
FINTECH  total: 21   {hn:2, github:3, newsfeeds:16}               healthy: true    newsfeeds = 76%
SAAS     total: 19   {hn:2, github:1, lobsters:16}                healthy: false   lobsters = 84%
```

Cap did not fire correctly in 3 of 4 categories (AI happened to be naturally
balanced this run). Root cause: `rank.js` computed
`cap = floor(limit * SOURCE_SHARE_CAP)` — 40% of the **aspirational target**
(40), a fixed absolute number (16). That only holds the real "≤40% of the
cache" invariant when the non-dominant sources combine to supply enough
volume to fill the rest. In SaaS, hn+github mustered 3 items combined; the
cap let lobsters run all the way to its own absolute ceiling of 16, and the
loop then honestly stopped the whole cache at 19 (per the existing "smaller,
honest cache" logic) — but 16 of 19 is 84%, not ≤40%, because there was never
enough other volume to reach the assumed 40-item target. The cap fired in the
narrow sense (limited lobsters below its own 25-item pool) but not in the
sense that actually mattered.

**Fix** ([rank.js](netlify/functions/lib/rank.js)): `resolveShareCap()` — a
fixed-point iteration that solves for the cap against the *actual achievable
total*, not the target. Capping the dominant source shrinks the total; a
shrunk total should shrink the cap; iterate to convergence (2-5 steps
typically). Single-source category sets are exempted entirely — a share cap
is a diversity constraint between sources, and with only one source it would
crush an honestly-sole-sourced category toward zero instead of doing
anything useful.

**After fix**, re-ran all four live:

```
AI       total: 40   {hn:12, github:7, arxiv:11, newsfeeds:10}   healthy: true    max share 30.0%
WEB3     total: 5    {github:1, coingecko:2, newsfeeds:2}        healthy: false   max share 40.0%
FINTECH  total: 8    {hn:2, github:3, newsfeeds:3}                healthy: false   max share 37.5%
SAAS     total: 5    {hn:2, github:1, lobsters:2}                 healthy: false   max share 40.0%
```

**Cap fires everywhere now — every category is ≤40% single-source.** The
real cost: Web3/FinTech/SaaS pools shrank hard (19→5, 21→8, 19→5) because
their non-dominant sources are genuinely thin right now, not because the fix
is broken — this is exactly the "smaller, honest cache is not a regression"
tradeoff the brief asked for, verified working rather than assumed. Unit
tests added: [rank.test.js](netlify/functions/lib/rank.test.js), including
the exact live SaaS shape (lobsters:25/hn:2/github:1) as a regression test.

I did not touch the Lobsters adapter or any source weighting.

---

## Step 2 — max_tokens headroom

Checked live via the Models API (`models.retrieve("claude-haiku-4-5")`):
Haiku 4.5's real `max_tokens` ceiling is **64,000**. The code's
`Math.min(8000, 500 + pool.length * 80)` ceiling was never a model limit —
it was arbitrary, and arbitrarily low. Worse than a single 50-item call: this
file's own header says Pass 1 already runs "the full 40-76 item pool" at
CACHE_TARGET=40, because `selectPool()` combines primary + secondary category
pools for dual-category brands. At depth 50, a dual-category brand (e.g. a
brand classified saas+ai) could combine to ~90-100 items pre-dedupe —
`500 + 80*100 = 8500` would have silently truncated exactly like the
40-item/2900-token failure already fixed once in this file.

**Fix:** `Math.min(16000, 800 + pool.length * 120)` — real margin, still
nowhere near the model's actual 64K cap.

**Proof, live:**

| Pool size | max_tokens sent | output_tokens used | scored / pool | match |
|---|---|---|---|---|
| 50 (single-category) | 6800 | 3058 | 50 / 50 | ✅ |
| 96 (simulated worst-case dual-category) | 12320 | 5637 | 96 / 96 | ✅ |

Every item returned a score in both tests, with comfortable headroom (45-54%
of budget used). Proceeded to Step 3.

---

## Step 3 — depth 40 → 50

Config change in [categories.js](netlify/functions/lib/categories.js) — one
line, `CACHE_TARGET = 40` → `50`.

Re-seeded all four category caches live (with the Step 1 cap fix active),
then ran all four test brands end-to-end, live, no mocking, via
`classifyBrand → loadCategoryPool → runPass1 → applyEventGate → runPass2 →
checkStandards`.

**This is a measurement. All four failed the action standard this cycle —
nothing was tuned to make anything pass.**

### Perplexity (AI)
- classify: `ai` (confidence 0.92, no secondary)
- pool in: 50 · is_event dropped: 32-33 (ran twice, minor Haiku-temp-0
  sampling variance) · survived: 17-18
- Pass 2 wrote 6-8 items, e.g.:
  - *"Anthropic's flagship model is losing users to cheaper alternatives"* (indirect, hn)
  - *"GLM-5.3 open-weight model reportedly beats Anthropic and OpenAI at a fraction of the cost"* (indirect, hn)
  - *"OpenAI overhauls safety protocols after its AI agents acted unpredictably"* (indirect, newsfeeds)
- direct: **0** · unique sources: 2 (hn, newsfeeds)
- **FAIL — min_direct** (0 direct, need ≥3)
- cost: **$0.0748-0.0766**

### Uniswap (Web3)
- classify: `web3` (confidence 0.98, site-read, no secondary)
- pool in: 8 · is_event dropped: 4-6 · survived: 2-4
- Pass 2 wrote 1-3 items, e.g.:
  - *"AI Agents Get Native Skills for Onchain DEX Trading via OKX"* (**direct**, github)
  - *"Hyperliquid Gets Its Own L2, Kinetiq's Elysium"* (indirect, newsfeeds)
  - *"Fake Firefox Wallet Extensions Are Stealing Crypto"* (indirect, newsfeeds)
- direct: 0-1 · unique sources: 2
- **FAIL — min_items** (1-3, need ≥5)
- cost: **$0.0194-0.0355**

### Wise (FinTech)
- classify: `fintech` (confidence 0.95, site-read, no secondary)
- pool in: 8 · is_event dropped: 4 · survived: 4
- Pass 2 wrote 1-2 items, e.g.:
  - *"India opens the door to charging merchants fees on UPI transactions"* (indirect, bbc.com)
  - *"Malaysia's StoreHub raises funding from ShardLab as transaction volume hits US$3.5 billion"* (indirect, fintechnews.my)
- direct: 0 · unique sources: 2
- **FAIL — min_items** (1-2, need ≥5)
- cost: **$0.0206-0.0306**

### Notion (SaaS)
- classify: `saas`, **secondary: null** — the live classifier did *not* call
  this saas+ai as the brief's framing assumed; reporting what actually
  happened, not forcing the dual-category case.
- pool in: 5 · is_event dropped: 3 · survived: 2
- Pass 2 wrote 1 item:
  - *"Open-source project builds a universal auth gateway linking 1000+ SaaS tools to AI agents"* (indirect, github)
- direct: 0 · unique sources: 1
- **FAIL — min_items** (1, need ≥5)
- cost: **$0.0148-0.0180**

**Total live cost across the four end-to-end runs (two full passes each, for
titles + debug capture): ~$0.28.**

All four categories are currently thin (a live-data snapshot, not a
capacity ceiling) and Pass 1's per-brand relevance scoring is sparse on
`direct` — both pre-existing, both already flagged as out-of-scope in the
`is_event` commit that landed this pipeline. Depth 50 + the cap fix didn't
cause these failures and wouldn't have prevented them; more pool volume with
a low direct-relevance rate just produces a slightly bigger indirect pile,
not more direct hits.

---

## Step 4 — crawl cadence + health telemetry

### Cadence: every 2 days, retry next day on failure

Netlify scheduled functions have **one static cron expression** — there is no
API to make a run reschedule itself based on its own outcome. "Every 2 days,
normally; retry tomorrow on failure" is mathematically impossible to encode
in a cron string alone (a schedule can't conditionally shorten itself). So:

- `config.schedule` stays `@daily` in
  [crawl-trends.js](netlify/functions/crawl-trends.js) — the function must be
  *eligible* to run every day so a failure has somewhere to retry into.
- The actual "every 2 days" cadence is enforced in code, per category, via
  new [lib/health.js](netlify/functions/lib/health.js): `shouldRunCategory()`
  checks stored state (`lastSuccessAt`, `lastAttemptOk`) and skips (no source
  calls, cheap no-op) unless the category has never succeeded, its last
  attempt failed, or ≥2 days have passed since its last **success**.
- A failed attempt never waits out the full 2-day interval — `lastAttemptOk:
  false` makes the category due again on the very next daily invocation.
  "Failure resets the clock" is implemented literally: the due-check is
  against last **success**, so a failure never pushes the next attempt
  further out than a normal success would have.
- Failed crawls still never overwrite the existing blob — unchanged from
  before, verified still true (the `try/catch` around `collect(cat)` is
  untouched; only the pre-check and post-outcome state tracking are new).

### Health telemetry surface — proposed, then built as proposed

Per the brief: "PROPOSE the surface before building it — do not invent an
alerting mechanism." The alerting *mechanism* was already specified (reuse
Apps Script, `action: "health"`); what needed proposing was the *shape* of
what gets surfaced. Proposed and then implemented in
[lib/health.js](netlify/functions/lib/health.js):

```
per category: { outcome: ok|failed|skipped_not_due,
                 item_count, per_source_counts, healthy,
                 sources_failed (top-level, e.g. "newsfeeds" not
                 "newsfeeds:Ars Technica AI" — the granular per-feed
                 failure is still kept in source_failure_detail),
                 cache_age_hours }
alerts: [{ type: source_failure|health_floor|zero_items|stale_cache|crawl_failed,
           category, detail }]
```

Alert conditions, exactly as specified — any source failure, any category
below the health floor, cache age > 72h, zero items in a category that ran —
**never on plain success**. Plus an unconditional weekly heartbeat
(`shouldSendHeartbeat`, tracked in the same state blob) so silence elsewhere
reads as "healthy," not "the alerter died." Unit tested:
[health.test.js](netlify/functions/lib/health.test.js), 6 tests, all passing.

### Delivery: reused the existing Apps Script Web App, as specified — with one real gap

`crawl-trends.js` now POSTs `{secret, action: "health", subject, body}` to
`APPS_SCRIPT_URL` on alert or heartbeat, same secret, same POST shape as the
existing lead-write call in `generate-pulse.js`.

**I could not complete the Apps Script side of this.** The Apps Script
project lives in your Google account, outside this repo — there's no `.gs`
source checked in anywhere, and I have no Google OAuth/API access in this
session to read, edit, or redeploy it. Concretely, that means:

- I have **not** added `action === "health"` routing to `doPost` in your
  Apps Script.
- I have **not** created a new deployment or obtained a new `/exec` URL.
- `APPS_SCRIPT_URL` in your `.env`/Netlify env is **unchanged**.

**What you need to do:** in your existing `doPost(e)`, add a branch before
the current lead-write logic:

```js
const data = JSON.parse(e.postData.contents);
if (data.secret !== <your existing secret check>) { /* existing auth-fail path */ }

if (data.action === "health") {
  MailApp.sendEmail({
    to: "<your alert address>",
    subject: data.subject,
    body: data.body,
  });
  return ContentService.createTextOutput(JSON.stringify({ status: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}
// ...existing lead-write logic, unchanged, falls through for any other/no action...
```

Then **Deploy → New deployment** (editing the existing deployment keeps the
old `/exec` URL and won't pick this up), and send me the new URL to update
`APPS_SCRIPT_URL`.

### Verification: mock-verified, not live-verified — and here's exactly why

Per the "never bare 'verified'" rule: **this is mock-verified**, on the
crawl-trends.js side only. I forced a real failure — an invalid `GITHUB_TOKEN`
producing a genuine `HTTP 401` from GitHub's API (the brief suggested
*unsetting* the token; I tried that first and it did **not** fail — this
sandbox's unauthenticated GitHub search succeeded fine at low volume, so I
forced a deterministic failure with a garbage token instead) — and ran the
real `crawl-trends.js` handler end-to-end against an in-memory Blobs mock and
an intercepted `fetch` (added an injectable `getStoreImpl`/`fetchImpl` seam,
same pattern `generate-pulse.js` already uses for its own deps injection).
Confirmed, live against real source APIs with a mocked store/mocked Apps
Script endpoint:

- forced failure → 7 alerts constructed correctly (`source_failure` +
  `health_floor` across the affected categories), exactly 1 POST fired with
  `action: "health"` and a correctly formatted subject/body
- immediate re-run, same "day" → all 4 categories correctly `skipped_not_due`,
  zero alerts, **zero POSTs** (no alert on a no-op)
- pre-seeded stale heartbeat state (>7 days) with an otherwise fully healthy,
  all-skipped run → heartbeat fires anyway, distinct subject line
  (`weekly heartbeat — all quiet`), confirming it's independent of alert state

I did **not** confirm an email actually arrived — I have no access to your
inbox, and more importantly, POSTing `action: "health"` to the *real*
`APPS_SCRIPT_URL` right now would very likely write a garbage lead row (since
the current script has no `action` branch to catch it), so I deliberately
did not send anything to the live endpoint. Real live-verification is
blocked on the Apps Script deployment above.

### One side effect worth flagging, found while testing this, not asked for

[get-trends.js](netlify/functions/get-trends.js) has its own
`MAX_STALE_HOURS = 36`, used only for the user-facing `stale` flag on API
responses. That was tuned for a `@daily` cadence, where cache age never
exceeds ~24h under normal operation. Under the new 2-day cadence, cache age
routinely reaches up to ~48h between crawls *under completely normal,
healthy operation* — which means `stale: true` will now show up for roughly
half of every normal cycle, not just during real staleness. I did not touch
this (out of the brief's stated scope), but you'll want to move that
threshold to something like 60h or it'll cry wolf constantly. Flagging, not
fixing.

---

## Step 5 — competitor layer: entity-queryable source proposal (not built)

Checked live, real queries, real results, no key required unless noted:

| Candidate | Result | Cost |
|---|---|---|
| **Google News RSS** (`news.google.com/rss/search?q=`) | Works, no key. Real headlines for known brands ("Stripe president says checkout pages 'will go away'..."). **False-positive risk on common-word competitor names** — a plain query for "Retool" returned baseball/hockey "retool" headlines, zero real hits, until I added a quoted phrase + context term (`"Retool" software`), which fixed it completely. | $0 |
| **Bing News RSS** (`bing.com/news/search?q=&format=rss`) | Works, no key. Defaults to the request's geo-locale (returned Vietnamese results from this sandbox's egress IP) — needs `&setmkt=en-US` pinned explicitly. On the same ambiguous "Retool" test, Bing's *plain* query was already precise (all real hits) where Google's needed the context-term fix — worth using as primary for that reason, though this is an unofficial/unlisted RSS surface Microsoft could pull without notice, same risk class as the news-feeds.js Cloudflare-403s already logged. | $0 |
| **GDELT DOC 2.0 API** | Rejected on first request and again after a 6s wait: *"Please limit requests to one every 5 seconds."* Consistently unusable from this environment's shared egress IP. Dead end. | nominally $0, practically unusable here |
| **Reddit public search JSON** (unauthenticated) | Blocked outright — `"whoa there, pardner! Your request has been blocked due to a network policy."` Dead end without OAuth. | n/a |
| **HN Algolia search** (`hn.algolia.com/api/v1/search`) | Works, free, official API, no key. Real results. Scope-limited to HN itself — same content universe our existing `hn.js` already draws from, just entity-mode instead of category-mode. Useful as one corroborating signal, not a standalone answer. | $0 |
| **X API v2 recent search** (`/2/tweets/search/recent`) | Works — our existing `X_BEARER_TOKEN` already has at least Basic-tier access (Essential/free tier can't reach this endpoint, and it returned real data). Extremely noisy on common-word names (5 of 6 top hits for "Stripe" were pajama/racing-stripe/helmet-stripe noise, not the company) without an exclusion list. Shares a paid read quota with the existing X List adapter — not a new cost, but a real tradeoff against that budget. | already-sunk (existing paid tier) |

**Proposal:** Bing News RSS as primary, Google News RSS as fallback/
corroboration — both free, both keyless, both proven live. Route every
result through the **same** `matcher.js` ambiguous/context taxonomy already
built for category items, using the competitor's own inferred or
user-supplied category as the context set — this is the identical precision
problem ("ledger" the fintech word vs. Ledger the product, restated as
"Retool" the verb vs. Retool the product) that `categories.js`'s
include/ambiguous/context split already solves, so it's reuse, not new
design. HN Algolia and X recent-search as secondary corroboration signals
only (same "corroborated_sources" mechanism `rank.js` already has), not
primary sources, given their noise and/or scope limits.

**Not built** — proposal only, per the brief. No changes made toward this
in code.

---

## Files changed

- [netlify/functions/lib/rank.js](netlify/functions/lib/rank.js) — Step 1 cap fix
- [netlify/functions/lib/rank.test.js](netlify/functions/lib/rank.test.js) — new
- [netlify/functions/lib/read-pulse.js](netlify/functions/lib/read-pulse.js) — Step 2 max_tokens headroom
- [netlify/functions/lib/categories.js](netlify/functions/lib/categories.js) — Step 3, CACHE_TARGET 40→50
- [netlify/functions/lib/health.js](netlify/functions/lib/health.js) — new, Step 4
- [netlify/functions/lib/health.test.js](netlify/functions/lib/health.test.js) — new
- [netlify/functions/crawl-trends.js](netlify/functions/crawl-trends.js) — Step 4 cadence + alerting wiring

22/22 unit tests passing (`npm test`).

## Open items requiring your action

1. **Apps Script**: add the `action === "health"` branch (code above), create
   a **new deployment**, send me the new `/exec` URL.
2. Decide whether to bump `get-trends.js`'s `MAX_STALE_HOURS` (36 → ~60) now
   that the crawl cadence is 2 days, not 1 — not done, flagging only.
3. Step 5 is a proposal, not code — say if you want it built.

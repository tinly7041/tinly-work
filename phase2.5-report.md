# Phase 2.5 — Read Layer & Backend Harness

**Branch:** `phase2.5-read-layer` off `staging@ab567dd`
**Scope:** backend only. No frontend, no gate, no lead capture. Turnstile, IP rate limiting, Apps Script, email, and all four UI states are explicitly out of scope (Phase 3.5/4). The running staging trial (`crawl-trends.js` on its `@daily` schedule) was not touched.
**All numbers below are live-verified** — real Anthropic API calls (Haiku 4.5 for classification, Sonnet 5 for the read layer), real site fetches, real cached trend pools. Nothing here is mocked.

---

## Step 1 — Classifier upgrade: read the website

**Problem:** `classify-brand.js` classified off the brand name alone. A bare name gives almost nothing to work with for early-stage/unknown brands, which was the root cause of thin, generic reads downstream.

**What changed:**
- [`netlify/functions/lib/classify.js`](netlify/functions/lib/classify.js) (new) — fetches the site (5s timeout), extracts `<title>`, meta description, all `og:*` tags, and ~1500 chars of body text with `<script>/<style>/<nav>/<footer>` stripped. Fetch failure falls back to name-only classification and sets `site_read: false` — never hard-fails.
- Categories are pulled directly from [`lib/categories.js`](netlify/functions/lib/categories.js)'s `ACTIVE` list (`ai`, `web3`, `fintech`, `saas`) rather than a separate hardcoded enum, so classification can never drift from what trend pools actually exist.
- No hardwired cross-category rule. `secondary` is model-decided per brand and defaults to `null` — most brands should get no secondary.
- New return shape: `{primary, secondary, confidence, brand_read, site_read}`.
- [`netlify/functions/classify-brand.js`](netlify/functions/classify-brand.js) rewritten as an ESM Netlify handler around the new lib. Also caught and fixed a stale dated model ID (`claude-haiku-4-5-20251001` → `claude-haiku-4-5`).
- [`netlify/functions/lib/pricing.js`](netlify/functions/lib/pricing.js) (new) — per-model USD pricing for the cost math used in `--debug`.

**Live result — the acceptance test (Avis, avis.xyz):**
```json
{
  "primary": "ai", "secondary": null, "confidence": 0.95,
  "brand_read": "AVIS is a platform that provides unified API access to multiple AI models (functioning as a gateway layer) and an app store distribution channel for AI applications. It positions itself as infrastructure that connects builders to models on one side and end users on the other, abstracting model provider switching and reducing lock-in.",
  "site_read": true
}
```
Reads as a router/gateway/aggregator, not "an AI company" — passes the bar set in the brief. Also spot-checked on Stripe (`fintech + web3` secondary, correctly picked up crypto rails), Linear (`saas + ai`), Uniswap (`web3`, no forced secondary), and Notion (`saas + ai`, lower confidence reflecting genuine ambiguity).

---

## Step 2 — Local cache seeder

**What changed:**
- [`scripts/seed-cache.js`](scripts/seed-cache.js) (new) — runs `collect()` (unmodified, reused from `lib/collect.js`) per category, writes `.cache/trends-<category>.json` in the exact shape Blobs stores (`fetched_at, category, label, items, health, reference`). Flags: `--all`, `--category <name>`, `--max-age <hours>`.
- `.cache/` added to `.gitignore`.

**Live result — `node scripts/seed-cache.js --all`:**

| category | items | healthy | unique sources |
|---|---|---|---|
| ai | 40 | true | 5 |
| web3 | 40 | true | 6 |
| fintech | 23 | true | 3 |
| saas | 40 | true | 4 |

First run (before a `GITHUB_TOKEN` was added to `.env`) had GitHub 403-ing on every category and fintech landed unhealthy (8 items, 2 sources) — failed soft exactly as designed, no crawl-wide failure. Re-seeding after the token was added fixed all four categories, including fintech (8→23 items).

---

## Step 3 — Sonnet read layer

**What changed:**
- [`netlify/functions/lib/pool.js`](netlify/functions/lib/pool.js) (new) — `loadCategoryPool(catKey)` reads `.cache/` if present, else falls back to Blobs. One code path, chosen by file presence.
- [`netlify/functions/lib/read-pulse.js`](netlify/functions/lib/read-pulse.js) (new) — `selectPool()` combines primary+secondary items and reuses `dedupe`/`applyCorroborationBoost` from `rank.js` unmodified (no forked corroboration logic). `generatePulseRead()` builds the prompt, calls Sonnet, and enforces the action standards **in code**, never as a stated target in the prompt:
  - `items.length >= 5`
  - `direct relevance count >= 3`
  - `unique sources >= 2`
  - any returned `url` not present in the input pool rejects the entire response
  - below floor → discard everything, return the quiet-path object

**Bug caught live:** first call truncated mid-JSON at `max_tokens: 2000` — five items × six fields plus the thinking-token budget genuinely need more room. Fixed by raising to `4096`.

**Live result (Avis, 40-item `ai` pool):** first call returned only 4 honest items → correctly discarded to quiet (`min_items`). Second call passed (5 items, 3 direct, 3 unique sources) with specific, source-grounded output (see Step 5 for the full text). This first exposed the run-to-run variance that shaped how Step 5 was run — see below.

---

## Step 4 — CLI harness

**What changed:**
- [`scripts/generate-report.js`](scripts/generate-report.js) (new). Chain: `classifyBrand()` → `loadCategoryPool()` per category (wrapped so a missing local cache **and** missing/unconfigured Blobs is treated as "no pool," not a crash) → `generatePulseRead()` → print.
- Three modes, all live-verified: default (readable text), `--json` (raw), `--debug` (adds classifier fields, pool sizes, per-standard pass/fail detail, token usage + cost).

No changes to `generate-pulse.js`'s abuse gate — this harness is standalone; wiring it into the gated path is Phase 3.5/4 work.

---

## Step 5 — Real brand runs

Because Step 3 exposed run-to-run variance (same brand, same pool, different pass/quiet outcome from one Sonnet call to the next), each brand below was run **3 times** against the same cached pool rather than once, so the quiet-rate numbers below are a real rate, not a coin flip. Total cost for this test session: **$0.5749** across 20 API calls (16 Sonnet + 4 Haiku).

### Avis (avis.xyz) — AI infrastructure, the router/aggregator case
`primary: ai, secondary: null, confidence: 0.95` · pool: 40 items, healthy
**Runs: 1 pass, 2 quiet** (fail reasons: `min_items`, `min_direct`)

Full report (passing run):
> Avis, the model landscape you're abstracting away just got more fragmented and more agent-heavy at the same time. Two GitHub projects this week are solving pieces of your exact problem (provider swapping, harness orchestration), and the Nvidia-Poolside news signals the model zoo you need to support is about to get bigger, not smaller.

1. **New open-source tool lets you swap any LLM into Claude Code or Codex CLI without rewriting** — direct/quick — [github.com/lidge-jun/opencodex](https://github.com/lidge-jun/opencodex) — *so_what:* "worth a reaction on why that abstraction layer needs to be a platform, not a script"
2. **Omnigent launches as a meta-harness to orchestrate Claude Code, Codex, Cursor and custom agents** — direct/quick — [github.com/omnigent-ai/omnigent](https://github.com/omnigent-ai/omnigent)
3. **Nvidia reportedly putting $6B into Poolside to build a rival open-weight model** — direct/quick — [x.com/i/web/status/2091371098172768333](https://x.com/i/web/status/2091371098172768333)
4. Local LLM quantization thread — indirect/quick
5. "Consumer AI is underrated" — indirect/quick, tied to SEA government-services/informal-finance framing

**My technical read:** specific, source-grounded, not "AI is growing." Names real competing projects and reacts to Avis's actual gateway/marketplace thesis.

**Founder's verdict (recorded 2026-08-23):** *"Still read as unclear bulletin. It reads like a digital newspaper. It must drill down much more on the so-what, [with a] concrete action recommendation... The trend pulse itself can be more engaging, insightful and more actionable — like, what social post they can air in the next 24hr to 'steal the spotlight' before someone else does. This can be well leveraged by synthesis ability from AI."*

→ **Open item:** the current `so_what` field names an angle ("worth a reaction on why...") but stops short of a concrete, time-boxed action. The locked schema's `so_what` is deliberately "the opening, not the execution" per the Phase 2.5 spec — this founder feedback suggests the next iteration needs either a sharper `so_what` (closer to "post X within 24h, framed as Y") or a genuinely new field for a time-boxed action recommendation. That's a schema/prompt decision, not something to change unilaterally — flagging for a decision, not implemented.

### Wise (wise.com) — FinTech, the honest test
`primary: fintech, secondary: null, confidence: 0.95` · pool: 23 items, healthy (borderline against collect.js's `>=20 items, >=3 sources` gate)
**Runs: 0 pass, 3 quiet** (all three: `min_items`, Sonnet returning only 3 items each time)

Full report:
> Wise's categories are quiet right now — nothing in the pool cleared the bar for a real pulse this cycle.

**My technical read:** the valid result the brief predicted for FinTech, not a failure. Precisely: Sonnet didn't find irrelevant items and correctly discard them — it consistently found fewer than 5 items it was willing to commit to at all, out of a pool that's mostly generic payments/neobank/API launches, not cross-border-remittance-specific.

**Founder's verdict:** *"I don't see the full pool and the read that laid out, I cannot judge. But that would mean the report would not be helpful to Wise's professionals?"*

→ Correct — as built, a quiet result today means **no report is shown at all**, so it can't be helpful or unhelpful; there's nothing delivered. Whether that's the right product behavior (silence) versus something lighter-weight (e.g., "here's what we found, none of it cleared the bar, but here's the raw activity") is a product decision for Phase 3.5/4, not something this backend layer decides on its own. **Open item:** raw pool contents (all 23 fintech items, with title/source/date) weren't included in this report — worth a follow-up dump if the fintech source config itself needs tuning (keyword expansion in `categories.js`) rather than just accepting the quiet result as the pool's ceiling.

### Retool (retool.com) — B2B SaaS
`primary: saas, secondary: ai, confidence: 0.92` · pool: 40+40 items → 76 after cross-category dedupe (4 dupes removed), healthy
**Runs: 2 pass, 1 quiet** (fail reason: `min_items`)

Full report (passing run):
> Retool, the pool this week is thick with 'agent harness' and 'connector' tools that are circling exactly the territory you already own: wiring AI agents into internal systems with some notion of governance.

1. **Open-source auth gateway connects 1000+ SaaS providers to AI agents via MCP** — direct — [github.com/oomol-lab/open-connector](https://github.com/oomol-lab/open-connector)
2. **FetchSandbox MCP launches on Product Hunt** — direct
3. **YC-backed Vendo lets users build features on top of your product** — direct
4. Omnigent (agent-harness governance) — indirect
5. Mocktail (mock API server) — indirect

**My technical read:** the sharpest of the four outputs — names real, specific competing/adjacent launches and ties each to Retool's actual MCP/governance angle. Clearly benefited from secondary-category pooling (see Q3 below).

**Founder's verdict:** *"Probably the sector has become more crowded. With this kind of cohort, we must give clearer implication of action, and linked with tinly.work's essence: cut-through positioning and amplify them well enough before it's too late."*

→ Same open item as Avis: the content selection and category-fit are working (this is the best of the four for accuracy), but the `so_what` layer needs to go further toward tinly.work's actual positioning — a concrete, urgency-framed "cut through and amplify before it's too late" action, not just a pointed observation. Both Avis and Retool's feedback converge on the same fix target: **the `so_what` field, or a field alongside it, needs to become an actual action recommendation, not just a narrowed angle.**

### Uniswap (uniswap.org) — Web3
`primary: web3, secondary: null, confidence: 0.99` · pool: 40 items, healthy
**Runs: 0 pass, 3 quiet** (`min_direct`, `min_items`, `min_items`)

Full report:
> Uniswap's categories are quiet right now — nothing in the pool cleared the bar for a real pulse this cycle.

**My technical read — flagged as a real limitation, not noise:** this is a *healthy* pool by the collect.js gate, and Uniswap is one of the best-known brands in its category, yet it went quiet 3/3. The `web3` pool is broad crypto/DeFi/token news (memecoins, other protocols, trending CoinGecko tokens) — Sonnet is correctly declining to force a "direct" label onto items that are crypto-adjacent but not actually about DEX/AMM mechanics. **The read layer appears to work better for infra/platform brands that plausibly relate to many pool items (Avis, Retool) than for a single well-defined end-user protocol competing against a pool of only tangentially related news.**

**Founder's verdict:** *"It's not an ideal case, at all. Let's document and figure how to fix it."*

→ **Open item, documented for a follow-up fix.** Candidate directions (none implemented, all need a decision):
1. Narrower web3 sub-vertical pools in `categories.js` (e.g. split DEX/AMM from broader token/NFT/chain-infra news) so a DEX-specific brand has a pool actually shaped like its business.
2. A pre-selection relevance pass before the 5-item schema is asked for — score raw pool items against the brand specifically (not just category) before Sonnet writes, rather than relying on the writing pass alone to also do the filtering.
3. Accept that some brands in broad categories will legitimately go quiet more often, and treat that as correct rather than a defect — decide this per-category, not universally.

---

## The four questions

**1. Does `brand_read` visibly change item selection versus category alone?**
Yes, starkly. Same Avis pool, identical everything else, two runs:
- **With** the real `brand_read` → passed, 5 specific items, pulse_summary naming Avis's actual gateway/marketplace bet.
- **Without** it (generic placeholder: "A company operating in this category. No further detail available.") → **zero items returned**, immediate quiet.

Without brand context, Sonnet couldn't confidently call anything "direct" for an unknown company and returned nothing rather than guess. `brand_read` is load-bearing, not decorative.

**2. How often does the action standard drop a brand to quiet, and which standard fires first?**
Across 12 runs (4 brands × 3): **9/12 (75%) went quiet.** Of those 9 quiet outcomes: `min_items` fired **7 times (78%)**, `min_direct` fired **2 times (22%)**, `min_unique_sources` fired **0 times**. The item-count floor is overwhelmingly the bottleneck — even healthy 40-item category pools routinely aren't specific enough to a given brand for Sonnet to commit to 5 honest picks. This is a high enough rate to be a product decision point: it means most reports, most of the time, currently land on "nothing yet." Whether that's the intended honesty or needs prompt/pool tuning is a call for the product owner — flagged, not fixed unilaterally, since the brief explicitly forbids telling the model a target count as a workaround.

**3. Does secondary-category pooling help, or dilute?**
Helps, clearly, in the one case tested (Retool, `saas+ai`): primary-only pool (40 items, 4 sources) → **failed** (`min_direct`, only 2 direct items). Primary+secondary pool (76 items after dedupe, 6 sources, 4 genuine cross-category dupes) → **passed** (4 direct, 3 unique sources). The secondary pool added real additional direct hits — not noise — and produced genuine cross-category corroboration (the same 4 stories independently surfaced under both category searches).

**4. Actual cost per report:**
A single normal report (1 Haiku classify call + 1 Sonnet read call — the Sonnet call runs and is billed whether it passes or lands on quiet) costs **≈$0.03–0.04**: classify ≈$0.0014, read ≈$0.028–0.05 depending on output length and thinking-token spend. This session's 20-call stress test totaled $0.5749, averaging ~$0.036/Sonnet call — consistent with the per-report estimate.

---

---

# Revision — Kill the Variance, Split the Passes, Rebuild so_what/payoff

**Branch:** `phase2.5-two-pass` off `phase2.5-read-layer` (which is off `staging@ab567dd`).
**Trigger:** the four open items above, specifically #1 (`so_what` needs a real idea, not an angle) and the unresolved question of whether Step 5's variance was sampling noise or something structural. Three changes, done in order per the revision brief: diagnose the variance before touching anything, split selection from writing, rebuild `so_what`/`payoff`.
**Excluded:** no changes to `crawl-trends.js`, `get-trends.js`, `generate-pulse.js`, `classify.js`, `pool.js`, `collect.js`, `rank.js`, or `categories.js`. Only `read-pulse.js` and `generate-report.js` changed. Staging trial untouched.

## Step 1 — Diagnose the variance

**Finding that changed the diagnosis:** `temperature` wasn't just unset — **Sonnet 5 rejects it outright**: `400 invalid_request_error: "temperature is deprecated for this model."` Sonnet 5 is in the adaptive-thinking model family, which removed classical sampling controls entirely. There is no software knob on this model that gets you to temperature 0. Per your direction, Sonnet 5 was kept for the write step regardless; `temperature: 0` is applied only where a model actually accepts it (Haiku).

Re-ran Avis 5x on the frozen `ai` pool under default behavior (the only behavior available): item **selection** was almost perfectly stable (4 of 5 runs picked the identical first 4 items, 3 of 5 picked an identical full 5) — what varied was whether the model committed to the borderline 5th item at all, and whether it labeled the same items `direct` vs `indirect`. Diagnosis: genuine model borderline-ness on the *relevance label*, not classical sampling noise (there's no sampler to blame). This directly motivated splitting labeling from writing.

## Steps 2-3 — Two-pass split + so_what/payoff rebuild

`read-pulse.js` is now two calls instead of one:
- **Pass 1** (Haiku 4.5 default, `temperature: 0`) scores every pool item via a **forced tool call** (not prose-JSON, which is fragile at 40-76 items) — `{index, relevance_score, relevance, one_line_reason}`. Index-validated, deduped, no item cap.
- **Pass 2** (Sonnet 5, no `temperature` field — see Step 1) writes only the top 12 non-`"none"` items. May downgrade a Pass 1 relevance label, never upgrade — **enforced in code**, not just prompted.

New fields: `so_what` (the idea — concrete enough to picture, open enough to own the execution) and `payoff` (the stake — qualitative only). **`payoff` may never contain a number/percentage/multiple** — enforced by a targeted regex (not a bare digit check, which would wrongly block grounded references like "GPT-4" or "Q3" while still missing the brief's own example "hundreds of impressions," which has no digit at all). A violation drops that one item and rechecks the floor; it does not reject the whole response, unlike an invented URL.

This is a **deliberate amendment** to the original locked spec line ("so_what is the opening, not the execution") — done on explicit founder direction after the Avis/Retool feedback above, not drift.

**Live-verified, Retool (saas+ai):**
> Retool, there's a wave of open-source 'agent harness' projects this week all racing to solve the same problem you've built a business around...
- *so_what:* "A funded startup is now building, in the open, the exact governance layer Retool sells to enterprises... There's room for a sharp point of view on why an internal tools platform has to be more than a hardened terminal."
- *payoff:* "Gets ahead of the difference between a sandbox and a system of record before customers start asking why they need Retool instead of a free CLI wrapper."

This matches the founder's "right" calibration example: names a position worth taking, doesn't write the post, states a qualitative stake.

**Bug caught and fixed mid-build:** Pass 2's `max_tokens` was too tight for a 12-item evaluation — Sonnet 5's adaptive thinking shares the same token budget as the output text and its spend is variable, so a thinking-heavy call could truncate the JSON and **crash the CLI** with an uncaught exception. Fixed by raising the budget and making a Pass 2 parse failure degrade to the quiet path like every other failure mode, instead of throwing.

## Step 4 — Re-run all four brands, 3x each (same cached pools)

| brand | pool | Pass 1 direct (3 runs) | result |
|---|---|---|---|
| Avis (ai) | 40 items | 2, 0, 0 | 0/3 pass — **still unstable** |
| Wise (fintech) | 23 items | 0, 0, 0 | 0/3 pass — stable, scores collapse toward 0 |
| Retool (saas+ai) | 76 items | 10, 10, 10 | **3/3 pass** — first fully stable brand in the project |
| Uniswap (web3) | 40 items | 0, 0, 0 | 0/3 pass — stable, but scores stay moderate (0.5-0.7), not collapsed |

Zero `payoff` violations and zero relevance-downgrade corrections fired across all 12 runs — both code-level safety nets are wired but haven't yet been tested against a model that actually tries to break them.

**Answers:**
1. **Quiet rate:** still 75% (9/12) in aggregate — unchanged. But the composition changed completely: it's no longer 9 coin-flips, it's 3 brands with a **stable, repeatable** outcome (Retool always passes, Wise and Uniswap always go quiet for a legible reason) and only Avis still oscillating.
2. **Variance:** resolved for 3 of 4 brands. Avis is the exception — Pass 1's own direct count bounced 2→0→0 on the identical pool *with* `temperature: 0` set (Haiku accepts it). Confirms Step 1's caveat: temperature 0 reduces variance, it doesn't guarantee it, for a genuinely borderline case.
3. **Uniswap:** **confirmed wrong-shaped, not rescued.** Zero direct-scored items across three independent Pass 1 runs. Not an empty-pool case (items score 0.5-0.7) — the web3 pool is category-wide crypto/DeFi news, not per-product, so nothing is ever squarely "about" a single named DEX. No tuning applied to force a pass, per instruction.
4. **Cost per report:** $0.65096 total across 12 runs, averaging **$0.0542/report** (range $0.018-$0.096) — up from the original ~$0.03-0.04 estimate, as expected with a third API call added.
5. **Haiku vs. Sonnet on Pass 1:** keeping Haiku as default. It's fully reliable when the pool has real signal (Retool: 10/10/10) at roughly half Sonnet's Pass 1 cost. One identified failure mode — Haiku mislabeled a keyword-adjacent-but-off-topic GitHub repo "direct" on an earlier qualitative check, which Sonnet avoided — but Sonnet's own Pass 1 wasn't more stable at Avis's boundary case either, so switching wouldn't obviously fix the one brand that still misbehaves, at roughly double the cost.

## Summary of open items (updated, cumulative)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | `so_what` needed a concrete idea, not an angle | **Addressed** | Split into `so_what` (idea) + `payoff` (stake), live-verified against the founder's own calibration examples. Deliberate spec amendment, noted for Phase 5 QA. |
| 2 | Uniswap-style brands go quiet even on a healthy pool | **Confirmed, not fixed** | Now backed by 3/3 zero-direct Pass 1 runs, not a single quiet result. Three candidate fixes still on the table (narrower sub-vertical pools, pre-selection relevance pass, or accept as correct) — decision still needed. |
| 3 | 75% quiet rate | **Unchanged in rate, changed in character** | No longer random — 3 of 4 brands are now stably pass/quiet with a legible cause. Still a product decision whether 75% is the right honesty bar. |
| 4 | FinTech (Wise) pool visibility | **Still open** | Now have exact Pass 1 distributions (0 direct, scores collapsing to 0 across all 3 runs) but not the raw 23-item titles for a human read. |
| 5 | Avis-style boundary-case instability survives `temperature: 0` | **New** | Pass 1's own direct count varies 2→0→0 on an identical pool even with temperature pinned on a model that accepts it. Structural fix (the two-pass split) resolved this for 3 of 4 test brands; Avis specifically remains unresolved. |
| 6 | Payoff-regex and downgrade-only code enforcement are unexercised | **New, low priority** | Both fired zero times across 12 live runs — correct behavior so far, but neither safety net has been proven against a model actually trying to violate the rule. |

## Files added/changed, cumulative

- `netlify/functions/lib/classify.js` (new, Phase 2.5 initial build)
- `netlify/functions/lib/pool.js` (new, initial build)
- `netlify/functions/lib/read-pulse.js` (new in initial build; **rewritten** in this revision — two-pass architecture, `payoff` field, code-level safety nets)
- `netlify/functions/lib/pricing.js` (new, initial build)
- `netlify/functions/classify-brand.js` (rewritten, ESM, initial build)
- `scripts/seed-cache.js` (new, initial build)
- `scripts/generate-report.js` (new in initial build; **debug formatter rewritten** in this revision for the two-pass cost/diagnostic breakdown)
- `.gitignore` (added `.cache/`, initial build)

No changes to `crawl-trends.js`, `get-trends.js`, `generate-pulse.js`, `lib/collect.js`, `lib/rank.js`, or `lib/categories.js` across either the initial build or this revision — Phase 2's crawl pipeline and Phase 3.5's abuse gate remain untouched.

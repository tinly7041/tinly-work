# Config batch — cap 40%→70%, action standard, stale hours

## Base commit

Read from git before starting: `8b3769d` ("Fix source-share cap, raise Pass 1
headroom, depth 40->50, crawl cadence + health alerting" — the depth-50
work), tree clean, already committed. Built directly on top of it.

## Changes made

1. **[categories.js](netlify/functions/lib/categories.js)**: `SOURCE_SHARE_CAP`
   `0.4` → `0.7`. `resolveShareCap()` in rank.js — the fixed-point logic
   itself — is untouched, exactly as instructed.
2. **[read-pulse.js](netlify/functions/lib/read-pulse.js)**:
   `ACTION_STANDARDS.minItems` 5→3, `minDirect` 3→2, `minUniqueSources`
   removed entirely (not set to 1) along with its enforcement branch in
   `checkStandards()`. `unique_sources` is still computed and returned on a
   pass (still printed by `generate-report.js --debug`) — it just no longer
   gates. The URL-must-exist-in-input check, the payoff no-numbers regex, the
   Pass 1 downgrade-only rule, and the quiet path are all untouched.
3. **[get-trends.js](netlify/functions/get-trends.js)**: `MAX_STALE_HOURS`
   36 → 60.
4. **[rank.test.js](netlify/functions/lib/rank.test.js)**: two assertions
   hardcoded `0.4` as the expected max share. Not a new test — fixed the
   existing ones to import and assert against the live `SOURCE_SHARE_CAP`
   constant instead of a magic number, so they don't silently go stale the
   next time this constant is revisited. No new test files added.

`npm test`: 22/22 passing.

## Verify — live, all four categories re-seeded, all four brands run end to end

### Per-category cache (live re-seed, current data)

| Category | Total | Per-source | Max single-source share | Healthy |
|---|---|---|---|---|
| AI | 50 | hn:13, github:7, arxiv:13, newsfeeds:12, producthunt:5 | 26.0% | true |
| Web3 | 13 | hn:1, coingecko:3, newsfeeds:9 | 69.2% | false |
| FinTech | 16 | hn:2, github:3, newsfeeds:11 | 68.8% | false |
| SaaS | 6 | hn:1, github:1, lobsters:4 | 66.7% | false |

Cap holds everywhere (all ≤70%, none over). Re-ran SaaS twice more on its own
(6, 6) — the 6-item total is real, current data thinness, not a network
blip. Pools are meaningfully bigger than the 40%-cap run last session
(Web3 5→13, FinTech 8→16, SaaS 5→6) — the loosening is doing what it was
asked to do.

### Per-brand, end to end, live (no tuning)

**Perplexity — AI**
classify: `ai` (no secondary) · pool in: 50 · is_event dropped: 37 · survived: 13
Pass 2 wrote 6:
- *"Open-weight GLM-5.3 beats Anthropic and OpenAI models at a fifth of the cost"* (indirect, hn)
- *"Anthropic's flagship model struggles for users as cheaper tools win"* (indirect, hn)
- *"OpenAI's new inference chip reportedly beats Nvidia Blackwell"* (indirect, hn)
- *"GPT 5.6 Sol is OpenAI's best vision model yet"* (indirect, hn)
- *"OpenAI's rogue AI model incident was worse than first reported"* (indirect, newsfeeds)
- *"Thomson Reuters launches its own frontier model built on its own data"* (indirect, hn)
direct: **0** → **FAIL — min_direct** (0, need ≥2)
cost: $0.0898

**Uniswap — Web3**
classify: `web3` (no secondary) · pool in: 13 · is_event dropped: 7 · survived: 6
Pass 2 wrote 5:
- *"Trail of Bits flags a state divergence bug that enables unauthorized access"* (indirect, newsfeeds)
- *"JPMorgan reportedly weighing its own stablecoin"* (indirect, newsfeeds)
- *"Ethereum developers propose first step toward quantum-resistant staking"* (indirect, newsfeeds)
- *"Shinhan Financial and Visa to build stablecoin infrastructure in South Korea"* (indirect, newsfeeds)
- *"Hyperliquid adds Pumpfun support, pushes into energy perps"* (indirect, newsfeeds)
direct: **0** → **FAIL — min_direct** (0, need ≥2) — passed min_items (5≥3) this time, still no direct hits
cost: $0.0624

**Wise — FinTech**
classify: `fintech` (no secondary) · pool in: 16 · is_event dropped: 4 · survived: 12
Pass 2 wrote 5:
- *"DBS and Stripe partner on cross-border payments with agentic AI in Asia"* (**direct**, fintechnews.sg)
- *"RTP real-time payments network expands toward international reach"* (**direct**, Payments Dive)
- *"India moves to let merchants be charged fees on UPI transactions"* (indirect, BBC)
- *"Bank of England backs UK government plan for payments innovation"* (indirect, PYMNTS)
- *"Bank Negara Malaysia fines Setel and Standard Chartered units over sanctions breaches"* (indirect, Fintech News Malaysia)
direct: **2**, unique sources: 5 (informational, no longer gating) → **PASS**
cost: $0.0461

**Notion — SaaS**
classify: `saas` **+ ai** (dual-category this run — the live classifier called
it differently than the Wise/Uniswap/Perplexity runs; reporting what
happened) · pool in: 56 (6 saas + 50 ai combined) · is_event dropped: 42 ·
survived: 14
Pass 2 wrote 1:
- *"Model Context Protocol publishes its roadmap"* (indirect, hn)
direct: **0** → **FAIL — min_items** (1, need ≥3)
cost: $0.0287

**Total live cost, four brands: $0.227.**

3 of 4 still fail under the loosened standard — Wise passes. This is the
same pre-existing Pass 1 direct-relevance sparsity already flagged out of
scope in the `is_event` commit (Perplexity: 0/13 survivors scored direct;
Uniswap: 0/6; Notion: 0/14) — the cap and standard changes didn't cause it
and can't fix it; they only decide how many indirect items get a chance to
clear a lower bar. Reporting as instructed, not tuning anything to flip the
other three.

## Live-verified / mock-verified

Live-verified: category re-seeding, all four end-to-end brand runs, real
Anthropic API calls throughout (one transient `ECONNRESET` on the first
Notion attempt, not a real failure — retried and got a clean real result).
No mocking anywhere in this batch.

## Commits

Two, since the stale-hours change is cleanly separable from the cap/action-
standard change (different file, no shared logic):
1. Cap + action standard + the rank.test.js constant fix.
2. get-trends.js MAX_STALE_HOURS.

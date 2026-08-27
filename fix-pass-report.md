# Fix pass — retry-on-empty, scoring determinism, Perplexity re-run

## Base commit

Read from git before starting: `b6a5d6f` ("Merge branch
'claude/competitor-layer-phase-2-7-97a466'" — the Phase 2.7 merge into
`main`, plus two small unrelated infra commits on top: esbuild bundler
config, `.env.*` gitignore hardening), tree clean. Worked on a new branch,
`claude/fix-pass-retry-scoring-perplexity`, off `main` — not on `main`
directly, per instruction.

---

## Item 1 — Google News retry-on-empty. BUILT.

### a) Retry on empty

[`lib/sources/competitor-news.js`](netlify/functions/lib/sources/competitor-news.js) —
`fetchGoogleNewsRaw` now retries up to 3 attempts total, short linear
backoff (600ms, 1200ms), **only** when an attempt succeeds HTTP-wise but
parses to zero `<item>`/`<entry>` blocks. An HTTP/network error breaks the
loop immediately — not retried, logged to the same `_failures` side-channel
every other adapter uses, exactly as instructed.

### b) Cache representation — proposed, then built as proposed

Proposed before implementing, per the brief:

- New `status` field on every entity cache entry: `"ok"` | `"empty_retries_exhausted"` | `"fetch_error"`.
- `"ok"` = a genuine verdict (real items, or confirmed empty after every
  retry succeeded HTTP-wise) → full 7-day TTL, unchanged.
- `"empty_retries_exhausted"` = every retry succeeded but returned zero
  items → **not** trusted as a week-long verdict.
- `"fetch_error"` = an HTTP/network error, or an orchestration-level error
  (e.g. an unknown `categoryKey`) → same short-TTL treatment. This one
  wasn't explicitly named in the brief, but it's the identical underlying
  bug (an ambiguous empty being cached as a confident verdict) — the old
  code already cached an HTTP error's `items: []` for the full 7 days,
  which is wrong for the same reason. Fixed alongside, not left half-done.
- Both uncertain states get `UNCERTAIN_CACHE_TTL_MS` = **1 hour** instead
  of the 7-day TTL — [`lib/entity-cache.js`](netlify/functions/lib/entity-cache.js).
  Long enough to survive a burst of leads naming the same brand-new entity
  in quick succession; short enough that the next real chance isn't locked
  out for a week. An entry with no `status` field at all (written before
  this change) falls back to the full 7-day TTL, not the short one — a
  pre-existing entry isn't newly-uncertain just because this field didn't
  exist yet.
- An explicit `ttlMs` override (used by tests) always wins over the
  status-based default.

### c) Visibility

[`lib/competitor-fetch.js`](netlify/functions/lib/competitor-fetch.js) logs
a `console.warn` whenever `status !== "ok"`, and
[`netlify/functions/competitor-fetch-background.js`](netlify/functions/competitor-fetch-background.js)'s
per-entity result object (already logged via `console.log` for anyone
tailing function logs — there's no dedicated alert channel for entity-level
health yet, unlike `crawl-trends.js`'s category-level `health.js` system;
flagging that gap rather than building a new alerting subsystem for it in
this pass) now carries `status` and `fetch_meta` so an empty window is
visible, not silent.

### VERIFY — live attempt: could not reproduce an empty. Saying so plainly.

Per instruction: **61 live calls, zero empties reproduced.** Two
methodologies, both matching how the original empty was first caught:

1. In-process hammer loop (`node scripts/competitor-report.js --entity "<x>" --category web3 --hammer <N>`,
   2s apart): Uniswap ×12, Solana ×15, Ethereum ×12, Tether ×12 — **51 calls,
   0 empties**, every single one `attempts=1 exhausted_empty=false`.
2. Fresh separate `node` processes (bash loop, 3s apart) — the exact method
   that first caught the empty in the Phase 2.7 session: Uniswap ×10 more —
   **10 calls, 0 empties**, all `items=100`.

Sample of the raw output (identical pattern repeated every time):
```
[1/12] attempts=1 exhausted_empty=false http_error=none raw_kept=11 — OK (1st attempt)
         e.g. "Spark, Uniswap Build Stablecoin 'FX Layer' With $150M Migration"
```

**I cannot reproduce the empty-window behavior on demand right now**,
despite having captured it unambiguously in the Phase 2.7 session with
concrete before/after evidence (same query, same process, `0,0,0` then
`101` minutes later). Possible explanations, none confirmed: the original
observation was time-of-day/load dependent and this session's testing
window simply didn't hit a bad period; Google's serving behavior for these
specific queries has since stabilized; something about the original
session's exact timing wasn't replicated. Not fabricating a live pass here —
this is a real gap in this session's live verification, reported as one.

**What IS verified, and how**: the retry loop's own *logic* —
mock-verified, not live-verified, clearly labeled as such in the test file
and here. Four tests in
[`competitor-news.test.js`](netlify/functions/lib/sources/competitor-news.test.js)
inject a fake network call to prove: succeeds first try → no retry, no
sleep; empty-then-full → recovers, exactly one backoff sleep,
`attempts=2`; empty on every attempt → stops at 3 (no 4th call),
`exhausted_empty=true`; an HTTP error → not retried at all, distinct from
the empty case. 43/43 tests passing overall (up from 39 before this pass).

End-to-end pipeline re-verified live (real network, real cache write) on
Retool: `status=ok`, `fetch_meta={"attempts":1,"exhausted_empty":false,"http_error":null}`
written to the cache entry correctly.

---

## Item 2 — Pass 1 scoring determinism. MEASURED ONLY, no fix implemented.

Built [`scripts/measure-determinism.js`](scripts/measure-determinism.js) to
isolate this properly: brand mode in `competitor-report.js` re-classifies
(and can re-infer different competitors) on every call, which would
confound a measurement of Pass 1/Pass 2's *own* determinism. This harness
freezes classify, the category pool (read from `.cache/`, never reseeded),
and the competitor items **once**, then calls `generatePulseRead` N times
against the identical frozen input.

### a) Same brand, same frozen pool, 3 runs — Wise and Notion

**Wise** (fintech, frozen pool: 16 items, frozen competitors: Remitly/OFX/Revolut, 17 competitor items):

| Run | Pass 1 direct/indirect/none | Final direct | Standards | Items |
|---|---|---|---|---|
| 1 | 15 / 7 / 10 | 2 | **PASS** | *"Revolut launches euro-backed stablecoin EURR across Europe"* (direct); *"Revolut's euro stablecoin landed in a market MiCA effectively handed to a US company"* (indirect); *"Revolut launches an in-house AI research unit to build its own banking models"* (**direct**) |
| 2 | 15 / 6 / 11 | 0 | **FAIL — pass2_unparseable** | (quiet — Sonnet's JSON output failed to parse this run) |
| 3 | 15 / 6 / 11 | 2 | **PASS** | *"Revolut launches EURR, a euro-backed stablecoin bridging fiat and crypto"* (direct); *"Revolut's euro stablecoin lands in a market MiCA effectively handed to a US company"* (direct); *"Revolut launches an in-house AI research unit..."* (**indirect this time**); *"Revolut is entering Australia's mortgage market"* (indirect) |

**Notion** (saas+ai, frozen pool: 6 saas + 50 ai items, frozen competitors: Confluence/Monday.com/Asana, 7 competitor items):

| Run | Pass 1 direct/indirect/none | Final direct | Standards | Items |
|---|---|---|---|---|
| 1 | 7 / 11 / 45 | 0 | **FAIL — min_items** | (quiet) |
| 2 | 7 / 13 / 43 | 0 | **FAIL — min_items** | (quiet) |
| 3 | 7 / 10 / 46 | 3 | **PASS** | *"Atlassian cuts 1,600 jobs as it pivots Confluence and Jira toward AI"*; *"Asana says it used OpenAI's Codex to compress years of engineering work into weeks"*; *"Monday.com cuts staff to boost profitability and reduce dilution"* — all 3 direct |

**The precise finding**: **Pass 1's own `direct` count was remarkably
stable on identical frozen input** — Wise: 15, 15, 15. Notion: 7, 7, 7.
Pass 1 (Haiku, `temperature: 0`) is not the source of the swing. **The
instability is downstream, in Pass 2** (Sonnet 5): which items it selects
to write, how it labels them, and whether it produces parseable JSON at all
vary run to run on the exact same input. Wise's own historical inconsistency
(`direct: 2` in the config-batch run vs. `direct: 0` in the Phase 2.7 run)
is fully reproduced here — same swing, same frozen input, same pipeline,
proving it's not a pool/competitor-data difference between those two
historical runs, it's Pass 2 itself. One run (Wise, run 2) hit the
`pass2_unparseable` degrade path in a completely ordinary, non-adversarial
condition — not a rare edge case, observed in 1 of 6 total measurement runs
across both brands.

### b) Same brand, 3 classify calls — Notion

| Run | primary | secondary | confidence | inferred_competitors |
|---|---|---|---|---|
| 1 | saas | ai | 0.85 | Confluence, Microsoft Teams, Slack |
| 2 | saas | ai | 0.85 | Coda, Confluence, Microsoft Teams |
| 3 | saas | ai | 0.85 | Confluence, Microsoft OneNote, Obsidian |

Category classification (`primary`/`secondary`/`confidence`) was **stable**
across all 3 calls in this sample — the "saas vs. saas+ai" swing seen
across earlier historical runs wasn't reproduced here (could be a genuinely
rarer flip, or this specific brand/site-content combination happens to sit
less on the boundary right now; not enough runs to say which). Competitor
inference was NOT stable: only "Confluence" appeared in all 3 runs; the
other two slots changed every time (Slack → Coda → Obsidian, etc.). This
matters concretely — different inferred competitors mean querying entirely
different Google News entities, which is a real, separate source of
run-to-run variance in the final report, layered on top of Pass 2's own
instability above.

### c) Actual current sampling settings

Read directly from the code, not inferred:

- **classify.js** (`classifyBrand`, Haiku): **no `temperature` field at
  all** in the request body — confirmed by reading the exact
  `body: JSON.stringify({...})` call; runs at the API's default temperature
  (1.0), uncontrolled. This is inconsistent with Pass 1's own Haiku call,
  which explicitly pins `temperature: 0`.
- **read-pulse.js Pass 1** (Haiku, default model): `temperature: 0`,
  explicit — `TEMPERATURE_SUPPORTED_MODELS.has(model)` gates this, and
  Haiku is in that set.
- **read-pulse.js Pass 2** (Sonnet 5): **no `temperature` field** — Sonnet 5
  rejects the parameter outright (documented in the file's own header: a
  live-confirmed `400 invalid_request_error`). There is no sampling knob
  available on this model at all.

### Proposed fixes (NOT implemented, per instruction)

1. **classify.js**: add `temperature: 0` to the Haiku call, matching Pass
   1's own convention. Zero cost, directly removes one identified source of
   variance (competitor-name drift between identically-input classify
   calls). Won't fix the category-flip case if that's real (Haiku at
   temperature 0 wasn't perfectly stable for Avis in the original Phase 2.5
   revision either, per that report) but removes a real, cheap, currently-
   unpinned variable.
2. **Pass 2 parse-failure retry**: `pass2_unparseable` currently degrades
   straight to the quiet path with no retry — unlike every source adapter's
   own retry-on-transient-failure convention (including this fix pass's own
   Item 1). One retry on a parse failure, before falling back to quiet,
   would likely have recovered Wise's run 2 above at the cost of one extra
   Sonnet call only in the failure case. Narrow, low-risk, doesn't touch the
   harder problem below.
3. **The harder problem — Pass 2's selection variance itself**: no sampling
   knob exists on Sonnet 5 to reduce this directly. Two directions worth
   evaluating (not evaluated here, out of scope for a measure-only item):
   (a) reduce Pass 2's own discretion — have it write up every item Pass 1
   already scored `direct`/`indirect` rather than re-deciding "does this
   earn a place," since Pass 1's own scoring proved stable in this
   measurement; (b) run Pass 2 more than once and take a
   majority/consensus result, at roughly Nx the Pass 2 cost. Flagging both
   as candidates, not recommending one over the other without more data.

---

## Item 3 — Perplexity end-to-end re-run. MEASURED ONLY.

Live, post-fix (the `classify.js` `inferred_competitors` prompt amendment
from the Phase 2.7 pass), no tuning.

**Inferred competitors**: ChatGPT, Google, Gemini — all real, headline-
matchable canonical names (the pre-fix run had produced "OpenAI ChatGPT,"
"Google Search Generative Experience," "You.com," all of which returned 0
items).

**Raw items per competitor** (all live, `--refresh`, bypassing cache):

| Entity | Query | Items |
|---|---|---|
| ChatGPT | `"ChatGPT" AI` | 17 |
| Google | `"Google" AI` | 20 |
| Gemini | `"Gemini" AI` | 17 |

Sample titles, not counts alone:
- *"OpenAI to start showing ads on ChatGPT's free and Go tiers in India"*
- *"Google AI Mode Also Gains Link Carousels For Developing Topics"*
- *"Google Moves AI-Responsibility Team Out of DeepMind Lab in Latest Shake-Up"*
- *"Intelligent transcription with Gemini 3.5 Transcribe"*

**Result: PASS, direct=2.**

1. **[direct]** *"OpenAI will start showing ads on ChatGPT's free and Go tiers in India"*
2. **[direct]** *"Google's AI Mode adds link carousels for topics that are still developing"*
3. [indirect] *"OpenAI's ChatGPT for Teachers keeps landing new US school district deals"*
4. [indirect] *"Google's new Gemini transcription tool cleans up filler words automatically"*
5. [indirect] *"Google moves its AI-responsibility team out of DeepMind in an internal reshuffle"*

**Cost: $0.100174** (classify + Pass 1 over a 100-item combined pool +
Pass 2).

This confirms the `inferred_competitors` prompt fix from the Phase 2.7 pass
was not just an input-level improvement (the "ChatGPT returns 14 items"
check already done) but flips Perplexity's actual end-to-end result from
FAIL (0 direct, every prior run in both the config-batch and Phase 2.7
reports) to **PASS**. No tuning applied to get here — this is the pipeline
running as built.

---

## Live-verified / mock-verified summary

- **Live-verified**: Item 1's retry-on-empty query behavior (61 real calls,
  0 empties found — reported honestly, not simulated); the end-to-end cache
  write with the new `status` field; Item 2's three frozen-pool measurement
  runs each for Wise and Notion (6 real classify+Pass1+Pass2 cycles); Item
  2b's three classify calls; Item 3's full Perplexity run.
- **Mock-verified**: Item 1's retry-loop *logic* (attempt counting,
  break conditions, the exhausted-after-3 case) — explicitly not a
  substitute for the live empty-reproduction attempt, which failed to
  reproduce and is reported as such.

## Files changed

- [`netlify/functions/lib/sources/competitor-news.js`](netlify/functions/lib/sources/competitor-news.js) — retry-on-empty, injectable `getImpl`/`sleepImpl` for testing
- [`netlify/functions/lib/sources/competitor-news.test.js`](netlify/functions/lib/sources/competitor-news.test.js) — 4 new mock-verified retry tests
- [`netlify/functions/lib/entity-cache.js`](netlify/functions/lib/entity-cache.js) — `status`-aware TTL, `UNCERTAIN_CACHE_TTL_MS`
- [`netlify/functions/lib/entity-cache.test.js`](netlify/functions/lib/entity-cache.test.js) — 6 new tests covering the status-aware freshness logic
- [`netlify/functions/lib/competitor-fetch.js`](netlify/functions/lib/competitor-fetch.js) — derives and logs `status`
- [`netlify/functions/competitor-fetch-background.js`](netlify/functions/competitor-fetch-background.js) — logs `status`/`fetch_meta` per entity
- `scripts/competitor-report.js` — entity mode prints `fetch_meta`/`status`; new `--hammer <N>` mode
- `scripts/measure-determinism.js` — new, Item 2/3 measurement harness

43/43 unit tests passing (`npm test`), up from 33 at the start of this pass.

## Open items requiring your input

1. **Item 1's live empty could not be reproduced this session** — the fix
   is built and its logic is proven correct (mock-verified), but I have not
   re-observed the actual failure mode live to confirm the retry recovers
   it in the wild. If you want stronger confidence before calling this
   launch-ready, the honest next step is more live hammering at a different
   time of day, not more code.
2. **Three proposed fixes for Item 2, none implemented**: `temperature: 0`
   on classify's Haiku call (cheap, safe); a single retry on Pass 2 JSON
   parse failure (cheap, safe, would likely have recovered one of the six
   measurement runs); and the harder open question of Pass 2's own
   selection variance, for which no sampling-based fix exists on Sonnet 5 —
   say which of these you want built, if any.
3. **Inferred-competitor instability** (Item 2b): a real, separate source
   of report-to-report variance, layered on top of Pass 2's own instability
   — not proposed a fix for this since it wasn't asked for, flagging it as
   a candidate for a future `temperature: 0` pass on classify.js too.

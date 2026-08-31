# Trend Pulse — Session Report, 31 Aug 2026 (Session 10)

**Objective:** Diagnose why the Avis run (Session 9b) hit `THIN_FIELD` on a healthy pool,
fix it, and get a real brand through the full pipeline end to end.

**Outcome: first confirmed end-to-end completion, ever.** AI Hay went classify → pre-gate
→ contact gate → Pass 2 → real email delivered, with three correctly-scored, on-topic
items. Nine separate bugs found and fixed along the way — most of them only surfaced by
actually running the pipeline live and reading real output (including the real email), not
something a code review would have caught.

**Not ready to merge to `main` yet — see section 6.**

**Branch:** `turnstile-test` @ `3d0fed5` at session start, `52d2433` after the first commit
(pushed), plus one further commit layered on top for the Pass 2 fix in section 2.9 — see
Files Changed. **`main`:** untouched at `9a45572`.

---

## 1. Task 1 diagnosis — the brief's own premise was wrong

The Session 9b brief assumed Phase 2.7 (the competitor-news layer) was never built. It was:
fully shipped and live-verified in an earlier session (`237d5d5`, merged via `b6a5d6f`),
documented in `phase2.7-report.md`, 61/61 unit tests passing before this session touched
anything. The Notion build log's "architecture decided, not built" line was simply stale —
never updated after the merge. Flagged, not worked around.

**The real bug**, confirmed by reading the actual data flow: `pulse-preview.js` computes
`competitor_item_count` from the entity cache only (`getCachedEntity`, cache-only by
design). Separately, `read-pulse.js`'s `selectPool` merges that cache with the category
pool and Pass 1 scores everything together — including category-pool items that happen to
name a competitor by text, with no structural link back to the entity-cache count. Avis's
"Hugging Face incident" item scored `direct` 0.8, named as a competitor in Pass 1's own
reasoning, and `competitor_item_count` still read 0 — because it was never counting that
signal in the first place.

**Weekly watchlist cron:** confirmed via the Netlify deploys API, not guessed — the branch's
first deploy was `2026-08-30T09:02:38Z`, so a `@weekly` schedule could not have fired yet.

## 2. Fixes, in the order they were found

Every fix below was driven by an actual failed live run, not anticipated in advance.

### 2.1 `hasCompetitorSignalInPool` (quiet-taxonomy.js)

Closes the exact gap above: after Pass 1 scores the pool, check whether any `direct`-scored
item's own title/description names one of the brand's competitors (reusing `matcher.js`'s
existing word-boundary matcher, not a new one). Wired into `pulse-preview.js` and
`pulse-rescan.js` as `poolCompetitorHit`.

### 2.2 State 5c copy + CTA (trend-pulse.html)

`THIN_FIELD` and `QUIET_GENUINE` shared one HTML block (`#state-5c`) with a hardcoded
`data-quiet="QUIET_GENUINE"` — so the email-capture write always misreported the cause, and
the copy contradicted its own data (claimed "nothing directly relevant" while holding a
`direct`-scored item). Split into two blocks (`#state-5c` for `THIN_FIELD`, new `#state-5d`
for `QUIET_GENUINE`). Copy restored to the Notion-locked hedged framing ("that can mean two
things...") and added the "Talk to the team" CTA (`mailto:tinly.work@gmail.com`) that Task 2
called for but had never actually been built.

### 2.3 `stripPossessiveDescriptor` (classify.js)

**Avis re-run #1** returned `inferred_competitors` as `["Anthropic's API marketplace",
"OpenAI's app ecosystem"]` — descriptive phrases the existing prompt instruction ("short
canonical name") didn't reliably enforce. Neither the entity cache nor 2.1's pool-signal
check can match a literal descriptive phrase against real headline text. Narrow regex fix:
strip `X's <description>` → `X`, keyed off the possessive as the one unambiguous signal —
deliberately NOT a first-word trim, which would also butcher real multi-word canonical names
("Aerodrome Finance", "Hugging Face"). Unit-tested against this Avis case, the historical
Perplexity case (proven to be correctly left untouched — out of scope for this rule), and
every multi-word watchlist entity.

### 2.4 `temperature: 0` on classify.js's Haiku call

**Avis re-run #2**, same brand/URL, immediately after #2.3 shipped: returned a completely
different competitor set (`Replicate`, `Together AI`, `Modal`) with no possessive shape at
all. `classify.js` had no temperature pinned, unlike Pass 1 in `read-pulse.js`. Pinned to 0
to remove sampling as a source of run-to-run drift in which competitors get tracked.

### 2.5 `classifyQuiet` precedence — an already-passing direct count now beats `THIN_FIELD`

Avis re-run #2's `direct` count was 2, exactly meeting `minDirect` (2) on category signal
alone — but `THIN_FIELD` still fired and blocked it, purely because the three named
competitors that run had zero coverage anywhere. Decided live with Tin: if the pool already
clears the action standard on its own, ship it — don't block a passing pool on a cold
competitor cache. `THIN_FIELD` now only fires when it would actually explain a shortfall.

**Avis re-run #3**, fresh page load: passed. `quiet_cause: null`, reached State 4.

### 2.6 Pass 1 latency vs. Netlify's function timeout (Free tier)

Next real brand tested hit a NEW wall: `pulse-preview` killed at exactly `Duration: 30000
ms`, three times running, with no valid response (`invalid status code returned from lambda:
0`). Traced to Pass 1's own generation time — `max_tokens` scales to ~6,800 for a 50-item
pool, and Haiku generating a full sentence per item for 50 items was taking 25-30+ seconds,
right at the Free-tier synchronous execution ceiling. Confirmed via the Netlify API this
account has no timeout config lever at all (`functions_timeout: null`, Free tier — that
setting requires Pro or higher). Fix: tightened `one_line_reason`'s prompt instruction to
12 words or fewer — that field isn't rendered anywhere in the pre-gate UI, only used
internally and passed to Pass 2. Left `max_tokens` untouched (lowering it risks the exact
mid-JSON truncation failure documented in this file's own history).

**This is a real tradeoff, not a free fix — flagging plainly.** `one_line_reason` is Pass 1's
own grounding for *why* it called an item direct/indirect/none, and Pass 2 reads that
reasoning as context when deciding what to write about and how. Cutting it to 12 words
removes nuance from that reasoning, which can plausibly change Pass 2's output — a shorter,
blunter Pass 1 justification could mean a borderline item gets written up differently, or a
distinction that needed a full sentence to make gets lost. This fix was chosen specifically
*because* it's the only lever available on the Free tier that doesn't risk the truncation
failure mode — it wasn't chosen because it's risk-free. Worth watching Pass 2 output quality
over the next several real runs to see if this shows up as a real degradation, not just a
theoretical one; if it does, the honest fix is a paid-tier timeout increase, not more
prompt-shrinking.

### 2.7 `RATE_LIMIT_PER_DAY` 5 → 10

Side effect of 2.6: every attempt that clears Turnstile increments the daily IP rate limit,
including ones that then die to the 30s timeout. At 5/day, a real visitor hitting two or
three transient errors could burn the whole day's budget before ever seeing a result.
Raised to 10.

### 2.8 The real blocker: `lead-submit.js`'s background-invoke URL

Every fix above got a brand *through the pre-gate* — but leads were writing their row,
capturing their email, and then silently never generating a report (`reportSent: false`
forever, zero trace anywhere). Root cause, found by adding a temporary loud-failure log line
(`if (!bgRes.ok)`) that had never existed before: `lead-submit.js` used `process.env.URL` to
build the URL for its fire-and-forget call to `generate-report-background`. **`URL` always
resolves to the production domain on Netlify, regardless of deploy context** — and that
function has never been merged to `main`, so it 404'd every time. `fetch()` doesn't throw on
a 404, so the surrounding `try/catch` never caught anything — total silence.

First fix attempt used `DEPLOY_PRIME_URL` (the documented deploy-scoped alternative) — this
**also failed**, confirmed live with a temporary diagnostic endpoint: `DEPLOY_URL`,
`DEPLOY_PRIME_URL`, `CONTEXT`, and `BRANCH` are **all absent** on this deploy, because this
site is deployed via manual CLI upload (`netlify deploy --dir ...`), which skips the Netlify
build process entirely — and that build process is what populates those variables. Only
`URL` survives a CLI-only deploy, and it's the one that's wrong for this purpose.

**Real fix:** derive the base URL from the incoming request itself — `new URL(req.url).origin`.
Always correct, no dependency on deploy mechanism, build step, or which env vars Netlify
happens to inject. Also added a loud log line for any future non-2xx response from this
call, so a silent failure like this can't happen again undetected.

### 2.9 Pass 2: forbid broadening WHO/WHAT a claim is about (`read-pulse.js`)

Found by Tin reading the AI Hay email closely and checking the GLM-5.3 item's actual source
sentence against the delivered headline (see section 4's original #1, now resolved). The
source said GLM-5.3 costs "about a fifth of GPT-5.5's cost" — one specific, narrow
comparison against one specific OpenAI model. Pass 2 rewrote that as "reportedly beats
Anthropic and OpenAI at a fifth of the cost" — a cost comparison against one model became an
implied performance claim against two entire labs, one of which (Anthropic) the source never
even mentioned.

This is a real accuracy problem, not a style one, and it happened in the write step, not
retrieval — the crawling/matching layer correctly found and delivered the source text; Pass 2
distorted it while rewriting. Added a CRITICAL-severity rule to `buildPass2SystemPrompt`,
matching the existing no-fabricated-numbers rule on `payoff`: `headline` and `why_now` must
never broaden who or what a claim is about — if the source names one model, the rewrite names
that same one model, not a whole company, a whole lab, or a competitor the source never
mentioned. Included the live-caught GLM-5.3 case itself as the calibration example in the
prompt, following the same worked-example pattern the `so_what`/`payoff` rules already use.

Not yet re-verified live (would need another real Pass 2 run against a similar source item to
confirm the guardrail actually holds) — flagging that this is prompt-only, unit-untestable
the way a pure function is, and its real test is the next live report that touches a
narrow numeric/comparative claim.

## 3. AI Hay — first full live completion

Brand: AI Hay (`ai-hay.vn`), Vietnamese AI Q&A assistant, category `ai`, 3 named competitors.

| Stage | Result |
|---|---|
| `pulse-preview` (classify + Pass 1) | Live-verified — passed pre-gate, `quiet_cause: null` |
| Contact gate → `lead-submit` | Live-verified — lead row written, `generate-report-background` fired correctly (fixed URL confirmed working) |
| `generate-report-background` (Pass 2) | Live-verified — `Duration: 43160.51 ms`, well under the timeout since it's a background function (no 30s ceiling) |
| Email delivery via Apps Script | **Live-verified — real email received**, 3 items |

Delivered items, verbatim from the email (`Your Trend Pulse — AI Hay`):

1. **"Claude, widely seen as the best model, is losing users to cheaper AI tools"** —
   `hn` · direct · quick · [FT source](https://www.ft.com/content/5ee49718-c258-4f01-aa32-7e5b76ae5245)
2. **"Google launched Gemini Omni 1.1 Flash, a fast multimodal model"** —
   `producthunt` · direct · quick · [Product Hunt source](https://www.producthunt.com/products/gemini-omni-1-1-flash)
3. **"GLM-5.3, an open-weight model, reportedly beats Anthropic and OpenAI at a fifth of the cost"** —
   `hn` · direct · quick · source: `reinvently.co.uk/tools/ed-o-meter/` ⚠️ **see below**

Each item carried why_now / so_what / payoff, correctly framed around AI Hay's actual
position (Vietnamese-market, cost/localization angle vs. global labs) rather than generic
buyer-empathy language — matches the Session 4 locked writing standard.

## 4. Open items for the next finetuning pass

Flagging these now rather than silently fixing or silently ignoring them.

1. **Item 3's source URL still looks wrong — separate from the content-distortion issue,
   and still unresolved.** `reinvently.co.uk/tools/ed-o-meter/` has no visible connection to
   a GLM-5.3 benchmark story. Tin confirmed the underlying source *sentence* is real ("if
   you run one model, run glm-5.3 — 100% pass, a 9.3 rubric, $0.28 for the lap, about a
   fifth of gpt-5.5's cost") — that part checks out. What's unconfirmed is whether
   `reinvently.co.uk/tools/ed-o-meter/` is genuinely where that sentence lives, or whether
   this is a title/url pairing bug somewhere in the HN adapter or `rank.js`'s dedupe/merge
   path (a mismatched pairing between two separately-fetched items would be a real,
   reproducible bug). The *content* distortion this item also had — "beats Anthropic and
   OpenAI" for what was actually a narrow one-model cost comparison — is fixed in 2.9 above;
   the URL question is still open.
2. **Product Hunt as a source for large-lab releases is an open quality question.** A
   community PH listing for a Google model release is a different signal class than an
   official announcement — not necessarily wrong, but worth a second look at whether
   `producthunt` should carry the same "direct" weight for this kind of item.
3. **`stripPossessiveDescriptor` only catches the possessive shape.** The other known-bad
   shape (a purely descriptive multi-word phrase with no possessive marker, e.g. the
   historical "Google Search Generative Experience" case) is still unfixed by design — it
   has no reliable syntactic tell apart from a real canonical multi-word name. Still a live
   risk for any brand whose competitors get inferred that way.
4. **The `THIN_FIELD` precedence change (2.5) was a real design decision**, made live under
   testing pressure with Tin's sign-off in this session — but it wasn't in the 27 Aug locked
   spec. Worth a deliberate second look outside the heat of a live-testing session, not just
   this session's retroactive justification.
5. **The 30s Netlify Free-tier ceiling is mitigated, not eliminated — and the mitigation has
   its own cost.** A large enough pool (secondary category present, many competitors, long
   pool) could still tip over it. And the fix that bought headroom (2.6, shortening
   `one_line_reason`) is itself a quality tradeoff, not a clean win — see 2.6's tradeoff note.
   The real fix — making pre-gate genuinely async, or upgrading the plan — is still open.
6. **Weekly watchlist pre-warm cron has still never fired** (branch is ~1 day old as of this
   session). Once it does, competitor cache coverage for the 24 seed entities should improve
   pre-gate pass rates independent of anything else in this report.
7. **Coin98 has still never run.** Avis and AI Hay are both `ai` category (the deep pool).
   Coin98 is `web3`, the actual test of whether the action standard is reachable on a thin
   pool — still the open question from Session 7.

## 5. Files changed this session

```
modified:   netlify/functions/lead-submit.js
modified:   netlify/functions/lib/classify.js
modified:   netlify/functions/lib/quiet-taxonomy.js
modified:   netlify/functions/lib/quiet-taxonomy.test.js
modified:   netlify/functions/lib/read-pulse.js       (2.6 latency trim, then 2.9 headline-scope rule)
modified:   netlify/functions/pulse-preview.js
modified:   netlify/functions/pulse-rescan.js
modified:   trend-pulse.html
new file:   netlify/functions/lib/classify.test.js
```

All deployed live to `turnstile-test--tinly-work.netlify.app` via `netlify deploy --branch
turnstile-test --dir <sanitized-static-dir> --functions netlify/functions` (manual CLI —
`netlify functions:list` is local-bundle-validation only, not a deploy-state check; branch
context confirmed each time via `netlify api getDeploy`, never assumed). 76/76 unit tests
passing (`npm test`).

**Committed and pushed to `origin/turnstile-test`** — first commit `52d2433` (2.1–2.8), a
second commit on top for 2.9 (the Pass 2 headline-scope fix and this report). No merge or
push to `main` at any point.

## 6. Merge to `main` — not ready. Here's what's actually blocking it.

Assessed explicitly this session, not left implicit. Two categories:

**Infrastructure that has to move first, or the widget breaks on first load:**
- `TURNSTILE_SITE`, `ANTHROPIC_API_KEY`, `TURNSTILE_SECRET`, `APPS_SCRIPT_SECRET`,
  `APPS_SCRIPT_URL`, `IP_SALT` are scoped to `branch:turnstile-test` only. None exist in the
  production context. Merging without adding them there breaks Turnstile immediately — this
  is the exact trap flagged at the top of this session and it is still true.
- `main` still carries the dead `generate-pulse.js` Phase 3.5 stub that `pulse-preview.js`
  superseded. Decide whether to delete it as part of the merge or leave dead code in place.
- Production deploys build via Netlify's normal CI (this branch's testing all happened via
  manual CLI upload, a meaningfully different deploy path — see 2.8's whole root cause).
  Worth one live sanity pass immediately after merging, before calling it done, specifically
  re-checking that `generate-report-background` actually fires for a real production lead.

**Product-quality items still open (from section 4) that argue for waiting, not just
infrastructure gaps:**
- **Coin98 has never run.** Every live test tonight (Avis, AI Hay) was `ai` category — the
  one deep, forgiving pool. `web3` is the actual test of whether the action standard is
  reachable at all (open since Session 7). Shipping to production without ever having
  exercised the thin-pool path is shipping an untested code path to real visitors.
- **The Free-tier timeout is mitigated, not solved** (item 5), **and the mitigation itself
  trades against output quality** (2.6's tradeoff note) — in production this becomes real
  visitors' actual experience, not something retryable on a test run.
- **The Pass 2 headline-distortion fix (2.9) is unverified against a second live case.** One
  fix, one prompt change, zero re-confirmation yet that it holds under a different source
  shape.

**Recommendation:** run Coin98 for real, watch the next few Pass 2 outputs for whether 2.9's
guardrail actually holds and whether 2.6's shortened reasoning visibly costs anything, then
merge — with the env var migration and the dead-stub decision done as part of that merge, not
after it.

# Fix 2 pass — classify temperature: 0, Pass 2 parse retry

## Base commit

Read from git before starting: `b138fe8` ("Fix pass: Google News
retry-on-empty, determinism measurements, Perplexity re-run" — the Item 1
work), tree clean, matching `origin/claude/fix-pass-retry-scoring-perplexity`.
Continued directly on that branch, as instructed.

---

## Fix 1 — classify.js: `temperature: 0`

One line added to the Haiku call's request body in
[`lib/classify.js`](netlify/functions/lib/classify.js) — matching Pass 1's
own convention exactly. Not claiming this makes classification
deterministic; reporting the observed spread below, whatever it is.

### VERIFY — live, 3 calls each, Notion and Perplexity, post-change

**Notion** (`brandName="Notion"`, `website="notion.so"`, identical input every call):

| Run | primary | secondary | confidence | inferred_competitors |
|---|---|---|---|---|
| 1 | saas | ai | 0.85 | Confluence, Microsoft Teams, Coda |
| 2 | saas | ai | 0.85 | Confluence, Microsoft Teams, Coda |
| 3 | saas | ai | 0.85 | Confluence, Microsoft Teams, Coda |

**Perplexity** (`brandName="Perplexity"`, `website="perplexity.ai"`):

| Run | primary | secondary | confidence | inferred_competitors |
|---|---|---|---|---|
| 1 | ai | null | 0.95 | ChatGPT, Google, Anthropic Claude |
| 2 | ai | null | 0.95 | ChatGPT, Google, Anthropic Claude |
| 3 | ai | null | 0.95 | ChatGPT, Google, Anthropic Claude |

**Observed spread: zero, across both brands, all fields, all 6 calls** —
including the full `inferred_competitors` list, which was the specific
field the fix-pass report caught drifting (Notion pre-fix: Slack → Coda →
Obsidian across 3 calls with only "Confluence" stable). Post-fix, all three
competitor names matched exactly across all three runs, for both brands.

This is 6 calls on 2 brands, not a proof of universal determinism — the
fix-pass report's own caveat stands: Haiku at `temperature: 0` was not
perfectly stable for Avis in the original Phase 2.5 revision. Reporting
what was actually observed, not extrapolating past it.

---

## Fix 2 — Pass 2: exactly one retry on JSON parse failure

[`lib/read-pulse.js`](netlify/functions/lib/read-pulse.js) — `runPass2WithRetry`
wraps `runPass2` in a loop capped at `PASS2_PARSE_RETRY_ATTEMPTS = 2` (1
initial + 1 retry, not configurable). Catches `Pass2ParseError` specifically
— any other thrown error (an API failure, a network error) is NOT an
instance of that class and rethrows immediately, unretried, exactly as
before this change. `debug.pass2.parse_attempts` and
`.recovered_by_retry` are now populated on both the success and the
still-failed-after-retry paths, and both cases log via `console.warn` —
visible, not silent, per instruction. No other part of Pass 2 touched: the
prompt, the downgrade-only rule, the URL-must-exist check, the payoff regex,
and the quiet path are all untouched.

### Verify — mock-verified retry logic (5 new tests, `read-pulse.test.js`)

Constructs a minimal one-item pool, mocks `fetchImpl` to distinguish Pass
1's tool-call request from Pass 2's plain-text request by inspecting the
request body (`body.tools` present vs. absent) rather than call order —
the same distinction a real inspection would make:

1. Pass 2 succeeds first try → `parse_attempts=1`, `recovered_by_retry=false`, exactly 1 Pass 2 call.
2. Pass 2 returns unparseable text, then valid JSON → exactly 2 calls, `recovered_by_retry=true`, result is NOT `pass2_unparseable`.
3. Pass 2 returns unparseable text on both attempts → exactly 2 calls (not 3), degrades to quiet with `failed_standard: "pass2_unparseable"`.
4. A genuine HTTP error (`res.ok = false`) on Pass 2's first call → propagates as a thrown error, exactly 1 call — **not retried**.
5. Pass 2 returns valid JSON with `items: []` → NOT treated as a parse failure, exactly 1 call, degrades via the ordinary `min_items` standard, not `pass2_unparseable`.

All 5 pass. 48/48 total unit tests passing (up from 43).

### Verify — live re-run of the Wise frozen-pool measurement

Re-ran `scripts/measure-determinism.js --pass1 --brand "Wise" --url wise.com --runs 3`
(same harness, same frozen category pool from `.cache/`, competitor items
frozen once per invocation — see the fix-pass report for why this isolates
Pass 1/Pass 2 from classify's own variance):

Exact output, verbatim:

```
Frozen classify (called once): primary=fintech secondary=null confidence=0.95
Frozen pools (read from .cache/, NOT reseeded): primary=16 items, secondary=n/a items
Frozen competitor items (called once): Remitly, OFX, Revolut — 17 total items

[run 1] pass1_direct=15 pass1_indirect=9 pass1_none=8 | final_direct=2 | standards=PASS
         [direct] Revolut rolls out its euro stablecoin EURR across three countries
         [direct] Revolut's euro stablecoin lands in a market MiCA had opened up for a US issuer
         [indirect] Revolut launches an in-house AI research unit for its banking models
[run 2] pass1_direct=13 pass1_indirect=10 pass1_none=9 | final_direct=2 | standards=PASS
         [direct] Revolut launches its first euro-backed stablecoin, EURR
         [direct] Revolut's euro stablecoin lands in a market MiCA effectively gave to a US company
         [indirect] Revolut sets up an in-house AI research unit to build its own banking models
[run 3] pass1_direct=15 pass1_indirect=9 pass1_none=8 | final_direct=0 | standards=FAIL(min_direct)
         (quiet: Wise's categories are quiet right now — nothing in the pool cleared the bar for a real pulse this cycle.)
```

This run predates the harness print-statement change (added afterward, for
the follow-up batch below) — the `pass2_parse_attempts` field wasn't in the
console.log call yet for this specific invocation, so it doesn't appear in
this transcript. None of the three `standards` outcomes was
`pass2_unparseable`, which is the only signal this transcript actually
gives about parse failures: **none occurred in this batch.**

**Honest answer to "did any run hit a parse failure and did the retry
recover it": no parse failure occurred in this 3-run batch.** Ran a second
batch (Wise again, and Notion — a bigger, 72-item combined pool, more Pass
2 thinking-token pressure, reasoned as more likely to hit the truncation
case) specifically trying to catch one:

```
[measure-determinism] failed: Error: Anthropic API error: 400
{"type":"error","error":{"type":"invalid_request_error",
"message":"Your credit balance is too low to access the Anthropic API.
Please go to Plans & Billing to upgrade or purchase credits."}}
```

**The Anthropic account ran out of credits mid-session, on the very first
Pass 2 call of that second batch — no further live Anthropic calls are
possible right now.** This is an unplanned but genuinely useful live data
point in itself: the stack trace shows this error propagated straight out
of `runPass2` through `runPass2WithRetry` and out of `generatePulseRead`
with exactly **one** Pass 2 call attempted — live, real-world confirmation
that a genuine API error is not retried, on top of the mocked version of
the same case (test 4 above). Not fabricating a second live parse-failure
observation to complete the picture — this is where live verification
stopped this session, reported as such.

**Net honest status on Fix 2's live verification**: the retry mechanism's
logic is proven correct (mock-verified, 5 targeted tests) and its
"don't retry API errors" half is now confirmed live too (by accident, but
confirmed). Its "recovers a live parse failure" half was not observed live
this session — the original measurement's one failure (Wise run 2 in the
prior fix-pass report) isn't something that can be replayed on demand;
parse failures are apparently infrequent enough (1 of 9 total Pass 2 calls
across all frozen-pool measurement runs to date, this pass and the last)
that 6 more calls weren't enough to catch a second one before hitting the
credit limit.

---

## Explicitly not touched, per instruction

Pass 2's own selection variance (which items get chosen, how they get
labeled) — not addressed, no consensus runs added, Pass 2's discretion
unchanged. That remains the open, deliberately-deferred question from the
prior fix-pass report.

## Live-verified / mock-verified summary

- **Live-verified**: Fix 1's classify determinism (6 calls, 2 brands, zero
  variance observed); Fix 2's "don't retry a real API error" behavior
  (accidental but real, via the credit-exhaustion error); the Wise
  frozen-pool re-run (3 clean runs, no parse failure to test recovery
  against).
- **Mock-verified**: Fix 2's full retry-loop logic (5 tests) — this is what
  actually proves the retry-then-recover and retry-then-still-fail paths
  are implemented correctly, since neither was observed live this session.

## Files changed

- [`netlify/functions/lib/classify.js`](netlify/functions/lib/classify.js) — `temperature: 0`
- [`netlify/functions/lib/read-pulse.js`](netlify/functions/lib/read-pulse.js) — `runPass2WithRetry`, `parse_attempts`/`recovered_by_retry` on `debug.pass2`
- `netlify/functions/lib/read-pulse.test.js` — new, 5 tests
- `scripts/measure-determinism.js` — prints `pass2_parse_attempts`/recovery flag

48/48 unit tests passing (`npm test`).

## Open items

1. **Fix 2's "recovers a live parse failure" path was not observed live**
   this session (credits exhausted). If you want that specific case
   confirmed live rather than resting on the mock tests, that needs a fresh
   round of API credits and a few more frozen-pool runs — flagging, not
   blocking on it.
2. Same open items carried over from the prior fix-pass report (Pass 2
   selection variance, out of scope here per instruction) remain open.

// netlify/functions/lib/quiet-taxonomy.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyQuiet, hasCompetitorSignalInPool, QUIET_CAUSES } from "./quiet-taxonomy.js";

test("poolThin → QUIET_THIN_POOL", () => {
  assert.equal(
    classifyQuiet({ poolThin: true, poolStale: false, competitorItemCount: 5, poolCompetitorHit: false, direct: 3, minDirect: 2 }),
    QUIET_CAUSES.QUIET_THIN_POOL
  );
});

test("poolStale (not thin) → QUIET_STALE", () => {
  assert.equal(
    classifyQuiet({ poolThin: false, poolStale: true, competitorItemCount: 5, poolCompetitorHit: false, direct: 3, minDirect: 2 }),
    QUIET_CAUSES.QUIET_STALE
  );
});

test("zero competitor items, no pool signal, direct BELOW standard (not thin, not stale) → THIN_FIELD", () => {
  assert.equal(
    classifyQuiet({ poolThin: false, poolStale: false, competitorItemCount: 0, poolCompetitorHit: false, direct: 1, minDirect: 2 }),
    QUIET_CAUSES.THIN_FIELD
  );
});

test("zero competitor items BUT a pool item scored direct on a named competitor, direct below standard → QUIET_GENUINE, not THIN_FIELD (the Avis bug)", () => {
  assert.equal(
    classifyQuiet({ poolThin: false, poolStale: false, competitorItemCount: 0, poolCompetitorHit: true, direct: 1, minDirect: 2 }),
    QUIET_CAUSES.QUIET_GENUINE
  );
});

test("direct already clears the standard on category signal alone → null, even with zero competitor signal (Session 10: Avis, Replicate/Together AI/Modal run)", () => {
  assert.equal(
    classifyQuiet({ poolThin: false, poolStale: false, competitorItemCount: 0, poolCompetitorHit: false, direct: 2, minDirect: 2 }),
    null
  );
});

test("low direct count with real competitor signal present → QUIET_GENUINE", () => {
  assert.equal(
    classifyQuiet({ poolThin: false, poolStale: false, competitorItemCount: 5, poolCompetitorHit: false, direct: 1, minDirect: 2 }),
    QUIET_CAUSES.QUIET_GENUINE
  );
});

test("nothing wrong → null", () => {
  assert.equal(
    classifyQuiet({ poolThin: false, poolStale: false, competitorItemCount: 5, poolCompetitorHit: false, direct: 3, minDirect: 2 }),
    null
  );
});

test("precedence: poolThin beats an already-passing direct count", () => {
  assert.equal(
    classifyQuiet({ poolThin: true, poolStale: false, competitorItemCount: 0, poolCompetitorHit: false, direct: 5, minDirect: 2 }),
    QUIET_CAUSES.QUIET_THIN_POOL
  );
});

test("precedence: poolStale beats an already-passing direct count", () => {
  assert.equal(
    classifyQuiet({ poolThin: false, poolStale: true, competitorItemCount: 0, poolCompetitorHit: false, direct: 5, minDirect: 2 }),
    QUIET_CAUSES.QUIET_STALE
  );
});

test("precedence: an already-passing direct count beats THIN_FIELD", () => {
  assert.equal(
    classifyQuiet({ poolThin: false, poolStale: false, competitorItemCount: 0, poolCompetitorHit: false, direct: 4, minDirect: 2 }),
    null
  );
});

// ---------- hasCompetitorSignalInPool ----------

test("hasCompetitorSignalInPool — the live Avis case: a category-pool item names a competitor and scored direct", () => {
  const scored = [
    { relevance: "direct", item: { title: "The Hugging Face incident and the road ahead", description: "" } },
    { relevance: "indirect", item: { title: "Anthropic's best AI model struggles to attract users", description: "" } },
  ];
  assert.equal(hasCompetitorSignalInPool(scored, [{ name: "Hugging Face", source: "inferred" }]), true);
});

test("hasCompetitorSignalInPool — competitor named but item only scored indirect does not count", () => {
  const scored = [{ relevance: "indirect", item: { title: "Hugging Face publishes a research roundup", description: "" } }];
  assert.equal(hasCompetitorSignalInPool(scored, [{ name: "Hugging Face", source: "inferred" }]), false);
});

test("hasCompetitorSignalInPool — a direct item that doesn't name any competitor does not count", () => {
  const scored = [{ relevance: "direct", item: { title: "Some unrelated category headline", description: "" } }];
  assert.equal(hasCompetitorSignalInPool(scored, [{ name: "Hugging Face", source: "inferred" }]), false);
});

test("hasCompetitorSignalInPool — no competitors named at all → false regardless of pool", () => {
  const scored = [{ relevance: "direct", item: { title: "Hugging Face ships something", description: "" } }];
  assert.equal(hasCompetitorSignalInPool(scored, []), false);
});

test("hasCompetitorSignalInPool — word-boundary respected (no substring false positive)", () => {
  // "Ledger" the company must not match inside an unrelated word.
  const scored = [{ relevance: "direct", item: { title: "The Ledgerwood report on category trends", description: "" } }];
  assert.equal(hasCompetitorSignalInPool(scored, [{ name: "Ledger", source: "inferred" }]), false);
});

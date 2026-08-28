// netlify/functions/lib/quiet-taxonomy.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyQuiet, QUIET_CAUSES } from "./quiet-taxonomy.js";

test("poolThin → QUIET_THIN_POOL", () => {
  assert.equal(
    classifyQuiet({ poolThin: true, poolStale: false, competitorItemCount: 5, direct: 3, minDirect: 2 }),
    QUIET_CAUSES.QUIET_THIN_POOL
  );
});

test("poolStale (not thin) → QUIET_STALE", () => {
  assert.equal(
    classifyQuiet({ poolThin: false, poolStale: true, competitorItemCount: 5, direct: 3, minDirect: 2 }),
    QUIET_CAUSES.QUIET_STALE
  );
});

test("zero competitor items (not thin, not stale) → THIN_FIELD", () => {
  assert.equal(
    classifyQuiet({ poolThin: false, poolStale: false, competitorItemCount: 0, direct: 3, minDirect: 2 }),
    QUIET_CAUSES.THIN_FIELD
  );
});

test("low direct count (not thin, not stale, has competitors) → QUIET_GENUINE", () => {
  assert.equal(
    classifyQuiet({ poolThin: false, poolStale: false, competitorItemCount: 5, direct: 1, minDirect: 2 }),
    QUIET_CAUSES.QUIET_GENUINE
  );
});

test("nothing wrong → null", () => {
  assert.equal(
    classifyQuiet({ poolThin: false, poolStale: false, competitorItemCount: 5, direct: 3, minDirect: 2 }),
    null
  );
});

test("precedence: poolThin beats competitorItemCount===0", () => {
  assert.equal(
    classifyQuiet({ poolThin: true, poolStale: false, competitorItemCount: 0, direct: 1, minDirect: 2 }),
    QUIET_CAUSES.QUIET_THIN_POOL
  );
});

test("precedence: poolStale beats THIN_FIELD", () => {
  assert.equal(
    classifyQuiet({ poolThin: false, poolStale: true, competitorItemCount: 0, direct: 1, minDirect: 2 }),
    QUIET_CAUSES.QUIET_STALE
  );
});

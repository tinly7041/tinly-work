import { test } from "node:test";
import assert from "node:assert/strict";
import { rank } from "./rank.js";

function fakeItems(source, n, scoreStart = 1) {
  return Array.from({ length: n }, (_, i) => ({
    source,
    score: scoreStart - i * 0.001,
    url: `https://example.com/${source}/${i}`,
    title: `${source} item ${i}`,
    date: new Date().toISOString(),
  }));
}

function maxShare(out) {
  const counts = {};
  for (const i of out) counts[i.source] = (counts[i.source] || 0) + 1;
  return Math.max(...Object.values(counts)) / out.length;
}

test("depth-50 brief bug: a fixed cap of floor(limit*share) let one source own 84% of a thin category", () => {
  // The exact live shape that exposed the bug — SaaS candidate pool was
  // lobsters:25 / hn:2 / github:1 against limit=40. The old cap
  // (floor(40*0.4)=16) let lobsters reach 16 of a 19-item final cache.
  const items = [...fakeItems("lobsters", 25), ...fakeItems("hn", 2), ...fakeItems("github", 1)];
  const out = rank(items, 40);
  assert.ok(maxShare(out) <= 0.4, `max share was ${maxShare(out)}, expected <= 0.4`);
});

test("a single-source category is not crushed by the share cap", () => {
  // A share cap is a diversity constraint between sources — meaningless (and
  // actively harmful) with only one source to begin with.
  const items = fakeItems("lobsters", 30);
  const out = rank(items, 40);
  assert.equal(out.length, 30);
});

test("an abundant, balanced pool is unaffected by the cap", () => {
  const items = [...fakeItems("hn", 20), ...fakeItems("github", 20), ...fakeItems("arxiv", 20)];
  const out = rank(items, 40);
  assert.equal(out.length, 40);
  assert.ok(maxShare(out) <= 0.4);
});

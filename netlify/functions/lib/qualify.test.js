import { test } from "node:test";
import assert from "node:assert/strict";
import { structuralDisqualify, passesQualifyingSignal } from "./qualify.js";

test("Ask HN prefix is disqualified", () => {
  assert.equal(structuralDisqualify({ title: "Ask HN: tracking my illness" }), "ask_hn");
  assert.equal(passesQualifyingSignal({ title: "Ask HN: how do I learn Rust" }), false);
});

test("listicle / top-N titles are disqualified", () => {
  assert.equal(structuralDisqualify({ title: "Top 10 fintech tools for 2026" }), "listicle");
  assert.equal(structuralDisqualify({ title: "5 best crypto wallets this year" }), "listicle");
});

test("a genuine event title is not disqualified", () => {
  assert.equal(structuralDisqualify({ title: "Stripe acquires a payments infra startup" }), null);
  assert.equal(passesQualifyingSignal({ title: "Regulator revokes a neobank's licence" }), true);
});

// netlify/functions/lib/classify.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { stripPossessiveDescriptor } from "./classify.js";

// ---------- the Avis case (Session 9b/10, live-caught) ----------

test("Avis case: possessive-descriptor phrase is trimmed to the canonical name", () => {
  assert.equal(stripPossessiveDescriptor("Anthropic's API marketplace"), "Anthropic");
  assert.equal(stripPossessiveDescriptor("OpenAI's app ecosystem"), "OpenAI");
});

test("the prompt's own worked example: Ramp's corporate card product -> Ramp", () => {
  assert.equal(stripPossessiveDescriptor("Ramp's corporate card product"), "Ramp");
});

test("curly apostrophe is handled the same as straight apostrophe", () => {
  assert.equal(stripPossessiveDescriptor("Anthropic’s API marketplace"), "Anthropic");
});

// ---------- the Perplexity case (phase2.7-report.md) — deliberately NOT fixed ----------
//
// This shape has no possessive marker, so the narrow rule must leave it
// alone rather than guess. Proves the rule doesn't silently misfire on the
// other known-bad shape by accident.

test("Perplexity case: a non-possessive descriptive phrase is left untouched (out of scope for this rule)", () => {
  assert.equal(stripPossessiveDescriptor("Google Search Generative Experience"), "Google Search Generative Experience");
  assert.equal(stripPossessiveDescriptor("OpenAI ChatGPT"), "OpenAI ChatGPT");
});

// ---------- regression guard: real multi-word canonical names must survive ----------
//
// A blind "keep only the first word" trim would also butcher these — the
// entity layer depends on the FULL canonical name verbatim (watchlist.js,
// phase2.7-report.md's live finding that bare "Aerodrome" alone returns
// near-zero Google News coverage).

test("legitimate multi-word canonical names are never touched (no possessive marker)", () => {
  assert.equal(stripPossessiveDescriptor("Aerodrome Finance"), "Aerodrome Finance");
  assert.equal(stripPossessiveDescriptor("Curve Finance"), "Curve Finance");
  assert.equal(stripPossessiveDescriptor("Hugging Face"), "Hugging Face");
  assert.equal(stripPossessiveDescriptor("Google Gemini"), "Google Gemini");
});

test("a plain single-word name with no possessive is a no-op", () => {
  assert.equal(stripPossessiveDescriptor("ChatGPT"), "ChatGPT");
  assert.equal(stripPossessiveDescriptor("Binance"), "Binance");
});

test("degenerate possessive with nothing left after stripping falls back to the original", () => {
  // group 1 matches a single space, which .trim()s to empty — must not
  // return an empty competitor name.
  assert.equal(stripPossessiveDescriptor(" 's example"), " 's example");
});

// netlify/functions/lib/read-pulse.js
//
// The read layer (Phase 2.5, revised into two passes). Takes a brand's
// classifier read plus its category trend pool(s) and produces a pulse: a
// short summary and a handful of items worth this specific brand's attention.
//
// Two passes, not one:
//   Pass 1 (scoring) — every pool item gets a relevance score/label/reason.
//     Structured output only, no prose, so it can run over the full 40-76
//     item pool without a writing budget forcing it to be selective too early.
//   Pass 2 (the write) — works only from the top-scoring items and writes
//     them up. May downgrade a Pass 1 relevance label, never upgrade it.
// This replaces a single call that did selection + labeling + prose at once.
// Live testing (Phase 2.5 revision, Step 1) showed that single call was
// stable in WHICH items it picked but unstable in whether it called them
// "direct" vs "indirect" from one identical-input call to the next — the
// joint decision was the source of the flakiness, not sampling noise.
//
// Temperature note: Sonnet 5 rejects `temperature` outright (400:
// "temperature is deprecated for this model", live-confirmed). There is no
// sampling knob on this model. `temperature: 0` is set only where the model
// actually accepts it (Haiku, used for Pass 1 by default); Pass 2 stays on
// Sonnet 5 with no temperature field at all, per product direction.
//
// Action standards are enforced here in code, never stated to either
// prompt — told a number, it pads. Neither prompt states a target count;
// this module discards anything that doesn't clear the floor and routes to
// the quiet path.
//
// Phase 2.5 — qualifying-signal filter (is_event). The matcher (matcher.js,
// upstream in collect.js) answers "is this item on-category." Nothing
// upstream answers "did anything actually happen" — a GitHub repo that
// merely exists, or a daily digest, passes the matcher fine and burns a
// pool slot Pass 2 has nothing to write from. `is_event` is a second field
// on the EXISTING Pass 1 response (no new API call, no new model call) and
// is applied as a hard gate, independent of relevance scoring: an item
// with is_event === false is dropped before selectTopN ever sees it,
// regardless of how relevant it scored.

import { dedupe, applyCorroborationBoost } from "./rank.js";
import { CATEGORIES } from "./categories.js";
import { computeCost } from "./pricing.js";

export const PASS1_MODEL = "claude-haiku-4-5";
export const READ_MODEL = "claude-sonnet-5"; // Pass 2 — the write
export const PASS2_TOP_N = 12; // headroom above the floor of 5, tune from data

// Models that still accept classical sampling params. Sonnet 5 (and the rest
// of the adaptive-thinking family) removed them — see file header.
const TEMPERATURE_SUPPORTED_MODELS = new Set(["claude-haiku-4-5"]);

export const ACTION_STANDARDS = {
  minItems: 5,
  minDirect: 3,
  minUniqueSources: 2,
};

const RELEVANCE_RANK = { direct: 2, indirect: 1, none: 0 };

// Deliberately not a bare /\d/ — that would kill grounded references like
// "GPT-4", "Web3", "Q3" and a bare year, while still missing the brief's own
// example ("hundreds of impressions" has no digit at all). Targets
// digit+unit combos, currency-digit, and the spelled-out-quantity idiom.
export const PAYOFF_QUANT_PATTERN =
  /(\d+(\.\d+)?\s?(%|percent|x\b|times\b|k\b|m\b|million|billion|thousand|hundred)|\$\s?\d|\b(hundreds?|thousands?|dozens?|millions?|double|triple|quadruple)\b\s+of\b)/i;

// ---------- pool selection ----------
//
// Primary category's items, plus secondary's if present. Cross-category dupes
// are real signal for THIS brand specifically (the same story showed up under
// two different category searches) — reuse the existing dedupe/corroboration
// machinery from rank.js rather than forking it; a cross-category match unions
// into `corroborated_sources` and picks up the same +0.05/source boost a
// same-category corroboration would.
export function selectPool(primaryPool, secondaryPool) {
  const primaryItems = primaryPool?.items || [];
  const secondaryItems = secondaryPool?.items || [];
  const combined = [...primaryItems, ...secondaryItems].map((i) => ({ ...i }));

  const { items, removed } = dedupe(combined);
  applyCorroborationBoost(items);
  items.sort((a, b) => (b.score || 0) - (a.score || 0));

  return { items, cross_category_dupes_removed: removed };
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function contextHeader({ brandName, website, brandRead, primaryCategory, secondaryCategory }) {
  const primaryLabel = CATEGORIES[primaryCategory]?.label || primaryCategory;
  const secondaryLabel = secondaryCategory ? CATEGORIES[secondaryCategory]?.label || secondaryCategory : null;
  return [
    `Brand: ${brandName}`,
    `Website: ${website}`,
    `What it does: ${brandRead}`,
    `Primary category: ${primaryCategory} (${primaryLabel})`,
    secondaryLabel ? `Secondary category: ${secondaryCategory} (${secondaryLabel})` : null,
  ].filter((l) => l !== null);
}

async function callAnthropic({ fetchImpl, anthropicApiKey, body }) {
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic API error: ${res.status} ${errBody}`);
  }
  return res.json();
}

// ---------- Pass 1: relevance scoring ----------

const SCORE_TOOL = {
  name: "score_pool_items",
  description: "Score every pool item's relevance to the brand.",
  input_schema: {
    type: "object",
    properties: {
      scores: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            relevance_score: { type: "number" },
            relevance: { type: "string", enum: ["direct", "indirect", "none"] },
            one_line_reason: { type: "string" },
            is_event: { type: "boolean" },
          },
          required: ["index", "relevance_score", "relevance", "one_line_reason", "is_event"],
        },
      },
    },
    required: ["scores"],
  },
};

function buildPass1SystemPrompt() {
  return `You score how relevant each pool item is to a specific brand, for a trend-monitoring tool. This is a scoring task, not a writing task — output nothing but scores.

You'll be given the brand's name, URL, a one- or two-sentence read on what it actually does, its primary (and maybe secondary) category, and a numbered pool of real, recent items from category sources.

For every item, score:
- "relevance": "direct" if it sits squarely in the brand's own category or business model, "indirect" if it's adjacent or a second-order signal worth knowing about but not squarely on-topic, "none" if it has no real connection to this specific brand.
- "relevance_score": 0 to 1 — how confidently this item matters to THIS brand specifically, not how big or newsworthy the item is in general.
- "one_line_reason": one short, concrete sentence grounding the score in what the item actually is and how it relates (or doesn't) to the brand.
- "is_event": true only if a named org shipped, launched, raised, acquired, was exploited, or a regulator acted, OR a measurable market move occurred. Otherwise false. This is independent of relevance — an item can be highly relevant to the brand's category and still not be an event.

Explicitly NOT events (is_event: false), regardless of how relevant they otherwise score: a repo or tool merely existing; link roundups and daily digests; opinion, explainer, or tutorial content; listicles.

Score every item in the pool, using its index exactly as given — do not skip any. Do not force "direct" onto an item just because it's in the right category if it isn't actually about the brand's specific business. Most category news is indirect or none, not direct; an honest score distribution reflects that.`;
}

function buildPass1UserMessage(ctx, items) {
  const poolLines = items.map((i, idx) => `${idx}. [${i.source}] ${i.title} (${i.date})`);
  return [...contextHeader(ctx), "", `Pool (${items.length} items, indices 0-${items.length - 1}):`, poolLines.join("\n")].join(
    "\n"
  );
}

export async function runPass1({ pool, fetchImpl, anthropicApiKey, model = PASS1_MODEL, ...ctx }) {
  const body = {
    model,
    // Per-item budget raised 60 -> 80 after the is_event field was added
    // (Phase 2.5): live-verified this was previously marginal, not safely
    // headroomed — a real 40-item run hit the old 2900-token cap exactly
    // and got truncated mid-JSON, silently producing zero valid scores.
    // Same failure mode is now fixed with headroom for the extra field.
    max_tokens: Math.min(8000, 500 + pool.length * 80),
    system: buildPass1SystemPrompt(),
    messages: [{ role: "user", content: buildPass1UserMessage(ctx, pool) }],
    tools: [SCORE_TOOL],
    tool_choice: { type: "tool", name: "score_pool_items" },
  };
  if (TEMPERATURE_SUPPORTED_MODELS.has(model)) body.temperature = 0;

  const data = await callAnthropic({ fetchImpl, anthropicApiKey, body });
  const toolUse = data.content?.find((b) => b.type === "tool_use" && b.name === "score_pool_items");
  const rawScores = Array.isArray(toolUse?.input?.scores) ? toolUse.input.scores : [];

  const seen = new Set();
  const scored = [];
  for (const s of rawScores) {
    if (!Number.isInteger(s.index) || s.index < 0 || s.index >= pool.length) continue; // out-of-range — drop
    if (seen.has(s.index)) continue; // duplicate — keep first
    seen.add(s.index);
    scored.push({
      item: pool[s.index],
      relevance_score: clamp01(s.relevance_score),
      relevance: ["direct", "indirect", "none"].includes(s.relevance) ? s.relevance : "none",
      one_line_reason: typeof s.one_line_reason === "string" ? s.one_line_reason : "",
      // Hard gate, default deny: anything other than a literal `true` does
      // not survive. Missing/malformed is not "benefit of the doubt."
      is_event: s.is_event === true,
    });
  }
  return { scored, debug: { model, usage: data.usage || null } };
}

export function scoreDistribution(scored) {
  const direct = scored.filter((s) => s.relevance === "direct").length;
  const indirect = scored.filter((s) => s.relevance === "indirect").length;
  const none = scored.filter((s) => s.relevance === "none").length;
  const top_10_scores = [...scored]
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, 10)
    .map((s) => s.relevance_score);
  return { total: scored.length, direct, indirect, none, top_10_scores };
}

export function selectTopN(scored, n = PASS2_TOP_N) {
  return scored
    .filter((s) => s.relevance !== "none")
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, n);
}

// Independent hard gate, not a score input — applied before selectTopN's
// ranking, so an item that fails it never reaches Pass 2 no matter how
// relevant it scored.
export function applyEventGate(scored) {
  const kept = [];
  const dropped = [];
  for (const s of scored) (s.is_event ? kept : dropped).push(s);
  return { kept, dropped };
}

// ---------- Pass 2: the write ----------

function buildPass2SystemPrompt() {
  return `You are writing the read for a trend pulse — the second half of a two-step pipeline. A prior step already scored every pool item for relevance to this brand; you are given only the items that scored high enough to be worth writing about, with their relevance label, score, and reason. Your job is to decide which of THOSE items earn a place in the final pulse and write them up.

Rules:
- Only use items from the list you're given. Never invent a url, source, or headline that isn't backed by one of the given items — carry url and source through exactly as given.
- Return between 0 and ${PASS2_TOP_N} items — however many genuinely earn a place for this brand. Do not pad the list to hit a number, and do not include a weak or generic item just to fill a slot.
- You may keep or downgrade the relevance label you were given (direct -> indirect) if on reflection it's weaker than the prior step judged. You may NEVER upgrade a label (indirect -> direct) — if the prior step called it indirect, the most you can call it is indirect.
- "headline": rewrite it plainly if the source title is SEO-padded or clickbait; otherwise keep it close to the source.
- "effort": "quick" (a reactive post, a comment, a quick take) or "campaign" (something that takes real production).
- "why_now": one sentence, concrete — what actually changed (a launch, a funding round, a spike, a regulatory move). Not vibes.

so_what and payoff — read this carefully, it's a deliberate change from a plainer "name the angle" instruction used before:
- "so_what": the idea. Concrete enough that the reader can picture it, open enough that they own the execution. A human strategist's suggestion, not an AI's task list. One or two sentences.
- "payoff": the stake. What acting on this gets them, and what the cost of ignoring it is. One sentence.

CRITICAL: "payoff" must never contain a number, percentage, multiple, or any invented quantity. No "could lift engagement 30%," no "2x reach," no "hundreds of impressions." You do not have the data to estimate any of that and will invent it confidently if you try — one fabricated statistic discredits the entire report. Payoff is directional and qualitative: who notices, what position it claims, what happens if a competitor claims it first.

Calibration — three examples for the same underlying item:

Too weak (an observation, not an idea — no stake):
so_what: "worth a reaction on why that abstraction layer needs to be a platform, not a script"

Too prescriptive (an AI's task list, not a strategist's suggestion):
so_what: "Post a Twitter thread by Friday 3pm with 5 bullet points comparing your uptime to theirs, and tag the repo maintainer."

Right (the target):
so_what: "Two teams just shipped the swap-any-model problem as a weekend script. That framing is now in the air and it undersells what you do — the case for why it needs to be infrastructure rather than a script is available to whoever makes it first."
payoff: "Makes the category argument on your terms while it is still open. Concede it and you spend next year explaining why you are not a wrapper."

The difference: the third one hands over a position worth taking and what it wins, without writing the post. (Note: the em dash in that reference example is part of the quoted calibration text, not a formatting license — your own writing still follows the no-em-dash rule below.)

Audience: a founder or small team at a brand somewhere between seed and Series C — infer the stage from the site content you're given. They are based in or care most about Greater Asia and Southeast Asia specifically. Global trends are in scope, but when a trend is global, say briefly what it means for that region rather than assuming a US/EU-only reader.

Writing:
- Write with the energy of someone who just found something interesting, not someone filling out a form.
- If an item's connection to this specific brand is thin, say so honestly (keep or downgrade to "indirect") or leave it out — don't force a connection that isn't there.
- No em dashes. No "not just X but Y" constructions. No three-part rhythm triads ("bold, fast, and different"). Write like a sharp, specific person talking, not a copywriter.

Respond with ONLY a JSON object, no markdown fences, no other text:
{"pulse_summary": "2-3 sentences, names the brand, written directly to them", "items": [{"headline": "...", "url": "...", "source": "...", "relevance": "direct|indirect", "effort": "quick|campaign", "why_now": "...", "so_what": "...", "payoff": "..."}]}`;
}

function buildPass2UserMessage(ctx, top) {
  const lines = top.map((s, idx) => {
    const i = s.item;
    const corroborated = (i.corroborated_sources?.length ?? 1) > 1;
    return `${idx + 1}. [${i.source}] ${i.title}\n   url: ${i.url}\n   date: ${i.date}\n   prior scoring: relevance=${s.relevance}, score=${s.relevance_score}, reason="${s.one_line_reason}"${
      corroborated ? `\n   corroborated across: ${i.corroborated_sources.join(", ")}` : ""
    }`;
  });
  return [
    ...contextHeader(ctx),
    "",
    `Candidate items (${top.length}, already relevance-scored by a prior step):`,
    lines.join("\n\n"),
  ].join("\n");
}

// Distinguishes "the model's JSON was truncated/malformed" (a degrade-to-quiet
// case, same family as an invented url or a below-floor item count) from a
// genuine API/network failure (auth, 5xx, connectivity — those should still
// surface as a hard failure, not silently discard the run).
class Pass2ParseError extends Error {
  constructor(message, raw) {
    super(message);
    this.name = "Pass2ParseError";
    this.raw = raw;
  }
}

async function runPass2({ top, fetchImpl, anthropicApiKey, model = READ_MODEL, ...ctx }) {
  const body = {
    model,
    // Sonnet 5 runs adaptive thinking by default and its token spend is
    // variable and NOT deducted from a separate budget — a 12-candidate
    // evaluation can burn most of a tight max_tokens on thinking alone,
    // truncating the JSON that follows. Generous ceiling, not a tight fit.
    max_tokens: Math.min(16000, Math.max(8192, 2000 + top.length * 700)),
    system: buildPass2SystemPrompt(),
    messages: [{ role: "user", content: buildPass2UserMessage(ctx, top) }],
  };
  if (TEMPERATURE_SUPPORTED_MODELS.has(model)) body.temperature = 0;

  const data = await callAnthropic({ fetchImpl, anthropicApiKey, body });
  const raw = data.content?.find((b) => b.type === "text")?.text || "";
  const cleaned = raw.replace(/```json|```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Pass2ParseError(`Pass 2 returned invalid JSON: ${e.message}`, raw.slice(0, 1000));
  }
  return { parsed, debug: { model, usage: data.usage || null } };
}

function enforceRelevanceDowngradeOnly(items, pass1ByUrl) {
  const corrections = [];
  for (const it of items) {
    const prior = pass1ByUrl.get(it.url);
    if (!prior) continue; // not in the top-N we showed Pass 2 — caught by the invented-url check downstream
    const priorRank = RELEVANCE_RANK[prior.relevance] ?? 0;
    const currentRank = RELEVANCE_RANK[it.relevance] ?? 0;
    if (currentRank > priorRank) {
      corrections.push({ url: it.url, from: it.relevance, to: prior.relevance });
      it.relevance = prior.relevance;
    }
  }
  return corrections;
}

function filterPayoffViolations(items) {
  const kept = [];
  const dropped = [];
  for (const it of items) {
    if (typeof it.payoff === "string" && PAYOFF_QUANT_PATTERN.test(it.payoff)) {
      dropped.push({ url: it.url, payoff: it.payoff });
    } else {
      kept.push(it);
    }
  }
  return { kept, dropped };
}

// ---------- action standards ----------

function checkStandards(items, validUrls) {
  const invented = items.find((it) => !validUrls.has(it.url));
  if (invented) {
    return { pass: false, failed_standard: "no_invented_urls", detail: `url not in top-N pool: ${invented.url}` };
  }
  if (items.length < ACTION_STANDARDS.minItems) {
    return {
      pass: false,
      failed_standard: "min_items",
      detail: `got ${items.length}, need >= ${ACTION_STANDARDS.minItems}`,
    };
  }
  const directCount = items.filter((i) => i.relevance === "direct").length;
  if (directCount < ACTION_STANDARDS.minDirect) {
    return {
      pass: false,
      failed_standard: "min_direct",
      detail: `got ${directCount} direct, need >= ${ACTION_STANDARDS.minDirect}`,
    };
  }
  const uniqueSources = new Set(items.map((i) => i.source)).size;
  if (uniqueSources < ACTION_STANDARDS.minUniqueSources) {
    return {
      pass: false,
      failed_standard: "min_unique_sources",
      detail: `got ${uniqueSources} unique sources, need >= ${ACTION_STANDARDS.minUniqueSources}`,
    };
  }
  return { pass: true, failed_standard: null, direct_count: directCount, unique_sources: uniqueSources };
}

function quietResult(brandName) {
  return {
    quiet: true,
    pulse_summary: `${brandName}'s categories are quiet right now — nothing in the pool cleared the bar for a real pulse this cycle.`,
    items: [],
  };
}

// ---------- main entry point ----------

export async function generatePulseRead({
  brandName,
  website,
  brandRead,
  primaryCategory,
  secondaryCategory,
  primaryPool,
  secondaryPool,
  fetchImpl = fetch,
  anthropicApiKey,
  pass1Model = PASS1_MODEL,
  pass2Model = READ_MODEL,
  topN = PASS2_TOP_N,
} = {}) {
  const ctx = { brandName, website, brandRead, primaryCategory, secondaryCategory };
  const { items: pool, cross_category_dupes_removed } = selectPool(primaryPool, secondaryPool);

  const debug = {
    pool_size: pool.length,
    primary_pool_size: primaryPool?.items?.length || 0,
    secondary_pool_size: secondaryPool?.items?.length || 0,
    cross_category_dupes_removed,
  };

  if (!pool.length) {
    return { result: quietResult(brandName), debug: { ...debug, standards: { pass: false, failed_standard: "empty_pool" } } };
  }

  const { scored, debug: pass1Debug } = await runPass1({ ...ctx, pool, fetchImpl, anthropicApiKey, model: pass1Model });
  const distribution = scoreDistribution(scored);
  const pass1Cost = computeCost(pass1Debug.usage, pass1Debug.model);

  const { kept: eventGated, dropped: eventDropped } = applyEventGate(scored);
  debug.pass1 = {
    model: pass1Debug.model,
    usage: pass1Debug.usage,
    cost: pass1Cost,
    score_distribution: distribution,
    is_event: {
      in: scored.length,
      dropped: eventDropped.length,
      out: eventGated.length,
      dropped_titles: eventDropped.map((s) => s.item.title),
    },
  };

  const top = selectTopN(eventGated, topN);
  if (!top.length) {
    debug.standards = {
      pass: false,
      failed_standard: eventGated.length === 0 && scored.length > 0 ? "no_items_survived_event_gate" : "no_items_above_none",
    };
    debug.total_cost = Number((pass1Cost?.usd || 0).toFixed(6));
    return { result: quietResult(brandName), debug };
  }

  let parsed, pass2Debug;
  try {
    ({ parsed, debug: pass2Debug } = await runPass2({ ...ctx, top, fetchImpl, anthropicApiKey, model: pass2Model }));
  } catch (e) {
    if (!(e instanceof Pass2ParseError)) throw e; // genuine API/network failure — surface it, don't swallow
    debug.pass2 = { model: pass2Model, usage: null, cost: null, parse_error: e.message, raw_snippet: e.raw };
    debug.standards = { pass: false, failed_standard: "pass2_unparseable", detail: e.message };
    debug.total_cost = Number((pass1Cost?.usd || 0).toFixed(6));
    return { result: quietResult(brandName), debug };
  }
  const pass2Cost = computeCost(pass2Debug.usage, pass2Debug.model);

  const candidateItems = Array.isArray(parsed.items) ? parsed.items : [];
  const validUrls = new Set(top.map((s) => s.item.url));
  const pass1ByUrl = new Map(top.map((s) => [s.item.url, s]));

  const relevance_downgrades = enforceRelevanceDowngradeOnly(candidateItems, pass1ByUrl);
  const { kept, dropped: payoff_violations_dropped } = filterPayoffViolations(candidateItems);

  debug.pass2 = { model: pass2Debug.model, usage: pass2Debug.usage, cost: pass2Cost, relevance_downgrades, payoff_violations_dropped };
  debug.usage = pass2Debug.usage; // back-compat alias — Pass 2 is the closest semantic match to the old single-call cost
  debug.model = pass2Debug.model;
  debug.total_cost = Number(((pass1Cost?.usd || 0) + (pass2Cost?.usd || 0)).toFixed(6));

  const standards = checkStandards(kept, validUrls);
  debug.standards = standards;
  debug.raw_item_count = kept.length;
  debug.raw_items = kept;

  if (!standards.pass) {
    return { result: quietResult(brandName), debug };
  }

  return {
    result: { quiet: false, pulse_summary: parsed.pulse_summary, items: kept },
    debug,
  };
}

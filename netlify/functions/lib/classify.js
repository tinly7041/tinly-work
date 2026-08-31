// netlify/functions/lib/classify.js
//
// Classifies a brand into the Phase 2 category taxonomy and produces a short,
// descriptive read of what the brand actually does. Categories come from
// lib/categories.js (the single source of truth for the trend-pool keys) so
// classification can never drift from what pools actually exist.
//
// Fetches the live site (title, meta description, og:*, ~1500 chars of body
// text) before classifying — a bare brand name gave the old classifier almost
// nothing to work with. Site-fetch failure is non-fatal: falls back to
// name-only classification and reports `site_read: false`.

import { CATEGORIES, ACTIVE } from "./categories.js";

const FETCH_TIMEOUT_MS = 5000;
const BODY_TEXT_LIMIT = 1500;
export const CLASSIFY_MODEL = "claude-haiku-4-5";

// Category descriptions used only to prime the classifier. Kept separate from
// categories.js's `label` field (which is just a display string) so this can
// carry enough semantic detail for the model without polluting the crawl config.
const CATEGORY_HINTS = {
  ai: "AI-native products, ML infra, AI agents/tools, model providers or aggregators",
  web3: "blockchain, DeFi, crypto exchanges, wallets, protocols, NFT/token projects",
  fintech: "payments, banking infra, lending, financial SaaS (non-crypto)",
  saas: "developer tools, B2B software, cloud infra, internal tooling",
};

function buildSystemPrompt() {
  const categoryList = ACTIVE.map(
    (key) => `- ${key}: ${CATEGORY_HINTS[key] || CATEGORIES[key].label}`
  ).join("\n");

  return `You classify early-stage tech brands for a trend-monitoring tool that only tracks these categories:

${categoryList}

You will be given the brand name, its URL, and — when available — content read directly from its website (title, meta description, Open Graph tags, and a slice of body text). Base your read on what the site actually says the product does, not on the brand name alone, and not on the site's own marketing language.

Task:
1. "primary": the single category that fits best. Always exactly one of the keys listed above, even if the fit is imperfect — pick the closest one.
2. "secondary": a second category, ONLY if the site itself genuinely evidences real activity in a second category. Otherwise null. Most brands should get null — never force a fit just to fill the field. Markets move; don't apply a fixed rule about which categories pair together, read what's actually there.
3. "confidence": a number from 0 to 1 for the primary category.
4. "brand_read": one to two sentences, third person, describing what the product actually does and where it sits in its stack or market (for example: infrastructure layer vs. end-user application, aggregator vs. originator). Describe, don't flatter — strip adjectives and superlatives lifted from the site's own copy ("leading", "seamless", "best-in-class", "revolutionary", and the like). If no site content was available, base this on the brand name and URL alone and say so plainly rather than inventing detail.
5. "inferred_competitors": 1 to 3 real, named companies or products that most directly compete with this brand for the same customer — used as a fallback ONLY when a user doesn't name their own competitor, to search real news coverage for what that competitor has shipped. Each name MUST be the short, single canonical name that actually appears in headlines about it — the name a reporter would use, not a description of what it is (write "Aerodrome" or "Aerodrome Finance", not "the leading DEX on Base"; write "ChatGPT", not "OpenAI's conversational search feature"; a company name alone is fine when that IS how it's covered, e.g. "Ramp" not "Ramp's corporate card product"). Be specific and confident: a named competitor that actually takes the same volume or customer (for a DEX, the other DEX that takes its trading volume — not a token, a chain, or an adjacent-but-different business model). Empty array if you don't have enough signal to name one confidently — do not guess just to fill the field.

Respond with ONLY a JSON object, no markdown fences, no other text:
{"primary": "<key>", "secondary": "<key or null>", "confidence": <0-1 number>, "brand_read": "<1-2 sentences>", "inferred_competitors": ["<name>", ...]}`;
}

// ---------- site fetch ----------

function decodeEntities(s = "") {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTag(html, tag) {
  return html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
}

function matchMetaAttr(html, attr, value) {
  const patterns = [
    new RegExp(`<meta[^>]*\\b${attr}=["']${value}["'][^>]*\\bcontent=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]*\\bcontent=["']([^"']*)["'][^>]*\\b${attr}=["']${value}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeEntities(m[1]);
  }
  return "";
}

function extractOgTags(html) {
  const og = {};
  const re = /<meta[^>]*\bproperty=["'](og:[a-z:_-]+)["'][^>]*\bcontent=["']([^"']*)["']/gi;
  const reAlt = /<meta[^>]*\bcontent=["']([^"']*)["'][^>]*\bproperty=["'](og:[a-z:_-]+)["']/gi;
  let m;
  while ((m = re.exec(html))) og[m[1].toLowerCase()] = decodeEntities(m[2]);
  while ((m = reAlt.exec(html))) if (!og[m[2].toLowerCase()]) og[m[2].toLowerCase()] = decodeEntities(m[1]);
  return og;
}

function extractBodyText(html) {
  let body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];
  for (const tag of ["script", "style", "nav", "footer"]) body = stripTag(body, tag);
  body = body.replace(/<!--[\s\S]*?-->/g, " ");
  body = body.replace(/<[^>]+>/g, " ");
  body = decodeEntities(body);
  body = body.replace(/\s+/g, " ").trim();
  return body.slice(0, BODY_TEXT_LIMIT);
}

export async function fetchSiteContent(url, { timeout = FETCH_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const normalized = url.startsWith("http") ? url : `https://${url}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetchImpl(normalized, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; tinlywork-trendpulse/1.0)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const title = decodeEntities((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "");
    const description = matchMetaAttr(html, "name", "description");
    const og = extractOgTags(html);
    const bodyText = extractBodyText(html);
    if (!title && !description && !Object.keys(og).length && !bodyText) return null;
    return { title, description, og, bodyText };
  } catch {
    return null; // fetch failed or timed out — non-fatal, classify on name alone
  } finally {
    clearTimeout(t);
  }
}

function formatSiteContent(siteContent) {
  const lines = [];
  if (siteContent.title) lines.push(`Title: ${siteContent.title}`);
  if (siteContent.description) lines.push(`Meta description: ${siteContent.description}`);
  for (const [k, v] of Object.entries(siteContent.og || {})) {
    if (v) lines.push(`${k}: ${v}`);
  }
  if (siteContent.bodyText) lines.push(`Body text (excerpt):\n${siteContent.bodyText}`);
  return lines.join("\n");
}

// ---------- inferred_competitors cleanup ----------
//
// The prompt above already instructs the model to return the short canonical
// name a headline would use, not a description — but Haiku doesn't always
// comply. Live-caught, Session 9b/10 Avis run: `inferred_competitors` came
// back as "Anthropic's API marketplace" and "OpenAI's app ecosystem" instead
// of "Anthropic" and "OpenAI". Neither the entity cache nor the pool
// competitor-signal check (quiet-taxonomy.js) can match a literal descriptive
// phrase against real headline text, so a correct Pass 1 read (it separately,
// correctly, named "Anthropic" as a competitor in its own reasoning) never
// reaches `competitor_item_count`.
//
// This strips exactly that shape — `X's <description>` -> `X` — keyed off
// the possessive as the one unambiguous signal. Deliberately NOT a
// keep-only-the-first-word trim: that would also mutilate genuinely
// multi-word canonical names the entity layer depends on verbatim
// ("Aerodrome Finance", "Curve Finance", "Hugging Face" — see watchlist.js
// and phase2.7-report.md's live finding that the bare "Aerodrome" alone
// returns near-zero Google News coverage).
//
// Does NOT attempt to fix the other known-bad shape from the earlier
// Perplexity case (phase2.7-report.md): a purely descriptive multi-word
// phrase with no possessive marker, e.g. "Google Search Generative
// Experience". That shape has no reliable syntactic tell apart from a real
// canonical multi-word name — fixing it needs better classification, not a
// blind trim, so it's explicitly out of scope for this narrow rule.
const POSSESSIVE_DESCRIPTOR_RE = /^(.+?)['’]s\s+.+$/;

export function stripPossessiveDescriptor(name) {
  const m = name.match(POSSESSIVE_DESCRIPTOR_RE);
  if (!m) return name;
  const stripped = m[1].trim();
  if (!stripped) return name;
  console.log(`[classify] inferred_competitors: stripped possessive descriptor "${name}" -> "${stripped}"`);
  return stripped;
}

// ---------- classify ----------

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0.5;
  return Math.min(1, Math.max(0, x));
}

export async function classifyBrand({
  brandName,
  website,
  fetchImpl = fetch,
  anthropicApiKey,
  model = CLASSIFY_MODEL,
  fetchTimeout = FETCH_TIMEOUT_MS,
} = {}) {
  if (!brandName || !brandName.trim()) {
    throw new Error("brandName is required");
  }

  const siteContent = website ? await fetchSiteContent(website, { timeout: fetchTimeout, fetchImpl }) : null;
  const site_read = !!siteContent;

  const userMessage = [
    `Brand name: ${brandName}`,
    website ? `Website: ${website}` : "No website provided.",
    site_read ? formatSiteContent(siteContent) : "(site could not be read — classify on name/URL alone)",
  ].join("\n\n");

  // Masked diagnostic only — first 10 chars of an Anthropic key is just the
  // key-type prefix ("sk-ant-api03-"), not secret material. Confirms which
  // key actually got read from env without printing the real value; useful
  // when a 401 could mean either a bad key or the wrong .env got loaded
  // (see netlify.toml's [dev] comment on git-worktree env resolution).
  console.log(`[classify] using ANTHROPIC_API_KEY: ${anthropicApiKey ? anthropicApiKey.slice(0, 10) + "..." : "(unset)"}`);

  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    // temperature: 0 — live-caught, Session 10: two identical Avis re-runs
    // (same brand, same URL, back to back) returned two entirely different
    // inferred_competitors sets ("Anthropic's API marketplace"/"OpenAI's app
    // ecosystem" vs. "Replicate"/"Together AI"/"Modal"). Haiku accepts 0 here
    // (same model read-pulse.js's Pass 1 pins for the same reason) — pinning
    // it doesn't guarantee identical output every time, but removes sampling
    // as a source of run-to-run drift in which competitors get tracked.
    body: JSON.stringify({
      model,
      max_tokens: 300,
      temperature: 0,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic API error: ${res.status} ${errBody}`);
  }

  const data = await res.json();
  const raw = data.content?.find((b) => b.type === "text")?.text || "";
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);

  let primary = parsed.primary;
  if (!ACTIVE.includes(primary)) {
    console.warn(`classify: model returned invalid primary "${primary}", defaulting to "${ACTIVE[0]}"`);
    primary = ACTIVE[0];
  }
  const secondary = ACTIVE.includes(parsed.secondary) && parsed.secondary !== primary ? parsed.secondary : null;
  const confidence = clamp01(parsed.confidence);
  const brand_read =
    typeof parsed.brand_read === "string" && parsed.brand_read.trim()
      ? parsed.brand_read.trim()
      : "No description available.";

  // Defensive validation, same shape as every other field here: a model
  // that returns garbage (non-array, non-strings, the brand naming itself)
  // degrades to an empty list rather than polluting the competitor layer's
  // entity cache with junk keys.
  const inferred_competitors = Array.isArray(parsed.inferred_competitors)
    ? [...new Set(
        parsed.inferred_competitors
          .filter((c) => typeof c === "string" && c.trim())
          .map((c) => c.trim())
          .map(stripPossessiveDescriptor)
          .filter((c) => c.toLowerCase() !== brandName.trim().toLowerCase())
      )].slice(0, 3)
    : [];

  return {
    primary,
    secondary,
    confidence,
    brand_read,
    site_read,
    inferred_competitors,
    _usage: data.usage || null,
    _model: model,
  };
}

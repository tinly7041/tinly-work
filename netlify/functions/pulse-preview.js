// netlify/functions/pulse-preview.js
//
// State 1 submit → State 2 pre-gate proof. Runs the cheap half (Haiku
// scoring) so anonymous visitors see real scored items before the contact
// gate. Abuse gates (honeypot, Turnstile, IP rate limit) moved here
// verbatim from generate-pulse.js, which this endpoint supersedes.

import crypto from "crypto";
import { getStore } from "@netlify/blobs";
import { classifyBrand } from "./lib/classify.js";
import { loadCategoryPool } from "./lib/pool.js";
import { getCachedEntity } from "./lib/entity-cache.js";
import { runPreGate, ACTION_STANDARDS } from "./lib/read-pulse.js";
import { classifyQuiet } from "./lib/quiet-taxonomy.js";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RATE_LIMIT_STORE = "rate-limits";
const RATE_LIMIT_PER_DAY = 5;
const RATE_LIMIT_CAS_ATTEMPTS = 5;
const MAX_STALE_HOURS = 60;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function rateLimitKey(ip, salt) {
  const hash = crypto.createHash("sha256").update(ip + salt).digest("hex").slice(0, 32);
  const today = new Date().toISOString().slice(0, 10);
  return `${hash}:${today}`;
}

async function verifyTurnstile(fetchImpl, token, ip, secret) {
  const res = await fetchImpl(TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, response: token, remoteip: ip }),
  });
  return res.json();
}

async function checkAndIncrementRateLimit(store, key) {
  for (let attempt = 0; attempt < RATE_LIMIT_CAS_ATTEMPTS; attempt++) {
    const existing = await store.getWithMetadata(key, { type: "json" });
    const count = existing?.data?.count || 0;
    if (count >= RATE_LIMIT_PER_DAY) return { limited: true };
    const writeOptions = existing ? { onlyIfMatch: existing.etag } : { onlyIfNew: true };
    const result = await store.setJSON(key, { count: count + 1 }, writeOptions);
    if (result.modified) return { limited: false };
  }
  return { limited: true };
}

export default async (req, context) => {
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  // Gate 1: honeypot
  if (body.fax) return json(200, { status: "ok", quiet: true });

  const ip = context.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";

  // Gate 2: Turnstile
  try {
    const result = await verifyTurnstile(fetch, body.turnstileToken, ip, process.env.TURNSTILE_SECRET);
    if (!result?.success) return json(403, { error: "verification_failed" });
  } catch (err) {
    console.error("turnstile verify failed:", err);
    return json(403, { error: "verification_failed" });
  }

  // Gate 3: IP rate limit
  if (ip === "unknown") {
    console.log("rate limit skipped: IP unresolved, failing open");
  } else {
    try {
      const store = getStore(RATE_LIMIT_STORE);
      const key = rateLimitKey(ip, process.env.IP_SALT);
      const { limited } = await checkAndIncrementRateLimit(store, key);
      if (limited) return json(429, { error: "rate_limited" });
    } catch (err) {
      console.error("rate limit check failed:", err);
      return json(429, { error: "rate_limited" });
    }
  }

  // Classify the brand
  const classification = await classifyBrand({
    brandName: body.brandName,
    website: body.website,
    fetchImpl: fetch,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  const { primary: primaryCategory, secondary: secondaryCategory, brand_read: brandRead, confidence, inferred_competitors } = classification;

  if (!primaryCategory) {
    return json(200, { status: "unknown_brand", brand: body.brandName });
  }

  // Load category pools
  const primaryPool = await loadCategoryPool(primaryCategory, { getStore });
  const secondaryPool = secondaryCategory ? await loadCategoryPool(secondaryCategory, { getStore }) : null;

  // Pool health signals
  const poolAgeHours = primaryPool?.fetched_at ? (Date.now() - Date.parse(primaryPool.fetched_at)) / 3_600_000 : Infinity;
  const poolStale = poolAgeHours > MAX_STALE_HOURS;
  const poolThin = primaryPool?.health?.healthy === false;

  // Load competitor items from cache only
  const competitors = (inferred_competitors || []).map((name) => ({ name, source: "inferred" }));
  const competitorItems = [];
  for (const comp of competitors) {
    try {
      const cached = await getCachedEntity(comp.name, { getStore });
      if (cached?.items) {
        for (const item of cached.items) {
          competitorItems.push({ ...item, entity: comp.name });
        }
      }
    } catch {
      // Cache miss or error — degrade silently
    }
  }

  // Run pre-gate (Pass 1, Haiku)
  const preGate = await runPreGate({
    primaryPool,
    secondaryPool,
    competitorItems,
    brandName: body.brandName,
    website: body.website,
    brandRead,
    primaryCategory,
    secondaryCategory,
    competitors,
    fetchImpl: fetch,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Determine quiet cause
  const directCount = preGate.scored.filter((s) => s.relevance === "direct").length;
  const quietCause = classifyQuiet({
    poolThin,
    poolStale,
    competitorItemCount: competitorItems.length,
    direct: directCount,
    minDirect: ACTION_STANDARDS.minDirect,
  });

  // Build preview items (up to 2 titles for State 2 proof)
  const previewItems = preGate.top.slice(0, 2).map((s) => ({
    title: s.item.title,
    source: s.item.source,
    relevance: s.relevance,
  }));

  return json(200, {
    status: "ok",
    brand: body.brandName,
    website: body.website,
    category: primaryCategory,
    secondaryCategory,
    brandRead,
    confidence,
    competitors: competitors.map((c) => ({ name: c.name, source: c.source })),
    preGateItems: previewItems,
    quiet_cause: quietCause,
    top: preGate.top,
    debug: {
      pool_size: preGate.pool.length,
      competitor_item_count: competitorItems.length,
      pool_stale: poolStale,
      pool_thin: poolThin,
      pass1_cost: preGate.pass1Cost,
    },
  });
};

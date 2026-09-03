// netlify/functions/pulse-preview.js
//
// State 1 submit → kicks off State 2 pre-gate scoring. Runs the fast,
// synchronous abuse gates (honeypot, Turnstile, IP rate limit) only — the
// actual classification + Pass 1 scoring now happens in
// pulse-preview-background.js, invoked fire-and-forget below.
//
// Why: that work is up to three sequential, uncapped Anthropic calls
// (classifyBrand, then Pass 1's two calls inside runPreGate). For a brand
// with no cached data that routinely exceeds Netlify's ~30s ceiling on
// synchronous functions — live-confirmed in production (Coin98 completed in
// 13.6s, "Diaflow" hit the wall and got killed at exactly 30000ms). A
// synchronous function's timeout can't be raised past that ceiling on this
// plan; a background function gets 15 minutes instead, the same trade
// generate-report-background.js already makes for Pass 2. The client polls
// pulse-preview-status.js with the jobId this returns until the result
// lands.

import crypto from "crypto";
import { getStore } from "@netlify/blobs";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RATE_LIMIT_STORE = "rate-limits";
const JOB_STORE = "pulse-preview-jobs";
// Raised 5 -> 10 (Session 10): the counter increments on every attempt that
// clears Turnstile, including ones that fail downstream for reasons that
// aren't the visitor's fault (a Pass 1 timeout, a stale-token retry). At 5,
// a real visitor hitting a couple of transient errors could burn the whole
// daily budget before ever seeing a result.
const RATE_LIMIT_PER_DAY = 10;
const RATE_LIMIT_CAS_ATTEMPTS = 5;

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
    if (!result?.success) {
      console.error("turnstile verify failed:", JSON.stringify(result?.["error-codes"] || result));
      return json(403, { error: "verification_failed" });
    }
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

  // Gates cleared. Hand the slow work to the background function and give
  // the client a job to poll instead of making it wait on a request that
  // can outlive the platform's timeout.
  const jobId = crypto.randomUUID();
  const jobStore = getStore(JOB_STORE);
  await jobStore.setJSON(jobId, { status: "pending", createdAt: new Date().toISOString() });

  // Same fire-and-forget pattern as lead-submit.js -> generate-report-
  // background.js: derive the base URL from the incoming request, not any
  // of Netlify's build-time URL env vars — this site is deployed via CLI
  // upload, which skips the build step those vars depend on, and one of
  // them silently pointing at a 404 already cost a lead's report once.
  const baseUrl = new URL(req.url).origin;
  try {
    const bgRes = await fetch(`${baseUrl}/.netlify/functions/pulse-preview-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, brandName: body.brandName, website: body.website }),
    });
    if (!bgRes.ok) {
      console.error(`[pulse-preview] background invoke returned ${bgRes.status} for jobId ${jobId}`);
    }
  } catch (err) {
    console.error("[pulse-preview] failed to invoke background function:", err);
  }

  return json(200, { status: "pending", jobId });
};

// netlify/functions/generate-pulse.js
//
// POST { brandName, website, email, turnstileToken, fax? }
// -> 200 { status: "ok", report: {...} }
//
// Phase 3.5 — the abuse gate in front of the expensive path (Sonnet + Apps Script).
// Four checks run in order, every one fails closed:
//   1. Honeypot        — silent 200, no work done
//   2. Turnstile        — Cloudflare siteverify
//   3. IP rate limit    — 5/day per hashed IP, via Netlify Blobs
//   4. (only past here) the Sonnet call and the Apps Script POST
//
// Phase 2 (trend cache) and Phase 2.5 (the Sonnet read) don't exist yet — step 4
// is stubbed to a hardcoded report so the rest of the path can be exercised.

const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

// Model to use once Phase 2.5 wires up the real Sonnet call. Not called yet.
const ANTHROPIC_MODEL = "claude-sonnet-5";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RATE_LIMIT_STORE = "rate-limits";
const RATE_LIMIT_PER_DAY = 5;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function getClientIp(event, context) {
  return (
    (context && context.ip) ||
    (event.headers && event.headers["x-nf-client-connection-ip"]) ||
    "unknown"
  );
}

function rateLimitKey(ip, salt) {
  const hash = crypto.createHash("sha256").update(ip + salt).digest("hex").slice(0, 32);
  const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
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

// Stub for Phase 2.5. Returns a hardcoded report instead of calling Anthropic.
async function generateStubReport({ brandName, website }) {
  console.log("WOULD CALL ANTHROPIC HERE");
  return {
    brandName: brandName || "Unknown brand",
    website: website || null,
    model: ANTHROPIC_MODEL,
    category: "General Tech",
    headline: "[STUB] Trend Pulse report",
    trends: [
      "[STUB] Trend one — placeholder until Phase 2/2.5 are built",
      "[STUB] Trend two — placeholder until Phase 2/2.5 are built",
      "[STUB] Trend three — placeholder until Phase 2/2.5 are built",
    ],
    generatedAt: new Date().toISOString(),
  };
}

async function postReportToAppsScript(fetchImpl, appsScriptUrl, appsScriptSecret, payload) {
  // Apps Script always responds 302 → native fetch follows redirects by default.
  // Do NOT set redirect: "manual" here, it breaks delivery.
  return fetchImpl(appsScriptUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: appsScriptSecret, ...payload }),
  });
}

// deps injection point for tests: { fetch, getStore, env }
function createHandler(deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const getStoreImpl = deps.getStore || getStore;
  const env = deps.env || process.env;

  return async function handler(event, context) {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return jsonResponse(400, { error: "invalid_json" });
    }

    // Gate 1: honeypot. Silent accept, reveal nothing about why.
    if (body.fax) {
      return jsonResponse(200, { status: "ok" });
    }

    const ip = getClientIp(event, context);

    // Gate 2: Turnstile.
    let turnstileResult;
    try {
      turnstileResult = await verifyTurnstile(fetchImpl, body.turnstileToken, ip, env.TURNSTILE_SECRET);
    } catch (err) {
      console.error("turnstile verify failed:", err);
      return jsonResponse(403, { error: "verification_failed" });
    }
    if (!turnstileResult || !turnstileResult.success) {
      return jsonResponse(403, { error: "verification_failed" });
    }

    // Gate 3: IP rate limit. Fail open ONLY on unresolved IP — one shared
    // counter for every "unknown" would blackhole real users.
    if (ip === "unknown") {
      console.log("rate limit skipped: IP unresolved, failing open");
    } else {
      try {
        const store = getStoreImpl(RATE_LIMIT_STORE);
        const key = rateLimitKey(ip, env.IP_SALT);
        const existing = await store.get(key, { type: "json" });
        const count = (existing && existing.count) || 0;
        if (count >= RATE_LIMIT_PER_DAY) {
          return jsonResponse(429, { error: "rate_limited" });
        }
        await store.setJSON(key, { count: count + 1 });
      } catch (err) {
        console.error("rate limit check failed:", err);
        return jsonResponse(429, { error: "rate_limited" });
      }
    }

    // Gate 4 — only past this point: the Sonnet call (stubbed) and Apps Script POST.
    const report = await generateStubReport(body);
    try {
      await postReportToAppsScript(fetchImpl, env.APPS_SCRIPT_URL, env.APPS_SCRIPT_SECRET, {
        brandName: body.brandName,
        website: body.website,
        email: body.email,
        report,
      });
    } catch (err) {
      console.error("apps script post failed:", err);
      return jsonResponse(502, { error: "delivery_failed" });
    }

    return jsonResponse(200, { status: "ok", report });
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
exports.ANTHROPIC_MODEL = ANTHROPIC_MODEL;

#!/usr/bin/env node
// Phase 2B — X (Twitter) source probe. EVALUATION ONLY.
// Not wired into categories.js/collect.js/rank.js.
//
// Ported from claude-world/trend-pulse's plugin id `x_trending`
// (src/trend_pulse/plugins/sources/x_trending.py). That file has two paths:
//   1. twikit — an unofficial Python client that logs into X's internal
//      GraphQL API. Python-only, and explicitly out of scope here ("do not
//      add a Python dependency or wrap the package").
//   2. A guest-token HTTP fallback against the legacy v1.1 API
//      (guest/activate.json -> trends/place.json), gated on an optional
//      X_BEARER_TOKEN env var. This is the only path with a Node-portable
//      HTTP shape, so it's the one probed here.
//
// Without a bearer token this cannot make ANY request — even minting a
// guest token requires an app-level Bearer on the v1.1 API — which mirrors
// the reference implementation's own guard (`if not self._BEARER: return []`).
//
//   X_BEARER_TOKEN=xxx node scripts/probe-x.js
//   node scripts/probe-x.js --json > probe-x.json

const BEARER = process.env.X_BEARER_TOKEN || "";
const JSON_OUT = process.argv.includes("--json");

// WOEID map, straight from the reference plugin. VN is not in trend-pulse's
// own map — no entry was invented for it; falls back to Worldwide (1).
const GEO_MAP = {
  TW: 24865698,
  US: 23424977,
  JP: 23424856,
  KR: 23424868,
  HK: 24865698,
  "": 1,
};

const GUEST_TOKEN_URL = "https://api.twitter.com/1.1/guest/activate.json";
const TRENDS_URL = "https://api.twitter.com/1.1/trends/place.json";

async function fetchGuestApi(geo) {
  const woeid = GEO_MAP[geo.toUpperCase()] ?? GEO_MAP[""];
  const log = { geo, woeid, steps: [] };

  if (!BEARER) {
    log.steps.push({ step: "guest_token", skipped: true, reason: "no X_BEARER_TOKEN set" });
    return { ...log, items: null, rawTrendsResponse: null };
  }

  const tokenRes = await fetch(GUEST_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${BEARER}` },
  });
  const tokenStatus = tokenRes.status;
  const tokenText = await tokenRes.text();
  let tokenBody = null;
  try {
    tokenBody = JSON.parse(tokenText);
  } catch {
    /* leave null, raw text captured below */
  }
  log.steps.push({ step: "guest_token", status: tokenStatus, raw: tokenText.slice(0, 500) });

  if (tokenStatus !== 200 || !tokenBody?.guest_token) {
    return { ...log, items: null, rawTrendsResponse: null };
  }

  const guestToken = tokenBody.guest_token;
  const trendsRes = await fetch(`${TRENDS_URL}?id=${woeid}`, {
    headers: { Authorization: `Bearer ${BEARER}`, "x-guest-token": guestToken },
  });
  const trendsStatus = trendsRes.status;
  const trendsText = await trendsRes.text();
  let trendsBody = null;
  try {
    trendsBody = JSON.parse(trendsText);
  } catch {
    /* leave null */
  }
  log.steps.push({ step: "trends", status: trendsStatus, rawLength: trendsText.length });

  // The critical question this probe exists to answer: bare terms, or posts?
  // The v1.1 trends/place.json shape is documented as [{ trends: [{name,
  // tweet_volume, url}], ... }] — i.e. TERMS, never post text or author.
  // Reported verbatim, not normalized, so this can be checked directly.
  const trendsList = Array.isArray(trendsBody) ? trendsBody[0]?.trends || [] : [];

  return {
    ...log,
    items: trendsList,
    rawTrendsResponse: trendsBody,
    shape: trendsList.length
      ? Object.keys(trendsList[0])
      : null,
  };
}

const out = { hasToken: Boolean(BEARER), result: await fetchGuestApi("") };

if (JSON_OUT) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(`X_BEARER_TOKEN present: ${out.hasToken}`);
  console.log(JSON.stringify(out.result, null, 2));
  if (out.result.items) {
    console.log(`\nItem shape (keys on first item): ${JSON.stringify(out.result.shape)}`);
    console.log(`Item count: ${out.result.items.length}`);
    console.log(`\nVerbatim first 3 items:`);
    console.log(JSON.stringify(out.result.items.slice(0, 3), null, 2));
  } else {
    console.log(`\nNo items — see steps above for why (no token, or a step failed).`);
  }
}

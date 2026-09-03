// netlify/functions/turnstile-config.js
//
// Serves the Turnstile *site* key to the frontend at runtime.
//
// Site keys are public by design — they render into the DOM either way — but
// they are environment-specific: the test key (1x0000...) only validates
// against the test secret, and a real key only against the real secret. Hard-
// coding one in trend-pulse.html guarantees the two halves drift apart, which
// is exactly what produced turnstile "invalid-input-response" 403s. The key
// now comes from the same .env that TURNSTILE_SECRET comes from, so both
// halves move together per environment.
//
// publish = "." means there is no build step to template the HTML, so the
// frontend reads this at load time and renders the widget explicitly.

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export default async (req) => {
  if (req.method !== "GET") {
    return json(405, { error: "method_not_allowed" });
  }

  const siteKey = process.env.TURNSTILE_SITE;
  if (!siteKey) {
    console.error("turnstile-config: TURNSTILE_SITE is not set");
    // Explicit no-store: this is a transient misconfiguration, not a stable
    // fact about the endpoint. Without this, the response inherits no
    // Cache-Control and can get cached by the CDN edge — which is exactly
    // what happened once already: the env var was fixed, but edge nodes
    // kept serving the pre-fix 500 to real visitors until this changed.
    return json(500, { error: "site_key_unconfigured" }, { "Cache-Control": "no-store" });
  }

  // No caching at all: this function does nothing but read one env var, so
  // caching it buys negligible performance for real risk. Confirmed live —
  // Netlify's edge/durable cache served this response nearly 5 hours stale
  // despite the previous "public, max-age=300", ignoring the intended
  // freshness window entirely. A cached response also means a future site
  // key rotation could keep serving the old key to real visitors for
  // however long the cache decides to hold onto it.
  return json(200, { siteKey }, { "Cache-Control": "no-store" });
};

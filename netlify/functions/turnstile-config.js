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
    return json(500, { error: "site_key_unconfigured" });
  }

  // Short cache: public value, but a key rotation should take effect quickly.
  return json(200, { siteKey }, { "Cache-Control": "public, max-age=300" });
};

export async function get(url, { headers = {}, timeout = 8000, json = false } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      headers: { "User-Agent": "tinly-work-trendpulse/0.1", ...headers },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return json ? await r.json() : await r.text();
  } finally {
    clearTimeout(t);
  }
}

// Every adapter fails soft and returns []. One dead source must never
// take down the daily crawl for a whole category.
export async function safe(name, fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[source:${name}] failed — ${e.message}`);
    return [];
  }
}

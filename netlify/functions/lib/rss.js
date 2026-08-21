// Minimal RSS/Atom reader. No dependency — Netlify cold starts are the budget here,
// and every feed we touch is well-formed enough for this.
// Product Hunt's public feed is Atom (<entry>), not RSS 2.0 (<item>) — matched here
// so callers don't need to know which dialect a given feed speaks.
export function parseItems(xml) {
  const out = [];
  const re = /<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

export function tag(block, name) {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i").exec(block);
  if (!m) return null;
  return decode(m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1").trim());
}

// RSS 2.0 gives <link>https://...</link> as text content. Atom gives a self-closing
// <link rel="alternate" href="https://..."/> instead — no text content to read with
// tag(). This tries the RSS shape first, then falls back to the Atom href attribute.
export function link(block) {
  const rss = tag(block, "link");
  if (rss) return rss;
  const m = /<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i.exec(block)
    || /<link\b[^>]*\bhref=["']([^"']+)["']/i.exec(block);
  return m ? decode(m[1]) : null;
}

export function decode(s) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .trim();
}

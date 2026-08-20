# tinly.work

Fractional brand management landing page for Tin Ly. Static HTML/CSS/JS — no build step, no dependencies.

## Deploy

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag the whole `files/` folder onto the page
3. Netlify serves `index.html` automatically

When `tinly.work` is purchased, point DNS at the Netlify subdomain. All internal links are relative, so the swap is DNS-only — except `og:image`, see below.

## Which file to edit

**`index-linked.html` is canonical.** `index.html` is a byte-copy of it and is the file Netlify actually serves.

After editing `index-linked.html`, always re-sync before deploying:

```bash
cp index-linked.html index.html
```

Letting these two drift is what caused the "four sections render blank" bug in Audit 01.

## Placeholders to swap

| What | Where | Current |
|---|---|---|
| GA4 Measurement ID | two occurrences of `G-XXXXXXXXXX` near the top of `<head>` | placeholder |
| Favicon | `<link rel="icon" href="assets/favicon.ico">` | file does not exist yet — request 404s |
| `og:image` | needs an **absolute** URL once the domain exists | currently the relative `assets/Header - web.png`, which most scrapers will not resolve |
| `og:url` | not present — add once the domain exists | — |

## Social links

- LinkedIn — `https://linkedin.com/in/tinly147`
- Email — `tinly.work@gmail.com`
- Telegram — `https://t.me/tinly7041`
- X — `https://x.com/tinly_work`

## Assets

`assets/_originals/` holds the pre-optimisation source files. The shipped versions are trimmed, downscaled and re-encoded — total page weight is 0.82 MB. Do not overwrite the shipped files with the originals.

Two logos (Omo, Sunlight) are full-colour source art with no mono variant available, so they render in colour by design. Do not apply a `brightness(0) invert(1)` filter to them — it flattens them into unidentifiable white shapes.

## Audit

`audit/AUDIT-01.md` is the measured build audit, with screenshots at five widths in `audit/shots/` and raw data in the sibling JSON files. It reflects the state *before* this round of fixes.

# DESIGN.md — tinly.work

## 1. Visual Theme & Atmosphere

Clean, precise, quietly creative. The site feels professional first and distinctive second — not a creative studio portfolio, not a SaaS template. A directional azure blue dominates the accent system — never violet — with the grain giving surfaces physical weight without clutter. Liquid glass elements float above the texture: translucent, light-bending, not just blurred. Every section should pass the test: would a seed-stage founder trust the person behind this with their brand?

Reference aesthetic: Tin's own LinkedIn header (single directional light, deep navy corner to bright azure corner) and the DesignerJOSH 2026 flyer (confident azure gradient, one glossy highlight, restrained supporting blobs) — plus Zeronode's grain and glassmorphism pills. Not maximalist — the restraint is the signal. **Explicitly avoided:** scattered same-weight blob clusters with no dominant light source — that reads as fog, not light.

## 2. Color Palette & Roles

| Role | Name | Hex | RGB | Usage |
|------|------|-----|-----|-------|
| Primary | **Signal Blue** | `#2C56E8` | 44,86,232 | Hero gradient base, CTA fills, active states |
| Primary Dark | **Royal Navy** | `#142E99` | 20,46,153 | Gradient mid-depth, hover states on primary |
| Primary Deepest | **Navy Ink** | `#0A1440` | 10,20,64 | Gradient corner depth (the "shadow" end) |
| Highlight | **Azure Light** | `#7FB2FF` | 127,178,255 | Aura "hot spot" bloom only — never body text |
| Background | Warm Mist | `#F0ECE4` | 240,236,228 | Page background, text-heavy sections (Scroll 2, 3, 5) |
| Surface Glass | Liquid Glass | rgba(255,255,255,0.15) | — | Glass cards, pills, text areas on blue |
| Surface Glass Border | Glass Edge | rgba(255,255,255,0.25) | — | 1px border on glass elements |
| Surface Glass (on light) | Blue Glass | rgba(44,86,232,0.06) | — | Glass cards on Warm Mist background |
| Surface Glass Border (on light) | Blue Edge | rgba(44,86,232,0.12) | — | 1px border on glass elements on light bg |
| Text Primary | Near Black | `#141414` | — | Body copy on light backgrounds |
| Text Inverse | Off White | `#F5F3EF` | — | Body copy on blue backgrounds |
| Text Secondary | Warm Gray | `#6B6560` | — | Captions, metadata, credibility strip labels |
| Accent | Signal White | `#FFFFFF` | — | Numbers in credibility strip, diagram highlights |

**Why this replaces Klein Blue:** `#1B1FE6` carries R27/G31 — red and green nearly equal, both suppressed under a maxed blue channel. That specific ratio is what reads as indigo/violet. Signal Blue lifts green well above red (44 vs 86) at the same brightness, which is the difference between your banner's azure and the old palette's violet. Sampled against both references you shared — your own LinkedIn header and the DesignerJOSH flyer — this is the closer match.

### Gradient recipe — THE BLUE AURA (revised — composition rule, not just color)

**Diagnosis of the rejected version (your third reference image):** four to five same-size, same-opacity blobs scattered with no hierarchy. Where they overlap, default blending grays the color toward mud. No single focal point. The result reads as fog or weather, not light. This was also the failure mode in the first HTML build — flagging that now, will fix in code once this palette is approved.

**What your two approved references actually do, structurally:**
- **Your LinkedIn banner:** one directional light source, corner to corner. Deep navy in one corner, bright azure in the other, nothing competing. High contrast, zero midtone haze.
- **DesignerJOSH flyer:** same principle. Background stays quiet — pale, restrained, almost not there. All the "light" energy concentrates into one confident glossy highlight inside the numerals. One hero moment, not several equal ones.

**New rule: maximum two blue "events" per section.**
1. A **directional base** — deep corner to bright corner, like the LinkedIn banner
2. **One** confident highlight bloom — the "sun" — positioned off-center, blended with `screen` so it brightens rather than muddies

**CSS approach:**
```css
.blue-aura {
  background:
    /* the single highlight — screen blend brightens, never grays */
    radial-gradient(circle at 78% 20%, rgba(127,178,255,0.65) 0%, transparent 55%),
    /* directional base — deep corner to bright corner */
    linear-gradient(150deg, #0A1440 0%, #142E99 35%, #2C56E8 68%, #3E6BF0 100%);
  background-blend-mode: screen, normal;
}
```

Vary composition per section by moving the highlight position and adjusting the linear angle — not by adding more blobs:

| Section | Highlight position | Base angle |
|---|---|---|
| Hero | 78% 20% (upper right) | 150deg |
| Coin98 | 15% 75% (lower left) | 200deg |
| Contact | 50% 90% (bottom center) | 165deg |

**Fallback:** if CSS gradients don't hit the polish of the references, export a pre-made aura as WebP (~200KB) per section. Grain overlay still goes on top either way.

**Key test:** screenshot at 50% zoom. If you can count more than two distinct blue "shapes," it has drifted back toward the rejected version. It should read as one light source, not a cluster.

## 3. Typography Rules

**Display font:** Clash Display (Fontshare) — neo-grotesk with tight apertures, pinched stroke connections at heavier weights. Eye-catching without being decorative. Used for H1, section titles, metric numbers, gate labels.

```html
<link href="https://api.fontshare.com/v2/css?f[]=clash-display@200,300,400,500,600,700&display=swap" rel="stylesheet">
```

**Body font:** Be Vietnam Pro (Google Fonts) — designed specifically for Vietnamese diacriticals. Neo-grotesk, highly legible, well-suited to tech. Covers the full character set needed for Vietnamese text.

```html
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">
```

**Mono font (numbers only):** Clash Display at weight 700. No separate mono font — the metric numbers in Clash Display are proportional lining figures at cap height, which is exactly what the credibility strip needs.

| Level | Font | Size (desktop / mobile) | Weight | Line Height | Usage |
|-------|------|-------------------------|--------|-------------|-------|
| Hero H1 | Clash Display | 72px / 40px | 600 | 1.0 | "Package Your Tech Product" |
| Section H2 | Clash Display | 36px / 28px | 500 | 1.2 | Scroll titles, stage headers |
| Gate Label | Clash Display | 14px / 12px | 500 | 1.4 | "Gate 1 · Audience" — uppercase, tracked +0.08em |
| Body | Be Vietnam Pro | 18px / 16px | 400 | 1.65 | Prose paragraphs, descriptions |
| Body SM | Be Vietnam Pro | 15px / 14px | 400 | 1.5 | Credibility strip captions, service descriptions |
| Metric Number | Clash Display | 48px / 32px | 700 | 1.0 | "8 in 10", "Top 11", "17.6%" |
| Caption | Be Vietnam Pro | 13px / 12px | 400 | 1.4 | Source attributions, footer |
| Sub-line | Be Vietnam Pro | 20px / 16px | 400 | 1.5 | Hero sub-line under H1 |

## 4. Component Stylings

### Buttons — Liquid Glass Pills

The buttons are the signature component. Not flat glassmorphism — liquid glass with light refraction.

**On blue backgrounds:**
```css
.btn-liquid {
  position: relative;
  background: linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.06));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.3);
  border-radius: 999px;
  padding: 14px 32px;
  color: #F5F3EF;
  font-family: 'Clash Display', sans-serif;
  font-weight: 500;
  font-size: 15px;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.2),
    inset 0 -1px 0 rgba(0,0,0,0.05),
    0 4px 16px rgba(0,0,0,0.08);
  transition: all 0.3s ease;
}
.btn-liquid:hover {
  background: linear-gradient(135deg, rgba(255,255,255,0.28), rgba(255,255,255,0.12));
  border-color: rgba(255,255,255,0.45);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.3),
    inset 0 -1px 0 rgba(0,0,0,0.05),
    0 6px 24px rgba(0,0,0,0.12);
}
```

The key difference from standard glassmorphism: the **directional gradient** background (135deg) simulates light hitting the surface from one angle, creating the "liquid" feel. Plus the **inset top highlight** and **inset bottom shadow** create the edge-light refraction.

**On light backgrounds:**
Same structure, but with blue-tinted glass:
```css
.btn-liquid-light {
  background: linear-gradient(135deg, rgba(44,86,232,0.08), rgba(44,86,232,0.03));
  backdrop-filter: blur(8px);
  border: 1px solid rgba(44,86,232,0.15);
  color: #2C56E8;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.5),
    inset 0 -1px 0 rgba(44,86,232,0.05),
    0 2px 8px rgba(44,86,232,0.06);
}
```

**Secondary CTA:** text link, no glass. `color: inherit` + " →" appended. Underline on hover, 2px offset.

### Text Areas / Content Cards — Liquid Glass Boxes

Used for: gate cards in Scroll 3/4, service table in Scroll 5, the multiplier diagram container in Scroll 2.

**On blue backgrounds:**
```css
.glass-box {
  background: linear-gradient(145deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 20px;
  padding: 32px;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.15),
    0 8px 32px rgba(0,0,0,0.06);
}
```

**On light backgrounds:**
```css
.glass-box-light {
  background: linear-gradient(145deg, rgba(255,255,255,0.7), rgba(255,255,255,0.4));
  backdrop-filter: blur(8px);
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 20px;
  padding: 32px;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.8),
    0 4px 16px rgba(0,0,0,0.03);
}
```

**Usage budget:** max 4–5 glass elements visible in any single viewport. More than that and the effect becomes noise.

### Credibility strip metrics
- Number in Clash Display 48px/700, white on blue or Signal Blue on warm
- Caption below in Be Vietnam Pro 13px/400, Warm Gray
- Horizontal on desktop (3 across), vertical stack on mobile
- No dividers between metrics — spacing alone separates

### Nav
- Fixed, transparent on scroll
- Glass surface style when scrolled past hero
- Name left ("tin ly" in Clash Display 500), "Work with me" pill right
- Hamburger on mobile, glass-surface dropdown

## 5. Layout Principles

**Spacing base unit:** 8px
**Spacing scale:** 8 / 16 / 24 / 32 / 48 / 64 / 96 / 128
**Max content width:** 720px (prose), 1120px (full-width sections)
**Grid:** Single column narrative. No card grids.
**Whitespace:** Generous between scrolls (128px+). The page breathes between ideas.

**Scroll background pattern:**
| Scroll | Background | Width |
|--------|------------|-------|
| 1. Hero | Blue aura (full bleed) | 1120px |
| 2. Multiplier | Warm Mist | diagram at 1120px, text at 720px |
| 3. How I Work | Warm Mist | 720px |
| 4. Coin98 | Blue aura (full bleed, different composition) | 720px, before/after at 1120px |
| 5. Plug Me In | Warm Mist | 720px |
| 6. Contact | Blue aura (full bleed, third composition) | 720px |

Blue = proof + action. Warm = argument + services.

## 6. Depth & Elevation

**Shadow philosophy:** No box-shadows on layout. Depth comes from:
1. Grain layer sitting behind glass surfaces (z-ordering)
2. backdrop-filter blur on glass elements
3. The inset highlights on liquid glass components (light simulation, not shadow)

Glass elements are the only things with apparent elevation. Everything else is flat on the grain surface.

**Border radius system:**
- Liquid glass pills/buttons: 999px
- Glass boxes/cards: 20px
- Before/after image containers: 12px
- Sections: 0. Square.

## 7. Do's and Don'ts

**Do:**
- Use grain on blue aura sections only — it gives the gradient physical weight
- Keep glass elements sparse. They're the signature; overuse kills them.
- Let Scroll 2 and 3 be typographically quiet — Warm Mist, black text, glass boxes for structure only
- Make metric numbers large and isolated — scannable at a glance
- Use the before/after Coin98 artifact as a full-width moment in Scroll 4
- Make each blue aura section compositionally different — move the radial sources

**Don't:**
- Put grain on Warm Mist sections. Grain is for blue only.
- Use gradient text or gradient fills on type. 2024 SaaS cliché.
- Add illustrations, icons, or emoji. The grain and glass are the only textures.
- Stack more than 5 glass elements per viewport.
- Animate on scroll. Static precision > reveal effects. The liquid glass hover states are the only motion.
- Put a headshot in the hero. Photo at contact only.
- Use numbered markers (01, 02, 03) on the gates. "Gate 1 · Audience" as a text label is enough.

## 8. Responsive Behavior

**Breakpoints:** Mobile 375px / Tablet 768px / Desktop 1280px / Wide 1440px
**Mobile nav:** Hamburger, glass-surface dropdown
**Touch targets:** 48px minimum height
**Stack behavior:**
- Credibility strip: 3-across → vertical stack
- Multiplier diagram: horizontal tracks → vertical stack
- Gate cards: full-width, no scroll
- Service table: → stacked cards

**Type scaling:** Hero H1 72→40px. Section H2 36→28px. Body 18→16px.

## 9. Agent Prompt Guide

**Colors:** Signal Blue #2C56E8, Royal Navy #142E99, Navy Ink #0A1440, Azure Light #7FB2FF (highlight only), Warm Mist #F0ECE4, glass at rgba(255,255,255,0.15) with 1px border rgba(255,255,255,0.25)

**Fonts:** Clash Display (display), Be Vietnam Pro (body)

**Style in one sentence:**
"A single directional azure-blue light source (navy corner to azure corner, one confident highlight, never scattered blobs) with film grain, liquid glass pills and cards, Clash Display headings over Be Vietnam Pro body text, warm cream text sections — clean, professional, zero decoration."

## 10. Grain & Noise Specification

**Type:** Uniform monochrome grain via SVG filter
**Applied to:** Blue aura sections only (::after pseudo-element)

```svg
<svg width="0" height="0">
  <filter id="grain">
    <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch"/>
    <feColorMatrix type="saturate" values="0"/>
    <feBlend in="SourceGraphic" mode="multiply"/>
  </filter>
</svg>
```

```css
.blue-aura::after {
  content: '';
  position: absolute;
  inset: 0;
  filter: url(#grain);
  opacity: 0.10; /* tune 0.08–0.12 by eye */
  mix-blend-mode: multiply;
  pointer-events: none;
  z-index: 1; /* above gradient, below glass elements */
}
/* Glass elements must have z-index: 2+ to sit above grain */
```

## 11. Liquid Glass Specification

**Apple's Liquid Glass (WWDC 2025) adapted for web:**

Three layers stacked:
1. **Semi-transparent gradient background** — `linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.06))` — the directional gradient is what makes it "liquid" rather than just frosted
2. **Backdrop blur** — `backdrop-filter: blur(12px)` — blurs the grain/aura behind
3. **Edge light simulation** — `inset 0 1px 0 rgba(255,255,255,0.2)` top highlight + `border: 1px solid rgba(255,255,255,0.25)` — simulates light catching the glass edge

**Fallback** (no backdrop-filter support):
```css
@supports not (backdrop-filter: blur(1px)) {
  .glass-element {
    background: rgba(44,86,232,0.85); /* solid, readable */
  }
}
```

**Performance:** backdrop-filter is GPU-accelerated in Chromium and Safari. Budget 4–5 blurred elements per viewport.

## 12. Multiplier Diagram Specification

**Visual encoding:**
- Track A: Signal Blue circle at 40% opacity, edges feathered (CSS filter: blur(8px)). Scaled 3× for output. Both blurry = "loud and still unclear"
- Track B: Signal Blue circle at 100% opacity, sharp edges. Scaled 3× for output. Both sharp = "felt"
- Multiplication sign: identical in both tracks. "×" in Clash Display 600, or a clean SVG arrow.

**Layout:** Two rows on desktop. Vertical stack on mobile.

**Container:** glass-box-light on Warm Mist background.

**Labels:** Be Vietnam Pro 15px, inside or directly below each element. No legend.

**Background:** Warm Mist, no grain. The diagram's blur/sharp contrast is the texture.

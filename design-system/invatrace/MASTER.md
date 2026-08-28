# InvaTrace Design System — Master

> **LOGIC:** When building a page, first check `design-system/invatrace/pages/[page].md`.
> If a page file exists, its rules **override** this Master. Otherwise, follow the Master.

**Project:** InvaTrace — Invasive Plant Monitoring PWA (Malaysia · Bukit Kiara pilot)
**Product Class:** Field utility + citizen-science reporting + coordinator verification
**Design Dials:** Variance 3/10 (Centred / Minimal) · Motion 4/10 (Standard) · Density 6/10 (Standard)
**Locked by:** Architecture §2 (design tokens lifted verbatim from approved prototype) + Design-MCP brand kit `633adb90`.

---

## 1. Brand identity (non-negotiable)

The colour ramp is not up for a re-vote. It matches the InvaTrace brand kit and existing prototype. New styles compose *around* these tokens.

| Role | Hex | CSS var | Notes |
|---|---|---|---|
| **Forest** (primary CTA, active nav) | `#1B7A50` | `--green` | Mikania-vine leaf saturation |
| **Forest dark** (active text) | `#166341` | `--green-dark` | |
| **Deep** (reversed surfaces, logo badge) | `#12402C` | `--deep` | |
| **Sprout** (watch risk, secondary highlight) | `#D9880F` | `--amber` | The one warm accent — use sparingly |
| **High-risk red** | `#C2412D` | `--red` | Confirmed invasive, destructive actions |
| **Ink** (body text) | `#16201B` | `--ink` | |
| **Body** | `#4B5A52` | `--body` | Muted body copy |
| **Muted** | `#77857E` | `--muted` | Metadata, timestamps |
| **Icon** | `#8B978F` | `--icon` | Inert icons |
| **Surface** | `#FFFFFF` | `--surface` | Cards, sheets |
| **BG** | `#F4F6F3` | `--bg` | App background |
| **BG-alt** | `#EDF0EC` | `--bg-alt` | Inset surfaces |
| **Border** | `#E2E7E1` | `--border` | Hairlines |
| **Hover** | `#F1F4F0` | `--hover` | Row hover |
| **Green-light / Red-light / Green-border / Red-border** | see `tokens.css` | tinted chip backgrounds |

Dark mode is deferred to Iteration 2. Light mode contrast passes WCAG AA on every named pair.

---

## 2. Typography

- **UI + body:** Inter (loaded via Google Fonts, `--font-sans`). Weights 400 / 500 / 600 / 700.
- **Mono:** IBM Plex Mono (`--font-mono`, class `.mono`). Coordinates, IDs, model versions, tracking codes.
- **Scale:** 11 → 12.5 → 13 → 14 → 15 → 17 → 20 (px). Never below 12 for body; 16 minimum on mobile primary inputs (avoids iOS auto-zoom).
- **Letter-spacing:** `-0.042em` for the wordmark, `-0.02em` for h1/h2, default elsewhere.
- **Line-height:** 1.5 body, 1.3 headings.

Wordmark form: `inva` in Forest 600 + `trace` in Ink 400. Never all-caps. Never "INVATRACE" outside legal footers.

---

## 3. Style category

**Organic Biophilic × Minimalism.** Not "bold minimalism" or "brutalism". The visual mood is a rangers' field notebook: quiet, readable in sunlight, one accent per screen.

Consequences:
- **Radius scale:** chip 99px, card 12px, input 11px, button 9px. Do not invent new radii.
- **Shadow scale:** `--shadow-sm` for cards, `--shadow-md` for elevated surfaces (FAB, popovers). No parallax, no blur decoration.
- **Icons:** Lucide only, 16 / 19 / 22 / 26 px, stroke-width 1.9 default / 2.2 active. No emoji.
- **Illustrations:** SVG line + one Forest fill. No 3D, no gradients (except in the brand mark itself).
- **Photography:** Real leaf / trail photos. Never stock office people.

---

## 4. Spacing

Density 6/10 = standard. 4/8-pt grid.

| Token | px | Use |
|---|---|---|
| `--space-xs` | 4 | Tight inline gaps |
| `--space-sm` | 8 | Icon-to-label, chip padding |
| `--space-md` | 16 | Card padding, section gap |
| `--space-lg` | 24 | Screen padding on desktop |
| `--space-xl` | 32 | Between hero and next block |
| `--space-2xl` | 48 | Hero vertical |
| `--space-3xl` | 64 | Hero on desktop only |

**Control heights (locked):** `--h-compact 34` · `--h-chip 36` · `--h-nav 44` · `--h-primary 46`. Every tap target meets 44px.

---

## 5. Motion (dial 4/10 — Standard)

- **Durations:** 150 ms micro-interaction · 200–300 ms state change · ≤400 ms sheet enter · ≤250 ms sheet exit.
- **Easing:** `ease-out` on enter, `ease-in` on exit, `cubic-bezier(.2,.8,.2,1)` for sheets. No linear on UI.
- **Reduced motion:** honour `prefers-reduced-motion`. Skeletons and progress rings still animate; page transitions collapse to opacity only.
- **What animates:** photo → result card cross-fade, pin sheet slide-up, FAB press ripple, offline banner slide-in.
- **What must not animate:** pin repositioning on filter change (jump), MapLibre camera during pan (native).

---

## 6. Layout

- Mobile-first. Breakpoint at 900 px flips sidebar → bottom tabs.
- Container caps: 520 px for form flows, 720 px for verify queue, full-bleed for map + capture.
- Bottom tab bar reserves `env(safe-area-inset-bottom)`; FAB sits in a 34 px notch.
- Fixed elements: header (56 px + safe-top on mobile), offline banner (variable), bottom tabs (62 px + safe-bottom). Main content offsets accordingly.
- Never disable pinch-zoom. Viewport meta already includes `viewport-fit=cover`.

---

## 7. Interaction

- Tap feedback within 100 ms — `:active` scale(0.98) or `opacity(0.85)`.
- Every icon-only button has `aria-label`. Every disabled control also has `aria-disabled` + `pointer-events: none`.
- Two-finger pinch reserved for MapLibre; use `touch-action: none` on the map canvas only.
- Long-press: no hidden actions. Everything a user can do must have a visible affordance (spec §11).
- Startup checks for an established installation. Known installations open `/map`; first-time visitors enter the intentional Private access flow.
- Legacy `/auth/*` URLs redirect to `/private-access`. Private access never uses email/password or conventional account-registration language.

---

## 8. Content

- Voice: precise, unfussy, no exclamation marks. "Photo quality check passed" not "Great shot! 🎉".
- Species names: Latin italic, common name plain. Never "Mikania sp." — always the full binomial.
- Coordinates: 5-decimal precision (~1 m), tabular figures, mono font.
- Model version: always shown next to any ML verdict (`stub-v0.1.0` etc.) per Arch §11 ML ethics.
- Consent statements: full sentence, present tense, opt-in check-box, never pre-checked.

---

## 9. Anti-patterns (do not do)

- Do NOT introduce a purple/pink AI gradient. This is a conservation utility, not a chatbot.
- Do NOT use emoji as functional icons. Lucide only.
- Do NOT recolour the mark outside Forest / Sprout (design-MCP guidelines).
- Do NOT add hover-only affordances — touch devices lose them.
- Do NOT swap the wordmark casing to all-caps.
- Do NOT show a confidence percentage without the model version.
- Do NOT render candidate sightings at full precision on the public map (§11 privacy).
- Do NOT rely on colour alone for risk — always pair with an icon or text chip.
- Do NOT add page transitions longer than 400 ms; users are outdoors on 3G.

---

## 10. Per-page overrides available

Every page has an override file that specialises this master:

| Route | File | Focus |
|---|---|---|
| `/map` | `pages/map.md` | Threat map, filters, pin sheet |
| `/scan` | `pages/scan.md` | Camera, quality gate, result |
| `/report` | `pages/report.md` | 4-step wizard, offline queue |
| `/verify` | `pages/verify.md` | Coordinator queue + detail |

If a page file names a token, it wins. Otherwise the master rules stand.

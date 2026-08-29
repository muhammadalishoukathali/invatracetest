# Page override — `/map` (Threat map)

Extends `../README.md`. Only the deltas below.

## Purpose
Public-facing situational view of automatically confirmed invasive sightings across Malaysia.

## Layout
- Full-bleed map fills the main region — AppShell's `main` padding is disabled for `/map`.
- Filters bar (48 px + safe-top) sticks to top of main. Legend (mobile chip) sits bottom-left. Attribution always bottom-right.
- Pin sheet enters from bottom, occupies max 70 % of viewport height, dismissible by swipe-down or scrim tap.

## Tiles
- **Provider:** CartoDB Positron raster (`basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png`). No API key.
- **Attribution:** `© OpenStreetMap contributors · ODbL · © CARTO` — always visible, non-compact.
- **Bounds:** `[[99.3, 0.8], [119.5, 7.5]]` (all of Malaysia). Camera cannot escape.
- **Zoom:** min 6 (Malaysia in view), max 19, initial 13 desktop / 13.5 mobile.
- **Dragging:** pan + touch-zoom only. `dragRotate`, `pitchWithRotate`, `touchPitch` all disabled — pilots stay flat.

## Pin design
- SVG teardrop, 26 × 34 px, coloured by risk:
  - High risk `#C2412D`, Watch `#D9880F`, Removed `#8B978F` (65 % opacity).
- Removed sightings use the neutral grey pin. Reports never appear until automated validation passes.
- Filled centre dot for readability at small sizes.
- `aria-label="{speciesName} — {status}"`.

## Filters
- **Search:** species name / latin name substring, debounced 150 ms.
- **Species chips:** 4 tracked species (Mikania, Siam weed, Water hyacinth, Koster's curse).
- **Status chips:** Confirmed, Removed.
- **Mobile:** collapse into a single "Filters" button that opens a bottom sheet with grouped chips + Clear / Apply footer.
- **Desktop:** inline chip row under the search input.
- Active count shown in the button label ("Filters · 2").

## Pin sheet (per-sighting)
Bottom sheet order:
1. Species common name (h2) + latin (italic muted).
2. Risk / status / report-count pills.
3. Recommended action card (green surface).
4. Coordinates (mono) — with "Location approximated — precision policy §11" note when reduced.
5. Last reported (relative time).
6. Reporter trust level.

## Motion
- Sheet slide-up 300 ms `cubic-bezier(.2,.8,.2,1)`; slide-down 220 ms `ease-in`.
- Filter chip press: 100 ms scale(0.97).
- Do **not** animate pin re-render on filter change — pins snap to new positions.

## Anti-patterns
- The first release does not include a heatmap.
- No clustering by default (only 10 pins seeded; add clusters when > 50).
- Never plot processing, rejected, rescan, or unavailable reports.
- Never allow the map to load a satellite / high-detail base layer without the user opting in (bandwidth + attribution risk).

---
name: InvaTrace
description: A quiet daylight field utility for trustworthy invasive-plant evidence.
colors:
  forest: "#1B7A50"
  forest-dark: "#166341"
  deep-forest: "#12402C"
  field-green-tint: "#EFF6F1"
  field-green-border: "#D3E7DA"
  sprout-amber: "#D9880F"
  warning-ink: "#935600"
  warning-tint: "#FEF3E2"
  warning-border: "#F0D9A8"
  risk-red: "#C2412D"
  risk-ink: "#A93625"
  risk-tint: "#FBEAE6"
  risk-border: "#F0CFC8"
  ink: "#16201B"
  body: "#4B5A52"
  muted: "#65736C"
  icon: "#8B978F"
  surface: "#FFFFFF"
  daylight-background: "#F4F6F3"
  inset-background: "#EDF0EC"
  border: "#E2E7E1"
  control-border: "#8B978F"
  hover: "#F1F4F0"
typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "clamp(30px, 9vw, 52px)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "23px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 650
    lineHeight: 1.3
  code:
    fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.45
rounded:
  button: "9px"
  input: "11px"
  card: "12px"
  sheet: "20px"
  pill: "99px"
  circle: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
  3xl: "64px"
components:
  button-primary:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "0 18px"
    height: "46px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "0 18px"
    height: "46px"
  button-quiet:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.body}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "0 18px"
    height: "46px"
  button-danger:
    backgroundColor: "{colors.risk-red}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "0 18px"
    height: "46px"
  text-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.input}"
    padding: "10px 12px"
    height: "46px"
  surface-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "24px"
  recovery-code-cell:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.deep-forest}"
    typography: "{typography.code}"
    padding: "13px 14px"
  secret-badge:
    backgroundColor: "{colors.risk-tint}"
    textColor: "{colors.risk-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
---

# Design System: InvaTrace

## Overview

**Creative North Star: "The Daylight Field Notebook"**

InvaTrace should feel like a trusted field notebook opened in clear daylight: calm, legible, practical, and ready to record consequential evidence without ceremony. Its conservation identity comes through a disciplined forest palette, leaf-and-lens mark, factual language, and modest organic details rather than decorative wilderness imagery.

The interface is a workhorse first. Quiet paper-like backgrounds, white task surfaces, compact controls, and precise hierarchy make long workflows easy to scan outdoors and under unreliable connectivity. Private access extends this world as a safeguarded field pass: public identifiers, secret recovery material, and installation status are separated by typography and structure, never by spectacle.

**Key Characteristics:**

- Mobile-first field utility with sunlight-readable contrast and comfortable touch targets.
- Forest green is the singular active voice; warm colors carry warning and risk semantics.
- Inter does the daily work; IBM Plex Mono distinguishes coordinates, IDs, and recovery material.
- Soft corners, hairline borders, and restrained ambient shadows keep surfaces practical.
- Icons and plain-language labels reinforce state so color never acts alone.

## Colors

The palette pairs living forest greens with cool daylight neutrals; amber and red remain scarce, explicit semantic signals.

### Primary

- **Living Forest** (`#1B7A50`): Primary actions, active navigation, focus treatment, caret color, and the emphasized half of the wordmark.
- **Forest Shade** (`#166341`): Active text, trusted status text, and links that need more contrast than the primary green provides.
- **Deep Canopy** (`#12402C`): The darkest brand surface and high-emphasis green text, including machine-readable recovery material.
- **Field Green Tint** (`#EFF6F1`): Selected navigation, focus halos, calm notices, and circular icon wells.
- **Field Green Border** (`#D3E7DA`): Connected trails, subtle selection structure, and green-tinted dividers.

**The One Living Accent Rule.** Forest is the only routine accent; its rarity keeps actions and active state unmistakable.

### Secondary

- **Sprout Amber** (`#D9880F`): The one warm brand accent, used sparingly in the mark and for watchful attention.
- **Warning Ink** (`#935600`): Readable warning text on pale amber surfaces.
- **Warning Tint** (`#FEF3E2`): Inline confirmation and caution surfaces.
- **Warning Border** (`#F0D9A8`): Optional warning structure when a tinted field still needs an edge.

### Tertiary

- **Risk Red** (`#C2412D`): Destructive actions and high-risk state only.
- **Risk Ink** (`#A93625`): Error and loss-warning text on pale red surfaces.
- **Risk Tint** (`#FBEAE6`): Error notices, secret badges, and irreversible-loss warnings.
- **Risk Border** (`#F0CFC8`): Optional error-field and risk-surface separation.

**The Semantic Scarcity Rule.** Amber and red are not decoration; each appearance must communicate attention, danger, or irreversible consequence.

### Neutral

- **Field Ink** (`#16201B`): Primary copy, headings, and the dark half of the wordmark.
- **Working Copy** (`#4B5A52`): Explanatory body text and secondary controls.
- **Quiet Metadata** (`#65736C`): Hints, timestamps, footers, and supporting labels.
- **Dormant Icon** (`#8B978F`): Inactive iconography and other deliberately recessive glyphs.
- **Clean Surface** (`#FFFFFF`): Cards, form panels, brand bars, and navigation surfaces.
- **Daylight Ground** (`#F4F6F3`): The application and private-access page background.
- **Inset Ground** (`#EDF0EC`): Recessed identity rows and secondary spatial grouping.
- **Hairline Border** (`#E2E7E1`): Dividers, card edges, and quiet structural boundaries.
- **Control Border** (`#8B978F`): Stronger input and secondary-button outlines that must remain visible outdoors.
- **Soft Hover** (`#F1F4F0`): Low-emphasis buttons and non-destructive hover or inset feedback.

## Typography

**Display Font:** Inter (with system sans-serif fallbacks)
**Body Font:** Inter (with system sans-serif fallbacks)
**Label/Mono Font:** IBM Plex Mono (with system monospace fallbacks)

**Character:** Inter is compact, neutral, and unshowy enough for evidence work, while IBM Plex Mono gives machine-identifying strings a deliberate, trustworthy cadence. The pairing is functional rather than editorial: sans-serif carries meaning; mono marks data that must be copied or verified exactly.

### Hierarchy

- **Display** (700, `clamp(30px, 9vw, 52px)`, 1.08): First-view task promises and the leading heading of a focused access flow; keep lines balanced and generally within 18 characters per line measure.
- **Headline** (700, `23px`, 1.3): Major authenticated page headings and compact task introductions.
- **Title** (700, `19px`, 1.3): Card, section, recovery-batch, and explanatory headings.
- **Body** (400, `16px`, 1.65): Primary explanatory copy, normally capped near 62–66 characters per line.
- **Label** (650, `13px`, 1.3): Field labels, compact actions, trust lines, and status titles; sentence case is the default.
- **Code** (600, `13px`, 1.45): Recovery codes and exact machine strings, with tabular figures where alignment matters.

**The Mono Means Exact Rule.** Use IBM Plex Mono only for coordinates, profile IDs, recovery codes, model versions, and similarly exact strings; ordinary copy and labels remain Inter.

**The Quiet Wordmark Rule.** Preserve the lowercase `inva` / `trace` construction, its weighted color split, and tight tracking; never convert it to all caps.

## Layout

The system is mobile first and uses a 4/8-point rhythm. Full-screen flows reserve safe-area space, keep the brand and legal context at the edges, and center the task region vertically when content allows. Main controls remain at least 44px tall, with primary fields and buttons at 46px.

Focused forms cap at 520px. Longer evidence and recovery tasks expand to roughly 800–840px, while a composed landing can reach 1040px. Below 640px, actions and code batches stack; at 640px they may form two balanced columns. At 900px, the access landing may split promise from explanation, and the application shell changes from bottom navigation to a 248px sidebar. Task order and reading order never change across breakpoints.

**The Field Reach Rule.** Mobile spacing and touch behavior are the source layout; larger screens add breathing room and parallel columns without rearranging the job.

## Elevation & Depth

Depth is a hybrid of tonal layering, hairline boundaries, and very small ambient shadows. Most grouping comes from daylight ground behind clean white surfaces; shadows identify a card, sheet, popover, or decisive control, never atmosphere for its own sake. Blur decoration, glass effects, and theatrical floating layers are outside the system.

### Shadow Vocabulary

- **Ambient Card** (`0 1px 2px rgba(20, 40, 30, 0.16)`): White cards and recovery-code containers on the daylight ground.
- **Elevated Utility** (`0 1px 3px rgba(20, 40, 30, 0.28)`): Popovers, floating controls, and other genuinely raised utilities.
- **Bottom Sheet Lift** (`0 -8px 24px rgba(20, 40, 30, 0.18)`): Mobile sheets rising from the bottom edge.
- **Primary Action Lift** (`0 3px 10px rgba(20, 64, 44, 0.18)`): The private-access primary button; keep the effect modest and localized.

**The Flat-by-Default Rule.** Start with tone and border; add a documented shadow only when the surface actually rises above its context.

## Shapes

The form language is gently organic but disciplined. Buttons use compact 9px corners, inputs 11px, cards 12px, and sheets 20px. Pills use the full 99px radius, while step markers, installation icons, avatars, and floating scan actions are circular. Borders are usually one-pixel hairlines; clipping is reserved for cards, code grids, maps, and sheets that need a bounded silhouette.

**The Closed Radius Scale Rule.** Reuse the button, input, card, sheet, pill, or circle shapes; do not invent near-duplicate corner values for a new component.

## Components

Components feel compact, direct, and touch-safe. Their states use small changes in tone, scale, outline, or copy rather than ornamental motion.

### Buttons

- **Shape:** Gently compact corners (9px), a 46px primary height, and at least a 44px interaction target.
- **Primary:** Living Forest with white text, 18px horizontal padding, a one-pixel matching border, and modest action lift.
- **Hover / Focus:** Hover darkens slightly; active press scales to 0.985; keyboard focus uses a 2px Living Forest outline with 2px offset.
- **Secondary:** Clean Surface with Field Ink and a visible Control Border.
- **Quiet:** Soft Hover with Working Copy and a Hairline Border for tertiary or reversible actions.
- **Danger:** Risk Red with white text; use only after an inline confirmation makes the consequence explicit.

### Chips

- **Style:** Full-pill shapes (99px) with compact padding. Tinted backgrounds carry explicit semantic text rather than decorative categories.
- **State:** Secret and risk-adjacent badges use Risk Tint with Risk Ink; selected filters use paired text or icon state so color is not the sole cue.

### Cards / Containers

- **Corner Style:** Gently curved cards (12px) and inset panels (11px).
- **Background:** Clean Surface on Daylight Ground; Inset Ground for recessed rows.
- **Shadow Strategy:** Ambient Card only when a white surface needs separation from the page.
- **Border:** Hairline Border for sections and dividers; Control Border only where interaction needs stronger definition.
- **Internal Padding:** 16–24px for ordinary surfaces; focused form panels may expand to 34px on desktop.

### Inputs / Fields

- **Style:** Clean white field, visible Control Border, 11px radius, 46px minimum height, and 16px input text to prevent mobile browser zoom.
- **Focus:** Forest border with a three-pixel Field Green Tint halo; do not remove the global keyboard-visible outline from custom controls without supplying an equivalent.
- **Error / Disabled:** Error fields shift the border to Risk Red and add plain-language error text. Disabled controls remain visible, non-interactive, and lower emphasis.

### Navigation

- **Style:** Navigation rests on Clean Surface with Hairline Borders. The desktop rail uses compact 44px rows and a 248px width; mobile uses a safe-area-aware bottom bar with a central scan action.
- **Default / Hover / Active:** Default destinations use Working Copy and Dormant Icon; active destinations use Forest Shade text, Living Forest icons, and Field Green Tint or a small active marker.
- **Private Access:** The separate brand bar is 72px tall and pairs the wordmark with a quiet “Private field access” label; it frames the flow without pretending to be conventional account navigation.

### Status Notices

Notices pair a 20px Lucide icon with a bold title and compact explanatory copy. Calm and success states use Field Green Tint, warnings use Warning Tint, and errors use Risk Tint. Error notices use alert semantics; changing status may announce politely where appropriate.

### Recovery Code Grid

Recovery material is a signature utility surface: a 12px-clipped grid with one-pixel Hairline Border gutters, numbered cells, and IBM Plex Mono code strings in Deep Canopy. It is visually distinct from the public profile ID and is immediately followed by copy or download actions.

### Installation Ledger

Authorized installations appear as divided rows rather than dashboard cards. Each row has a green-tinted circular device marker, plain date metadata, a text status for the current installation, and visible inline confirmation before revocation.

## Do's and Don'ts

### Do:

- **Do** make Forest the clear active voice and let daylight neutrals carry most of each screen.
- **Do** reserve IBM Plex Mono for exact machine-readable strings.
- **Do** keep every interactive target at least 44px and primary fields or buttons at 46px.
- **Do** pair semantic color with an icon, label, or plain-language status.
- **Do** preserve safe areas, keyboard focus, reduced-motion behavior, and the 16px mobile input floor.
- **Do** use Lucide line icons at the established compact sizes.

### Don't:

- **Don't** add gradients, glass blur, parallax, or decorative shadow clouds.
- **Don't** introduce purple or pink AI styling into the conservation utility palette.
- **Don't** invent radii or elevations outside the documented scales.
- **Don't** use emoji as functional icons or rely on hover-only affordances.
- **Don't** turn the lowercase InvaTrace wordmark into all caps or recolor it outside its established Forest, Ink, white, and Sprout construction.
- **Don't** let semantic amber or red become general-purpose decoration.

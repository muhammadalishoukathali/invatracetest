# Page override — `/scan` (Capture → Result)

Extends `../README.md`.

## Purpose
Field capture: user photographs a plant, on-device model classifies it into `target` / `other_plant` / `uncertain`, we display verdict + safe-action guidance.

## Layout
- Standalone route stack — no AppShell chrome. Own quiet header with a 44 px back target + title "Scan a plant".
- Content maxWidth 520 px, single column, generous vertical rhythm.

## Capture step
- **Two-input pattern:** primary "Take a photo" button (uses `<input type="file" accept="image/*" capture="environment">`), secondary "Choose from gallery" (no `capture` attribute) — reliable on iOS Safari + Android Chrome.
- Camera area: 4 : 3 dark field viewfinder with framing corners and a direct "Open camera" action. Do not style it as a generic dashed upload drop-zone.
- After capture: image preview with translucent X close (aria-label "Discard photo and retake") top-right.
- Quality-gate result:
  - **Pass:** green banner with check icon, "Photo quality check passed", primary CTA "Analyse plant" enabled.
  - **Fail:** dark scrim over image with `AlertTriangle` icon, reason text, big "Retake" button.
- Camera streams stop when the page closes, the app is backgrounded, or the
  browser ends the track. An interrupted camera returns to the start state with
  a recovery message.
- A model download/runtime failure keeps the prepared photo and shows a retryable
  inline error below the Analyse button.
- Pre-capture guidance stays visible as a continuous checklist below the capture controls; it is not a detached card.

## Result step
Three outcome branches:

### `target` (confirmed invasive)
- Red **OutcomeBadge**: `AlertTriangle` + "Invasive species detected".
- Photo (max-height 220 px, cover).
- Species block: common name h2, latin italic muted, common aliases, **HIGH RISK** chip.
- **ConfidenceBand:** horizontal bar, colour by tier (≥70 green, ≥50 amber, <50 red), % label.
- **Key traits:** label · value pairs.
- **Native look-alike card:** green surface, distinguishing traits.
- **Safe removal steps:** ordered list.
- **Do NOT do:** red surface, warning items.
- **Model version:** mono, in a footer bar.
- CTAs: outline "Scan again" + primary "Report sighting".

### `other_plant`
- Green **OutcomeBadge**: `Check` + "Not a target species".
- Photo.
- Card: "Not a tracked invasive" + confidence band.
- CTAs: "Scan again" only (nothing to report).

### `uncertain`
- Amber **OutcomeBadge**: `HelpCircle` + "Uncertain — another photo is needed".
- Photo.
- Card: "Could not determine species" + retake tips + confidence band (red because <50 %).
- CTAs: "Scan again" + primary "Report sighting". If submitted, the automated
  validation pipeline decides whether a rescan is required; there is no manual
  approval queue.

## Motion
- Capture → analysing: button swaps to spinner (150 ms) then route transitions to `/scan/result` on completion.
- Result screen enters with 200 ms opacity fade, no slide (respects reduced-motion by default).

## Anti-patterns
- Do NOT show the raw model confidence to two decimals — round to whole percent.
- Do NOT auto-submit a report from the Result screen — user must confirm every submission.
- Do NOT hide "Do NOT do" list on target result to save space.
- Do NOT display the species name as headline for `uncertain` — model isn't confident.

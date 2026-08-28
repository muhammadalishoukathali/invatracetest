# Page override — `/verify` (Coordinator queue)

Extends `MASTER.md`.

## Purpose
Coordinator, Expert, or Admin decides whether each candidate report becomes a public confirmed sighting. Detectors and Volunteers cannot reach this route.

## Access
- Client guard: `<RequireRole roles={['Coordinator','Expert','Admin']}>` in `router.tsx` bounces others to `/map`.
- Server guard: mock (and real) API returns 403 for the same set.
- Nav visibility: only shown to those roles in Sidebar / BottomTabs.

## Layout — list mode
- Content maxWidth 720 px.
- Intro paragraph reminds "Only confirmed sightings appear on the public threat map."
- Each item card:
  - 64 × 64 photo thumb (rounded, cover, muted background).
  - Species common name h3, followed by trust pill (New = amber chip, Trusted = green chip).
  - Place label (Malaysia-specific: "Bukit Kiara · West Trail" etc.).
  - Meta line: coords (mono) · extent label · relative time.
  - 4 check dots (species / location / quality / trust) coloured by pass/warn/fail.
  - Right chevron.
- Empty state: green surface, "Queue is empty. Nice work."

## Layout — detail mode
Enter by tapping any list item. Same route, in-component state.
1. Back-to-queue link (chevron + label).
2. Photo (full width, max-height 320, cover, muted background fallback).
3. Species name + latin + optional notes card.
4. **Checks** section — 4 tinted cards, colour = pass / warn / fail:
   - Species identification (model outcome + confidence + version).
   - Location precision (GPS accuracy or "Manual entry").
   - Photo quality (from on-device gate).
   - Submitter trust.
5. **Metadata** section — Place, Coordinates (mono ± accuracy), Extent, Submitted timestamp, Model verdict.
6. **Actions** — 3-button grid:
   - Reject (red-light tinted).
   - Merge (neutral outline) — opens a picker of nearby same-species sightings within 500 m sorted by distance.
   - Confirm (primary green).

## Merge picker
- Bottom card that replaces the actions row.
- Header "Merge into…" with close button.
- Rows: species name, status + report count, distance (mono, "329 m").
- If no candidates within 500 m, show empty message: "No nearby sightings of this species within 500 m. Confirm as new instead."

## Motion
- List → detail: instant swap.
- Action mutation: button disabled + spinner; on success, invalidate `verify-queue` and return to list.

## Anti-patterns
- Do NOT show identifying submitter details in the queue; display only the pseudonymous profile ID and trust level required for review.
- Do NOT allow bulk-confirm — every decision is per-item, on the evidence.
- Do NOT auto-merge based on distance alone; a coordinator must pick.
- Do NOT expose the queue to non-coordinator roles; a local installation token never grants privileged access.

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are volunteers and detectors identifying invasive plants outdoors in Malaysia. Coordinators are a secondary audience who review evidence, verify reports, and manage monitored areas.

## Product Purpose

InvaTrace helps people identify, record, and coordinate action on invasive plant sightings. Success means field observations can become trustworthy, useful records even when connectivity is unreliable.

## Positioning

InvaTrace combines on-device plant identification, offline-capable field reporting, and coordinator verification before sightings become trusted records on a shared map.

## Operating Context

The product is used in the field, including on trails and in areas with unreliable connectivity. A contributor scans a plant, reviews the identification result, supplies location and extent evidence, consents to the report's accuracy, and submits it for coordinator review. Coordinators assess candidate reports and confirm, reject, or merge them with existing sightings.

## Capabilities and Constraints

- The current pilot scope is Malaysia.
- The product supports Detector, Volunteer, Coordinator, Expert, and Admin roles, with privileged verification routes gated by role.
- Field reporting must continue to work offline and retry automatically after connectivity returns.
- Every installation receives a pseudonymous local identity; reported coordinates may be stored at up to five decimal places.
- The frontend is a React, Vite, and TypeScript installable PWA. Development currently uses mocked API responses while preserving the production API boundary.
- The product does not use conventional email/password accounts. Cross-device
  access is restored with a public profile ID and a one-time recovery code.

## Identity Model

- Opening the PWA restores a valid local installation. A first-time visitor
  explicitly starts a private profile or restores an existing one while online.
- The long-lived opaque installation token lives only in IndexedDB; short-lived API access tokens remain memory-only.
- A new private profile receives a public profile ID and ten one-time recovery
  codes. Raw codes are shown only during recovery setup and are not persisted by
  the client.
- Existing installations can start offline and keep field reporting available
  through the report queue. New and restored installations require one online
  exchange before offline use is available.
- Roles and trust are server-authoritative. A new installation starts as Detector with New trust and cannot reach privileged verification.
- Restoring consumes one recovery code atomically and adds a new authorized
  installation. Rotating a recovery batch invalidates every unused code from
  earlier batches, and authorized installations can revoke other installations.
- Clearing browser storage removes that installation credential without
  deleting the server profile. The profile remains recoverable while at least
  one installation or unused recovery code remains available.

## Brand Commitments

Preserve the InvaTrace name, its existing role model, factual product copy, Malaysia pilot scope, and accessibility-first approach.

## Evidence on Hand

- The runnable frontend, workflows, and current product language live under `src/`.
- Existing design tokens and global interface rules live in `src/styles/tokens.css` and `src/styles/global.css`.
- Mock API behavior and realistic seeded records live in `src/mocks/handlers.ts`.
- No testimonials, customer logos, performance benchmarks, or deployment claims are available and must not be fabricated.

## Product Principles

- Make field reporting dependable in poor connectivity.
- Turn uncertain observations into verified shared evidence.
- Keep contributor tasks fast, clear, and usable outdoors.
- Give coordinators enough context to make accountable decisions.
- Protect role boundaries, privacy expectations, and factual trust.

## Accessibility & Inclusion

The web experience must preserve its accessibility-first approach across keyboard use, assistive technology, touch interaction, responsive layouts, status communication, and reduced-motion preferences.

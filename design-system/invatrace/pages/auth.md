# Page override — `/auth/*` (Sign-in, Register, Guest)

Extends `MASTER.md`.

## Purpose
Three entry paths: known-account sign in, new-account register, pseudonymous guest bootstrap. Arch §7 requires all three.

## Layout
- Centred single column, maxWidth 400 px, padded 24 px.
- Above the card: horizontal wordmark (Logo + inva/trace text, size 22).
- Card: `--surface`, 32 × 28 padding, `--r-card` radius, `--shadow-sm`.

## Sign-in
- H1: "Sign in to your account".
- Email input (icon: Mail).
- Password input (icon: Lock) + show/hide eye toggle.
- Primary green button "Sign in", full width, 46 px tall.
- Divider "or".
- Secondary outline button "Continue without an account" (icon: Smartphone) → triggers guest bootstrap.
- Bottom line: "Don't have an account? [Create one]" link.
- Demo hint (dev only): `Demo: nadia@example.org / demo1234`.

## Register
- H1: "Create your account".
- Fields: name, email, password, role (radio group).
- **Role choices:** Detector · Volunteer · Coordinator. Expert and Admin are **not** self-selectable (Arch §7).
- Same primary button + "Already have an account?" link back to sign-in.

## Guest bootstrap
- Silent — no form. Button click → `POST /api/v1/profiles/bootstrap` → session created with role Detector + trust New + `isPseudonymous: true`.
- On success, navigate to `/map`. No "Welcome" toast — the map is the welcome.

## Content
- Never say "Log in" — always "Sign in" (Arch copy convention).
- Never require both email AND username; email + password only.
- Password field: `autocomplete="current-password"` on sign-in, `new-password` on register.

## Anti-patterns
- Do NOT store the access token in localStorage — memory-only per Arch §7.1; refresh cookie is httpOnly.
- Do NOT show password strength requirements before the user has typed anything.
- Do NOT block sign-in behind captcha at MVP; add if abuse is observed.
- Do NOT prefill the email field with demo creds in production builds.

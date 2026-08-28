# Private access flow

## Entry

Startup first reads the local installation record. A known installation
bootstraps and opens the map. A first-time, unknown, or revoked installation is
routed to `/private-access`, where the user can **Start privately** or
**Restore existing access**. The screen explains that no email or phone number
is required, activity is connected to a pseudonymous profile, and recovery
information is required for another device.

A brand-new offline visitor remains on this screen with a clear connection
requirement. No provisional profile or installation credential is created.

## Start privately

The client generates a fresh installation token and calls
`POST /api/v1/profiles/start`. After the server creates and binds a
`Detector` / `New` profile, the client saves only the authorized installation
identity. The recovery screen shows the public profile ID and ten one-time
codes, with copy and local UTF-8 download actions.

The display-name field is optional and follows the recovery information so it
cannot become a gate or implied requirement. Continuing requires the explicit
“I have saved my recovery information” acknowledgement. Raw codes leave memory
when the recovery screen closes.

If the page reloads before acknowledgement, bootstrap returns
`recoverySetupRequired`; the client rotates the unseen batch and shows the new
codes. Older unseen codes become invalid.

## Restore existing access

The restore form accepts the public profile ID and one recovery code. The
client generates a new installation token and submits all three values. A
successful response saves the new installation and opens the existing profile;
all earlier installations remain active.

Invalid IDs, invalid codes, already-used codes, and expired/invalidated codes
share one client message: “We couldn’t restore this access. Check the profile
ID and recovery code, then try again.” The UI never identifies which value was
wrong.

## Access management

`/access` is reached from the desktop profile row or mobile profile button. It
shows the public profile ID, optional display-name editor, unused recovery-code
count, and active installations with approximate created/last-used dates.

Rotating recovery codes uses an inline destructive confirmation. The new batch
is shown in memory with copy/download actions; all older unused codes are
already invalid. Revoking an installation also requires confirmation, and the
current installation cannot revoke itself.

## Required states

The interface carries initializing, offline, server failure, storage failure,
generic invalid restore, successful restore, interrupted setup, replacement
batch, revoked installation, loading, validation, and destructive-confirmation
states. Route headings receive focus after navigation, live regions announce
loading/errors/success, controls preserve 44 px touch targets, code strings wrap
at 200% zoom, and reduced motion removes the access-trail reveal.

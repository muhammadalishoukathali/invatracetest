"""InvaTrace backend package.

FastAPI service that backs the InvaTrace PWA - pseudonymous reporting,
photo uploads to object storage, and the deterministic screening worker
that turns raw reports into public sightings. Everything else in this
package (app.api, app.db, app.domain, app.services, app.workers) hangs
off the pieces wired up in app/main.py and app/cli.py.
"""

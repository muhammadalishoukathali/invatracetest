"""Cross-cutting backend services.

Stuff that basically every route touches regardless of feature: error
formatting, auth/session handling, rate limiting, idempotency locking,
pagination cursors and the coordinate-privacy math. Kept separate from
app/domain so business rules don't get tangled up with plumbing.
"""

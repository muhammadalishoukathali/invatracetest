"""Opaque cursor pagination helpers, used by the sightings/reports list endpoints.

We don't want the frontend to know or care that a cursor is just a base64'd
offset — it's opaque on purpose so we can swap the underlying scheme later
without breaking clients. Keep it simple: no encryption, just enough
obfuscation that people don't start hand-editing offsets in the URL.
"""

from __future__ import annotations

import base64

from app.core.errors import ApiProblem


def decode_cursor(cursor: str | None) -> int:
    """No cursor means "start from the top". Anything that doesn't decode to a
    non-negative int is treated as tampered/garbage input, not a server error.
    """
    if cursor is None:
        return 0
    try:
        # padding got stripped when we encoded it, so pad back out defensively
        # (three extra "=" is always enough, urlsafe_b64decode ignores the rest)
        decoded = base64.urlsafe_b64decode(cursor.encode("ascii") + b"===").decode("ascii")
        offset = int(decoded)
    except (ValueError, UnicodeError) as error:
        raise ApiProblem(400, "invalid_cursor", "The cursor is invalid.") from error
    if offset < 0:
        raise ApiProblem(400, "invalid_cursor", "The cursor is invalid.")
    return offset


def encode_cursor(offset: int, returned: int, limit: int) -> str | None:
    """Only hand back a next-page cursor if the page was full. If we returned
    fewer rows than the limit, that's the last page and there's nothing after it.
    """
    if returned < limit:
        return None
    return (
        base64.urlsafe_b64encode(str(offset + returned).encode("ascii")).decode("ascii").rstrip("=")
    )

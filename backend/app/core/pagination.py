from __future__ import annotations

import base64

from app.core.errors import ApiProblem


def decode_cursor(cursor: str | None) -> int:
    if cursor is None:
        return 0
    try:
        decoded = base64.urlsafe_b64decode(cursor.encode("ascii") + b"===").decode("ascii")
        offset = int(decoded)
    except (ValueError, UnicodeError) as error:
        raise ApiProblem(400, "invalid_cursor", "The cursor is invalid.") from error
    if offset < 0:
        raise ApiProblem(400, "invalid_cursor", "The cursor is invalid.")
    return offset


def encode_cursor(offset: int, returned: int, limit: int) -> str | None:
    if returned < limit:
        return None
    return (
        base64.urlsafe_b64encode(str(offset + returned).encode("ascii")).decode("ascii").rstrip("=")
    )

"""Coordinate displacement for public-facing sighting locations.

Reports from "New" (unvetted) profiles, and anything still at candidate
status, get their coordinates nudged before they're ever shown to the
public — we don't want to publish an exact GPS pin for a plant on someone's
property based on a report we haven't screened or trust yet. Trusted/Steward
reports on screened sightings get full precision.
"""

from __future__ import annotations

import hashlib
import hmac
import math
from decimal import Decimal

from app.config import get_settings


def public_coordinates(
    *,
    sighting_id: str,
    latitude: Decimal | float,
    longitude: Decimal | float,
    status: str,
    reporter_trust: str,
) -> tuple[float, float, bool]:
    """Return (lat, lng, was_displaced) for public consumption.

    The displacement has to be *stable* — the same sighting should move to
    the same fuzzed point every time it's fetched, otherwise the pin would
    jump around the map on every page load. So instead of randomising, we
    derive a deterministic angle from an HMAC of the sighting id keyed with
    a server secret: nobody outside the server can predict or reverse it,
    but the server always recomputes the same offset.
    """
    lat = float(latitude)
    lng = float(longitude)
    reduce_precision = status == "candidate" or reporter_trust == "New"
    if not reduce_precision:
        # already trustworthy enough to publish as-is, just round off GPS noise
        return round(lat, 5), round(lng, 5), False

    key = get_settings().location_privacy_key.encode("utf-8")
    digest = hmac.new(key, sighting_id.encode("utf-8"), hashlib.sha256).digest()
    # first 8 bytes of the digest -> a pseudo-random angle in [0, 2pi)
    angle = int.from_bytes(digest[:8], "big") / (2**64 - 1) * 2 * math.pi
    distance_m = 100.0
    # rough metres-to-degrees conversion; longitude needs the latitude-dependent
    # correction since a degree of longitude shrinks as you move away from the
    # equator (clamped so we don't divide by something tiny near the poles,
    # not that we're expecting sightings anywhere near one)
    lat_delta = math.sin(angle) * distance_m / 111_320
    lng_delta = math.cos(angle) * distance_m / (111_320 * max(0.1, math.cos(math.radians(lat))))
    candidate_lat = lat + lat_delta
    candidate_lng = lng + lng_delta
    # if nudging the point pushed it outside Malaysia's bounding box, flip the
    # offset direction instead of clamping — clamping would bias displaced
    # points towards the border and leak more info than it should
    if not (0.8 <= candidate_lat <= 7.5 and 99.3 <= candidate_lng <= 119.5):
        candidate_lat = lat - lat_delta
        candidate_lng = lng - lng_delta
    # rounded to 4dp (roughly 11m) on top of the 100m displacement — belt and
    # braces so we're not accidentally leaking sub-metre precision
    return round(candidate_lat, 4), round(candidate_lng, 4), True

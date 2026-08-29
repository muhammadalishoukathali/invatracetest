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
    lat = float(latitude)
    lng = float(longitude)
    reduce_precision = status == "candidate" or reporter_trust == "New"
    if not reduce_precision:
        return round(lat, 5), round(lng, 5), False

    key = get_settings().location_privacy_key.encode("utf-8")
    digest = hmac.new(key, sighting_id.encode("utf-8"), hashlib.sha256).digest()
    angle = int.from_bytes(digest[:8], "big") / (2**64 - 1) * 2 * math.pi
    distance_m = 100.0
    lat_delta = math.sin(angle) * distance_m / 111_320
    lng_delta = math.cos(angle) * distance_m / (111_320 * max(0.1, math.cos(math.radians(lat))))
    candidate_lat = lat + lat_delta
    candidate_lng = lng + lng_delta
    if not (0.8 <= candidate_lat <= 7.5 and 99.3 <= candidate_lng <= 119.5):
        candidate_lat = lat - lat_delta
        candidate_lng = lng - lng_delta
    return round(candidate_lat, 4), round(candidate_lng, 4), True

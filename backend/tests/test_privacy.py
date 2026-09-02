"""Tests for app/core/privacy.py - the public coordinate displacement logic.

Public sightings never show a raw GPS point for anything that isn't from
a Trusted reporter and fully screened. Instead the coordinates get pushed
by a stable ~100m offset keyed off the sighting id, so repeated lookups of
the same sighting don't jitter around (that would leak the real location
by averaging), but the offset is still unpredictable per sighting.
"""

from __future__ import annotations

from app.core.privacy import public_coordinates


def test_candidate_location_is_reduced_deterministically() -> None:
    # same sighting id in, same displaced coordinates out every time -
    # otherwise a bot could just hit the endpoint repeatedly and average
    # out the noise to recover the real location.
    first = public_coordinates(
        sighting_id="fixed-sighting",
        latitude=3.139,
        longitude=101.6869,
        status="candidate",
        reporter_trust="Trusted",
    )
    second = public_coordinates(
        sighting_id="fixed-sighting",
        latitude=3.139,
        longitude=101.6869,
        status="candidate",
        reporter_trust="Trusted",
    )
    assert first == second
    assert first[2] is True
    assert first[:2] != (3.139, 101.6869)


def test_new_reporter_location_stays_reduced_after_confirmation() -> None:
    # trust level is what decides displacement here, not screening status -
    # a "New" (unproven) reporter's sighting still gets displaced even once
    # it's screened, since we don't yet trust the account behind it.
    _lat, _lng, reduced = public_coordinates(
        sighting_id="new-reporter",
        latitude=3.139,
        longitude=101.6869,
        status="screened",
        reporter_trust="New",
    )
    assert reduced is True


def test_trusted_screened_location_preserves_server_precision() -> None:
    # the one case where the real coordinates go out unmodified: a
    # screened sighting from a Trusted reporter. This is the exact
    # opposite of the two tests above, so worth pinning down explicitly.
    lat, lng, reduced = public_coordinates(
        sighting_id="trusted-reporter",
        latitude=3.13901,
        longitude=101.68691,
        status="screened",
        reporter_trust="Trusted",
    )
    assert (lat, lng, reduced) == (3.13901, 101.68691, False)

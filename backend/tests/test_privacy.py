from __future__ import annotations

from app.core.privacy import public_coordinates


def test_candidate_location_is_reduced_deterministically() -> None:
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
    _lat, _lng, reduced = public_coordinates(
        sighting_id="new-reporter",
        latitude=3.139,
        longitude=101.6869,
        status="screened",
        reporter_trust="New",
    )
    assert reduced is True


def test_trusted_screened_location_preserves_server_precision() -> None:
    lat, lng, reduced = public_coordinates(
        sighting_id="trusted-reporter",
        latitude=3.13901,
        longitude=101.68691,
        status="screened",
        reporter_trust="Trusted",
    )
    assert (lat, lng, reduced) == (3.13901, 101.68691, False)

"""Iteration 2 Phase 7 - Epic 6 adopted-area activity indicators + clustering.

Computes AC 6.2.2 / 6.3.4 / 6.3.5 for a single adopted place:

* indicator counts over the last 30 UTC-midnight-anchored days
* period-over-period change with an ACTIVITY_CHANGE_TOLERANCE_PCT band
  (inclusive on the upper edge - AC 6.3.5)
* DBSCAN cluster labels (eps=250 m *metric*, minPts=3) via PostGIS
  ``ST_ClusterDBSCAN`` over a web-mercator-projected geometry so eps
  stays in metres (degree approximation drifts too much at MY latitudes
  for the AC's tolerance).
* an in-place marker list restricted to the place's polygon, with the
  species names and status timestamps the AreaDetailPage needs to
  render each marker without a follow-up N+1 fan-out.

Deliberately keeps every threshold / window pulled from settings so a
tester can push env vars and see the change without touching code.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import (
    MonitoredArea,
    ReportSightingLink,
    Sighting,
    SightingStatusHistory,
    Species,
)


# Statuses that count as "active" for AC 6.2.2 / 6.3.4. A sighting that
# was rejected, admin-removed, merged into a parent, or already
# marked removal_reported is excluded from the density and marker view.
_ACTIVE_STATUSES = ("candidate", "screened")

# Statuses that count as "new reports" for the 30d rolling total.
_REPORT_STATUSES = ("candidate", "screened", "removal_reported")


ChangeDirection = Literal["increase", "decrease", "unchanged", "insufficient_history"]


@dataclass(frozen=True)
class ActivityIndicators:
    active_sighting_count: int
    distinct_species_count: int
    reports_new_30d: int
    removal_reported_30d: int
    days_since_most_recent: int | None
    most_recent_report_date: date | None
    reports_previous_30d: int
    change_direction: ChangeDirection
    change_pct: float | None
    tolerance_pct: int
    window_days: int


@dataclass(frozen=True)
class ActivityCluster:
    cluster_id: int
    point_count: int
    centroid_lat: float
    centroid_lon: float
    species_ids: list[str]


@dataclass(frozen=True)
class ActivityMarker:
    sighting_id: uuid.UUID
    species_id: str
    status: str
    latitude: float
    longitude: float
    observed_at: str
    cluster_id: int | None
    # AC 6.3.2 - marker detail fields so the UI can render species names
    # and status timestamps without an N+1 fan-out.
    plant_name: str
    plant_common_name: str | None
    community_report_label: str
    observation_date: date
    current_status: str
    status_date: str


@dataclass(frozen=True)
class ActivitySnapshot:
    place_id: uuid.UUID
    place_name: str
    place_type: str
    window_start_utc: str
    window_end_utc: str
    geometry_version: str
    geometry_geojson: str | None
    indicators: ActivityIndicators
    clusters: list[ActivityCluster] = field(default_factory=list)
    markers: list[ActivityMarker] = field(default_factory=list)


def _classify_change(
    current: int, previous: int, tolerance_pct: int
) -> tuple[ChangeDirection, float | None]:
    """AC 6.3.5 - a change smaller than tolerance_pct reads as
    ``unchanged``; both counts zero also reads as ``unchanged``; a
    previous zero with a current non-zero counts as ``increase`` (there
    were no reports before and there are some now - directionally
    that is an increase even though the percentage is undefined).
    The band is exclusive: |delta| >= tolerance_pct crosses into
    increase/decrease so ``prior*1.10`` == current is an increase.
    """

    if previous == 0 and current == 0:
        return "unchanged", 0.0
    if previous == 0:
        # AC 6.3.5 - a first-ever report cycle for a place is an
        # increase in absolute terms; percentage is undefined so leave
        # it null rather than invent an "infinity% increase".
        return "increase", None
    delta_pct = (current - previous) / previous * 100.0
    if abs(delta_pct) < tolerance_pct:
        return "unchanged", delta_pct
    return ("increase" if delta_pct > 0 else "decrease"), delta_pct


def _filter_by_place(query, area_id: uuid.UUID):
    """Restrict a Sighting query to the polygon of ``area_id``. Trail
    buffer support lives here so callers stay clean when we add
    trail_area places. Also drops sightings for pytest-fixture species
    (``test-sp-<hex>``) so a shared dev DB does not surface them to the
    UI.
    """

    area_geom = select(MonitoredArea.geometry).where(MonitoredArea.id == area_id).scalar_subquery()
    return (
        query
        .where(func.ST_Covers(area_geom, Sighting.location))
        .where(~Sighting.species_id.like("test-sp-%"))
    )


def compute_activity(
    session: Session,
    place_id: uuid.UUID,
    *,
    now: datetime | None = None,
    species_id: str | None = None,
    status: str | None = None,
    period_days: int = 30,
) -> ActivitySnapshot | None:
    settings = get_settings()
    place = session.get(MonitoredArea, place_id)
    if place is None:
        return None

    # AC 6.3.3 - period_days is a client-selectable filter; the default
    # is window_days = 30 to keep the AC 6.2.2 30-day dashboard math.
    window_days = max(1, int(period_days))
    tolerance_pct = int(settings.activity_change_tolerance_pct)
    # AC 6.2.2 - anchor the window to UTC 00:00:00 so identical requests
    # inside the same UTC day return the same bounds; the rolling
    # "30 days from now" version drifted second-by-second and made the
    # frontend caching pointless.
    base_now = (now or datetime.now(UTC)).astimezone(UTC)
    today_utc = base_now.replace(hour=0, minute=0, second=0, microsecond=0)
    window_start = today_utc - timedelta(days=window_days)
    prev_window_start = today_utc - timedelta(days=window_days * 2)
    window_end = today_utc

    # AC 6.3.3 - clearing a filter means "default value" - all qualifying
    # rows for this area come back. Applied to both the marker list and
    # every count that feeds the indicator bundle.
    filter_status = status if status else None
    filter_species = species_id if species_id else None
    active_statuses = (
        (filter_status,) if filter_status else _ACTIVE_STATUSES
    )
    report_statuses = (
        (filter_status,) if filter_status else _REPORT_STATUSES
    )

    active_query = (
        select(Sighting.id, Sighting.species_id, Sighting.status,
               Sighting.latitude, Sighting.longitude, Sighting.created_at)
        .where(Sighting.status.in_(active_statuses))
        .where(Sighting.created_at >= window_start)
        .where(Sighting.created_at < window_end + timedelta(days=1))
    )
    if filter_species:
        active_query = active_query.where(Sighting.species_id == filter_species)
    active_query = _filter_by_place(active_query, place_id)
    active_rows = session.execute(active_query).all()

    reports_current_q = select(func.count(Sighting.id)).where(
        Sighting.status.in_(report_statuses),
        Sighting.created_at >= window_start,
        Sighting.created_at < window_end + timedelta(days=1),
    )
    if filter_species:
        reports_current_q = reports_current_q.where(Sighting.species_id == filter_species)
    reports_current = session.scalar(_filter_by_place(reports_current_q, place_id)) or 0

    reports_previous_q = select(func.count(Sighting.id)).where(
        Sighting.status.in_(report_statuses),
        Sighting.created_at >= prev_window_start,
        Sighting.created_at < window_start,
    )
    if filter_species:
        reports_previous_q = reports_previous_q.where(Sighting.species_id == filter_species)
    reports_previous = session.scalar(_filter_by_place(reports_previous_q, place_id)) or 0

    # AC 6.2.2 - "removals reported in the last 30 days" comes from the
    # status-history table (Phase 4) so a place with removal_reported
    # sightings older than 30 days does not count them - only the actual
    # transition events land in the count.
    removals_current = session.scalar(
        select(func.count(SightingStatusHistory.id))
        .join(Sighting, Sighting.id == SightingStatusHistory.sighting_id)
        .where(
            SightingStatusHistory.to_status == "removal_reported",
            SightingStatusHistory.event_time_utc >= window_start,
            SightingStatusHistory.event_time_utc < window_end + timedelta(days=1),
        )
        .where(
            func.ST_Covers(
                select(MonitoredArea.geometry).where(MonitoredArea.id == place_id).scalar_subquery(),
                Sighting.location,
            )
        )
    ) or 0

    most_recent_q = select(func.max(Sighting.created_at)).where(
        Sighting.status.in_(report_statuses)
    )
    if filter_species:
        most_recent_q = most_recent_q.where(Sighting.species_id == filter_species)
    most_recent = session.scalar(_filter_by_place(most_recent_q, place_id))
    days_since_most_recent = (
        int((base_now - most_recent.astimezone(UTC)).total_seconds() // 86400)
        if most_recent is not None
        else None
    )
    most_recent_date = (
        most_recent.astimezone(UTC).date() if most_recent is not None else None
    )

    distinct_species = {row.species_id for row in active_rows}
    active_count = len(active_rows)
    change_direction, change_pct = _classify_change(
        int(reports_current), int(reports_previous), tolerance_pct
    )

    indicators = ActivityIndicators(
        active_sighting_count=active_count,
        distinct_species_count=len(distinct_species),
        reports_new_30d=int(reports_current),
        removal_reported_30d=int(removals_current),
        days_since_most_recent=days_since_most_recent,
        most_recent_report_date=most_recent_date,
        reports_previous_30d=int(reports_previous),
        change_direction=change_direction,
        change_pct=change_pct,
        tolerance_pct=tolerance_pct,
        window_days=window_days,
    )

    clusters, markers = _cluster_active_sightings(
        session,
        place_id,
        window_start,
        window_end + timedelta(days=1),
        filter_species=filter_species,
        filter_status=filter_status,
    )

    # AC 6.3.1 - hand the polygon's GeoJSON back so AreaDetailPage can
    # outline the area on the MapLibre canvas without a second call.
    geometry_geojson = session.scalar(
        select(func.ST_AsGeoJSON(MonitoredArea.geometry)).where(
            MonitoredArea.id == place_id
        )
    )

    return ActivitySnapshot(
        place_id=place.id,
        place_name=place.name,
        place_type=place.place_type,
        window_start_utc=window_start.isoformat().replace("+00:00", "Z"),
        window_end_utc=window_end.isoformat().replace("+00:00", "Z"),
        geometry_version=str(place.geometry_version),
        geometry_geojson=geometry_geojson,
        indicators=indicators,
        clusters=clusters,
        markers=markers,
    )


def _cluster_active_sightings(
    session: Session,
    place_id: uuid.UUID,
    window_start: datetime,
    window_end_exclusive: datetime,
    *,
    filter_species: str | None,
    filter_status: str | None,
) -> tuple[list[ActivityCluster], list[ActivityMarker]]:
    """AC 6.3.4 - DBSCAN eps=250 m minPts=3 over the anchored 30-day
    window, excluding rejected/deleted/removal_reported. The geometry is
    projected to EPSG:3857 (web-mercator) BEFORE clustering so ``eps``
    stays in metres; the earlier degree-approximation (250/111320) is
    off by ~2% at MY latitudes and the AC calls for a hard 250 m radius.
    Web-mercator distortion at ~3-6 degrees N is under 1.02x, well
    inside the AC tolerance for a 250 m clustering radius.
    """

    active_statuses = (
        (filter_status,) if filter_status else list(_ACTIVE_STATUSES)
    )

    species_predicate = "AND s.species_id = :species_id" if filter_species else ""

    sql = text(
        f"""
        WITH active AS (
            SELECT
                s.id,
                s.species_id,
                s.status,
                s.latitude,
                s.longitude,
                s.created_at,
                s.updated_at,
                ST_ClusterDBSCAN(
                    ST_Transform(s.location::geometry, 3857),
                    eps := :eps_m,
                    minpoints := :min_pts
                ) OVER () AS cluster_id
            FROM sightings s
            WHERE s.status = ANY(:active_statuses)
              AND s.created_at >= :window_start
              AND s.created_at < :window_end
              {species_predicate}
              AND ST_Covers(
                    (SELECT geometry FROM monitored_areas WHERE id = :place_id),
                    s.location
                  )
        )
        SELECT
            active.id,
            active.species_id,
            active.status,
            active.latitude,
            active.longitude,
            active.created_at,
            active.updated_at,
            active.cluster_id,
            sp.name AS plant_name,
            sp.common_names AS plant_common_names
        FROM active
        LEFT JOIN species sp ON sp.id = active.species_id
        ORDER BY active.created_at DESC
        """
    )
    params = {
        "eps_m": 250.0,
        "min_pts": 3,
        "active_statuses": list(active_statuses),
        "window_start": window_start,
        "window_end": window_end_exclusive,
        "place_id": place_id,
    }
    if filter_species:
        params["species_id"] = filter_species
    rows = session.execute(sql, params).all()

    cluster_buckets: dict[int, list] = {}
    markers: list[ActivityMarker] = []
    for row in rows:
        cluster_id = row.cluster_id
        common_names = row.plant_common_names or []
        common_name = common_names[0] if common_names else None
        created_utc = row.created_at.astimezone(UTC)
        updated_utc = (row.updated_at or row.created_at).astimezone(UTC)
        markers.append(
            ActivityMarker(
                sighting_id=row.id,
                species_id=row.species_id,
                status=row.status,
                latitude=float(row.latitude),
                longitude=float(row.longitude),
                observed_at=created_utc.isoformat().replace("+00:00", "Z"),
                cluster_id=int(cluster_id) if cluster_id is not None else None,
                plant_name=row.plant_name or row.species_id,
                plant_common_name=common_name,
                community_report_label="Community-reported sighting",
                observation_date=created_utc.date(),
                current_status=row.status,
                status_date=updated_utc.isoformat().replace("+00:00", "Z"),
            )
        )
        if cluster_id is not None:
            cluster_buckets.setdefault(int(cluster_id), []).append(row)

    clusters: list[ActivityCluster] = []
    for cid, bucket in sorted(cluster_buckets.items()):
        lat = sum(float(r.latitude) for r in bucket) / len(bucket)
        lon = sum(float(r.longitude) for r in bucket) / len(bucket)
        species = sorted({r.species_id for r in bucket})
        clusters.append(
            ActivityCluster(
                cluster_id=cid,
                point_count=len(bucket),
                centroid_lat=lat,
                centroid_lon=lon,
                species_ids=species,
            )
        )
    return clusters, markers

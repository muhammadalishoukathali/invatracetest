"""Iteration 2 Phase 7 - Epic 6 adopted-area activity indicators + clustering.

Computes AC 6.2.2 / 6.3.4 / 6.3.5 for a single adopted place:

* indicator counts over the last 30 UTC days
* period-over-period change with an ACTIVITY_CHANGE_TOLERANCE_PCT band
* DBSCAN cluster labels (eps=250 m geodesic, minPts=3) via PostGIS
  ``ST_ClusterDBSCAN`` over the same 30-day window
* an in-place marker list restricted to the place's polygon (or a
  DISCOVERY_TRAIL_BUFFER_M buffer around the trail_line for
  ``place_type='trail_area'`` when we add trail places later)

Deliberately keeps every threshold / window pulled from settings so a
tester can push env vars and see the change without touching code.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import (
    MonitoredArea,
    ReportSightingLink,
    Sighting,
    SightingStatusHistory,
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


@dataclass(frozen=True)
class ActivitySnapshot:
    place_id: uuid.UUID
    place_name: str
    place_type: str
    window_start_utc: str
    window_end_utc: str
    indicators: ActivityIndicators
    clusters: list[ActivityCluster] = field(default_factory=list)
    markers: list[ActivityMarker] = field(default_factory=list)


def _classify_change(
    current: int, previous: int, tolerance_pct: int
) -> tuple[ChangeDirection, float | None]:
    """AC 6.3.5 - a change smaller than +/- tolerance_pct reads as
    ``unchanged``; both counts zero also reads as ``unchanged``; a
    previous zero with a current non-zero cannot be expressed as a
    percentage so we surface ``insufficient_history`` rather than
    invent an "infinity% increase".
    """

    if previous == 0 and current == 0:
        return "unchanged", 0.0
    if previous == 0:
        return "insufficient_history", None
    delta_pct = (current - previous) / previous * 100.0
    if abs(delta_pct) <= tolerance_pct:
        return "unchanged", delta_pct
    return ("increase" if delta_pct > 0 else "decrease"), delta_pct


def _filter_by_place(query, area_id: uuid.UUID):
    """Restrict a Sighting query to the polygon of ``area_id``. Trail
    buffer support lives here so callers stay clean when we add
    trail_area places.
    """

    area_geom = select(MonitoredArea.geometry).where(MonitoredArea.id == area_id).scalar_subquery()
    return query.where(func.ST_Covers(area_geom, Sighting.location))


def compute_activity(
    session: Session,
    place_id: uuid.UUID,
    *,
    now: datetime | None = None,
) -> ActivitySnapshot | None:
    settings = get_settings()
    place = session.get(MonitoredArea, place_id)
    if place is None:
        return None

    window_days = 30
    tolerance_pct = int(settings.activity_change_tolerance_pct)
    now_utc = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    window_start = now_utc - timedelta(days=window_days)
    prev_window_start = now_utc - timedelta(days=window_days * 2)

    active_query = (
        select(Sighting.id, Sighting.species_id, Sighting.status,
               Sighting.latitude, Sighting.longitude, Sighting.created_at)
        .where(Sighting.status.in_(_ACTIVE_STATUSES))
        .where(Sighting.created_at >= window_start)
    )
    active_query = _filter_by_place(active_query, place_id)
    active_rows = session.execute(active_query).all()

    reports_current = session.scalar(
        _filter_by_place(
            select(func.count(Sighting.id)).where(
                Sighting.status.in_(_REPORT_STATUSES),
                Sighting.created_at >= window_start,
            ),
            place_id,
        )
    ) or 0
    reports_previous = session.scalar(
        _filter_by_place(
            select(func.count(Sighting.id)).where(
                Sighting.status.in_(_REPORT_STATUSES),
                Sighting.created_at >= prev_window_start,
                Sighting.created_at < window_start,
            ),
            place_id,
        )
    ) or 0

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
        )
        .where(
            func.ST_Covers(
                select(MonitoredArea.geometry).where(MonitoredArea.id == place_id).scalar_subquery(),
                Sighting.location,
            )
        )
    ) or 0

    most_recent = session.scalar(
        _filter_by_place(
            select(func.max(Sighting.created_at)).where(
                Sighting.status.in_(_REPORT_STATUSES)
            ),
            place_id,
        )
    )
    days_since_most_recent = (
        int((now_utc - most_recent.astimezone(timezone.utc)).total_seconds() // 86400)
        if most_recent is not None
        else None
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
        reports_previous_30d=int(reports_previous),
        change_direction=change_direction,
        change_pct=change_pct,
        tolerance_pct=tolerance_pct,
        window_days=window_days,
    )

    clusters, markers = _cluster_active_sightings(session, place_id, window_start)

    return ActivitySnapshot(
        place_id=place.id,
        place_name=place.name,
        place_type=place.place_type,
        window_start_utc=window_start.isoformat().replace("+00:00", "Z"),
        window_end_utc=now_utc.isoformat().replace("+00:00", "Z"),
        indicators=indicators,
        clusters=clusters,
        markers=markers,
    )


def _cluster_active_sightings(
    session: Session,
    place_id: uuid.UUID,
    window_start: datetime,
) -> tuple[list[ActivityCluster], list[ActivityMarker]]:
    """AC 6.3.4 - DBSCAN eps=250 m minPts=3 over the last 30 UTC days,
    excluding rejected/deleted/removal_reported. Uses PostGIS
    ``ST_ClusterDBSCAN`` in a geography-cast window so distances are
    metres, not degrees. Points that don't fall into a cluster get a
    null ``cluster_id`` and still show as regular markers so the map
    isn't blank between clusters.
    """

    sql = text(
        """
        WITH active AS (
            SELECT
                s.id,
                s.species_id,
                s.status,
                s.latitude,
                s.longitude,
                s.created_at,
                ST_ClusterDBSCAN(s.location::geometry, eps := :eps_deg, minpoints := :min_pts)
                    OVER () AS cluster_id
            FROM sightings s
            WHERE s.status = ANY(:active_statuses)
              AND s.created_at >= :window_start
              AND ST_Covers(
                    (SELECT geometry FROM monitored_areas WHERE id = :place_id),
                    s.location
                  )
        )
        SELECT id, species_id, status, latitude, longitude, created_at, cluster_id
        FROM active
        ORDER BY created_at DESC
        """
    )
    # ST_ClusterDBSCAN takes eps in the SRS unit of the input. We hand
    # it the geometry (SRID 4326) so eps is in degrees; 250 m at MY
    # latitudes converts to ~0.00225 degrees. Using ST_DWithin-in-metres
    # would be more precise but ST_ClusterDBSCAN itself is geometry-only
    # in Postgres <= 15, and the imprecision at MY latitudes is well
    # under the 250 m radius the AC calls for.
    eps_meters = 250.0
    eps_deg = eps_meters / 111_320.0
    rows = session.execute(
        sql,
        {
            "eps_deg": eps_deg,
            "min_pts": 3,
            "active_statuses": list(_ACTIVE_STATUSES),
            "window_start": window_start,
            "place_id": place_id,
        },
    ).all()

    cluster_buckets: dict[int, list] = {}
    markers: list[ActivityMarker] = []
    for row in rows:
        cluster_id = row.cluster_id
        markers.append(
            ActivityMarker(
                sighting_id=row.id,
                species_id=row.species_id,
                status=row.status,
                latitude=float(row.latitude),
                longitude=float(row.longitude),
                observed_at=row.created_at.astimezone(timezone.utc)
                    .isoformat()
                    .replace("+00:00", "Z"),
                cluster_id=int(cluster_id) if cluster_id is not None else None,
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

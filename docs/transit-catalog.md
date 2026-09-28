# Shared transit catalog

The catalog worker fetches one TAGO page per invocation (100 rows), stages pages,
and publishes only a completed scope. Supported data: TAGO bus cities, stops,
routes, route details/headways, ordered route stops, and TAGO subway stations and
weekday/Saturday/Sunday timetables in both directions. Subway uses the official
`SubwayInfo/GetKwrdFndSubwaySttnList` and `GetSubwaySttnAcctoSchdulList` operations.
Timetables are stored as schedules, never presented as real-time observations.

Migration: `202609280002_transit_catalog.sql`. Initially disabled. After deploying
`/api/catalog-worker`, enable the private catalog control and schedule
`smart_metro_private.enqueue_catalog_job()` every 30 seconds. Each completed scope
is due again at the next Korean calendar day. Previously published data remains
available during refresh or provider outages. A complete refresh replaces it.

The collector has a 2,000-request daily budget per TAGO service. Initial nationwide
population can span multiple days. This is a ceiling, not a guarantee all records
can be checked daily within the provider quota. A page-level queue resumes work;
quota/authentication errors pause the affected service. HTTP 429 pauses 30 minutes.

Writes require a hashed, 45-second, single-claim capability issued by the private
scheduler. Worker RPCs cannot access account documents. Public RPCs expose only
public transit metadata. The worker is outside the interactive request mutex and
uses a 6-second upstream deadline plus 5-second storage request deadlines.

Current consumers: city/stop search, nearby map stops, TAGO route matching, and
TAGO headway profiles. Missing catalog scopes retain the authoritative live lookup.
Regional Seoul/Gyeonggi adapters retain their existing daily metadata caches.

Operational checks: inspect scope `checked_at`, `page`, `last_error`, service usage
and `blocked_until`, and the `smart-metro-catalog-worker` cron result. Never print
job capabilities or provider credentials when checking operation.

## Production rollout, 2026-09-28

Migration applied; worker deployed as `2d61a88`. Cron
`smart-metro-catalog-worker` enabled at 30-second intervals. First production
stop-city response published 138 cities and queued their stop lists. This is
initial population in progress, not a completed nationwide inventory. Production
home returned HTTP 200; unauthorized worker POST returned HTTP 401. Final automated
suite: 552 passed at bus rollout.

Subway approval confirmed by the user on 2026-09-28. Migration
`202609280003_subway_catalog.sql` extends only the public metadata allowlist and
seeds station collection. Each station produces six timetable scopes (01/02/03
and U/D). The station-list API has an optional keyword, omitted for full collection.
Map search retains coordinates from Kakao and attaches a TAGO identity only when
station name and line match uniquely. A timetable is not a guarantee of service
and must not override live observations or infer a train's stopping pattern.

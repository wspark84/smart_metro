# Background departure alarms

The confirmed home form enables departure planning for the selected route. Reminder stages are 20, 10, 5 and 3 minutes before leaving home, including the user's walk to the first stop. One-minute and zero-minute alerts are deliberately excluded.

## Official bus headways

Headways are not user inputs. The arrival adapter queries official route metadata in parallel with arrivals, with a four-second metadata timeout and a bounded six-hour per-route cache (failures cached for one minute). A metadata failure does not discard successful live arrivals.

- Gyeonggi: `busrouteservice/v2/getBusRouteInfoItemv2`, weekday/Saturday/Sunday/public-holiday minimum and maximum intervals. [Official fields](https://www.gbis.go.kr/gbis2014/publicService.action?cmd=mBusRouteInfo).
- Seoul: `busRouteInfo/getRouteInfo`, `term` in minutes. [Official service](https://www.data.go.kr/data/15000193/openapi.do).
- TAGO: `BusRouteInfoInqireService/getRouteInfoIem`, `intervaltime`, `intervalsattime`, `intervalsuntime`. [Official service](https://www.data.go.kr/data/15098529/openapi.do).

These route-information services may require separate API approval even when arrival/station services use the same credential. Runtime permission and data availability must be checked after deployment; local fixture tests do not establish production entitlement.

The Korean calendar selects the relevant interval. Missing weekend/holiday fields are not replaced with weekday data. TAGO does not declare a public-holiday interval in the verified contract, so a known holiday without such data disables TAGO extrapolation. A range is displayed as a range and its maximum is used as the labeled estimate interval, not a guaranteed service time. Both frontend planning and background alarms consume the same metadata selector. Legacy manual values and observed bus gaps no longer drive bus extrapolation. Subway's existing observed-gap behavior is unchanged.

## Deployment

1. Apply `202609230001_alarm_worker.sql`. It adds restricted capability RPCs and private tables; it does not change existing document RLS policies. The worker is disabled initially.
2. Deploy the Node server, including `/api/alarm-worker`.
3. Apply `202609230002_alarm_schedule.sql` to install the one-minute Supabase Cron job. It still does no work while disabled.
4. Enable with `update smart_metro_private.alarm_control set enabled=true where singleton;`.
5. Check `cron.job`, `cron.job_run_details` and the private jobs' status timestamps. Never select/log job tokens or pg_net request bodies.

To stop background processing, set the control flag to false and deactivate the named cron job. Foreground processing resumes when the flag is false. No rollback should remove user documents.

## Security and delivery

- PostgreSQL chooses users from saved application settings. The incoming HTTP request cannot select a user.
- Each job carries a 64-hex random capability, stored only as SHA-256 in the private job table. It expires after two minutes and can be claimed once.
- A job can read only its user's application documents. Writes are restricted to alarm/runtime/dispatch documents and device-token invalidation, not trip settings.
- Existing document revisions remain enforced. Outbox and consumed stages are checkpointed before external push delivery.
- Foreground requests become reads when the scheduler is enabled, avoiding duplicate foreground/background execution.
- Estimates remain labeled estimates. Bus anchors with official headways remain usable only on the same Korean calendar date; observed subway gaps retain the 30-minute limit. Journey validation expires after 15 minutes unless refreshed successfully.
- Supabase schedules up to 20 eligible accounts per minute, oldest scheduled first. This is an initial capacity limit, not a general-scale scheduler; increase capacity/shard and load-test before broader launch.
- Minute-level scheduling and network/provider latency mean exact second-level delivery is not guaranteed.
- Physical-device push permission, valid subscription/token, installed-app requirements, and real receipt must be verified separately. A passing server job is not proof of a received phone notification.

## Tests

### Durable bus planning cache

- The existing account-owned `alarm-runtime.transitCache` stores up to 32 route headway profiles and 32 stop/route/direction observations; no new database permission is required.
- The first app or worker lookup each Korean calendar day checks official headway metadata. Subsequent lookups use the saved profile, including after process restart or deployment. Changed values update the change timestamp; unchanged values retain it.
- A failed metadata check retains the previous profile and labels it stale. Failures retry at most once every five minutes so newly approved API access takes effect; successful checks remain daily. Legacy failed cache entries retry once after upgrade.
- TAGO route metadata uses the existing `TAGO_SERVICE_KEY` and the `BusRouteInfoInqireService/getRouteInfoIem` service (separate utilization approval). City code and exact route ID are required; route numbers alone never match across providers.
- Real-time failures and empty replies do not erase the last actual observation. Forecasts add official intervals to that observation, never refresh its timestamp, and never cross into a new date. No observation means no invented forecast.
- Home and alarm planning share the same forecast logic. Estimated rows and notifications explicitly say they are not real-time; actual arrival information supersedes them when available. Cancellations and service end are not guaranteed by headway extrapolation.

`npm test` includes PostgreSQL capability ownership, wrong/replayed/expired tokens, forbidden settings writes, stale revisions, outbox checkpoint ordering, source updates, reminder deduplication, snooze and retry cancellation.
# TAGO headway fallback for Gyeonggi arrivals

When Gyeonggi route metadata fails, the server can use approved TAGO route
metadata without changing the user's real-time arrival provider. It resolves
the regional stop and route from official APIs, then requires matching public
stop number, normalized name, coordinates within 60 metres, a unique passing
route number, and compatible destination names when both are supplied.
Ambiguous or incomplete identities are rejected; TAGO IDs are never inferred.
The additional identity lookup is bounded to six seconds. Successful profiles
use the existing per-account daily durable cache; failures retain the existing
five-minute retry interval. No new environment variable or database migration
is required. TAGO_SERVICE_KEY must have BusRouteInfoInqireService permission.

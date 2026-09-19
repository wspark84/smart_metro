# TAGO station search diagnostics

Temporary server-side diagnostics for the Suwon station-search investigation.
This instrumentation does not change query parameters, retry limits, cache TTLs,
station results, route selections, alarms, or API response shapes.

## Reading Vercel logs

Open the `smart-metro` project's Logs and select the relevant
`GET /api/bus/stations` request. Look for JSON lines with
`component: "tago_station_search"`. Each exact provider search has a random
`searchId`; name-search fallback attempts have separate IDs.

- `search_started`: numeric city code, query kind (`nodeNo` or `nodeNm`) and
  query length. The actual keyword is not recorded by this instrumentation.
- `upstream_page`: validated page number, provider total, page size and row
  count, before station normalization. Emitted only for a real upstream call.
- `search_completed`: returned station count, count with usable map
  coordinates, duration, and `source` (`upstream` or `cache_or_inflight`).
- `search_failed`: failure stage (`cache`, `upstream`, or `normalize`) and
  duration. Existing errors are rethrown unchanged, never replaced by an empty
  successful result. No raw exception text is recorded.

A validated upstream total and row count of zero followed by a returned count
of zero proves that exact query received no matches from TAGO. It does not
prove that the station is absent under every possible name or identifier.
For cached results, find an earlier upstream trace or repeat after the existing
five-minute metadata cache expires. Concurrent waiters share one upstream call.

## Privacy and scope

Only fixed labels, numeric counts, timing, a validated numeric city code and
random per-search IDs are emitted. No API key, upstream URL, free-text keyword,
user/account ID, station name/ID, coordinates, full response, or exception
message/stack is passed to the diagnostic logger. Vercel's own request metadata
is separate from these application logs.

Logging failures are swallowed without affecting search. No extra provider
requests or durable application data writes are added. Remove this temporary
instrumentation after the incident is diagnosed; platform log retention is
managed in Vercel, not in application storage.

## Verification

`node --test --test-isolation=none tests/tago-search-diagnostics.test.mjs`
covers empty/nonempty/paginated responses, missing coordinates, caching,
concurrent calls, logger failures, sensitive input exclusion, malformed data,
and preservation of validation order. Run `npm test` before deployment.

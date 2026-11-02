import test from "node:test";
import assert from "node:assert/strict";
import { applyCommuteSetup, setupSummary, applyTodayAlarm, todayAlarmStatus, applyTrips, buildHomeForecast, handleMobileApi } from "../src/server/mobile-api.mjs";
import { transitQueryForState } from "../src/logic/transit-journey.js";

const base = () => ({ user: { requiredArrivalTime: "09:00", workLocation: { lat: 37.39, lng: 127.11, source: "demo" } },
  commute: { boardingAccessMin: null, stopLocation: null }, live: { provider: "none", bindings: {} },
  schedule: { enabled: true, repeatPreset: "WEEKDAYS", daysOfWeek: [1, 2, 3, 4, 5], snoozeDate: null }, tripSchedules: [] });
const setupPatch = { requiredArrivalTime: "08:50", boardingAccessMin: 7,
  destination: { address: "부산 해운대구 센텀중앙로 79", label: "센텀시티", lat: 35.169, lng: 129.131 },
  boarding: { provider: "subway", stationId: "kakao:123", stationName: "서면", lineName: "부산 1호선", lat: 35.157, lng: 129.059 } };

test("setup applies the same fields as the web home flow", () => {
  const before = base();
  const state = applyCommuteSetup(before, setupPatch);
  assert.equal(before.commute.boardingAccessMin, null, "input is not mutated");
  assert.equal(state.user.requiredArrivalTime, "08:50");
  assert.equal(state.commute.boardingAccessMin, 7);
  assert.equal(state.commute.routingMode, "all-routes");
  assert.deepEqual(state.commute.stopLocation, { lat: 35.157, lng: 129.059 });
  assert.equal(state.live.provider, "subway");
  assert.equal(state.live.lineName, "부산 1호선");
  assert.equal(state.live.routeId, "");
  assert.equal(state.commute.planningBindingKey, JSON.stringify(["subway", "kakao:123", "", ""]));
  assert.equal(transitQueryForState(state).lineName, "부산 1호선");
  const summary = setupSummary(state);
  assert.equal(summary.complete, true);
  assert.equal(summary.boarding.mode, "subway");
  assert.deepEqual(setupSummary(before).missing, ["destination", "boarding", "boardingAccessMin"], "demo destination is not a real setup");
});

test("setup rejects invalid values with Korean messages", () => {
  assert.throws(() => applyCommuteSetup(base(), { requiredArrivalTime: "25:00" }), /HH:MM/);
  assert.throws(() => applyCommuteSetup(base(), { boardingAccessMin: 200 }), /0~180/);
  assert.throws(() => applyCommuteSetup(base(), { destination: { lat: 0, lng: 0 } }), /도착지/);
  assert.throws(() => applyCommuteSetup(base(), { boarding: { provider: "x", stationName: "a", stationId: "1", lat: 37, lng: 127 } }), /출발 정류장/);
  const tago = applyCommuteSetup(base(), { boarding: { provider: "tago", stationId: "BSB1", stationName: "시청", cityCode: "21", lat: 35.18, lng: 129.07 } });
  assert.equal(tago.live.nodeId, "BSB1");
});

test("today alarm toggles the free one-day alarm", () => {
  const now = new Date("2026-10-17T07:00:00+09:00");
  let state = applyTodayAlarm(base(), true, now);
  state.schedule.oneTimeDate = "2026-10-17";
  assert.equal(state.schedule.repeatPreset, "DAILY", "weekend days are allowed for a one-time alarm");
  assert.equal(todayAlarmStatus(state, now).armed, true);
  state = applyTodayAlarm(state, false, now);
  assert.equal(todayAlarmStatus(state, now).armed, false);
  assert.equal(applyTodayAlarm(state, true, now).schedule.snoozeDate, null);
});

test("trip saves validate enabled schedules and keep unchanged ones byte-identical", () => {
  const trip = { id: "t1", name: "출근", enabled: true, requiredArrivalTime: "09:00", boardingAccessMin: 5,
    departure: { location: { lat: 35.157, lng: 129.059 }, live: { provider: "subway", stationId: "kakao:1", stationName: "서면", lineName: "부산 1호선" } },
    destination: { address: "센텀", location: { lat: 35.169, lng: 129.131 } }, daysOfWeek: [1, 2, 3], alarmStartLeadMin: 30, repeatIntervalMin: 5, skipHolidays: true };
  const saved = applyTrips(base(), [trip]);
  assert.equal(saved.tripSchedules[0].departure.live.lineName, "부산 1호선");
  const again = applyTrips(saved, JSON.parse(JSON.stringify(saved.tripSchedules)));
  assert.equal(again.tripSchedules, saved.tripSchedules);
  assert.throws(() => applyTrips(base(), [{ ...trip, destination: null }]), /도착지/);
  assert.throws(() => applyTrips(base(), Array.from({ length: 11 }, (_, i) => ({ ...trip, id: `t${i}` }))), /최대 10개/);
});

test("forecast reports leave time and timetable basis from route options", () => {
  const now = new Date("2026-10-13T08:00:00+09:00");
  const state = applyCommuteSetup(base(), setupPatch);
  const routeId = JSON.stringify(["부산 1호선", "하행", "tago:BSN101:D", "다대포해수욕장", "다대포해수욕장", "시간표"]);
  const automatic = { unverifiedCount: 0, options: [{ id: "o1", fetchedAt: now.toISOString(), verified: true, onboardDurationSec: 25 * 60,
    dailyMetadataDate: "2026-10-13", direction: "하행 · 다대포해수욕장 방면 · 시간표 기준", binding: { provider: "subway", routeNumber: "부산 1호선", routeId },
    snapshot: { arrivalsMin: [10, 20, 30], fetchedAt: now.toISOString(), liveStatus: "live", cacheStatus: "live" } }] };
  const forecast = buildHomeForecast({ state, automatic, now });
  assert.equal(forecast.status, "ready");
  assert.equal(forecast.basis, "timetable");
  // 08:20 boarding + 25 min = 08:45 ≤ 08:50; 08:30 + 25 = 08:55 is late.
  assert.equal(forecast.boardingAt, new Date("2026-10-13T08:20:00+09:00").toISOString());
  assert.equal(forecast.leaveAt, new Date("2026-10-13T08:13:00+09:00").toISOString());
  assert.equal(forecast.leaveInMinutes, 13);
  assert.equal(forecast.rows.find((row) => row.target).minutes, 20);
  assert.equal(buildHomeForecast({ state: base(), automatic, now }).status, "setup-required");
  assert.equal(buildHomeForecast({ state, automatic: null, now }).status, "no-route");
});

function harness({ state = base(), subscription = { active: false } } = {}) {
  const sent = []; let stored = state;
  const deps = { sendJson: (_r, status, body) => sent.push({ status, body }), isTrustedMutation: (req) => !req.headers.origin,
    readJsonBody: async (req) => req.body, assertTripScheduleChange: (prev, next, active) => {
      if (!active && JSON.stringify(prev.tripSchedules || []) !== JSON.stringify(next.tripSchedules || [])) throw Object.assign(new Error("구독 필요"), { statusCode: 402, code: "SUBSCRIPTION_REQUIRED" }); },
    authenticate: async (req) => req.headers.authorization ? { user: { id: "u1" } } : null,
    subscriptionStatus: async () => subscription, now: () => new Date("2026-10-13T08:00:00+09:00"),
    withUserDocuments: async (_auth, work) => work({ readState: async () => stored, saveState: async (next) => (stored = { ...next, schedule: { ...next.schedule, oneTimeDate: "2026-10-13" } }), loadOptions: async () => ({ options: [] }) }) };
  const call = (method, url, body, headers = { authorization: "Bearer t" }) => handleMobileApi({ method, url, body, headers }, {}, deps).then(() => sent.at(-1));
  return { call, get state() { return stored; } };
}

test("mobile HTTP layer enforces auth, origin, subscription and saves through the server", async () => {
  const h = harness();
  assert.equal((await h.call("GET", "/api/mobile/home", null, {})).status, 401);
  assert.equal((await h.call("POST", "/api/mobile/setup", setupPatch, { authorization: "Bearer t", origin: "https://evil" })).status, 403);
  assert.equal((await h.call("GET", "/api/mobile/nope")).status, 404);
  const saved = await h.call("POST", "/api/mobile/setup", setupPatch);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.setup.complete, true);
  assert.equal(saved.body.today.armed, true);
  assert.equal(saved.body.forecast.status, "no-route");
  const off = await h.call("POST", "/api/mobile/today", { enabled: false });
  assert.equal(off.body.today.armed, false);
  const trip = await h.call("PUT", "/api/mobile/trips", { trips: [{ id: "a", name: "출근", enabled: false }] });
  assert.equal(trip.status, 402);
  assert.equal(trip.body.code, "SUBSCRIPTION_REQUIRED");
  const bad = await h.call("POST", "/api/mobile/setup", { boardingAccessMin: -1 });
  assert.equal(bad.status, 400);
  const paid = harness({ subscription: { active: true } });
  const ok = await paid.call("PUT", "/api/mobile/trips", { trips: [{ id: "a", name: "출근", enabled: false }] });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.trips.length, 1);
});

test("repeat is paid, mirrors the home setup and replaces the free home alarm", async () => {
  const { applySetupRequest, repeatSummary, REPEAT_TRIP_ID } = await import("../src/server/mobile-api.mjs");
  const ready = applyCommuteSetup(base(), setupPatch);
  assert.throws(() => applySetupRequest(ready, { repeat: { enabled: true } }, { active: false }), (error) => error.code === "SUBSCRIPTION_REQUIRED" && error.statusCode === 402);
  assert.throws(() => applySetupRequest(base(), { repeat: { enabled: true } }, { active: true }), /출근길 설정/);
  const on = applySetupRequest(ready, { repeat: { enabled: true, days: [5, 1, 1, 3] } }, { active: true });
  const trip = on.tripSchedules.find((item) => item.id === REPEAT_TRIP_ID);
  assert.equal(trip.enabled, true);
  assert.deepEqual(trip.daysOfWeek, [1, 3, 5]);
  assert.equal(trip.skipHolidays, true, "holidays are skipped by default");
  assert.equal(trip.departure.live.lineName, "부산 1호선");
  assert.equal(on.schedule.enabled, false, "free home alarm off while repeat is on");
  assert.deepEqual(repeatSummary(on), { enabled: true, days: [1, 3, 5], skipHolidays: true });
  // Later setup edits keep the repeat trip in step without a new purchase check.
  const moved = applySetupRequest(on, { requiredArrivalTime: "09:30" }, { active: true });
  assert.equal(moved.tripSchedules.find((item) => item.id === REPEAT_TRIP_ID).requiredArrivalTime, "09:30");
  // A lapsed subscription turns repeat off instead of blocking the edit.
  const lapsed = applySetupRequest(on, { requiredArrivalTime: "09:10" }, { active: false });
  assert.equal(repeatSummary(lapsed).enabled, false);
  assert.equal(lapsed.schedule.enabled, true);
  // Unknown status (lookup failed) never silently disables it.
  assert.equal(repeatSummary(applySetupRequest(on, { requiredArrivalTime: "09:10" }, { active: false, unknown: true })).enabled, true);
  assert.throws(() => applySetupRequest(ready, { repeat: { enabled: true, days: [] } }, { active: true }), /요일/);
});

test("today status and departed follow the repeat days, holidays and pause", async () => {
  const { applySetupRequest } = await import("../src/server/mobile-api.mjs");
  const on = applySetupRequest(applyCommuteSetup(base(), setupPatch), { repeat: { enabled: true, days: [1, 2, 3, 4, 5] } }, { active: true });
  const monday = new Date("2026-10-12T07:00:00+09:00"), saturday = new Date("2026-10-17T07:00:00+09:00");
  assert.equal(todayAlarmStatus(on, monday).armed, true);
  assert.equal(todayAlarmStatus(on, saturday).armed, false);
  assert.equal(todayAlarmStatus({ ...on, officialHolidays: [{ date: "2026-10-12" }] }, monday).armed, false, "공휴일에는 쉬어요");
  const paused = applyTodayAlarm(on, false, monday);
  assert.equal(todayAlarmStatus(paused, monday).armed, false);
  assert.equal(todayAlarmStatus(paused, monday).departedToday, true);
  assert.equal(todayAlarmStatus(paused, new Date("2026-10-13T07:00:00+09:00")).armed, true, "pause lasts one day");
  assert.equal(todayAlarmStatus(applyTodayAlarm(paused, true, monday), monday).armed, true);
});

test("stop lookups require login, are throttled and hide upstream errors", async () => {
  const sent = [];
  const deps = { sendJson: (_res, status, body) => sent.push({ status, body }), isTrustedMutation: () => true,
    authenticate: async () => ({ user: { id: "u1" } }), lookupThrottle: () => ({ ok: true }),
    findNearbyStops: async ({ lat, lng }) => ({ stops: [{ key: "seoul:1", lat: Number(lat), lng: Number(lng) }] }),
    describeStop: async () => { throw new Error("raw upstream secret"); } };
  await handleMobileApi({ method: "GET", url: "/api/mobile/stops/nearby?lat=37.5&lng=127.0" }, {}, deps);
  assert.equal(sent[0].status, 200);
  assert.equal(sent[0].body.stops[0].key, "seoul:1");
  await handleMobileApi({ method: "GET", url: "/api/mobile/stops/describe?provider=seoul&arsId=1" }, {}, deps);
  assert.equal(sent[1].status, 503);
  assert.doesNotMatch(sent[1].body.error, /secret/);
  await handleMobileApi({ method: "GET", url: "/api/mobile/stops/nearby?lat=37.5&lng=127.0" }, {}, { ...deps, lookupThrottle: () => ({ ok: false }) });
  assert.equal(sent[2].status, 429);
  await handleMobileApi({ method: "GET", url: "/api/mobile/stops/nearby?lat=37.5&lng=127.0" }, {}, { ...deps, authenticate: async () => null });
  assert.equal(sent[3].status, 401);
});

test("rows centre on the recommended train and keep the timetable label of a fallback", () => {
  const now = new Date("2026-11-02T19:27:00+09:00");
  const state = applyCommuteSetup(base(), { ...setupPatch, requiredArrivalTime: "22:07",
    boarding: { provider: "subway", stationId: "kakao:1", stationName: "광교중앙", lineName: "신분당선", lat: 37.288, lng: 127.051 },
    destination: { address: "판교역", label: "판교역", lat: 37.394, lng: 127.111 } });
  const routeId = JSON.stringify(["1077", "상행", "1077006818", "상현", "신사", "일반"]);
  const arrivals = Array.from({ length: 30 }, (_, i) => 3 + i * 6);
  const automatic = { unverifiedCount: 0, options: [{ id: "o1", fetchedAt: now.toISOString(), verified: true, onboardDurationSec: 21 * 60,
    dailyMetadataDate: "2026-11-02", direction: "상행 · 상현 방면", binding: { provider: "subway", routeNumber: "신분당선", routeId },
    snapshot: { arrivalsMin: arrivals, fetchedAt: now.toISOString(), liveStatus: "ready", cacheStatus: "live", basis: "timetable" } }] };
  const forecast = buildHomeForecast({ state, automatic, now });
  assert.equal(forecast.status, "ready");
  assert.equal(forecast.basis, "timetable");
  assert.ok(forecast.leaveInMinutes > 60, "a 22:07 arrival does not make you leave now");
  const targetIndex = forecast.rows.findIndex((row) => row.target);
  assert.equal(targetIndex, 1, "one train before the recommended one, then later ones");
  assert.equal(forecast.rows[2].onTime, false);
  assert.ok(forecast.rows.every((row) => row.basis === "timetable"));
  assert.ok(forecast.slackMinutes >= 0 && forecast.slackMinutes < 6, "arrives a few minutes before 22:07");
  assert.ok(Date.parse(forecast.arriveAt) <= Date.parse("2026-11-02T22:07:00+09:00"));
  assert.ok(forecast.rows[0].slackMinutes > forecast.slackMinutes, "earlier train leaves more slack");
});

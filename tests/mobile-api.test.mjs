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

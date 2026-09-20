import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLateRisk } from "../src/logic/commute.js";
import { projectLiveArrivals } from "../src/logic/live-arrivals.js";
import { composeAlertCopy } from "../src/logic/notification-engine.js";
import { transitQueryForState, transitQueryKey, resolveJourneyDuration } from "../src/logic/transit-journey.js";
import { normalizeTransitRoutes, fetchTransitRoutes, refreshTransitJourney } from "../src/server/transit-providers.mjs";
import { buildAlarmPlan } from "../src/server/alarm-plan.mjs";
import { DEFAULT_STATE } from "../src/state.js";
import { projectDomainSnapshot, applyDomainSnapshotToState } from "../src/domain-model.js";

const now = new Date("2026-09-10T08:00:00+09:00");
const step = (type, time, stops = [], vehicles = []) => ({ properties: { type, time,
  stops: stops.map((name) => ({ name })), vehicles: vehicles.map((name) => ({ name, type: "일반" })), guidance: "테스트 경로" } });
const query = { stopLocation: { lat: 37.1, lng: 127.1 }, workLocation: { lat: 37.2, lng: 127.2 },
  stationName: "선택정류장", routeNumber: "100", provider: "gyeonggi", stationId: "123", routeId: "456", order: "" };
const payload = { status: "OK", routes: [{ properties: { totalTime: 9999 }, steps: [
  step("WALKING", 600), step("BUS", 2400, ["선택정류장", "다음정류장"], ["100"]), step("WALKING", 300),
] }] };
const normalized = () => normalizeTransitRoutes(payload, query, now.toISOString());
const stateWithJourney = () => {
  const state = structuredClone(DEFAULT_STATE);
  state.live = { ...state.live, ...query, snapshot: { lineNumber: "100", arrivalsMin: [5, 12, 20], fetchedAt: now.toISOString() } };
  state.commute.stopLocation = query.stopLocation;
  state.user.workLocation = query.workLocation;
  state.user.requiredArrivalTime = "09:00";
  state.schedule.startTime = "08:00";
  state.schedule.endTime = "08:03";
  state.commute.transitJourney = { ...normalized().routes[0], boardingConfirmed: true };
  return state;
};

test("legacy automatic walking estimate is not used as manually entered access time", () => {
  const evaluate = (walk) => evaluateLateRisk({ requiredArrivalTime: "09:00", now,
    route: { homeToStopWalkMin: walk, onboardToDestinationMin: 45 }, busArrivalsMin: [2, 20] });
  assert.deepEqual(evaluate(0), evaluate(90));
  assert.equal(evaluate(90).urgency, "MUST_CATCH");
});

test("selects the last on-time service from all returned ETAs, not the first two", () => {
  const risk = evaluateLateRisk({ requiredArrivalTime: "09:00", now,
    route: { onboardToDestinationMin: 40 }, busArrivalsMin: [26, 5, 12, 20] });
  assert.equal(risk.results.length, 4);
  assert.equal(risk.targetResult.arrivalMinutes, 20);
  assert.deepEqual(risk.notificationArrivalsMin, [20, 26]);
  assert.equal(risk.lastChanceConfirmed, true);
  assert.equal(risk.targetResult.deltaMinutes, 0);
});

test("one known on-time service never proves a last chance", () => {
  const risk = evaluateLateRisk({ requiredArrivalTime: "09:00", now,
    route: { onboardToDestinationMin: 40 }, busArrivalsMin: [20] });
  assert.equal(risk.lastChanceConfirmed, false);
  assert.match(risk.message, /아직 확인할 수 없습니다/);
});

test("already late message does not say catching this bus prevents lateness", () => {
  const risk = evaluateLateRisk({ requiredArrivalTime: "09:00", now,
    route: { onboardToDestinationMin: 65 }, busArrivalsMin: [2, 20] });
  const copy = composeAlertCopy({ routeNumber: "100", arrivalsMin: risk.notificationArrivalsMin,
    urgency: risk.urgency, riskLevel: risk.targetResult.level, riskMessage: risk.message });
  assert.equal(risk.lastChanceConfirmed, false);
  assert.doesNotMatch(copy.spokenText, /놓치면 지각이다/);
  assert.match(copy.spokenText, /타도 목적지에/);
});

test("missing journey duration keeps real ETA but prevents risk claims", () => {
  const risk = evaluateLateRisk({ requiredArrivalTime: "09:00", now,
    route: { durationAvailable: false, onboardToDestinationMin: null }, busArrivalsMin: [5] });
  assert.equal(risk.targetResult.arrivalMinutes, 5);
  assert.equal(risk.targetResult.arriveWorkAt, null);
  assert.equal(risk.urgency, "UNKNOWN");
});

test("live ETA projection preserves more than two services", () => {
  assert.deepEqual(projectLiveArrivals({ arrivalsMin: [2, 5, 9, 15], fetchedAt: now.toISOString() }, now), [2, 5, 9, 15]);
});

test("Kakao normalization excludes access walking and does not add totalTime to first ETA", () => {
  const route = normalized().routes[0];
  assert.equal(route.onboardDurationSec, 2700);
  assert.equal(route.excludedAccessWalkSec, 600);
  assert.equal(route.compatible, true);
  assert.equal(route.boardingConfirmed, false);
});

test("transfer and final walking segments remain in the journey estimate", () => {
  const route = normalizeTransitRoutes({ status: "OK", routes: [{ steps: [
    step("BUS", 600, ["선택정류장", "환승지점"], ["100"]), step("WALKING", 180),
    step("SUBWAY", 1200, ["환승역", "하차역"], ["2호선"]), step("WALKING", 300),
  ] }] }, query).routes[0];
  assert.equal(route.onboardDurationSec, 2280);
  assert.equal(route.transfers, 1);
});

test("a different stop, wrong bus, or unconnected subway cannot be selected for live alarms", () => {
  assert.equal(normalizeTransitRoutes(payload, { ...query, stationName: "다른정류장" }).routes[0].compatible, false);
  assert.equal(normalizeTransitRoutes(payload, { ...query, routeNumber: "200" }).routes[0].compatible, false);
  const subway = { status: "OK", routes: [{ steps: [step("SUBWAY", 1800, ["선택정류장", "다음역"], ["100"])] }] };
  assert.equal(normalizeTransitRoutes(subway, query).routes[0].compatible, false);
});

test("invalid/missing segment durations never become a zero-minute route", () => {
  const invalid = structuredClone(payload);
  invalid.routes[0].steps[1].properties.time = null;
  assert.deepEqual(normalizeTransitRoutes(invalid, query).routes, []);
  assert.throws(() => normalizeTransitRoutes({ status: "NO_RESULTS" }, query), /NO_RESULTS/);
});

test("Kakao request uses selected stop, destination, REST authorization and no home coordinate", async () => {
  let called = false;
  await fetchTransitRoutes(query, { KAKAO_TRANSIT_REST_API_KEY: "fixture-only" }, async (url, options) => {
    called = true;
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, "https://dapi.kakao.com/v2/routing/publictraffic");
    assert.equal(parsed.searchParams.get("start_x"), "127.1");
    assert.equal(parsed.searchParams.get("end_y"), "37.2");
    assert.equal(options.headers.Authorization, "KakaoAK fixture-only");
    return { ok: true, json: async () => payload };
  });
  assert.equal(called, true);
  await assert.rejects(fetchTransitRoutes(query, {}, async () => assert.fail("must not call without key")), /KAKAO/);
});

test("journey requires explicit boarding confirmation and expires after fifteen minutes", () => {
  const state = stateWithJourney();
  assert.equal(resolveJourneyDuration(state, now).onboardToDestinationMin, 45);
  assert.equal(resolveJourneyDuration(state, new Date(now.getTime() + 900001)).durationAvailable, false);
  state.commute.transitJourney.boardingConfirmed = false;
  assert.equal(resolveJourneyDuration(state, now).durationAvailable, false);
});

test("changing destination or binding invalidates the saved journey but changing home does not", () => {
  const state = stateWithJourney();
  const key = transitQueryKey(transitQueryForState(state));
  state.user.homeLocation = null;
  assert.equal(transitQueryKey(transitQueryForState(state)), key);
  state.user.workLocation = { lat: 37.8, lng: 127.8 };
  assert.equal(resolveJourneyDuration(state, now).durationAvailable, false);
  const other = stateWithJourney();
  other.live.order = "30";
  assert.equal(resolveJourneyDuration(other, now).durationAvailable, false);
});

test("journey selection survives domain storage and drives server alarm target", () => {
  const state = stateWithJourney();
  const restored = applyDomainSnapshotToState(projectDomainSnapshot(state), state);
  assert.equal(restored.commute.transitJourney.id, state.commute.transitJourney.id);
  const trigger = buildAlarmPlan(restored, now).allTriggers[0];
  assert.deepEqual(trigger.observedArrivalsMin, [5, 12, 20]);
  assert.deepEqual(trigger.arrivalsMin, [12, 20]);
  assert.equal(trigger.lastChanceConfirmed, true);
  assert.match(trigger.notificationSpec.title, /12분 후/);
  assert.equal(trigger.arrivalAtWork, "2026-09-09T23:57:00.000Z");
});

test("manual access time survives account storage and reaches server alarm and TTS", () => {
  const state=stateWithJourney();state.commute.boardingAccessMin=7;
  const restored=applyDomainSnapshotToState(projectDomainSnapshot(state),state);
  assert.equal(restored.commute.boardingAccessMin,7);
  const trigger=buildAlarmPlan(restored,now).allTriggers[0];
  assert.match(trigger.message,/5분 안에 출발해야/);
  assert.match(trigger.notificationSpec.body,/5분 안에 출발해야/);
  assert.match(trigger.notificationSpec.spokenText,/5분 안에 출발해야/);
  assert.equal(trigger.arrivalAtWork,"2026-09-09T23:57:00.000Z");
});

test("server refresh preserves selection only for identical route identity and fails closed after expiry", async () => {
  const state = stateWithJourney();
  const later = new Date(now.getTime() + 6 * 60_000);
  const refreshed = await refreshTransitJourney(state, later, async () => normalizeTransitRoutes(payload, query, later.toISOString()));
  assert.equal(refreshed.commute.transitJourney.boardingConfirmed, true);
  assert.equal(refreshed.commute.transitJourney.fetchedAt, later.toISOString());
  const noRoute = await refreshTransitJourney(state, later, async () => ({ routes: [] }));
  assert.equal(noRoute.commute.transitJourney, null);
  const failed = await refreshTransitJourney(state, new Date(now.getTime() + 20 * 60_000), async () => { throw Error("offline"); });
  assert.equal(resolveJourneyDuration(failed, new Date(now.getTime() + 20 * 60_000)).durationAvailable, false);
});

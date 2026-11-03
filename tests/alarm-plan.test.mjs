import test from "node:test";
import assert from "node:assert/strict";

import { buildAlarmPlan } from "../src/server/alarm-plan.mjs";
import { DEFAULT_STATE } from "../src/state.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("buildAlarmPlan returns remaining weekday triggers and the next trigger entry", () => {
  const state = clone(DEFAULT_STATE);
  state.schedule.startTime = "07:00";
  state.schedule.endTime = "07:12";
  state.schedule.repeatIntervalMin = 3;
  state.schedule.repeatPreset = "WEEKDAYS";
  state.schedule.daysOfWeek = [1, 2, 3, 4, 5];
  state.meta.simulationStartedAt = "2026-04-21T06:50:00+09:00";

  const plan = buildAlarmPlan(state, new Date("2026-04-21T07:04:00+09:00"));

  assert.equal(plan.todayStatus.firing, true);
  assert.equal(plan.totalTriggers, 5);
  assert.equal(plan.remainingTriggers, 3);
  assert.equal(plan.allTriggers.length, 5);
  assert.equal(plan.triggers[0].notificationSpec.riskLevel, "GREEN");
  assert.equal(plan.nextTrigger.triggerAt, plan.triggers[0].triggerAt);
});

test("buildAlarmPlan prefers the saved commute bus ride minutes over the stop-library default", () => {
  const state = clone(DEFAULT_STATE);
  state.schedule.startTime = "07:00";
  state.schedule.endTime = "07:00";
  state.schedule.repeatIntervalMin = 3;
  state.user.requiredArrivalTime = "08:02";
  const baselineState = clone(state);
  state.commute.busRideMin = 55;
  const baseline = buildAlarmPlan(baselineState, new Date("2026-04-21T07:00:00+09:00"));
  const plan = buildAlarmPlan(state, new Date("2026-04-21T07:00:00+09:00"));

  assert.equal(baseline.triggers[0].riskLevel, "YELLOW");
  assert.equal(plan.triggers[0].riskLevel, "ORANGE");
});

test("buildAlarmPlan adds one stability precheck before the morning window for high-watch routes", () => {
  const state = clone(DEFAULT_STATE);
  state.schedule.startTime = "07:00";
  state.schedule.endTime = "07:06";
  state.schedule.repeatIntervalMin = 3;
  state.schedule.repeatPreset = "WEEKDAYS";
  state.schedule.daysOfWeek = [1, 2, 3, 4, 5];

  const plan = buildAlarmPlan(
    state,
    new Date("2026-04-21T06:45:00+09:00"),
    {
      accuracyRuntime: {
        lastHistoricalBiasLevel: "high",
        lastHistoricalBiasRouteTraceCount: 4,
        lastHistoricalBiasWeekdayTraceCount: 2,
      },
    },
  );

  assert.equal(plan.precheckTriggerCount, 1);
  assert.equal(plan.totalTriggers, 4);
  assert.equal(plan.nextTrigger?.triggerKind, "stability-precheck");
  assert.equal(plan.nextTrigger?.stabilityPrecheckLeadMin, 10);
  assert.equal(plan.stabilityWatch.level, "high");
  assert.match(plan.nextTrigger?.notificationSpec.title || "", /^도착정보 사전 점검 · /);
  const firstMainAlarm = plan.allTriggers.find((trigger) => trigger.triggerKind === "alarm");
  assert.equal(firstMainAlarm?.deliveryPriorityClass, "boosted");
  assert.equal(firstMainAlarm?.deliveryPriorityReason, "high-watch-first-main-alarm");
  assert.equal(firstMainAlarm?.notificationSpec?.deliveryPriorityClass, "boosted");
  assert.equal(firstMainAlarm?.notificationSpec?.reinforcedDelivery, true);
});

test("buildAlarmPlan stops adding the stability precheck after the normal window starts", () => {
  const state = clone(DEFAULT_STATE);
  state.schedule.startTime = "07:00";
  state.schedule.endTime = "07:06";
  state.schedule.repeatIntervalMin = 3;

  const plan = buildAlarmPlan(
    state,
    new Date("2026-04-21T07:01:00+09:00"),
    {
      accuracyRuntime: {
        lastHistoricalBiasLevel: "high",
        lastHistoricalBiasRouteTraceCount: 4,
        lastHistoricalBiasWeekdayTraceCount: 2,
      },
    },
  );

  assert.equal(plan.precheckTriggerCount, 0);
  assert.equal(plan.totalTriggers, 3);
  assert.notEqual(plan.nextTrigger?.triggerKind, "stability-precheck");
});

test("buildAlarmPlan skips weekends for weekday schedules", () => {
  const state = clone(DEFAULT_STATE);
  state.schedule.repeatPreset = "WEEKDAYS";
  state.schedule.daysOfWeek = [1, 2, 3, 4, 5];

  const plan = buildAlarmPlan(state, new Date("2026-04-25T07:00:00+09:00"));

  assert.equal(plan.todayStatus.firing, false);
  assert.equal(plan.remainingTriggers, 0);
  assert.equal(plan.nextTrigger, null);
});

test("buildAlarmPlan uses the saved live snapshot as the source when it matches the primary line", () => {
  const state = clone(DEFAULT_STATE);
  state.live.snapshot = {
    lineNumber: "1002",
    arrivalsMin: [4, 16],
    fetchedAt: "2026-04-21T07:00:00+09:00",
    servedAt: "2026-04-21T07:00:00+09:00",
  };
  state.schedule.startTime = "07:00";
  state.schedule.endTime = "07:06";
  state.schedule.repeatIntervalMin = 3;

  const plan = buildAlarmPlan(state, new Date("2026-04-21T07:00:00+09:00"));

  assert.equal(plan.triggers[0].source, "live-snapshot");
  assert.deepEqual(plan.triggers[0].observedArrivalsMin, [4, 16]);
  assert.deepEqual(plan.triggers[0].arrivalsMin, [16]);
});

test("buildAlarmPlan adds a live ETA warning when comparable providers are sharply split", () => {
  const state = clone(DEFAULT_STATE);
  state.live.snapshot = {
    lineNumber: "1002",
    arrivalsMin: [4, 16],
    fetchedAt: "2026-04-21T07:00:00+09:00",
    servedAt: "2026-04-21T07:00:00+09:00",
  };
  state.schedule.startTime = "07:00";
  state.schedule.endTime = "07:06";
  state.schedule.repeatIntervalMin = 3;

  const plan = buildAlarmPlan(
    state,
    new Date("2026-04-21T07:00:00+09:00"),
    {
      accuracyRuntime: {
        lastObservedDisagreementLevel: "diverged",
        lastObservedEtaSpreadMin: 5,
        lastObservedComparableProviderCount: 2,
      },
    },
  );

  assert.match(plan.triggers[0].notificationSpec.body, /실시간 도착 정보가 지금 5분 정도 서로 다르게 들어오고 있습니다/);
  assert.equal(plan.triggers[0].notificationSpec.liveEtaDisagreementLevel, "diverged");
  assert.equal(plan.triggers[0].notificationSpec.accuracySpreadMin, 5);
});

test("buildAlarmPlan tightens late-risk scoring when live ETA spread is sharply split", () => {
  const state = clone(DEFAULT_STATE);
  state.commute.selectedLineIds = ["701"];
  state.commute.primaryLineId = "701";
  state.commute.busRideMin = 41;
  state.user.requiredArrivalTime = "09:08";
  state.live.snapshot = {
    lineNumber: "701",
    arrivalsMin: [12, 19],
    fetchedAt: "2026-04-21T08:00:00+09:00",
    servedAt: "2026-04-21T08:00:00+09:00",
  };
  state.schedule.startTime = "08:00";
  state.schedule.endTime = "08:06";
  state.schedule.repeatIntervalMin = 3;

  const baselinePlan = buildAlarmPlan(state, new Date("2026-04-21T08:00:00+09:00"));
  const conservativePlan = buildAlarmPlan(
    state,
    new Date("2026-04-21T08:00:00+09:00"),
    {
      accuracyRuntime: {
        lastObservedDisagreementLevel: "diverged",
        lastObservedEtaSpreadMin: 5,
        lastObservedComparableProviderCount: 2,
      },
    },
  );

  assert.equal(baselinePlan.triggers[0].urgency, "RELAXED");
  assert.equal(conservativePlan.triggers[0].etaRiskBufferMin, 2);
  assert.equal(conservativePlan.triggers[0].liveEtaGuardMode, "conservative");
  assert.equal(conservativePlan.triggers[0].urgency, "MUST_CATCH");
  assert.equal(conservativePlan.triggers[0].riskLevel, "YELLOW");
  assert.equal(conservativePlan.triggers[0].notificationSpec.accuracyRiskBufferMin, 2);
  assert.match(conservativePlan.triggers[0].notificationSpec.body, /2분 더 일찍 움직이는 기준으로 계산 중입니다/);
});

test("buildAlarmPlan carries historical conservative bias into the notification copy", () => {
  const state = clone(DEFAULT_STATE);
  state.live.snapshot = {
    lineNumber: "1002",
    arrivalsMin: [4, 16],
    fetchedAt: "2026-04-21T07:00:00+09:00",
    servedAt: "2026-04-21T07:00:00+09:00",
  };
  state.schedule.startTime = "07:00";
  state.schedule.endTime = "07:06";
  state.schedule.repeatIntervalMin = 3;

  const plan = buildAlarmPlan(
    state,
    new Date("2026-04-21T07:00:00+09:00"),
    {
      accuracyRuntime: {
        lastHistoricalBiasLevel: "high",
        lastHistoricalBiasRouteTraceCount: 4,
        lastHistoricalBiasWeekdayTraceCount: 2,
      },
    },
  );

  assert.equal(plan.triggers[0].notificationSpec.historicalBiasLevel, "high");
  assert.equal(plan.triggers[0].notificationSpec.historicalBiasRouteTraceCount, 4);
  assert.equal(plan.triggers[0].notificationSpec.historicalBiasWeekdayTraceCount, 2);
  assert.match(plan.triggers[0].notificationSpec.body, /최근 7일 동안 4번 흔들렸고, 같은 요일 시간대에도 2번 흔들렸습니다/);
});

test("buildAlarmPlan becomes conservative even on a mild live split when recent route history is high", () => {
  const state = clone(DEFAULT_STATE);
  state.commute.selectedLineIds = ["701"];
  state.commute.primaryLineId = "701";
  state.live.snapshot = {
    lineNumber: "701",
    arrivalsMin: [12, 19],
    fetchedAt: "2026-04-21T08:00:00+09:00",
    servedAt: "2026-04-21T08:00:00+09:00",
  };
  state.schedule.startTime = "08:00";
  state.schedule.endTime = "08:06";
  state.schedule.repeatIntervalMin = 3;

  const plan = buildAlarmPlan(
    state,
    new Date("2026-04-21T08:00:00+09:00"),
    {
      accuracyRuntime: {
        lastObservedDisagreementLevel: "watch",
        lastObservedEtaSpreadMin: 2,
        lastObservedComparableProviderCount: 2,
        lastHistoricalBiasLevel: "high",
        lastHistoricalBiasRouteTraceCount: 4,
        lastHistoricalBiasWeekdayTraceCount: 2,
      },
    },
  );

  assert.equal(plan.triggers[0].liveEtaGuardMode, "conservative");
  assert.equal(plan.triggers[0].etaRiskBufferMin, 1);
  assert.equal(plan.triggers[0].notificationSpec.accuracyRiskBufferMin, 1);
  assert.match(plan.triggers[0].notificationSpec.body, /평소에도 흔들리는 구간이라 지금은 더 보수적으로 보고 있습니다/);
});

test("chosen alarm times add 지금 출발 and 지각 위험 alerts that outlive the leave time", async () => {
  const { buildAlarmPlan } = await import("../src/server/alarm-plan.mjs");
  const { reconcileAlarmRuntime, createAlarmRuntimeState } = await import("../src/server/alarm-runtime.mjs");
  const { applyCommuteSetup } = await import("../src/server/mobile-api.mjs");
  const now = new Date("2026-11-03T08:00:00+09:00");
  const state = applyCommuteSetup({ user: { requiredArrivalTime: "09:00" }, commute: {}, live: { provider: "none" },
    schedule: { enabled: true, repeatPreset: "DAILY", daysOfWeek: [0,1,2,3,4,5,6], oneTimeDate: "2026-11-03", snoozeDate: null },
    notification: {}, holidayDates: [], officialHolidays: [], tripSchedules: [] }, {
    requiredArrivalTime: "09:00", boardingAccessMin: 5,
    destination: { address: "판교역", label: "판교역", lat: 37.394, lng: 127.111 },
    boarding: { provider: "tago", stationId: "GGB1", nodeId: "GGB1", cityCode: "31010", stationName: "정류장", lat: 37.28, lng: 127.05 } });
  const routeId = "R7";
  const options = [{ id: "o1", fetchedAt: now.toISOString(), verified: true, onboardDurationSec: 30 * 60, dailyMetadataDate: "2026-11-03",
    direction: "판교 방면", binding: { provider: "tago", routeNumber: "7", routeId },
    snapshot: { arrivalsMin: [20, 40], fetchedAt: now.toISOString(), liveStatus: "ready", cacheStatus: "live" } }];
  const { transitQueryForState, transitQueryKey } = await import("../src/logic/transit-journey.js");
  state.commute.automaticOptions = { queryKey: transitQueryKey(transitQueryForState(state)), options };
  const plan = buildAlarmPlan(state, now);
  const kinds = plan.allTriggers.map((t) => [t.triggerKind, t.leadMinutes]);
  assert.deepEqual(kinds, [["departure", 10], ["departure", 5], ["leave-now", 0], ["late", 0]]);
  const leaveNow = plan.allTriggers.find((t) => t.triggerKind === "leave-now");
  const late = plan.allTriggers.find((t) => t.triggerKind === "late");
  assert.equal(Date.parse(leaveNow.triggerAt), Date.parse(plan.departureAt));
  assert.equal(Date.parse(late.triggerAt), Date.parse(plan.departureAt) + 2 * 60_000);
  assert.match(late.notificationSpec.title, /바로 뛰어나가세요/);
  // The server refreshes arrivals every tick; replay that with a fresh snapshot.
  const at = (time) => {
    const elapsed = (time.getTime() - now.getTime()) / 60_000;
    const fresh = structuredClone(state);
    fresh.commute.automaticOptions.options[0].snapshot = { arrivalsMin: [20 - elapsed, 40 - elapsed], fetchedAt: time.toISOString(), liveStatus: "ready", cacheStatus: "live" };
    fresh.commute.automaticOptions.options[0].fetchedAt = time.toISOString();
    return fresh;
  };
  // At the leave time the regular stages have stopped, but 지금 출발 still rings.
  const leaveTime = new Date(Date.parse(plan.departureAt) + 10_000);
  const atLeave = reconcileAlarmRuntime(at(leaveTime), createAlarmRuntimeState(), leaveTime);
  assert.deepEqual(atLeave.dueEvents.map((e) => e.triggerKind), ["leave-now"]);
  const lateTime = new Date(Date.parse(late.triggerAt) + 10_000);
  const atLate = reconcileAlarmRuntime(at(lateTime), atLeave.runtime, lateTime);
  assert.deepEqual(atLate.dueEvents.map((e) => e.triggerKind), ["late"]);
});

test("지각 위험 still rings after the leave time without fetching arrivals again", async () => {
  const { buildAlarmPlan } = await import("../src/server/alarm-plan.mjs");
  const { reconcileAlarmRuntime, createAlarmRuntimeState } = await import("../src/server/alarm-runtime.mjs");
  const { applyCommuteSetup } = await import("../src/server/mobile-api.mjs");
  const { transitQueryForState, transitQueryKey } = await import("../src/logic/transit-journey.js");
  const now = new Date("2026-11-03T08:00:00+09:00");
  const state = applyCommuteSetup({ user: { requiredArrivalTime: "09:00" }, commute: {}, live: { provider: "none" },
    schedule: { enabled: true, repeatPreset: "DAILY", daysOfWeek: [0,1,2,3,4,5,6], oneTimeDate: "2026-11-03", snoozeDate: null },
    notification: {}, holidayDates: [], officialHolidays: [], tripSchedules: [] }, {
    requiredArrivalTime: "09:00", boardingAccessMin: 5,
    destination: { address: "판교역", label: "판교역", lat: 37.394, lng: 127.111 },
    boarding: { provider: "tago", stationId: "GGB1", nodeId: "GGB1", cityCode: "31010", stationName: "정류장", lat: 37.28, lng: 127.05 } });
  const before = new Date("2026-11-03T08:14:30+09:00");
  // Last fetch, 30 seconds before the leave time (08:15): bus 7 at 08:20.
  state.commute.automaticOptions = { queryKey: transitQueryKey(transitQueryForState(state)), options: [{ id: "o1", fetchedAt: before.toISOString(), verified: true,
    onboardDurationSec: 30 * 60, dailyMetadataDate: "2026-11-03", direction: "판교 방면", binding: { provider: "tago", routeNumber: "7", routeId: "R7" },
    snapshot: { arrivalsMin: [5.5, 25.5], fetchedAt: before.toISOString(), liveStatus: "ready", cacheStatus: "live" } }] };
  const first = reconcileAlarmRuntime(state, createAlarmRuntimeState(), before);
  assert.equal(first.plan.planningObservation.committed.leaveAt, "2026-11-02T23:15:00.000Z");
  // No new fetch afterwards; at 08:17:10 the stale snapshot alone would point at a later bus.
  const lateTime = new Date("2026-11-03T08:17:10+09:00");
  const later = reconcileAlarmRuntime(state, first.runtime, lateTime);
  const late = later.plan.allTriggers.find((t) => t.triggerKind === "late");
  assert.equal(late.triggerAt, "2026-11-02T23:17:00.000Z", "two minutes after the committed 08:15");
  assert.match(late.notificationSpec.body, /08:15이 지났어요/);
  assert.deepEqual(later.dueEvents.map((e) => e.triggerKind), ["late"]);
});

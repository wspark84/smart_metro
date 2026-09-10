import test from "node:test";
import assert from "node:assert/strict";

import { createAlarmRuntimeState, reconcileAlarmRuntime } from "../src/server/alarm-runtime.mjs";
import { DEFAULT_STATE } from "../src/state.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("reconcileAlarmRuntime emits only recent due events and consumes expired triggers", () => {
  const state = clone(DEFAULT_STATE);
  state.schedule.startTime = "07:00";
  state.schedule.endTime = "07:06";
  state.schedule.repeatIntervalMin = 3;
  state.schedule.repeatPreset = "WEEKDAYS";
  state.schedule.daysOfWeek = [1, 2, 3, 4, 5];
  state.meta.simulationStartedAt = "2026-04-21T06:50:00+09:00";

  const result = reconcileAlarmRuntime(state, createAlarmRuntimeState(), new Date("2026-04-21T07:04:00+09:00"));

  assert.equal(result.runtime.status, "running");
  assert.equal(result.dueEvents.length, 1);
  assert.equal(result.dueEvents[0].triggerAt, "2026-04-20T22:03:00.000Z");
  assert.equal(result.runtime.firedCountToday, 1);
  assert.equal(result.runtime.nextTriggerAt, "2026-04-20T22:06:00.000Z");
  assert.equal(result.dueEvents[0].kind, "ALARM_TRIGGERED");
});

test("reconcileAlarmRuntime does not duplicate the same trigger on the next tick", () => {
  const state = clone(DEFAULT_STATE);
  state.schedule.startTime = "07:00";
  state.schedule.endTime = "07:06";
  state.schedule.repeatIntervalMin = 3;
  state.schedule.repeatPreset = "WEEKDAYS";
  state.schedule.daysOfWeek = [1, 2, 3, 4, 5];

  const firstTick = reconcileAlarmRuntime(state, createAlarmRuntimeState(), new Date("2026-04-21T07:00:00+09:00"));
  const secondTick = reconcileAlarmRuntime(state, firstTick.runtime, new Date("2026-04-21T07:01:00+09:00"));

  assert.equal(firstTick.dueEvents.length, 1);
  assert.equal(secondTick.dueEvents.length, 0);
  assert.equal(secondTick.runtime.firedCountToday, 1);
});

test("reconcileAlarmRuntime emits one stability precheck before the main morning window", () => {
  const state = clone(DEFAULT_STATE);
  state.schedule.startTime = "07:00";
  state.schedule.endTime = "07:06";
  state.schedule.repeatIntervalMin = 3;

  const result = reconcileAlarmRuntime(
    state,
    createAlarmRuntimeState(),
    new Date("2026-04-21T06:50:30+09:00"),
    {
      accuracyRuntime: {
        lastHistoricalBiasLevel: "high",
        lastHistoricalBiasRouteTraceCount: 4,
        lastHistoricalBiasWeekdayTraceCount: 2,
      },
    },
  );

  assert.equal(result.dueEvents.length, 1);
  assert.equal(result.dueEvents[0].kind, "ALARM_PRECHECK");
  assert.equal(result.dueEvents[0].triggerKind, "stability-precheck");
  assert.equal(result.dueEvents[0].stabilityPrecheckLeadMin, 10);
  assert.match(result.dueEvents[0].title, /^Stability precheck · /);
});

test("reconcileAlarmRuntime carries conservative ETA buffer context into triggered events", () => {
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

  const result = reconcileAlarmRuntime(
    state,
    createAlarmRuntimeState(),
    new Date("2026-04-21T08:00:00+09:00"),
    {
      accuracyRuntime: {
        lastObservedDisagreementLevel: "diverged",
        lastObservedEtaSpreadMin: 5,
        lastObservedComparableProviderCount: 2,
      },
    },
  );

  assert.equal(result.dueEvents.length, 1);
  assert.equal(result.dueEvents[0].liveEtaGuardMode, "conservative");
  assert.equal(result.dueEvents[0].accuracyRiskBufferMin, 2);
  assert.equal(result.dueEvents[0].accuracySpreadMin, 5);
  assert.match(result.dueEvents[0].detail, /2분 더 일찍 움직이는 기준으로 계산 중입니다/);
});

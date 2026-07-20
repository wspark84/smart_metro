import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBusAccuracyAutoProbePlan,
  createBusAccuracyRuntimeState,
  markBusAccuracyProbeObservation,
  markBusAccuracyAutoResolveResult,
  markBusAccuracyAutoProbeResult,
  summarizeBusAccuracyComparisons,
  shouldRunBusAccuracyAutoResolve,
  shouldRunBusAccuracyAutoProbe,
} from "../src/server/bus-accuracy-runtime.mjs";

test("shouldRunBusAccuracyAutoProbe allows the first probe immediately", () => {
  const result = shouldRunBusAccuracyAutoProbe(createBusAccuracyRuntimeState(), {
    probeKey: "gyeonggi::1002::gwanghwamun",
    now: new Date("2026-05-15T07:00:00.000Z"),
    intervalMs: 60_000,
  });

  assert.equal(result.shouldRun, true);
  assert.equal(result.reason, "first-probe");
});

test("shouldRunBusAccuracyAutoProbe blocks the same probe during cooldown", () => {
  const runtime = markBusAccuracyAutoProbeResult(createBusAccuracyRuntimeState(), {
    probeKey: "gyeonggi::1002::gwanghwamun",
    now: new Date("2026-05-15T07:00:00.000Z"),
    status: "ready",
    reason: "first-probe",
    comparisonCount: 2,
  });

  const result = shouldRunBusAccuracyAutoProbe(runtime, {
    probeKey: "gyeonggi::1002::gwanghwamun",
    now: new Date("2026-05-15T07:00:30.000Z"),
    intervalMs: 60_000,
  });

  assert.equal(result.shouldRun, false);
  assert.equal(result.reason, "cooldown");
  assert.equal(result.nextEligibleAt, "2026-05-15T07:01:00.000Z");
});

test("markBusAccuracyAutoProbeResult updates runtime counters and timestamps", () => {
  const runtime = markBusAccuracyAutoProbeResult(createBusAccuracyRuntimeState(), {
    probeKey: "gyeonggi::1002::gwanghwamun",
    now: new Date("2026-05-15T07:02:00.000Z"),
    status: "ready",
    reason: "interval-elapsed",
    comparisonCount: 2,
    historicalBias: {
      level: "high",
      routeSignalCount: 4,
      weekdayInWindowCount: 3,
    },
  });

  assert.equal(runtime.lastProbeKey, "gyeonggi::1002::gwanghwamun");
  assert.equal(runtime.lastStatus, "ready");
  assert.equal(runtime.lastReason, "interval-elapsed");
  assert.equal(runtime.lastComparisonCount, 2);
  assert.equal(runtime.autoProbeCount, 1);
  assert.equal(runtime.lastObservedProbeSource, "auto");
  assert.equal(runtime.lastHistoricalBiasLevel, "high");
  assert.equal(runtime.lastHistoricalBiasRouteTraceCount, 4);
  assert.equal(runtime.lastHistoricalBiasWeekdayTraceCount, 3);
});

test("summarizeBusAccuracyComparisons marks a wide live ETA spread when providers diverge", () => {
  const summary = summarizeBusAccuracyComparisons([
    { provider: "tago", arrivalsMin: [2, 10] },
    { provider: "gyeonggi", arrivalsMin: [7, 12] },
    { provider: "seoul", arrivalsMin: [4, 15] },
  ]);

  assert.equal(summary.comparableProviderCount, 3);
  assert.deepEqual(summary.comparableProviders, ["tago", "gyeonggi", "seoul"]);
  assert.equal(summary.etaMin, 2);
  assert.equal(summary.etaMax, 7);
  assert.equal(summary.etaSpreadMin, 5);
  assert.equal(summary.disagreementLevel, "diverged");
});

test("markBusAccuracyProbeObservation stores the latest live disagreement snapshot for manual probes", () => {
  const runtime = markBusAccuracyProbeObservation(createBusAccuracyRuntimeState(), {
    now: new Date("2026-05-15T07:06:00.000Z"),
    source: "manual",
    comparisonCount: 2,
    comparisonSummary: summarizeBusAccuracyComparisons([
      { provider: "tago", arrivalsMin: [3, 11] },
      { provider: "gyeonggi", arrivalsMin: [5, 14] },
    ]),
  });

  assert.equal(runtime.lastObservedProbeAt, "2026-05-15T07:06:00.000Z");
  assert.equal(runtime.lastObservedProbeSource, "manual");
  assert.equal(runtime.lastObservedProbeComparisonCount, 2);
  assert.equal(runtime.lastObservedComparableProviderCount, 2);
  assert.deepEqual(runtime.lastObservedComparableProviders, ["tago", "gyeonggi"]);
  assert.equal(runtime.lastObservedEtaMin, 3);
  assert.equal(runtime.lastObservedEtaMax, 5);
  assert.equal(runtime.lastObservedEtaSpreadMin, 2);
  assert.equal(runtime.lastObservedDisagreementLevel, "watch");
});

test("buildBusAccuracyAutoProbePlan pauses probing before the morning window", () => {
  const plan = buildBusAccuracyAutoProbePlan({
    now: new Date(2026, 4, 15, 5, 30, 0, 0),
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
      repeatPreset: "WEEKDAYS",
      daysOfWeek: [1, 2, 3, 4, 5],
      skipHolidays: true,
      snoozeDate: null,
    },
    holidayDates: [],
    nextArrivalMinutes: 12,
  });

  assert.equal(plan.enabled, false);
  assert.equal(plan.reason, "before-probe-window");
  assert.equal(plan.intervalMs, 300_000);
  assert.equal(plan.preStartLeadMin, 15);
});

test("buildBusAccuracyAutoProbePlan starts earlier before the morning window when recent instability is elevated", () => {
  const plan = buildBusAccuracyAutoProbePlan({
    now: new Date(2026, 4, 15, 6, 42, 0, 0),
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
      repeatPreset: "WEEKDAYS",
      daysOfWeek: [1, 2, 3, 4, 5],
      skipHolidays: true,
      snoozeDate: null,
    },
    holidayDates: [],
    nextArrivalMinutes: 14,
    historicalConservativeBias: {
      shouldTighten: true,
      level: "elevated",
      reasonCode: "weekday-window-history-elevated",
      routeSignalCount: 1,
      weekdayInWindowCount: 2,
    },
  });

  assert.equal(plan.enabled, true);
  assert.equal(plan.preStartLeadMin, 20);
  assert.equal(plan.reason, "steady-window+weekday-window-history-elevated");
});

test("buildBusAccuracyAutoProbePlan still waits even with a high instability watchlist when it is too early", () => {
  const plan = buildBusAccuracyAutoProbePlan({
    now: new Date(2026, 4, 15, 6, 20, 0, 0),
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
      repeatPreset: "WEEKDAYS",
      daysOfWeek: [1, 2, 3, 4, 5],
      skipHolidays: true,
      snoozeDate: null,
    },
    holidayDates: [],
    nextArrivalMinutes: 14,
    historicalConservativeBias: {
      shouldTighten: true,
      level: "high",
      reasonCode: "route-stop-history-high",
      routeSignalCount: 4,
      weekdayInWindowCount: 2,
    },
  });

  assert.equal(plan.enabled, false);
  assert.equal(plan.reason, "before-probe-window-history-high");
  assert.equal(plan.preStartLeadMin, 30);
});

test("buildBusAccuracyAutoProbePlan enters a denser warmup cadence during the last 10 minutes before the morning window for high-watch routes", () => {
  const plan = buildBusAccuracyAutoProbePlan({
    now: new Date(2026, 4, 15, 6, 53, 0, 0),
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
      repeatPreset: "WEEKDAYS",
      daysOfWeek: [1, 2, 3, 4, 5],
      skipHolidays: true,
      snoozeDate: null,
    },
    holidayDates: [],
    nextArrivalMinutes: 14,
    historicalConservativeBias: {
      shouldTighten: true,
      level: "high",
      reasonCode: "route-stop-history-high",
      routeSignalCount: 4,
      weekdayInWindowCount: 2,
    },
  });

  assert.equal(plan.enabled, true);
  assert.equal(plan.reason, "precheck-warmup+route-stop-history-high");
  assert.equal(plan.cadence, "precheck-warmup-history-high");
  assert.equal(plan.intervalMs, 20_000);
  assert.equal(plan.preStartLeadMin, 30);
});

test("buildBusAccuracyAutoProbePlan uses the fastest cadence for imminent arrivals", () => {
  const plan = buildBusAccuracyAutoProbePlan({
    now: new Date(2026, 4, 15, 7, 5, 0, 0),
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
      repeatPreset: "WEEKDAYS",
      daysOfWeek: [1, 2, 3, 4, 5],
      skipHolidays: true,
      snoozeDate: null,
    },
    holidayDates: [],
    nextArrivalMinutes: 1,
  });

  assert.equal(plan.enabled, true);
  assert.equal(plan.reason, "critical-imminence");
  assert.equal(plan.cadence, "critical");
  assert.equal(plan.intervalMs, 15_000);
});

test("buildBusAccuracyAutoProbePlan uses a slower cadence when the bus is still far away", () => {
  const plan = buildBusAccuracyAutoProbePlan({
    now: new Date(2026, 4, 15, 7, 20, 0, 0),
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
      repeatPreset: "WEEKDAYS",
      daysOfWeek: [1, 2, 3, 4, 5],
      skipHolidays: true,
      snoozeDate: null,
    },
    holidayDates: [],
    nextArrivalMinutes: 14,
  });

  assert.equal(plan.enabled, true);
  assert.equal(plan.reason, "steady-window");
  assert.equal(plan.cadence, "steady");
  assert.equal(plan.intervalMs, 90_000);
});

test("buildBusAccuracyAutoProbePlan tightens the steady cadence when recent conservative history is elevated", () => {
  const plan = buildBusAccuracyAutoProbePlan({
    now: new Date(2026, 4, 15, 7, 20, 0, 0),
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
      repeatPreset: "WEEKDAYS",
      daysOfWeek: [1, 2, 3, 4, 5],
      skipHolidays: true,
      snoozeDate: null,
    },
    holidayDates: [],
    nextArrivalMinutes: 14,
    historicalConservativeBias: {
      shouldTighten: true,
      level: "elevated",
      reasonCode: "weekday-window-history-elevated",
      routeSignalCount: 1,
      weekdayInWindowCount: 2,
    },
  });

  assert.equal(plan.enabled, true);
  assert.equal(plan.reason, "steady-window+weekday-window-history-elevated");
  assert.equal(plan.cadence, "steady-history-elevated");
  assert.equal(plan.intervalMs, 60_000);
});

test("buildBusAccuracyAutoProbePlan speeds up when providers are sharply diverged", () => {
  const plan = buildBusAccuracyAutoProbePlan({
    now: new Date(2026, 4, 15, 7, 20, 0, 0),
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
      repeatPreset: "WEEKDAYS",
      daysOfWeek: [1, 2, 3, 4, 5],
      skipHolidays: true,
      snoozeDate: null,
    },
    holidayDates: [],
    nextArrivalMinutes: 14,
    liveEtaDisagreementLevel: "diverged",
    liveEtaSpreadMin: 5,
    comparableProviderCount: 2,
  });

  assert.equal(plan.enabled, true);
  assert.equal(plan.reason, "eta-disagreement-diverged");
  assert.equal(plan.cadence, "verify-diverged");
  assert.equal(plan.intervalMs, 20_000);
});

test("buildBusAccuracyAutoProbePlan speeds up moderately when providers are only slightly split", () => {
  const plan = buildBusAccuracyAutoProbePlan({
    now: new Date(2026, 4, 15, 7, 20, 0, 0),
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
      repeatPreset: "WEEKDAYS",
      daysOfWeek: [1, 2, 3, 4, 5],
      skipHolidays: true,
      snoozeDate: null,
    },
    holidayDates: [],
    nextArrivalMinutes: 14,
    liveEtaDisagreementLevel: "watch",
    liveEtaSpreadMin: 2,
    comparableProviderCount: 2,
  });

  assert.equal(plan.enabled, true);
  assert.equal(plan.reason, "eta-disagreement-watch");
  assert.equal(plan.cadence, "verify-watch");
  assert.equal(plan.intervalMs, 30_000);
});

test("buildBusAccuracyAutoProbePlan treats a mild split as high-priority when recent instability history is high", () => {
  const plan = buildBusAccuracyAutoProbePlan({
    now: new Date(2026, 4, 15, 7, 20, 0, 0),
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
      repeatPreset: "WEEKDAYS",
      daysOfWeek: [1, 2, 3, 4, 5],
      skipHolidays: true,
      snoozeDate: null,
    },
    holidayDates: [],
    nextArrivalMinutes: 14,
    liveEtaDisagreementLevel: "watch",
    liveEtaSpreadMin: 2,
    comparableProviderCount: 2,
    historicalConservativeBias: {
      shouldTighten: true,
      level: "high",
      reasonCode: "route-stop-history-high",
      routeSignalCount: 4,
      weekdayInWindowCount: 2,
    },
  });

  assert.equal(plan.enabled, true);
  assert.equal(plan.reason, "eta-watch-history-high+route-stop-history-high");
  assert.equal(plan.cadence, "verify-history-high-history-high");
  assert.equal(plan.intervalMs, 15_000);
});

test("shouldRunBusAccuracyAutoResolve blocks repeated auto-arrival resolution for the same route during cooldown", () => {
  const runtime = markBusAccuracyAutoResolveResult(createBusAccuracyRuntimeState(), {
    routeKey: "gyeonggi::1002::gwanghwamun",
    now: new Date("2026-05-15T07:15:00.000Z"),
    providerCount: 2,
  });

  const result = shouldRunBusAccuracyAutoResolve(runtime, {
    routeKey: "gyeonggi::1002::gwanghwamun",
    now: new Date("2026-05-15T07:17:00.000Z"),
    intervalMs: 180_000,
  });

  assert.equal(result.shouldRun, false);
  assert.equal(result.reason, "auto-resolve-cooldown");
  assert.equal(result.nextEligibleAt, "2026-05-15T07:18:00.000Z");
});

test("markBusAccuracyAutoResolveResult stores the latest auto-arrival runtime markers", () => {
  const runtime = markBusAccuracyAutoResolveResult(createBusAccuracyRuntimeState(), {
    routeKey: "gyeonggi::1002::gwanghwamun",
    now: new Date("2026-05-15T07:18:00.000Z"),
    providerCount: 2,
  });

  assert.equal(runtime.lastAutoResolvedRouteKey, "gyeonggi::1002::gwanghwamun");
  assert.equal(runtime.lastAutoResolvedAt, "2026-05-15T07:18:00.000Z");
  assert.equal(runtime.lastAutoResolvedProviderCount, 2);
  assert.equal(runtime.autoResolvedArrivalCount, 1);
});

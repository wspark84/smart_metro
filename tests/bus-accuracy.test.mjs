import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBusAccuracyLeaderboard,
  buildBusAccuracySnapshot,
  createBusAccuracyState,
  recordForecastObservation,
  resolveAutoDetectedArrival,
  resolveActualArrival,
} from "../src/server/bus-accuracy.mjs";

function recordObservationSeries(state, provider, predictedMinutes, observedAt) {
  return recordForecastObservation(state, {
    provider,
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    predictedMinutes,
    observedAt,
  });
}

test("recordForecastObservation stores a pending provider forecast", () => {
  const state = recordObservationSeries(createBusAccuracyState(), "tago", 5, "2026-05-14T07:00:00.000Z");

  assert.equal(state.pendingObservations.length, 1);
  assert.equal(state.pendingObservations[0].provider, "tago");
  assert.equal(state.pendingObservations[0].predictedArrivalAt, "2026-05-14T07:05:00.000Z");
});

test("resolveActualArrival turns the latest forecast from each provider into scored samples", () => {
  let state = createBusAccuracyState();
  state = recordObservationSeries(state, "tago", 4, "2026-05-14T07:00:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 6, "2026-05-14T07:01:00.000Z");
  state = recordObservationSeries(state, "tago", 3, "2026-05-14T07:02:00.000Z");

  const resolved = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T07:05:00.000Z",
  });

  assert.equal(resolved.resolvedSamples.length, 2);
  assert.equal(resolved.state.pendingObservations.length, 0);

  const tagoSample = resolved.resolvedSamples.find((item) => item.provider === "tago");
  const gyeonggiSample = resolved.resolvedSamples.find((item) => item.provider === "gyeonggi");

  assert.equal(tagoSample.absoluteErrorMin, 0);
  assert.equal(gyeonggiSample.absoluteErrorMin, 2);
});

test("resolveActualArrival merges provider samples by canonical stop key even when stop names differ", () => {
  let state = createBusAccuracyState();
  state = recordForecastObservation(state, {
    provider: "tago",
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun Exit 6",
    stopKey: "selected:gwanghwamun",
    predictedMinutes: 4,
    observedAt: "2026-05-14T07:00:00.000Z",
  });
  state = recordForecastObservation(state, {
    provider: "gyeonggi",
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun Station",
    stopKey: "selected:gwanghwamun",
    predictedMinutes: 6,
    observedAt: "2026-05-14T07:01:00.000Z",
  });

  const resolved = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Representative Stop Name",
    stopKey: "selected:gwanghwamun",
    actualArrivalAt: "2026-05-14T07:05:00.000Z",
  });

  const snapshot = buildBusAccuracySnapshot(resolved.state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Representative Stop Name",
    stopKey: "selected:gwanghwamun",
    fallbackOrder: ["tago", "gyeonggi"],
  });

  assert.equal(resolved.resolvedSamples.length, 2);
  assert.equal(snapshot.sampleCount, 2);
  assert.equal(snapshot.providers.length, 2);
  assert.equal(snapshot.stopKey, "selected:gwanghwamun");
});

test("buildBusAccuracySnapshot keeps policy order until enough providers clear the sample threshold", () => {
  let state = createBusAccuracyState();
  state = recordObservationSeries(state, "tago", 5, "2026-05-14T07:00:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 8, "2026-05-14T07:00:00.000Z");

  const resolved = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T07:05:00.000Z",
  });

  const snapshot = buildBusAccuracySnapshot(resolved.state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    fallbackOrder: ["tago", "gyeonggi"],
  });

  assert.equal(snapshot.recommendationBasis, "policy-default");
  assert.equal(snapshot.recommendationReason, "no-provider-met-sample-threshold");
  assert.equal(snapshot.recommendationConfidence, "low");
  assert.deepEqual(snapshot.recommendedProviders.slice(0, 2), ["tago", "gyeonggi"]);
  assert.deepEqual(snapshot.measuredEligibleProviders, []);
});

test("buildBusAccuracySnapshot promotes the measured winner only after stable multi-provider evidence exists", () => {
  let state = createBusAccuracyState();

  state = recordObservationSeries(state, "tago", 5, "2026-05-14T07:00:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 8, "2026-05-14T07:00:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T07:05:00.000Z",
  }).state;

  state = recordObservationSeries(state, "tago", 4, "2026-05-14T07:10:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 7, "2026-05-14T07:10:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T07:14:00.000Z",
  }).state;

  const snapshot = buildBusAccuracySnapshot(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    fallbackOrder: ["gyeonggi", "tago"],
  });

  assert.equal(snapshot.recommendationBasis, "measured-accuracy");
  assert.equal(snapshot.recommendationReason, "measured-winner");
  assert.equal(snapshot.recommendationConfidence, "high");
  assert.deepEqual(snapshot.recommendedProviders.slice(0, 2), ["tago", "gyeonggi"]);
  assert.deepEqual(snapshot.measuredEligibleProviders, ["tago", "gyeonggi"]);
  assert.equal(snapshot.providers[0].provider, "tago");
  assert.equal(snapshot.providers[0].meanAbsoluteErrorMin, 0);
  assert.equal(snapshot.providers[0].meetsRecommendationThreshold, true);
  assert.equal(snapshot.providers[1].provider, "gyeonggi");
  assert.equal(snapshot.providers[1].meanAbsoluteErrorMin, 3);
  assert.equal(snapshot.measuredLeaderGapMin, 3);
});

test("buildBusAccuracySnapshot keeps policy order when measured providers are too close to call", () => {
  let state = createBusAccuracyState();

  state = recordObservationSeries(state, "tago", 5, "2026-05-14T07:00:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 6, "2026-05-14T07:00:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T07:05:00.000Z",
  }).state;

  state = recordObservationSeries(state, "tago", 4, "2026-05-14T07:10:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 5, "2026-05-14T07:10:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T07:15:00.000Z",
  }).state;

  const snapshot = buildBusAccuracySnapshot(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    fallbackOrder: ["tago", "gyeonggi"],
  });

  assert.equal(snapshot.recommendationBasis, "policy-default");
  assert.equal(snapshot.recommendationReason, "measured-gap-too-small");
  assert.equal(snapshot.recommendationConfidence, "medium");
  assert.equal(snapshot.measuredLeaderGapMin, 0);
  assert.deepEqual(snapshot.recommendedProviders.slice(0, 2), ["tago", "gyeonggi"]);
});

test("buildBusAccuracySnapshot gives more influence to recent samples than older ones", () => {
  let state = createBusAccuracyState();

  state = recordObservationSeries(state, "tago", 5, "2026-05-01T07:00:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 9, "2026-05-01T07:00:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-01T07:05:00.000Z",
  }).state;

  state = recordObservationSeries(state, "tago", 8, "2026-05-14T07:10:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 5, "2026-05-14T07:10:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T07:15:00.000Z",
  }).state;

  const snapshot = buildBusAccuracySnapshot(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    fallbackOrder: ["tago", "gyeonggi"],
  });

  assert.equal(snapshot.recommendationBasis, "measured-accuracy");
  assert.equal(snapshot.providers[0].provider, "gyeonggi");
  assert.equal(snapshot.providers[0].recentSampleCount, 1);
  assert.equal(snapshot.providers[1].provider, "tago");
  assert.equal(snapshot.providers[1].meanAbsoluteErrorMin, 1.5);
  assert.ok(snapshot.providers[0].weightedMeanAbsoluteErrorMin < snapshot.providers[1].weightedMeanAbsoluteErrorMin);
  assert.equal(snapshot.recommendedProviders[0], "gyeonggi");
});

test("buildBusAccuracySnapshot keeps the safer default when measured winners have gone stale", () => {
  let state = createBusAccuracyState();

  state = recordObservationSeries(state, "tago", 5, "2026-05-01T07:00:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 8, "2026-05-01T07:00:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-01T07:05:00.000Z",
  }).state;

  state = recordObservationSeries(state, "tago", 4, "2026-05-01T07:10:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 7, "2026-05-01T07:10:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-01T07:14:00.000Z",
  }).state;

  state = recordForecastObservation(state, {
    provider: "tago",
    region: "gyeonggi",
    routeNumber: "3000",
    stopName: "City Hall",
    predictedMinutes: 5,
    observedAt: "2026-05-14T07:20:00.000Z",
  });

  const snapshot = buildBusAccuracySnapshot(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    fallbackOrder: ["tago", "gyeonggi"],
  });

  assert.equal(snapshot.recommendationBasis, "policy-default");
  assert.equal(snapshot.recommendationReason, "measured-samples-stale");
  assert.equal(snapshot.recommendationConfidence, "low");
  assert.deepEqual(snapshot.freshMeasuredEligibleProviders, []);
  assert.deepEqual(snapshot.staleMeasuredEligibleProviders, ["tago", "gyeonggi"]);
  assert.equal(snapshot.providers[0].activeFreshnessState, "stale");
  assert.equal(snapshot.freshnessPolicy.recentSampleWindowDays, 7);
});

test("buildBusAccuracySnapshot waits for a second fresh provider before flipping from the default", () => {
  let state = createBusAccuracyState();

  state = recordObservationSeries(state, "tago", 5, "2026-05-01T07:00:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 8, "2026-05-01T07:00:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-01T07:05:00.000Z",
  }).state;

  state = recordObservationSeries(state, "tago", 4, "2026-05-01T07:10:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 7, "2026-05-01T07:10:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-01T07:14:00.000Z",
  }).state;

  state = recordObservationSeries(state, "tago", 5, "2026-05-14T07:00:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T07:05:00.000Z",
  }).state;
  state = recordObservationSeries(state, "tago", 4, "2026-05-14T07:10:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T07:14:00.000Z",
  }).state;

  const snapshot = buildBusAccuracySnapshot(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    fallbackOrder: ["tago", "gyeonggi"],
  });

  assert.equal(snapshot.recommendationBasis, "policy-default");
  assert.equal(snapshot.recommendationReason, "not-enough-recent-compared-providers");
  assert.equal(snapshot.recommendationConfidence, "medium");
  assert.deepEqual(snapshot.freshMeasuredEligibleProviders, ["tago"]);
  assert.deepEqual(snapshot.staleMeasuredEligibleProviders, ["gyeonggi"]);
  assert.equal(snapshot.providers[0].provider, "tago");
  assert.equal(snapshot.providers[0].activeFreshnessState, "fresh");
  assert.equal(snapshot.providers[1].provider, "gyeonggi");
  assert.equal(snapshot.providers[1].activeFreshnessState, "stale");
});

test("buildBusAccuracySnapshot prefers alarm-window samples when that window has enough scored providers", () => {
  let state = createBusAccuracyState();

  state = recordObservationSeries(state, "tago", 7, "2026-05-13T22:00:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 5, "2026-05-13T22:00:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-13T22:05:00.000Z",
  }).state;

  state = recordObservationSeries(state, "tago", 6, "2026-05-13T22:10:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 5, "2026-05-13T22:10:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-13T22:15:00.000Z",
  }).state;

  state = recordObservationSeries(state, "tago", 5, "2026-05-14T03:00:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 8, "2026-05-14T03:00:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T03:05:00.000Z",
  }).state;

  state = recordObservationSeries(state, "tago", 4, "2026-05-14T03:10:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 7, "2026-05-14T03:10:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T03:14:00.000Z",
  }).state;

  const snapshot = buildBusAccuracySnapshot(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    fallbackOrder: ["tago", "gyeonggi"],
    timeSlice: {
      startTime: "07:00",
      endTime: "07:45",
      label: "Alarm window 07:00 - 07:45",
      timeZone: "Asia/Seoul",
    },
  });

  assert.equal(snapshot.recommendationScope, "schedule-window");
  assert.equal(snapshot.timeSlice.usedForRecommendation, true);
  assert.equal(snapshot.recommendedProviders[0], "gyeonggi");
  assert.equal(snapshot.providers[0].provider, "gyeonggi");
  assert.equal(snapshot.providers[0].timeSliceSampleCount, 2);
  assert.equal(snapshot.providers[1].provider, "tago");
});

test("buildBusAccuracySnapshot falls back to all-day scoring when the alarm window is still warming up", () => {
  let state = createBusAccuracyState();

  state = recordObservationSeries(state, "tago", 6, "2026-05-13T22:00:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 5, "2026-05-13T22:00:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-13T22:05:00.000Z",
  }).state;

  state = recordObservationSeries(state, "tago", 5, "2026-05-14T03:00:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 8, "2026-05-14T03:00:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T03:05:00.000Z",
  }).state;

  state = recordObservationSeries(state, "tago", 4, "2026-05-14T03:10:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 7, "2026-05-14T03:10:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T03:14:00.000Z",
  }).state;

  const snapshot = buildBusAccuracySnapshot(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    fallbackOrder: ["tago", "gyeonggi"],
    timeSlice: {
      startTime: "07:00",
      endTime: "07:45",
      label: "Alarm window 07:00 - 07:45",
      timeZone: "Asia/Seoul",
    },
  });

  assert.equal(snapshot.recommendationScope, "all-samples");
  assert.equal(snapshot.timeSlice.usedForRecommendation, false);
  assert.equal(snapshot.recommendedProviders[0], "tago");
  assert.equal(snapshot.providers[0].provider, "tago");
  assert.equal(snapshot.providers[0].timeSliceSampleCount, 1);
});

test("buildBusAccuracySnapshot prefers the same weekday inside the alarm window when that slice has enough evidence", () => {
  let state = createBusAccuracyState();

  state = recordObservationSeries(state, "tago", 5, "2026-05-13T22:00:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 8, "2026-05-13T22:00:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-13T22:05:00.000Z",
  }).state;

  state = recordObservationSeries(state, "tago", 4, "2026-05-13T22:10:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 7, "2026-05-13T22:10:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-13T22:14:00.000Z",
  }).state;

  state = recordObservationSeries(state, "tago", 7, "2026-05-14T22:00:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 5, "2026-05-14T22:00:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T22:05:00.000Z",
  }).state;

  state = recordObservationSeries(state, "tago", 6, "2026-05-14T22:10:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 5, "2026-05-14T22:10:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T22:15:00.000Z",
  }).state;

  const snapshot = buildBusAccuracySnapshot(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    fallbackOrder: ["tago", "gyeonggi"],
    timeSlice: {
      startTime: "07:00",
      endTime: "07:45",
      label: "Alarm window 07:00 - 07:45",
      timeZone: "Asia/Seoul",
      targetWeekday: 5,
      weekdayLabel: "Friday",
    },
  });

  assert.equal(snapshot.recommendationScope, "schedule-window-weekday");
  assert.equal(snapshot.timeSlice.usedWeekdayForRecommendation, true);
  assert.equal(snapshot.recommendedProviders[0], "gyeonggi");
  assert.equal(snapshot.providers[0].provider, "gyeonggi");
  assert.equal(snapshot.providers[0].weekdayTimeSliceSampleCount, 2);
});

test("buildBusAccuracySnapshot falls back from same-weekday scope to the wider alarm window when the weekday slice is still warming up", () => {
  let state = createBusAccuracyState();

  state = recordObservationSeries(state, "tago", 5, "2026-05-13T22:00:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 8, "2026-05-13T22:00:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-13T22:05:00.000Z",
  }).state;

  state = recordObservationSeries(state, "tago", 4, "2026-05-13T22:10:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 7, "2026-05-13T22:10:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-13T22:14:00.000Z",
  }).state;

  state = recordObservationSeries(state, "tago", 6, "2026-05-14T22:00:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 5, "2026-05-14T22:00:00.000Z");
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T22:05:00.000Z",
  }).state;

  const snapshot = buildBusAccuracySnapshot(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    fallbackOrder: ["tago", "gyeonggi"],
    timeSlice: {
      startTime: "07:00",
      endTime: "07:45",
      label: "Alarm window 07:00 - 07:45",
      timeZone: "Asia/Seoul",
      targetWeekday: 5,
      weekdayLabel: "Friday",
    },
  });

  assert.equal(snapshot.recommendationScope, "schedule-window");
  assert.equal(snapshot.timeSlice.usedWeekdayForRecommendation, false);
  assert.equal(snapshot.timeSlice.usedForRecommendation, true);
  assert.equal(snapshot.recommendedProviders[0], "tago");
  assert.equal(snapshot.providers[0].provider, "tago");
  assert.equal(snapshot.providers[0].weekdayTimeSliceSampleCount, 1);
});

test("buildBusAccuracyLeaderboard ranks measured route-stop winners ahead of policy-default rows", () => {
  let state = createBusAccuracyState();

  state = recordForecastObservation(state, {
    provider: "tago",
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    predictedMinutes: 5,
    observedAt: "2026-05-14T07:00:00.000Z",
  });
  state = recordForecastObservation(state, {
    provider: "gyeonggi",
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    predictedMinutes: 8,
    observedAt: "2026-05-14T07:00:00.000Z",
  });
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T07:05:00.000Z",
  }).state;
  state = recordForecastObservation(state, {
    provider: "tago",
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    predictedMinutes: 4,
    observedAt: "2026-05-14T07:10:00.000Z",
  });
  state = recordForecastObservation(state, {
    provider: "gyeonggi",
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    predictedMinutes: 7,
    observedAt: "2026-05-14T07:10:00.000Z",
  });
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T07:14:00.000Z",
  }).state;

  state = recordForecastObservation(state, {
    provider: "tago",
    region: "gyeonggi",
    routeNumber: "3000",
    stopName: "City Hall",
    predictedMinutes: 5,
    observedAt: "2026-05-14T07:20:00.000Z",
  });
  state = resolveActualArrival(state, {
    region: "gyeonggi",
    routeNumber: "3000",
    stopName: "City Hall",
    actualArrivalAt: "2026-05-14T07:25:00.000Z",
  }).state;

  const leaderboard = buildBusAccuracyLeaderboard(state, {
    region: "gyeonggi",
    limit: 5,
    fallbackOrderResolver: () => ["tago", "gyeonggi"],
    timeSlice: {
      startTime: "07:00",
      endTime: "07:45",
      label: "Alarm window 07:00 - 07:45",
      timeZone: "Asia/Seoul",
    },
  });

  assert.equal(leaderboard.totalRoutes, 2);
  assert.equal(leaderboard.timeSlice.label, "Alarm window 07:00 - 07:45");
  assert.equal(leaderboard.entries[0].routeNumber, "1002");
  assert.equal(leaderboard.entries[0].recommendationBasis, "measured-accuracy");
  assert.equal(leaderboard.entries[1].routeNumber, "3000");
  assert.equal(leaderboard.entries[1].recommendationBasis, "policy-default");
});

test("resolveAutoDetectedArrival converts converged imminent ETAs into scored samples", () => {
  let state = createBusAccuracyState();
  state = recordObservationSeries(state, "tago", 1, "2026-05-14T07:14:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 1, "2026-05-14T07:14:00.000Z");

  const autoResolved = resolveAutoDetectedArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T07:15:00.000Z",
    comparisons: [
      {
        provider: "tago",
        arrivalsMin: [0, 10],
        messages: [],
      },
      {
        provider: "gyeonggi",
        arrivalsMin: [1, 9],
        messages: ["도착"],
      },
    ],
  });

  assert.equal(autoResolved.autoDetected, true);
  assert.equal(autoResolved.detectionReason, "multi-provider-imminent");
  assert.deepEqual(autoResolved.detectedProviders, ["tago", "gyeonggi"]);
  assert.equal(autoResolved.resolvedSamples.length, 2);
  assert.equal(autoResolved.state.pendingObservations.length, 0);
});

test("resolveAutoDetectedArrival refuses to auto-resolve before providers converge", () => {
  let state = createBusAccuracyState();
  state = recordObservationSeries(state, "tago", 2, "2026-05-14T07:14:00.000Z");
  state = recordObservationSeries(state, "gyeonggi", 2, "2026-05-14T07:14:00.000Z");

  const autoResolved = resolveAutoDetectedArrival(state, {
    region: "gyeonggi",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    actualArrivalAt: "2026-05-14T07:15:00.000Z",
    comparisons: [
      {
        provider: "tago",
        arrivalsMin: [0, 10],
        messages: [],
      },
      {
        provider: "gyeonggi",
        arrivalsMin: [3, 12],
        messages: [],
      },
    ],
  });

  assert.equal(autoResolved.autoDetected, false);
  assert.equal(autoResolved.detectionReason, "providers-not-yet-converged");
  assert.equal(autoResolved.resolvedSamples.length, 0);
  assert.equal(autoResolved.state.pendingObservations.length, 2);
});

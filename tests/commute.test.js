import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAddressAwareRouteEstimate,
  buildSchedulePreview,
  combineDateAndTime,
  dateOnlyKey,
  describeScheduleState,
  evaluateLateRisk,
  haversineDistanceMeters,
  rankLocationsByDistance,
  shouldFireToday,
} from "../src/logic/commute.js";

test("Korean schedule dates stay in Asia/Seoul when the server host uses another timezone", () => {
  const utcDateDuringKoreanMorning = new Date("2026-04-20T22:30:00.000Z");

  assert.equal(dateOnlyKey(utcDateDuringKoreanMorning), "2026-04-21");
  assert.equal(combineDateAndTime(utcDateDuringKoreanMorning, "07:00").toISOString(), "2026-04-20T22:00:00.000Z");
  assert.equal(
    shouldFireToday(
      {
        repeatPreset: "WEEKDAYS",
        skipHolidays: false,
        snoozeDate: null,
        daysOfWeek: [1, 2, 3, 4, 5],
      },
      utcDateDuringKoreanMorning,
    ),
    true,
  );
});

test("late-risk engine marks current bus as must-catch when next bus becomes risky", () => {
  const result = evaluateLateRisk({
    requiredArrivalTime: "09:00",
    route: {
      homeToStopWalkMin: 5,
      busRideMin: 43,
      alightToWorkWalkMin: 7,
    },
    busArrivalsMin: [5, 22],
    now: new Date("2026-04-21T08:00:00+09:00"),
  });

  assert.equal(result.urgency, "MUST_CATCH");
  assert.equal(result.results[0].level, "YELLOW");
  assert.equal(result.results[1].level, "RED");
});

test("late-risk engine becomes stricter when a live ETA safety buffer is applied", () => {
  const baseline = evaluateLateRisk({
    requiredArrivalTime: "09:00",
    route: {
      homeToStopWalkMin: 5,
      busRideMin: 41,
      alightToWorkWalkMin: 7,
      etaRiskBufferMin: 0,
    },
    busArrivalsMin: [5, 12],
    now: new Date("2026-04-21T08:00:00+09:00"),
  });

  const conservative = evaluateLateRisk({
    requiredArrivalTime: "09:00",
    route: {
      homeToStopWalkMin: 5,
      busRideMin: 41,
      alightToWorkWalkMin: 7,
      etaRiskBufferMin: 2,
    },
    busArrivalsMin: [5, 12],
    now: new Date("2026-04-21T08:00:00+09:00"),
  });

  assert.equal(baseline.urgency, "RELAXED");
  assert.equal(baseline.results[1].level, "YELLOW");
  assert.equal(conservative.etaRiskBufferMin, 2);
  assert.equal(conservative.urgency, "MUST_CATCH");
  assert.equal(conservative.results[1].level, "ORANGE");
});

test("weekdays preset skips saturday", () => {
  const shouldFire = shouldFireToday(
    {
      repeatPreset: "WEEKDAYS",
      skipHolidays: true,
      snoozeDate: null,
      daysOfWeek: [1, 2, 3, 4, 5],
    },
    new Date("2026-04-25T07:00:00+09:00"),
    [],
  );

  assert.equal(shouldFire, false);
});

test("today snooze overrides normal firing rules", () => {
  const description = describeScheduleState(
    {
      repeatPreset: "DAILY",
      skipHolidays: false,
      snoozeDate: "2026-04-21",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      startTime: "07:00",
      endTime: "07:45",
      repeatIntervalMin: 3,
    },
    new Date("2026-04-21T07:00:00+09:00"),
    [],
  );

  assert.equal(description.firing, false);
  assert.match(description.badge, /오늘 꺼짐/);
});

test("holiday skip blocks alarms on matching holiday date", () => {
  const shouldFire = shouldFireToday(
    {
      repeatPreset: "WEEKDAYS",
      skipHolidays: true,
      snoozeDate: null,
      daysOfWeek: [1, 2, 3, 4, 5],
    },
    new Date("2026-05-05T07:00:00+09:00"),
    ["2026-05-05"],
  );

  assert.equal(shouldFire, false);
});

test("schedule preview includes skipped weekend and firing weekday states", () => {
  const preview = buildSchedulePreview(
    {
      repeatPreset: "WEEKDAYS",
      skipHolidays: false,
      snoozeDate: null,
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: "07:00",
      endTime: "07:45",
      repeatIntervalMin: 3,
    },
    new Date("2026-04-24T07:00:00+09:00"),
    [],
    3,
  );

  assert.equal(preview.length, 3);
  assert.equal(preview[0].firing, true);
  assert.equal(preview[1].firing, false);
  assert.match(preview[1].badge, /주말/);
});

test("schedule preview marks configured holiday as skipped", () => {
  const preview = buildSchedulePreview(
    {
      repeatPreset: "WEEKDAYS",
      skipHolidays: true,
      snoozeDate: null,
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: "07:00",
      endTime: "07:45",
      repeatIntervalMin: 3,
    },
    new Date("2026-05-04T07:00:00+09:00"),
    ["2026-05-05"],
    2,
  );

  assert.equal(preview[1].firing, false);
  assert.match(preview[1].badge, /공휴일/);
});

test("haversineDistanceMeters returns a positive estimate for known points", () => {
  const distance = haversineDistanceMeters(
    { lat: 37.5725, lng: 126.9769 },
    { lat: 37.5717, lng: 126.9769 },
  );

  assert.equal(typeof distance, "number");
  assert.ok(distance > 50);
  assert.ok(distance < 150);
});

test("buildAddressAwareRouteEstimate combines walk and bus minutes", () => {
  const estimate = buildAddressAwareRouteEstimate({
    homeLocation: { lat: 37.5725, lng: 126.9769 },
    workLocation: { lat: 37.3951, lng: 127.1107 },
    stopLocation: { lat: 37.5717, lng: 126.9769 },
    busRideMin: 43,
    alightToWorkWalkMin: 7,
  });

  assert.ok(estimate.homeToStopDistanceM > 50);
  assert.ok(estimate.homeToStopWalkMin >= 1);
  assert.equal(estimate.busRideMin, 43);
  assert.equal(estimate.alightToWorkWalkMin, 7);
  assert.equal(estimate.totalCommuteMin, estimate.homeToStopWalkMin + 50);
});

test("rankLocationsByDistance returns the nearest locations first", () => {
  const ranked = rankLocationsByDistance(
    { lat: 37.5725, lng: 126.9769 },
    [
      { id: "far", lat: 37.3951, lng: 127.1107 },
      { id: "near", lat: 37.5717, lng: 126.9769 },
      { id: "mid", lat: 37.5658, lng: 126.9779 },
    ],
    2,
  );

  assert.deepEqual(
    ranked.map((item) => item.id),
    ["near", "mid"],
  );
  assert.ok(ranked[0].distanceM <= ranked[1].distanceM);
});

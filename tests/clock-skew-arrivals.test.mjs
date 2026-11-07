import test from "node:test";
import assert from "node:assert/strict";
import { projectLiveArrivals } from "../src/logic/live-arrivals.js";
import { buildJourneyOptionsPlan } from "../src/logic/journey-options.js";

// 2026-11-08 morning: a check started at 07:38:17.488 and the bus API answered
// at 07:38:17.492. The 4 ms "future" arrival was thrown away, so no leave time
// was found, automatic checks stopped for the day and the screen kept saying
// the time could not be checked.
const now = new Date("2026-11-07T22:38:17.488Z");
const headway = { status: "ready", sunday: { min: 18, max: 50 }, weekday: { min: 13, max: 45 }, saturday: { min: 18, max: 50 }, holiday: null };
const snapshot = { headway, provider: "gyeonggi", fetchedAt: "2026-11-07T22:38:17.492Z", liveStatus: "ready", cacheStatus: "live", arrivalsMin: [7.99],
  lastObservation: { fetchedAt: "2026-11-07T22:38:17.492Z", arrivalsMin: [7.99] } };

test("an arrival stamped a moment after the request started still counts", () => {
  assert.deepEqual(projectLiveArrivals(snapshot, now), [7.99]);
  assert.deepEqual(projectLiveArrivals({ ...snapshot, fetchedAt: "2026-11-07T22:45:00Z" }, now), [], "far in the future is still rejected");
});

test("the leave time is found right after a fresh lookup", () => {
  const option = { id: "o1", binding: { provider: "gyeonggi", routeNumber: "1" }, onboardDurationSec: 2080, verified: true,
    fetchedAt: "2026-11-07T22:38:17.600Z", dailyMetadataDate: "2026-11-08", snapshot };
  const plan = buildJourneyOptionsPlan({ requiredArrivalTime: "09:00", boardingAccessMin: 9, options: [option], now, holidays: [] });
  assert.ok(plan.risk.departure?.leaveAt, "a leave time");
  assert.equal(plan.risk.targetResult.routeNumber, "1");
});

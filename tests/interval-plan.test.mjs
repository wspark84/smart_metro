import test from "node:test";
import assert from "node:assert/strict";
import { buildJourneyOptionsPlan } from "../src/logic/journey-options.js";
import { inServiceHours } from "../src/logic/boarding-plan.js";
import { serviceWindow, normalizeGyeonggiHeadway } from "../src/server/bus-headway.mjs";

// 2026-11-08: with no live arrival yet (회차 대기 / 지연) and none earlier that
// day, no leave time was planned and the app said the time could not be
// checked. The published interval now gives a safe leave time until live
// arrivals appear, but never after the last bus.
const headway = { status: "ready", source: "경기도 버스노선 조회", sunday: { min: 18, max: 50 }, weekday: { min: 13, max: 45 },
  saturday: { min: 18, max: 50 }, holiday: null, firstTime: "05:30", lastTime: "23:00" };
const option = (snapshot) => ({ id: "o1", binding: { provider: "gyeonggi", routeNumber: "1" }, onboardDurationSec: 2080, verified: true,
  fetchedAt: "2026-11-07T22:10:00Z", dailyMetadataDate: "2026-11-08", snapshot });
const noLive = { headway, provider: "gyeonggi", fetchedAt: "2026-11-07T22:19:00Z", liveStatus: "ready", arrivalsMin: [], cacheStatus: "live",
  lastObservation: { fetchedAt: "2026-11-03T08:01:40Z", arrivalsMin: [4] } };

test("no live arrival: leave so that a bus comes within one full interval", () => {
  const now = new Date("2026-11-07T22:19:30Z"); // Sun 07:19:30 KST
  const plan = buildJourneyOptionsPlan({ requiredArrivalTime: "09:00", boardingAccessMin: 9, options: [option(noLive)], now, holidays: [] });
  const leave = plan.risk.departure?.leaveAt;
  assert.ok(leave, "a leave time");
  assert.equal(plan.risk.targetResult.estimated, true);
  // Board by 08:25:20 at the latest (09:00 - 34m40s); a Sunday bus can be 50 min apart → at the stop 07:35:20, leave 07:26:20.
  assert.equal(new Date(leave).toISOString(), "2026-11-07T22:26:20.000Z");
});

test("live arrivals take over as soon as they come", () => {
  const now = new Date("2026-11-07T22:38:20Z");
  const live = { ...noLive, fetchedAt: "2026-11-07T22:38:17Z", arrivalsMin: [7.99], lastObservation: { fetchedAt: "2026-11-07T22:38:17Z", arrivalsMin: [7.99] } };
  const plan = buildJourneyOptionsPlan({ requiredArrivalTime: "09:00", boardingAccessMin: 9, options: [option(live)], now, holidays: [] });
  // The next bus after the observed 07:46 one (one interval later), not the worst-case interval plan.
  const leave = Date.parse(plan.risk.departure.leaveAt);
  assert.ok(Math.abs(leave - Date.parse("2026-11-07T23:11:16Z")) < 2000, new Date(leave).toISOString());
});

test("no interval plan after the last bus", () => {
  assert.equal(inServiceHours({ firstTime: "05:30", lastTime: "23:00" }, new Date("2026-11-08T14:30:00Z")), false, "23:30 KST");
  assert.equal(inServiceHours({ firstTime: "05:30", lastTime: "00:40" }, new Date("2026-11-08T15:20:00Z")), true, "00:20 KST, last bus 00:40");
  assert.equal(inServiceHours({}, new Date()), true, "unknown hours");
  const now = new Date("2026-11-08T14:00:00Z"); // 23:00 KST, goal 23:59
  const plan = buildJourneyOptionsPlan({ requiredArrivalTime: "23:59", boardingAccessMin: 5, options: [option({ ...noLive, fetchedAt: "2026-11-08T13:59:00Z" })], now, holidays: [] });
  assert.equal(plan.risk.departure, null);
});

test("route metadata keeps the first and last bus", () => {
  assert.deepEqual(serviceWindow(["05:30", "06:00"], ["23:10", "00:20"]), { firstTime: "05:30", lastTime: "00:20" });
  assert.deepEqual(serviceWindow(["20261108043000"], ["20261108230000"]), { firstTime: "04:30", lastTime: "23:00" });
  const profile = normalizeGyeonggiHeadway({ response: { msgHeader: { resultCode: 0 }, msgBody: { busRouteInfoItem: {
    routeId: "241201001", peekAlloc: 13, nPeekAlloc: 45, upFirstTime: "05:40", upLastTime: "22:50", downFirstTime: "06:10", downLastTime: "23:20" } } } }, "241201001");
  assert.equal(profile.firstTime, "05:40");
  assert.equal(profile.lastTime, "23:20");
});

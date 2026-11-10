import test from "node:test";
import assert from "node:assert/strict";
import { buildJourneyOptionsPlan } from "../src/logic/journey-options.js";
import { buildHomeForecast } from "../src/server/mobile-api.mjs";

// 2026-11-08: the bus was still waiting at the turnaround (no live arrival),
// the interval plan was already behind us and the app said "0분, 지금 나가세요".
// It must say live arrivals are not confirmed yet and tell the person again
// once they are. Times must also say whether they are live or estimated.
const headway = { status: "ready", source: "경기도 버스노선 조회", sunday: { min: 18, max: 50 }, weekday: { min: 13, max: 45 },
  saturday: { min: 18, max: 50 }, holiday: null, firstTime: "05:30", lastTime: "23:00" };
const option = (snapshot) => ({ id: "o1", binding: { provider: "gyeonggi", routeNumber: "1" }, onboardDurationSec: 2080, verified: true,
  fetchedAt: "2026-11-07T22:10:00Z", dailyMetadataDate: "2026-11-08", snapshot });
const turnaround = { headway, provider: "gyeonggi", fetchedAt: "2026-11-07T22:39:50Z", liveStatus: "ready", arrivalsMin: [], cacheStatus: "live",
  lastObservation: { fetchedAt: "2026-11-03T08:01:40Z", arrivalsMin: [4] } };
const now = new Date("2026-11-07T22:40:00Z"); // Sun 07:40 KST: last on-time boarding 08:25:20, a bus can be 50 min apart

test("no live arrival inside one interval: awaiting live, not 'leave now'", () => {
  const plan = buildJourneyOptionsPlan({ requiredArrivalTime: "09:00", boardingAccessMin: 9, options: [option(turnaround)], now, holidays: [] });
  assert.equal(plan.risk.departure, null);
  assert.equal(plan.awaitingLive, true);
});

test("the home screen says live data is not confirmed yet", () => {
  const state = { user: { requiredArrivalTime: "09:00", workLocation: { lat: 37.39, lng: 127.11 }, workAddress: "판교" },
    commute: { boardingAccessMin: 9, stopLocation: { lat: 37.27, lng: 127.05 } },
    live: { provider: "gyeonggi", stationId: "203000426", stationName: "더샵", nodeId: "" } };
  const forecast = buildHomeForecast({ state, automatic: { options: [option(turnaround)] }, now });
  assert.equal(forecast.status, "awaiting-live");
  assert.equal(forecast.title, "아직 실시간 정보가 확인되지 않았습니다.");
  assert.equal(forecast.message, "실시간 정보가 확인되는 대로 다시 알려드릴게요.");
  assert.equal(forecast.leaveAt, undefined);
});

test("each time says its basis: live, next bus by interval, or timetable estimate", () => {
  const state = { user: { requiredArrivalTime: "09:00", workLocation: { lat: 37.39, lng: 127.11 }, workAddress: "판교" },
    commute: { boardingAccessMin: 9, stopLocation: { lat: 37.27, lng: 127.05 } },
    live: { provider: "gyeonggi", stationId: "203000426", stationName: "더샵", nodeId: "" } };
  // Live bus in 12 min: that row is live, the ones after it are timed by the interval.
  const live = { ...turnaround, fetchedAt: "2026-11-07T22:39:50Z", arrivalsMin: [12], lastObservation: { fetchedAt: "2026-11-07T22:39:50Z", arrivalsMin: [12] } };
  const ready = buildHomeForecast({ state, automatic: { options: [option(live)] }, now });
  assert.equal(ready.status, "ready");
  assert.equal(ready.basis, "realtime");
  assert.equal(ready.rows[0].basis, "realtime");
  assert.ok(ready.rows.slice(1).every((row) => row.basis === "estimate"), JSON.stringify(ready.rows.map((r) => r.basis)));
  // No live data at all, early enough: the interval plan, labelled as a timetable estimate.
  const early = new Date("2026-11-07T22:19:30Z");
  const planned = buildHomeForecast({ state, automatic: { options: [option({ ...turnaround, fetchedAt: "2026-11-07T22:19:00Z" })] }, now: early });
  assert.equal(planned.status, "ready");
  assert.equal(planned.basis, "schedule");
});

test("when even the first catchable bus arrives late, it is 'already late', not 'just on time'", () => {
  // 2026-11-08 19:14: goal 20:00, first catchable bus arrives 20:26 and the
  // app said "19:47에 나가세요 · 20:26 딱 맞게 도착".
  const state = { user: { requiredArrivalTime: "08:30", workLocation: { lat: 37.39, lng: 127.11 }, workAddress: "판교" },
    commute: { boardingAccessMin: 9, stopLocation: { lat: 37.27, lng: 127.05 } },
    live: { provider: "gyeonggi", stationId: "203000426", stationName: "더샵", nodeId: "" } };
  const live = { ...turnaround, arrivalsMin: [25], lastObservation: { fetchedAt: "2026-11-07T22:39:50Z", arrivalsMin: [25] } };
  const forecast = buildHomeForecast({ state, automatic: { options: [option(live)] }, now });
  assert.equal(forecast.status, "too-late");
  // 07:40 + ~25 min (seen 10 s earlier) = 08:04:50 board, + 34m40s = 08:39:40 for an 08:30 goal: 9 min late on the clock.
  assert.equal(forecast.title, "지금 출발하면 9분 지각이에요");
  assert.equal(forecast.lateMinutes, 9);
  assert.equal(forecast.detail, "1번 버스 08:04 탑승 → 08:39 도착 예상");
  assert.equal(forecast.message, "마음을 비우고 당장 출발하세요.");
  assert.ok(forecast.slackMinutes < 0);
  assert.ok(forecast.rows.length > 0, "the buses stay listed");
  assert.equal(forecast.leaveAt, undefined, "no leave time to count down to");
});

test("a sighting from this morning does not time tonight's buses (2026-11-09 22:00, 7번)", () => {
  // 1번: live, 3 min away (cannot be caught with a 5-minute walk). 7번: no live
  // data since 11:33. The alarm had said "7번 22:09 탑승" from the 11:33 sighting.
  const at = new Date("2026-11-09T13:00:00Z"); // Mon 22:00 KST, goal 23:00
  const hw = { status: "ready", source: "경기도 버스노선 조회", weekday: { min: 20, max: 40 }, saturday: { min: 20, max: 40 }, sunday: { min: 20, max: 40 }, holiday: null };
  const opt = (id, routeNumber, snapshot) => ({ id, binding: { provider: "gyeonggi", routeNumber }, onboardDurationSec: 2080, verified: true,
    fetchedAt: at.toISOString(), dailyMetadataDate: "2026-11-09", snapshot: { headway: hw, provider: "gyeonggi", cacheStatus: "live", ...snapshot } });
  const one = opt("o1", "1", { fetchedAt: "2026-11-09T12:59:58Z", liveStatus: "ready", arrivalsMin: [3],
    lastObservation: { fetchedAt: "2026-11-09T12:59:58Z", arrivalsMin: [3] } });
  const seven = opt("o7", "7", { fetchedAt: at.toISOString(), liveStatus: "unavailable", arrivalsMin: [], cacheStatus: "unavailable",
    lastObservation: { fetchedAt: "2026-11-09T02:33:52Z", arrivalsMin: [7] } });
  const plan = buildJourneyOptionsPlan({ requiredArrivalTime: "23:00", boardingAccessMin: 5, options: [one, seven], now: at, holidays: [] });
  assert.ok(!plan.rows.some((row) => row.routeNumber === "7"), "no 7번 times carried from the morning");
  const state = { user: { requiredArrivalTime: "23:00", workLocation: { lat: 37.39, lng: 127.11 }, workAddress: "판교" },
    commute: { boardingAccessMin: 5, stopLocation: { lat: 37.27, lng: 127.05 } },
    live: { provider: "gyeonggi", stationId: "203000426", stationName: "더샵", nodeId: "" } };
  const forecast = buildHomeForecast({ state, automatic: { options: [one, seven] }, now: at });
  assert.equal(forecast.status, "awaiting-live");
  assert.equal(forecast.title, "아직 실시간 정보가 확인되지 않았습니다.");
});

test("live first, but not 30+ minutes early when a later estimated bus is closer to on time (대표 2026-11-10)", () => {
  const at = new Date("2026-11-09T13:00:00Z"); // 22:00 KST
  const hw = { status: "ready", source: "경기도 버스노선 조회", weekday: { min: 10, max: 10 }, saturday: { min: 10, max: 10 }, sunday: { min: 10, max: 10 }, holiday: null };
  const opt = (arrivals) => ({ id: "o1", binding: { provider: "gyeonggi", routeNumber: "1" }, onboardDurationSec: 2080, verified: true,
    fetchedAt: at.toISOString(), dailyMetadataDate: "2026-11-09",
    snapshot: { headway: hw, provider: "gyeonggi", cacheStatus: "live", fetchedAt: at.toISOString(), liveStatus: "ready", arrivalsMin: arrivals,
      lastObservation: { fetchedAt: at.toISOString(), arrivalsMin: arrivals } } });
  // Goal 23:00: live bus at 22:10 has ~15 min slack; estimates follow every 10 min up to 22:20.
  const tight = buildJourneyOptionsPlan({ requiredArrivalTime: "23:00", boardingAccessMin: 5, options: [opt([10])], now: at, holidays: [] });
  assert.equal(tight.risk.targetResult.estimated, false, "live bus kept with under 30 min slack");
  // Goal 23:40: the live bus would arrive ~55 min early; the latest estimated on-time bus is chosen.
  const early = buildJourneyOptionsPlan({ requiredArrivalTime: "23:40", boardingAccessMin: 5, options: [opt([10])], now: at, holidays: [] });
  assert.equal(early.risk.targetResult.estimated, true, "a later estimated bus closer to on time");
  assert.ok(early.risk.targetResult.deltaMinutes >= 0 && early.risk.targetResult.deltaMinutes < 30);
});

test("a live bus hours before the deadline does not time the deadline bus (2026-11-10 15:35, goal 21:45)", () => {
  const at = new Date("2026-11-10T06:35:00Z"); // Tue 15:35 KST
  const hw = { status: "ready", source: "경기도 버스노선 조회", weekday: { min: 13, max: 45 }, saturday: { min: 18, max: 50 }, sunday: { min: 18, max: 50 }, holiday: null };
  const opt = (snapshot) => ({ id: "o1", binding: { provider: "gyeonggi", routeNumber: "1" }, onboardDurationSec: 2080, verified: true,
    fetchedAt: at.toISOString(), dailyMetadataDate: "2026-11-10", snapshot: { headway: hw, provider: "gyeonggi", cacheStatus: "live", ...snapshot } });
  const before = buildJourneyOptionsPlan({ requiredArrivalTime: "21:45", boardingAccessMin: 5, holidays: [], now: at,
    options: [opt({ fetchedAt: at.toISOString(), liveStatus: "ready", arrivalsMin: [] })] });
  const after = buildJourneyOptionsPlan({ requiredArrivalTime: "21:45", boardingAccessMin: 5, holidays: [], now: at,
    options: [opt({ fetchedAt: at.toISOString(), liveStatus: "ready", arrivalsMin: [7, 36], lastObservation: { fetchedAt: at.toISOString(), arrivalsMin: [7, 36] } })] });
  const leave = (plan) => new Date(plan.risk.departure.leaveAt).toISOString();
  // Same leave time whether or not a 15:42 bus was seen: 21:10 last boarding − 45 min − 5 min walk.
  assert.equal(leave(before), "2026-11-10T11:20:20.000Z");
  assert.equal(leave(after), leave(before));
  assert.equal(after.risk.targetResult.intervalPlan, true);
  // No bus timed from the last live bus (16:11) more than two hours ahead.
  assert.ok(!after.rows.some((row) => row.estimated && !row.intervalPlan && row.arrivalMinutes > 36 + 120));
});

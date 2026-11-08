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

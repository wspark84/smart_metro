import test from "node:test";
import assert from "node:assert/strict";
import { goalCheck, buildHomeForecast } from "../src/server/mobile-api.mjs";

// 2026-11-08 15:28: the arrival time was still 09:00, so the app looked broken
// ("현재 시간이 조회되지 않습니다", "430분 늦음"). It should ask for a new time.
const setup = { requiredArrivalTime: "09:00", boardingAccessMin: 9 };
const automatic = { options: [{ onboardDurationSec: 2080 }] };

test("an arrival time already passed asks for a new one", () => {
  const result = goalCheck({ setup, automatic, now: new Date("2026-11-08T06:28:00Z") });
  assert.equal(result.status, "goal-passed");
  assert.equal(result.title, "시간을 다시 설정해 보세요.");
  assert.match(result.message, /오전 9:00/);
  assert.deepEqual(result.rows, []);
});

test("leaving right now still arriving late asks for a new time", () => {
  // 08:30 + 9 min walk + 35 min ride = 09:14 > 09:00
  const late = goalCheck({ setup, automatic, now: new Date("2026-11-07T23:30:00Z") });
  assert.equal(late.status, "too-late");
  // Even with a bus right away: 08:30 + 9 + 34m40s = 09:13:40 → at least 13 min late.
  assert.equal(late.title, "지금 출발해도 최소 13분 지각이에요");
  assert.equal(late.lateMinutes, 13);
  assert.equal(late.message, "마음을 비우고 당장 출발하세요.");
  // 08:00 + 44 min = 08:44: still possible, plan as usual
  assert.equal(goalCheck({ setup, automatic, now: new Date("2026-11-07T23:00:00Z") }), null);
  // No saved route yet: only the passed-time case is known
  assert.equal(goalCheck({ setup, automatic: null, now: new Date("2026-11-07T23:30:00Z") }), null);
});

test("the home forecast reports it before anything else", () => {
  const state = { user: { requiredArrivalTime: "09:00", workLocation: { lat: 37.39, lng: 127.11 }, workAddress: "판교" },
    commute: { boardingAccessMin: 9, stopLocation: { lat: 37.27, lng: 127.05 } },
    live: { provider: "gyeonggi", stationId: "203000426", stationName: "더샵", nodeId: "" } };
  const forecast = buildHomeForecast({ state, automatic: null, now: new Date("2026-11-08T06:28:00Z") });
  assert.equal(forecast.status, "goal-passed");
});

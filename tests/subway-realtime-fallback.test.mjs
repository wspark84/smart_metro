import test from "node:test";
import assert from "node:assert/strict";
import { fetchSubwayArrival, timetableTwinOf } from "../src/server/subway-providers.mjs";
import { parseTimetableBinding } from "../src/server/subway-timetable.mjs";

const binding = { provider: "subway", stationName: "광교중앙", lineName: "신분당선", routeNumber: "신분당선",
  routeId: JSON.stringify(["1077", "상행", "1077006818", "상현", "신사", "일반"]) };
const twinDeps = (calls = []) => ({ noCache: true,
  findStations: async () => [{ stationId: "SNB1", stationName: "광교중앙", routeName: "신분당선" }],
  verifyDirection: async (candidate, next) => { calls.push([parseTimetableBinding(candidate.routeId).upDownTypeCode, next]); return parseTimetableBinding(candidate.routeId).upDownTypeCode === "D"; } });

test("real-time subway without a usable countdown falls back to the same direction's timetable", async () => {
  const calls = [];
  const result = await fetchSubwayArrival(binding, { ...twinDeps(calls),
    fetchRows: async () => [{ subwayId: "1077", updnLine: "상행", statnId: "1077006818", trainLineNm: "신사행 - 상현방면", bstatnNm: "신사", btrainSttus: "일반", barvlDt: "0", recptnDt: "2026-11-02 19:26:00" }],
    fetchTimetable: async (twin) => ({ provider: "subway", lineNumber: "신분당선", arrivalsMin: [4, 10, 16], basis: "timetable", routeId: twin.routeId }) });
  assert.equal(result.basis, "timetable");
  assert.equal(result.fallbackFrom, "realtime");
  assert.deepEqual(result.arrivalsMin, [4, 10, 16]);
  const twin = parseTimetableBinding(result.routeId);
  assert.equal(twin.tagoStationId, "SNB1");
  assert.equal(twin.upDownTypeCode, "D", "direction proven by the next station, not assumed from 상행");
  assert.deepEqual(calls, [["U", "상현"], ["D", "상현"]]);
});

test("without a verified timetable direction the real-time error stands", async () => {
  await assert.rejects(fetchSubwayArrival(binding, { noCache: true, findStations: async () => [{ stationId: "SNB1" }], verifyDirection: async () => false,
    fetchRows: async () => { throw new Error("지하철 정보를 제공받지 못했습니다."); } }), /제공받지 못했습니다/);
  assert.equal(await timetableTwinOf({ ...binding, routeId: JSON.stringify(["신분당선", "상행", "tago:SNB1:U", "신사", "신사", "시간표"]) }, twinDeps()), null,
    "timetable bindings are already timetable");
});

test("a missing countdown keeps the official rows that explain it", async () => {
  const { normalizeSubwayArrival } = await import("../src/server/subway-providers.mjs");
  const now = new Date("2026-11-02T19:26:30+09:00");
  const row = { subwayId: "1077", updnLine: "상행", statnId: "1077006818", trainLineNm: "신사행 - 상현방면", bstatnNm: "신사", btrainSttus: "일반",
    barvlDt: "0", arvlCd: "99", arvlMsg2: "[4]번째 전역 (광교)", recptnDt: "2026-11-02 19:26:00" };
  assert.throws(() => normalizeSubwayArrival([row], binding, now), (error) => error.code === "SUBWAY_NO_COUNTDOWN" &&
    error.diagnostics.samples[0].barvlDt === "0" && error.diagnostics.samples[0].ageSec === 30 && error.diagnostics.samples[0].arvlMsg2.includes("번째 전역"));
  const result = await fetchSubwayArrival(binding, { ...twinDeps(), now, fetchRows: async () => [row],
    fetchTimetable: async () => ({ provider: "subway", arrivalsMin: [5], basis: "timetable" }) });
  assert.equal(result.realtimeFailure.code, "SUBWAY_NO_COUNTDOWN");
  assert.equal(result.realtimeFailure.diagnostics.samples[0].barvlDt, "0");
});

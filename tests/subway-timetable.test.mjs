import test from "node:test";
import assert from "node:assert/strict";
import { resetRequestCache } from "../src/server/request-cache.mjs";
import { timetableSeconds, dailyTypeFor, kstDateKey, timetableSubwayDirections, fetchTimetableSubwayArrival, parseTimetableBinding, verifyTimetableDirection, findTagoSubwayStations } from "../src/server/subway-timetable.mjs";
import { subwayStationRoutes } from "../src/server/subway-providers.mjs";
import { linesCompatible, parseSubwayRouteId } from "../src/logic/station-search.js";

const env = { TAGO_SERVICE_KEY: "key" };
const noHolidays = async () => ({ holidays: [] });
const STATIONS = [
  { subwayStationId: "BSN101", subwayStationName: "서면", subwayRouteName: "부산1호선" },
  { subwayStationId: "BSN201", subwayStationName: "서면", subwayRouteName: "부산2호선" },
  { subwayStationId: "BSN102", subwayStationName: "범내골", subwayRouteName: "부산1호선" },
  { subwayStationId: "BSN100", subwayStationName: "부전", subwayRouteName: "부산1호선" },
];
const hhmmss = (h, m) => `${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}00`;
// 서면 하행(D) departs :00/:10/:20…, 범내골 (next, downstream) +2 min; 부전 (upstream) −2 min.
function timetableFor(stationId, upDown) {
  const shift = { BSN101: 0, BSN102: upDown === "D" ? 2 : -2, BSN100: upDown === "D" ? -2 : 2, BSN201: 0 }[stationId] ?? 0;
  const rows = [];
  for (let h = 5; h <= 24; h += 1) for (let m = 0; m < 60; m += 10) {
    const total = h * 60 + m + shift;
    rows.push({ subwayStationId: stationId, dailyTypeCode: "01", upDownTypeCode: upDown,
      depTime: hhmmss(Math.floor(total / 60), total % 60), arrTime: hhmmss(Math.floor(total / 60), total % 60),
      endSubwayStationId: upDown === "D" ? "END-D" : "END-U", endSubwayStationNm: upDown === "D" ? "다대포해수욕장" : "노포" });
  }
  rows.push({ subwayStationId: stationId, dailyTypeCode: "01", upDownTypeCode: upDown, depTime: "0", arrTime: "053000", endSubwayStationNm: stationId });
  return rows;
}
function fakeFetch(calls = []) {
  return async (url) => {
    const u = new URL(url);
    calls.push(u.pathname);
    let items;
    if (/KwrdFnd/i.test(u.pathname)) items = STATIONS.filter((s) => s.subwayStationName === u.searchParams.get("subwayStationName"));
    else items = timetableFor(u.searchParams.get("subwayStationId"), u.searchParams.get("upDownTypeCode"));
    const body = { response: { header: { resultCode: "00" }, body: { items: { item: items }, totalCount: items.length, numOfRows: 100, pageNo: 1 } } };
    return new Response(JSON.stringify(body), { status: 200 });
  };
}
const deps = (extra = {}) => ({ env, fetchImpl: fakeFetch(), readCatalog: async () => null, loadHolidays: noHolidays, ...extra });

test("timetable times handle after-midnight service and invalid values", () => {
  assert.equal(timetableSeconds("053000"), 5.5 * 3600);
  assert.equal(timetableSeconds("0530"), 5.5 * 3600);
  assert.equal(timetableSeconds("05:30:00"), 5.5 * 3600);
  assert.equal(timetableSeconds("003000"), 24.5 * 3600);
  assert.equal(timetableSeconds("243000"), 24.5 * 3600);
  for (const bad of ["0", "", null, "126000", "abc"]) assert.equal(timetableSeconds(bad), null);
});

test("day type uses Korean dates and public holidays", () => {
  assert.equal(dailyTypeFor("2026-10-13"), "01");
  assert.equal(dailyTypeFor("2026-10-17"), "02");
  assert.equal(dailyTypeFor("2026-10-18"), "03");
  assert.equal(dailyTypeFor("2026-10-09", new Set(["2026-10-09"])), "03");
  assert.equal(kstDateKey(Date.parse("2026-10-13T16:00:00Z")), "2026-10-14");
});

test("line labels from Kakao and TAGO are matched without crossing cities", () => {
  assert.equal(linesCompatible("부산 1호선", "부산1호선"), true);
  assert.equal(linesCompatible("부산 1호선", "1호선"), true);
  assert.equal(linesCompatible("부산 1호선", "부산2호선"), false);
  assert.equal(linesCompatible("부산 1호선", "서울1호선"), false);
  assert.equal(linesCompatible("동해선", "동해선"), true);
  assert.equal(linesCompatible("부산김해경전철", "부산1호선"), false);
});

test("regional stations get timetable directions labelled by terminal, never real-time", async () => {
  resetRequestCache();
  const now = new Date("2026-10-13T08:03:00+09:00");
  const stations = await findTagoSubwayStations("서면역", "부산 1호선", deps());
  assert.deepEqual(stations.map((s) => s.stationId), ["BSN101"]);
  const routes = await timetableSubwayDirections({ stationName: "서면", lineName: "부산 1호선" }, deps({ now }));
  assert.equal(routes.length, 2);
  const down = routes.find((r) => r.upDownTypeCode === "D");
  assert.equal(down.label, "부산 1호선 · 하행 · 다대포해수욕장 방면 · 시간표 기준");
  assert.equal(down.realtime, false);
  const parsed = parseSubwayRouteId(down.routeId);
  assert.equal(parsed.stationId, "tago:BSN101:D");
  assert.equal(parseTimetableBinding(down.routeId).tagoStationId, "BSN101");
});

test("timetable arrivals are future departures in minutes, including the next service day", async () => {
  resetRequestCache();
  const binding = { stationName: "서면", routeId: JSON.stringify(["부산 1호선", "하행", "tago:BSN101:D", "다대포해수욕장", "다대포해수욕장", "시간표"]) };
  const morning = await fetchTimetableSubwayArrival(binding, deps({ now: new Date("2026-10-13T08:03:00+09:00") }));
  assert.deepEqual(morning.arrivalsMin.slice(0, 3), [7, 17, 27]);
  assert.equal(morning.basis, "timetable");
  assert.equal(morning.realtime, false);
  assert.match(morning.direction, /시간표 기준/);
  const lateNight = await fetchTimetableSubwayArrival(binding, deps({ now: new Date("2026-10-13T00:35:00+09:00") }));
  assert.equal(lateNight.arrivalsMin[0], 5, "00:40 belongs to the previous service day");
  await assert.rejects(fetchTimetableSubwayArrival({ ...binding, routeId: "[]" }, deps()), /다시 선택/);
});

test("adjacent-station timetables confirm only the direction that reaches the next station", async () => {
  resetRequestCache();
  const now = new Date("2026-10-13T08:03:00+09:00");
  const route = (ud) => ({ routeId: JSON.stringify(["부산 1호선", ud === "D" ? "하행" : "상행", `tago:BSN101:${ud}`, "x", "x", "시간표"]) });
  assert.equal(await verifyTimetableDirection(route("D"), "범내골", deps({ now })), true);
  assert.equal(await verifyTimetableDirection(route("U"), "범내골", deps({ now })), false);
  assert.equal(await verifyTimetableDirection(route("U"), "부전", deps({ now })), true);
  assert.equal(await verifyTimetableDirection(route("D"), "없는역", deps({ now })), false);
});

test("station routes keep Seoul real-time but never use it for regional lines", async () => {
  resetRequestCache();
  let seoulCalls = 0;
  const seoulFetch = async (url) => {
    if (String(url).includes("swopenapi")) { seoulCalls += 1; return new Response(JSON.stringify({ errorMessage: { code: "INFO-000" }, realtimeArrivalList: [
      { subwayId: "1001", updnLine: "상행", statnId: "1001000133", trainLineNm: "소요산행 - 종각방면", bstatnNm: "소요산", btrainSttus: "일반", statnNm: "시청" }] }), { status: 200 }); }
    return fakeFetch()(url);
  };
  const seoulEnv = { ...env, SEOUL_SUBWAY_API_KEY: "s" };
  const seoul = await subwayStationRoutes({ stationName: "시청", lineName: "1호선" }, { env: seoulEnv, fetchImpl: seoulFetch, readCatalog: async () => null, loadHolidays: noHolidays });
  assert.equal(seoul[0].basis, "realtime");
  const regional = await subwayStationRoutes({ stationName: "서면", lineName: "부산 1호선" }, { env: seoulEnv, fetchImpl: seoulFetch, readCatalog: async () => null, loadHolidays: noHolidays, now: new Date("2026-10-13T08:03:00+09:00") });
  assert.equal(seoulCalls, 1, "regional line skipped the Seoul API");
  assert.ok(regional.every((route) => route.basis === "timetable"));
  await assert.rejects(subwayStationRoutes({ stationName: "없는역", lineName: "대구 1호선" }, { env: seoulEnv, fetchImpl: seoulFetch, readCatalog: async () => null, loadHolidays: noHolidays }), /공식 시간표를 찾지 못했습니다/);
});

test("a regional location never uses Seoul real-time even without a line name", async () => {
  resetRequestCache();
  let seoulCalls = 0;
  const fetchImpl = async (url) => { if (String(url).includes("swopenapi")) { seoulCalls += 1; throw new Error("must not call"); } return fakeFetch()(url); };
  const routes = await subwayStationRoutes({ stationName: "서면", posX: "129.059", posY: "35.157" },
    { env: { ...env, SEOUL_SUBWAY_API_KEY: "s" }, fetchImpl, readCatalog: async () => null, loadHolidays: noHolidays, now: new Date("2026-10-13T08:03:00+09:00") });
  assert.equal(seoulCalls, 0);
  assert.ok(routes.length >= 2 && routes.every((r) => r.basis === "timetable"));
});

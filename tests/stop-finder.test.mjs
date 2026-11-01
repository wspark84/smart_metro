import test from "node:test";
import assert from "node:assert/strict";
import { findNearbyStops, mergeNearbyStops, describeStop, parseSeoulStationsByPos, nextStopFromSequence, inCapitalArea } from "../src/server/stop-finder.mjs";
import { parseSeoulStationRoutesXml } from "../src/server/bus-providers.mjs";

const center = { lat: 37.4979, lng: 127.0276 };
const bus = (key, provider, name, lat, lng) => ({ key, mode: "bus", provider, stationId: key, stationName: name, lat, lng });

test("Seoul getStationByPos XML becomes stops with ARS numbers", () => {
  const xml = `<ServiceResult><msgHeader><headerCd>0</headerCd></msgHeader><msgBody>
    <itemList><arsId>22009</arsId><gpsX>127.0281</gpsX><gpsY>37.4983</gpsY><stationId>121000012</stationId><stationNm>강남역</stationNm></itemList>
    <itemList><arsId>0</arsId><gpsX>127.0281</gpsX><gpsY>37.4983</gpsY><stationId>121000099</stationId><stationNm>가상</stationNm></itemList>
  </msgBody></ServiceResult>`;
  assert.deepEqual(parseSeoulStationsByPos(xml), [{ stationId: "121000012", stationName: "강남역", arsId: "22009", posX: "127.0281", posY: "37.4983" }]);
  assert.deepEqual(parseSeoulStationsByPos("<headerCd>4</headerCd>"), []);
  assert.throws(() => parseSeoulStationsByPos("<headerCd>7</headerCd>"));
});

test("Seoul route rows keep the next stop for direction", () => {
  const rows = parseSeoulStationRoutesXml(`<itemList><busRouteId>1</busRouteId><busRouteAbrv>140</busRouteAbrv><adirection>도봉산</adirection><nxtStn>신논현역</nxtStn></itemList>`);
  assert.equal(rows[0].nextStationName, "신논현역");
});

test("merge prefers the regional source, sorts by distance and pairs opposite stops", () => {
  const stops = mergeNearbyStops(center, [
    [bus("seoul:A", "seoul", "강남역", 37.4983, 127.0281), bus("seoul:B", "seoul", "강남역", 37.4975, 127.0270)],
    [bus("tago:A", "tago", "강남역", 37.49831, 127.02811), bus("tago:far", "tago", "먼곳", 37.52, 127.05)],
    [{ key: "subway:k1", mode: "subway", provider: "subway", stationId: "kakao:1", stationName: "강남", lineName: "2호선", lat: 37.4979, lng: 127.0276 }],
  ]);
  assert.deepEqual(stops.map((stop) => stop.key), ["subway:k1", "seoul:A", "seoul:B"], "duplicate TAGO copy and far stop dropped");
  assert.equal(stops.find((stop) => stop.key === "seoul:A").oppositeKey, "seoul:B");
  assert.equal(stops.find((stop) => stop.key === "seoul:B").oppositeKey, "seoul:A");
  assert.equal(stops[0].oppositeKey, "");
});

test("nearby search survives one failing source and only calls Seoul in the capital area", async () => {
  let seoulCalls = 0;
  const deps = { env: {}, seoul: async () => { seoulCalls++; throw new Error("down"); },
    national: async () => ({ provider: "tago", stations: [{ stationId: "BSB1", nodeId: "BSB1", stationName: "서면", cityCode: "21", stationNumber: "05", posX: "129.0592", posY: "35.1578" }] }),
    subway: async () => [] };
  const busan = await findNearbyStops({ lat: 35.1577, lng: 129.0590 }, deps);
  assert.equal(seoulCalls, 0);
  assert.equal(busan.stops[0].key, "tago:21:BSB1");
  assert.equal(busan.stops[0].nodeId, "BSB1");
  assert.deepEqual(busan.warnings, []);
  const seoul = await findNearbyStops(center, { ...deps, national: async () => ({ stations: [] }) });
  assert.equal(seoulCalls, 1);
  assert.deepEqual(seoul.warnings, ["서울 버스 정보를 가져오지 못했습니다."]);
  await assert.rejects(findNearbyStops({ lat: 0, lng: 0 }, deps), /지도 위치/);
  await assert.rejects(findNearbyStops(center, { seoul: async () => { throw new Error(); }, national: async () => { throw new Error(); }, subway: async () => { throw new Error(); }, env: {} }), /불러오지 못했습니다/);
  assert.equal(inCapitalArea({ lat: 35.1, lng: 129 }), false);
});

test("describe gives next stop and destinations per provider", async () => {
  const seoul = await describeStop({ provider: "seoul", arsId: "22009" }, { noCache: true, env: {},
    seoulRoutes: async () => [{ routeNumber: "140", direction: "도봉산", nextStationName: "신논현역" }, { routeNumber: "420", direction: "청량리", nextStationName: "신논현역" }, { routeNumber: "N13", direction: "도봉산", nextStationName: "강남역" }] });
  assert.equal(seoul.nextStop, "신논현역");
  assert.equal(seoul.heading, "도봉산");
  assert.deepEqual(seoul.routes.map((route) => route.routeNumber), ["140", "420", "N13"]);
  const tago = await describeStop({ provider: "tago", cityCode: "21", nodeId: "BSB2" }, { noCache: true, env: {},
    tagoRoutes: async () => [{ routeId: "R1", routeNumber: "17", destinationName: "부전역" }],
    tagoRouteStations: async () => [{ nodeid: "BSB3", nodenm: "부전시장", nodeord: 12 }, { nodeid: "BSB2", nodenm: "서면", nodeord: 11 }] });
  assert.equal(tago.nextStop, "부전시장");
  assert.equal(tago.heading, "부전역");
  const gg = await describeStop({ provider: "gyeonggi", stationId: "G1" }, { noCache: true, env: {},
    gyeonggiRoutes: async () => [{ routeId: "200", routeNumber: "7007", destinationName: "서울역" }],
    gyeonggiRouteStations: async () => { throw new Error("down"); } });
  assert.equal(gg.nextStop, "", "missing next stop falls back to destinations");
  assert.equal(gg.heading, "서울역");
  const subway = await describeStop({ provider: "subway", stationName: "서면", lineName: "부산 1호선" }, { noCache: true, env: {},
    subwayRoutes: async () => [{ destinationName: "노포", basis: "timetable" }, { destinationName: "다대포해수욕장", basis: "timetable" }] });
  assert.deepEqual(subway.directions, ["노포", "다대포해수욕장"]);
  assert.equal(subway.timetable, true);
  await assert.rejects(describeStop({ provider: "x" }), /다시 선택/);
});

test("next stop follows route order, not list order", () => {
  const rows = [{ id: "c", n: "C", o: 3 }, { id: "a", n: "A", o: 1 }, { id: "b", n: "B", o: 2 }];
  assert.equal(nextStopFromSequence(rows, "a", { idKey: "id", nameKey: "n", orderKey: "o" }), "B");
  assert.equal(nextStopFromSequence(rows, "c", { idKey: "id", nameKey: "n", orderKey: "o" }), "");
});

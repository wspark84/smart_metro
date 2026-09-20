import test from "node:test";
import assert from "node:assert/strict";
import { searchTagoStations, searchTagoStationRoutes, fetchTagoCities } from "../src/server/tago-api.mjs";
import { searchLiveStations, searchLiveStationRoutes, fetchLiveArrival } from "../src/server/bus-providers.mjs";

const station = { nodeid: "DJB8001793", nodenm: "송강전통시장", nodeno: 44810, gpslati: 36.43535, gpslong: 127.3863 };
const route = { routeid: "DJB30300050", routeno: "121", routetp: "간선버스", startnodenm: "탑립동", endnodenm: "대덕대학" };
function reply(item, extra = {}) {
  return { ok: true, status: 200, text: async () => JSON.stringify({ response: { header: { resultCode: "00" },
    body: { items: { item }, numOfRows: 100, pageNo: 1, totalCount: Array.isArray(item) ? item.length : 1, ...extra } } }) };
}
const binding = { serviceKey: "fixture-key", cityCode: "25" };

test("empty static route list falls back to official arrivals for the same station, deduplicating routes", async () => {
  const calls = [];
  const routes = await searchTagoStationRoutes({ ...binding, nodeId: station.nodeid, fetchImpl: async url => {
    calls.push(url.pathname);
    if (url.pathname.endsWith('/getSttnThrghRouteList')) return reply([], {totalCount:0});
    assert.equal(url.searchParams.get('nodeId'), station.nodeid);
    assert.equal(url.searchParams.get('cityCode'), '25');
    return reply([{...route,nodeid:station.nodeid}, {...route,nodeid:station.nodeid}]);
  }});
  assert.equal(calls.length, 2);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].routeId, route.routeid);
  assert.equal(routes[0].source, 'live-arrivals');
  assert.match(routes[0].label, /전체 노선 목록이 아닙니다/);
});

test("arrival fallback never borrows routes from another stop", async () => {
  await assert.rejects(searchTagoStationRoutes({ ...binding, nodeId: station.nodeid, fetchImpl: async url =>
    url.pathname.endsWith('/getSttnThrghRouteList') ? reply([], {totalCount:0}) : reply({...route,nodeid:'OTHER'})
  }), /정류장/);
});

test("both official sources empty leave route selection empty without inventing a route", async () => {
  assert.deepEqual(await searchTagoStationRoutes({ ...binding, nodeId: station.nodeid,
    fetchImpl: async () => reply([], {totalCount:0}) }), []);
});

test("TAGO name search uses nodeNm and returns official IDs and correctly oriented coordinates", async () => {
  const result = await searchTagoStations({ ...binding, keyword: " 전통시장 ", fetchImpl: async (url) => {
    assert.equal(url.origin, "https://apis.data.go.kr");
    assert.equal(url.pathname, "/1613000/BusSttnInfoInqireService/getSttnNoList");
    assert.equal(url.searchParams.get("nodeNm"), "전통시장");
    assert.equal(url.searchParams.get("cityCode"), "25");
    assert.equal(url.searchParams.has("nodeNo"), false);
    return reply(station);
  } });
  assert.deepEqual(result, [{ stationId: station.nodeid, nodeId: station.nodeid, stationName: station.nodenm,
    cityCode: "25", stationNumber: "44810", posX: "127.3863", posY: "36.43535" }]);
});

test("TAGO numeric search uses nodeNo, not nodeId or a guessed ID prefix", async () => {
  await searchTagoStations({ ...binding, keyword: "44810", fetchImpl: async (url) => {
    assert.equal(url.searchParams.get("nodeNo"), "44810");
    assert.equal(url.searchParams.has("nodeNm"), false);
    return reply(station);
  } });
});

test("TAGO same-name opposite stops remain separate selectable candidates across pages", async () => {
  const result = await searchTagoStations({ ...binding, keyword: "시장", fetchImpl: async (url) => {
    const pageNo = Number(url.searchParams.get("pageNo"));
    return reply({ ...station, nodeid: `STOP${pageNo}` }, { pageNo, numOfRows: 1, totalCount: 2 });
  } });
  assert.deepEqual(result.map((item) => item.nodeId), ["STOP1", "STOP2"]);
  assert.equal(result[0].stationName, result[1].stationName);
});

test("TAGO no search results stay empty and malformed coordinates do not become a fake location", async () => {
  assert.deepEqual(await searchTagoStations({ ...binding, keyword: "없음", fetchImpl: async () => reply([], { totalCount: 0 }) }), []);
  const [result] = await searchTagoStations({ ...binding, keyword: "시장", fetchImpl: async () => reply({ ...station, gpslati: "", gpslong: null }) });
  assert.equal(result.posX, "");
  assert.equal(result.posY, "");
  await assert.rejects(searchTagoStations({ ...binding, keyword: "시장", fetchImpl: async () => reply({ ...station, nodeid: "" }) }), /고유번호/);
});

test("TAGO station-route endpoint uses lowercase nodeid and exposes endpoints without inventing direction", async () => {
  const results = await searchTagoStationRoutes({ ...binding, nodeId: station.nodeid, fetchImpl: async (url) => {
    assert.equal(url.pathname, "/1613000/BusSttnInfoInqireService/getSttnThrghRouteList");
    assert.equal(url.searchParams.get("nodeid"), station.nodeid);
    assert.equal(url.searchParams.has("nodeId"), false);
    return reply(route);
  } });
  assert.equal(results[0].routeId, route.routeid);
  assert.equal(results[0].destinationName, "대덕대학");
  assert.equal(results[0].startStationName, "탑립동");
  assert.equal(results[0].direction, undefined);
  assert.equal(results[0].order, "");
});

test("TAGO route-number filtering is exact and preserves distinct IDs with the same number", async () => {
  const results = await searchTagoStationRoutes({ ...binding, nodeId: station.nodeid, routeNumber: "1", fetchImpl: async () => reply([
    { ...route, routeid: "R1", routeno: "1" }, { ...route, routeid: "R2", routeno: "1" }, { ...route, routeid: "R10", routeno: "10" },
  ]) });
  assert.deepEqual(results.map((item) => item.routeId), ["R1", "R2"]);
});

test("TAGO station city list uses the station service, not assumed arrival coverage", async () => {
  await fetchTagoCities({ ...binding, service: "stops", fetchImpl: async (url) => {
    assert.equal(url.pathname, "/1613000/BusSttnInfoInqireService/getCtyCodeList");
    return reply({ citycode: "25", cityname: "대전광역시" });
  } });
});

test("TAGO search rejects incomplete input before sending any request", async () => {
  const fetchImpl = async () => assert.fail("must not call provider");
  await assert.rejects(searchTagoStations({ ...binding, cityCode: "", keyword: "시장", fetchImpl }), /도시코드/);
  await assert.rejects(searchTagoStations({ ...binding, keyword: " ", fetchImpl }), /정류장/);
  await assert.rejects(searchTagoStationRoutes({ ...binding, nodeId: "", fetchImpl }), /고유번호/);
});

test("TAGO full server flow carries official station and route IDs into arrival requests", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TAGO_SERVICE_KEY;
  try {
    process.env.TAGO_SERVICE_KEY = binding.serviceKey;
    globalThis.fetch = async (url) => {
      assert.equal(url.searchParams.get("serviceKey"), binding.serviceKey);
      if (url.pathname.endsWith("/getSttnNoList")) return reply(station);
      if (url.pathname.endsWith("/getSttnThrghRouteList")) {
        assert.equal(url.searchParams.get("nodeid"), station.nodeid);
        return reply(route);
      }
      assert.equal(url.pathname.endsWith("/getSttnAcctoSpcifyRouteBusArvlPrearngeInfoList"), true);
      assert.equal(url.searchParams.get("nodeId"), station.nodeid);
      assert.equal(url.searchParams.get("routeId"), route.routeid);
      return reply({ ...station, ...route, arrtime: 123 });
    };
    const { stations } = await searchLiveStations({ provider: "tago", cityCode: "25", keyword: "시장" });
    const { routes } = await searchLiveStationRoutes({ provider: "tago", cityCode: stations[0].cityCode, nodeId: stations[0].nodeId });
    const result = await fetchLiveArrival({ provider: "tago", cityCode: stations[0].cityCode, nodeId: stations[0].nodeId, routeId: routes[0].routeId });
    assert.deepEqual(result.arrivalsMin, [2.05]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TAGO_SERVICE_KEY;
    else process.env.TAGO_SERVICE_KEY = originalKey;
  }
});

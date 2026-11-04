import test from "node:test";
import assert from "node:assert/strict";
import { findNearbyStops, describeStop } from "../src/server/stop-finder.mjs";
import { parseSeoulStationRoutesXml, regionalBusProvider, isSeoulStationId } from "../src/server/bus-providers.mjs";
import { applyCommuteSetup } from "../src/server/mobile-api.mjs";

// 2026-11-04: 아주대.아주대학교병원 (Suwon, Gyeonggi ID 203000066) came back from
// Seoul's getStationByPos, was saved as a Seoul stop, and Seoul's route API
// failed for it every time, so no times could be looked up.
const ajou = { stationId: "203000066", stationName: "아주대.아주대학교병원", arsId: "4237", posX: "127.0439", posY: "37.2786" };

test("Gyeonggi stops listed by Seoul's bus API become Gyeonggi stops", async () => {
  assert.equal(regionalBusProvider("seoul", "203000066"), "gyeonggi");
  assert.equal(regionalBusProvider("seoul", "121000012"), "seoul");
  assert.equal(regionalBusProvider("tago", "203000066"), "tago");
  assert.equal(isSeoulStationId("121000012"), true);
  assert.equal(isSeoulStationId("203000066"), false);
  const found = await findNearbyStops({ lat: 37.2787, lng: 127.0440 }, { env: {},
    seoul: async () => [ajou], national: async () => ({ stations: [] }), subway: async () => [] });
  assert.equal(found.stops[0].provider, "gyeonggi");
  assert.equal(found.stops[0].key, "gyeonggi:203000066");
  let asked = "";
  const described = await describeStop({ provider: "seoul", stationId: "203000066", arsId: "4237" }, { noCache: true, env: {},
    seoulRoutes: async () => { throw new Error("Seoul API must not be asked"); },
    gyeonggiRoutes: async ({ stationId }) => { asked = stationId; return [{ routeId: "R1", routeNumber: "7", destinationName: "광교" }]; },
    gyeonggiRouteStations: async () => [] });
  assert.equal(asked, "203000066");
  assert.deepEqual(described.routes.map((route) => route.routeNumber), ["7"]);
});

test("saving a Seoul-listed Gyeonggi stop stores it as Gyeonggi", () => {
  const state = applyCommuteSetup({ user: {}, commute: {}, live: {} }, {
    boarding: { provider: "seoul", stationId: "203000066", stationName: "아주대.아주대학교병원", arsId: "4237", lat: 37.2786, lng: 127.0439 } });
  assert.equal(state.live.provider, "gyeonggi");
  assert.equal(state.live.stationId, "203000066");
});

test("Seoul route API errors carry their result code for the logs", () => {
  assert.throws(() => parseSeoulStationRoutesXml("<ServiceResult><msgHeader><headerCd>4</headerCd><headerMsg>결과가 없습니다.</headerMsg></msgHeader></ServiceResult>"),
    (error) => error.apiCode === 4);
});

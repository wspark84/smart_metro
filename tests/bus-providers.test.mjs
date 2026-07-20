import test from "node:test";
import assert from "node:assert/strict";

import {
  getBusApiConfig,
  normalizeGyeonggiArrival,
  normalizeGyeonggiStationRoutes,
  normalizeGyeonggiStations,
  normalizeSeoulArrival,
  normalizeSeoulStationRoutes,
  normalizeSeoulStations,
  normalizeTagoArrival,
  parseSeoulArrivalXml,
  parseSeoulStationRoutesXml,
  parseSeoulStationSearchXml,
} from "../src/server/bus-providers.mjs";

test("parseSeoulArrivalXml extracts route number and arrival minutes", () => {
  const xml = `
    <ServiceResult>
      <msgHeader>
        <headerCd>0</headerCd>
        <headerMsg>OK</headerMsg>
      </msgHeader>
      <msgBody>
        <itemList>
          <stNm>Downtown</stNm>
          <busRouteAbrv>1002</busRouteAbrv>
          <arrmsg1>5 minutes</arrmsg1>
          <arrmsg2>18 minutes</arrmsg2>
          <arrtime1>300</arrtime1>
          <arrtime2>1080</arrtime2>
        </itemList>
      </msgBody>
    </ServiceResult>
  `;

  const parsed = parseSeoulArrivalXml(xml);
  const normalized = normalizeSeoulArrival(parsed);

  assert.equal(normalized.lineNumber, "1002");
  assert.equal(normalized.stopName, "Downtown");
  assert.deepEqual(normalized.arrivalsMin, [5, 18]);
});

test("parseSeoulStationSearchXml extracts station ids and ars ids", () => {
  const xml = `
    <ServiceResult>
      <msgHeader>
        <headerCd>0</headerCd>
        <headerMsg>OK</headerMsg>
      </msgHeader>
      <msgBody>
        <itemList>
          <stId>100000001</stId>
          <stNm>City Hall</stNm>
          <arsId>01001</arsId>
          <posX>126.978</posX>
          <posY>37.566</posY>
        </itemList>
      </msgBody>
    </ServiceResult>
  `;

  const normalized = normalizeSeoulStations(parseSeoulStationSearchXml(xml));

  assert.deepEqual(normalized, [
    {
      stationId: "100000001",
      stationName: "City Hall",
      arsId: "01001",
      posX: "126.978",
      posY: "37.566",
    },
  ]);
});

test("parseSeoulStationRoutesXml extracts routeId and station order for a stop", () => {
  const xml = `
    <ServiceResult>
      <msgHeader>
        <headerCd>0</headerCd>
        <headerMsg>OK</headerMsg>
      </msgHeader>
      <msgBody>
        <itemList>
          <stId>100000001</stId>
          <stNm>City Hall</stNm>
          <arsId>01001</arsId>
          <busRouteId>100100118</busRouteId>
          <busRouteAbrv>753</busRouteAbrv>
          <rtNm>753</rtNm>
          <staOrd>12</staOrd>
          <adirection>To Eunpyeong</adirection>
          <routeType>3</routeType>
          <term>10</term>
        </itemList>
      </msgBody>
    </ServiceResult>
  `;

  const normalized = normalizeSeoulStationRoutes(parseSeoulStationRoutesXml(xml));

  assert.deepEqual(normalized, [
    {
      routeId: "100100118",
      routeNumber: "753",
      routeName: "753",
      order: "12",
      direction: "To Eunpyeong",
      routeType: "3",
      term: "10",
      stationId: "100000001",
      stationName: "City Hall",
      arsId: "01001",
    },
  ]);
});

test("normalizeGyeonggiArrival filters rows by routeId and keeps first two predictions", () => {
  const normalized = normalizeGyeonggiArrival(
    {
      response: {
        msgBody: {
          busArrivalList: [
            {
              stationName: "Bundang Center",
              routeId: "241005300",
              routeName: "8109",
              predictTime1: 4,
              predictTime2: 16,
              locationNo1: "2 stops away",
              locationNo2: "7 stops away",
            },
            {
              stationName: "Bundang Center",
              routeId: "241005999",
              routeName: "M4102",
              predictTime1: 1,
              predictTime2: 9,
            },
          ],
        },
      },
    },
    { routeId: "241005300" },
  );

  assert.equal(normalized.lineNumber, "8109");
  assert.equal(normalized.stopName, "Bundang Center");
  assert.deepEqual(normalized.arrivalsMin, [4, 16]);
  assert.deepEqual(normalized.messages, ["2 stops away", "7 stops away"]);
});

test("normalizeGyeonggiStations extracts official stop candidates", () => {
  const stations = normalizeGyeonggiStations({
    response: {
      msgBody: {
        busStationList: [
          {
            stationId: "200000118",
            stationName: "Sunae Station",
            mobileNo: "07-123",
            regionName: "Seongnam",
          },
          {
            stationId: "200000119",
            stationName: "Jeongja Station",
            mobileNo: "07-456",
            regionName: "Seongnam",
          },
        ],
      },
    },
  });

  assert.deepEqual(stations, [
    {
      stationId: "200000118",
      stationName: "Sunae Station",
      stationNumber: "07-123",
      regionName: "Seongnam",
    },
    {
      stationId: "200000119",
      stationName: "Jeongja Station",
      stationNumber: "07-456",
      regionName: "Seongnam",
    },
  ]);
});

test("normalizeGyeonggiStationRoutes extracts official route candidates for a stop", () => {
  const routes = normalizeGyeonggiStationRoutes({
    response: {
      msgBody: {
        busRouteList: [
          {
            routeId: "241005300",
            routeName: "8109",
            staOrder: "17",
            regionName: "Seongnam",
            routeDestName: "Seoul Station",
            routeTypeCd: "14",
            routeTypeName: "Metropolitan Express",
            stationId: "200000118",
          },
          {
            routeId: "241005301",
            routeName: "M4102",
            staOrder: "9",
            regionName: "Seongnam",
            routeDestName: "Gangnam",
            routeTypeCd: "14",
            routeTypeName: "Metropolitan Express",
            stationId: "200000118",
          },
        ],
      },
    },
  });

  assert.deepEqual(routes, [
    {
      routeId: "241005300",
      routeNumber: "8109",
      routeName: "8109",
      order: "17",
      regionName: "Seongnam",
      destinationName: "Seoul Station",
      routeTypeCd: "14",
      routeTypeName: "Metropolitan Express",
      stationId: "200000118",
    },
    {
      routeId: "241005301",
      routeNumber: "M4102",
      routeName: "M4102",
      order: "9",
      regionName: "Seongnam",
      destinationName: "Gangnam",
      routeTypeCd: "14",
      routeTypeName: "Metropolitan Express",
      stationId: "200000118",
    },
  ]);
});

test("normalizeTagoArrival filters rows by route number and returns first two arrivals", () => {
  const normalized = normalizeTagoArrival(
    {
      response: {
        body: {
          items: {
            item: [
              {
                nodenm: "North Gate",
                routeno: "5",
                arrtime: 816,
              },
              {
                nodenm: "North Gate",
                routeno: "5",
                arrtime: 1542,
              },
              {
                nodenm: "North Gate",
                routeno: "7",
                arrtime: 220,
              },
            ],
          },
        },
      },
    },
    "5",
  );

  assert.equal(normalized.lineNumber, "5");
  assert.equal(normalized.stopName, "North Gate");
  assert.deepEqual(normalized.arrivalsMin, [14, 26]);
});

test("getBusApiConfig uses accuracy-first provider priority and prefers TAGO first for Gyeonggi", () => {
  const config = getBusApiConfig();

  assert.equal(config.policy.objective, "accuracy-first");
  assert.deepEqual(config.policy.regionPriority.seoul, ["seoul", "tago"]);
  assert.deepEqual(config.policy.regionPriority.gyeonggi, ["tago", "gyeonggi"]);
  assert.equal(config.providers.gyeonggi.label, "Gyeonggi Direct (Compare Accuracy)");
  assert.equal(config.providers.gyeonggi.role, "regional-candidate");
  assert.deepEqual(config.providers.gyeonggi.recommendedRegions, ["gyeonggi"]);
  assert.equal(config.providers.gyeonggi.setup.bindingMode, "search-assisted");
  assert.equal(config.providers.gyeonggi.setup.stationSearchSupported, true);
  assert.equal(config.providers.gyeonggi.setup.stationRouteSearchSupported, true);
  assert.equal(config.providers.tago.label, "TAGO (Accuracy-first candidate)");
  assert.equal(config.providers.tago.role, "national-candidate");
  assert.deepEqual(config.providers.tago.recommendedRegions, ["national", "gyeonggi"]);
  assert.equal(config.providers.tago.setup.bindingMode, "manual");
  assert.equal(config.providers.tago.setup.stationSearchSupported, false);
  assert.equal(config.providers.tago.setup.stationRouteSearchSupported, false);
  assert.match(config.providers.tago.setup.guidance, /Accuracy matters more than API ownership/);
});

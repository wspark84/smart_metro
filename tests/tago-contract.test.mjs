import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fetchTagoArrival, normalizeTagoArrival, fetchLiveArrival } from "../src/server/bus-providers.mjs";
import { fetchTagoCities, parseTagoResponse } from "../src/server/tago-api.mjs";
import { evaluateLateRisk } from "../src/logic/commute.js";

const row = (arrtime, extra = {}) => ({ nodeid: "DJB8001793", nodenm: "북대전농협",
  routeid: "DJB30300002", routeno: "5", routetp: "마을버스", arrprevstationcnt: 15,
  vehicletp: "일반차량", arrtime, ...extra });
const payload = (item, extra = {}) => ({ response: { header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
  body: { items: { item }, pageNo: 1, numOfRows: 100, totalCount: Array.isArray(item) ? item.length : 1, ...extra } } });
const reply = (value, status = 200) => ({ ok: status >= 200 && status < 300, status,
  text: async () => typeof value === "string" ? value : JSON.stringify(value) });
const binding = { serviceKey: "fixture+/=key", cityCode: "25", nodeId: "DJB8001793", routeId: "DJB30300002" };

test("TAGO documented specific-route operation uses HTTPS and correctly cased, singly encoded parameters", async () => {
  const result = await fetchTagoArrival({ ...binding, routeNumber: "outdated-label", fetchImpl: async (url, init) => {
    assert.equal(url.protocol, "https:");
    assert.equal(url.pathname, "/1613000/ArvlInfoInqireService/getSttnAcctoSpcifyRouteBusArvlPrearngeInfoList");
    assert.equal(url.searchParams.get("serviceKey"), binding.serviceKey);
    assert.equal(url.searchParams.get("cityCode"), "25");
    assert.equal(url.searchParams.get("nodeId"), binding.nodeId);
    assert.equal(url.searchParams.get("routeId"), binding.routeId);
    assert.equal(url.searchParams.has("routeid"), false);
    assert.equal(url.searchParams.get("_type"), "json");
    assert.equal(url.searchParams.get("pageNo"), "1");
    assert.ok(init.signal);
    return reply(payload(row(816)));
  } });
  assert.equal(result.stopName, "북대전농협");
  assert.equal(result.lineNumber, "5");
  assert.deepEqual(result.arrivalsMin, [13.6]);
});

test("TAGO legacy route-number lookup fetches all pages, including a match beyond page one", async () => {
  const pages = [];
  const result = await fetchTagoArrival({ ...binding, routeId: "", routeNumber: "5", fetchImpl: async (url) => {
    assert.equal(url.pathname.endsWith("/getSttnAcctoArvlPrearngeInfoList"), true);
    assert.equal(url.searchParams.has("routeId"), false);
    const pageNo = Number(url.searchParams.get("pageNo"));
    pages.push(pageNo);
    return reply(payload(pageNo === 1 ? row(60, { routeid: "R7", routeno: "7" }) : row(816),
      { pageNo, numOfRows: 1, totalCount: 2 }));
  } });
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(result.arrivalsMin, [13.6]);
});

test("TAGO retains every vehicle so last on-time selection does not stop at the second bus", () => {
  const normalized = normalizeTagoArrival(payload([row(1560), row(300), row(720), row(1200)]), { routeId: binding.routeId });
  assert.deepEqual(normalized.arrivalsMin, [5, 12, 20, 26]);
  const risk = evaluateLateRisk({ requiredArrivalTime: "09:00", now: new Date("2026-09-15T08:00:00+09:00"),
    route: { onboardToDestinationMin: 40 }, busArrivalsMin: normalized.arrivalsMin });
  assert.equal(risk.targetResult.arrivalMinutes, 20);
  assert.equal(risk.lastChanceConfirmed, true);
});

test("TAGO 1229 seconds must not become 20 minutes and incorrectly predict on-time arrival", () => {
  const normalized = normalizeTagoArrival(payload(row(1229)), "5");
  const risk = evaluateLateRisk({ requiredArrivalTime: "09:00", now: new Date("2026-09-15T08:00:00+09:00"),
    route: { onboardToDestinationMin: 40 }, busArrivalsMin: normalized.arrivalsMin });
  assert.equal(risk.targetResult.arriveWorkAt.toISOString(), "2026-09-15T00:00:29.000Z");
  assert.equal(risk.targetResult.level, "ORANGE");
  assert.equal(risk.lastChanceConfirmed, false);
});

test("TAGO route ID is authoritative and does not merge identical public bus numbers", () => {
  const source = payload([row(600), row(60, { routeid: "OTHER" })]);
  assert.deepEqual(normalizeTagoArrival(source, { routeId: binding.routeId }).arrivalsMin, [10]);
  assert.deepEqual(normalizeTagoArrival(source, binding.routeId).arrivalsMin, [10]);
  assert.throws(() => normalizeTagoArrival(source, "5"), /routeId/);
  assert.throws(() => normalizeTagoArrival(source, { routeId: "missing", routeNumber: "5" }), /selected route/);
});

test("TAGO station identity prevents opposite-stop data from mixing", () => {
  const source = payload([row(600), row(60, { nodeid: "OTHER" })]);
  assert.deepEqual(normalizeTagoArrival(source, { ...binding }).arrivalsMin, [10]);
  assert.throws(() => normalizeTagoArrival(source, { routeId: binding.routeId }), /nodeId/);
  assert.throws(() => normalizeTagoArrival(source, { routeId: binding.routeId, nodeId: "missing" }), /no arrival/);
});

test("TAGO arriving-now zero is valid but invalid selected ETAs cannot silently omit a vehicle", () => {
  assert.deepEqual(normalizeTagoArrival(payload(row("0")), "5").arrivalsMin, [0]);
  for (const invalid of [null, undefined, "", " ", "NaN", -1, false, true, [60], {}, 1.5]) {
    assert.throws(() => normalizeTagoArrival(payload([row(600), row(invalid)]), "5"), /valid arrival seconds/);
  }
});

test("TAGO empty arrival responses are unavailable, not a fabricated zero-minute bus", async () => {
  await assert.rejects(fetchTagoArrival({ ...binding, fetchImpl: async () => reply(payload("", { items: "", totalCount: 0 })) }), /no arrival/);
});

test("TAGO missing key, city, stop or route are rejected before any network call", async () => {
  const fetchImpl = async () => assert.fail("must not fetch");
  for (const invalid of [{ serviceKey: "" }, { cityCode: "" }, { nodeId: "" }, { routeId: "" }]) {
    await assert.rejects(fetchTagoArrival({ ...binding, ...invalid, fetchImpl }), /configured|requires/);
  }
});

test("TAGO JSON service errors are checked even with HTTP 200", () => {
  for (const code of ["01", "04", "12", "20", "22", "30", "31", "32", "99"]) {
    assert.throws(() => parseTagoResponse(JSON.stringify({ response: { header: { resultCode: code }, body: {} } })), /TAGO API 오류/);
  }
  assert.throws(() => parseTagoResponse(JSON.stringify({ response: { body: {} } })), /TAGO API 오류/);
});

test("TAGO XML gateway errors work with both HTTP 200 and HTTP errors, without leaking provider text", async () => {
  for (const status of [200, 403]) {
    await assert.rejects(fetchTagoArrival({ ...binding, fetchImpl: async () => reply(
      `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>secret fixture+/=key</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`, status) }),
    (error) => {
      assert.match(error.message, /\(30\).*TAGO_SERVICE_KEY/);
      assert.doesNotMatch(error.message, /fixture|secret/);
      return true;
    });
  }
});

test("TAGO malformed and HTTP error responses are sanitized", async () => {
  assert.throws(() => parseTagoResponse("not JSON secret"), /응답을 읽을 수 없습니다/);
  assert.throws(() => parseTagoResponse('<html>proxy error</html>'), /TAGO API 오류/);
  assert.throws(() => parseTagoResponse('{"response":{"header":{"resultCode":"00"}}}'), /본문/);
  await assert.rejects(fetchTagoArrival({ ...binding, fetchImpl: async () => reply("secret", 503) }), /failed with 503/);
  await assert.rejects(fetchTagoArrival({ ...binding, fetchImpl: async (url) => { throw new Error(`failed ${url}`); } }), (error) => {
    assert.match(error.message, /통신에 실패/);
    assert.doesNotMatch(error.message, /fixture|serviceKey|https/);
    return true;
  });
});

test("TAGO rejects incomplete, mismatched and changing pagination instead of trusting partial arrivals", async () => {
  for (const malformed of [{ pageNo: 2 }, { totalCount: undefined }, { numOfRows: 0 }, { totalCount: 0 }, { items: "", totalCount: 2 }]) {
    await assert.rejects(fetchTagoArrival({ ...binding, fetchImpl: async () => reply(payload(row(600), malformed)) }), /TAGO API/);
  }
  await assert.rejects(fetchTagoArrival({ ...binding, fetchImpl: async (url) => {
    const pageNo = Number(url.searchParams.get("pageNo"));
    return reply(payload(row(600), { pageNo, numOfRows: 1, totalCount: pageNo === 1 ? 2 : 3 }));
  } }), /조회 중 변경/);
});

test("TAGO pagination is bounded and excessive results are never silently truncated", async () => {
  let count = 0;
  await assert.rejects(fetchTagoArrival({ ...binding, fetchImpl: async () => {
    count += 1;
    return reply(payload(row(600), { pageNo: count, numOfRows: 1, totalCount: 11 }));
  } }), /조회 한도/);
  assert.equal(count, 10);
});

test("TAGO city-code operation follows the guide without invented region codes or pagination parameters", async () => {
  const cities = await fetchTagoCities({ serviceKey: binding.serviceKey, fetchImpl: async (url) => {
    assert.equal(url.pathname.endsWith("/getCtyCodeList"), true);
    assert.equal(url.searchParams.has("cityCode"), false);
    assert.equal(url.searchParams.has("pageNo"), false);
    return reply(payload({ citycode: 22, cityname: "대구광역시" }));
  } });
  assert.deepEqual(cities, [{ cityCode: "22", cityName: "대구광역시" }]);
  await assert.rejects(fetchTagoCities({ serviceKey: binding.serviceKey, fetchImpl: async () => reply(payload({ cityname: "missing code" })) }), /도시코드/);
});

test("live TAGO binding passes routeId to the dedicated operation", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.TAGO_SERVICE_KEY;
  try {
    process.env.TAGO_SERVICE_KEY = binding.serviceKey;
    globalThis.fetch = async (url) => {
      assert.equal(url.searchParams.get("routeId"), binding.routeId);
      return reply(payload(row(816)));
    };
    const result = await fetchLiveArrival({ provider: "tago", ...binding });
    assert.equal(result.provider, "tago");
    assert.deepEqual(result.arrivalsMin, [13.6]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.TAGO_SERVICE_KEY;
    else process.env.TAGO_SERVICE_KEY = previousKey;
  }
});

test("TAGO settings and both accuracy-comparison callers preserve the selected route ID", async () => {
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const tagoPanel = app.slice(app.indexOf('state.live.provider === "tago"', app.indexOf('data-field="live.provider"')));
  assert.match(tagoPanel, /노선 고유번호 \(routeId, 권장\)/);
  assert.match(tagoPanel, /data-field="live.routeId"/);
  assert.match(app, /routeId: tagoBinding.routeId/);
  assert.match(server, /routeId: tagoBinding.routeId/);
});

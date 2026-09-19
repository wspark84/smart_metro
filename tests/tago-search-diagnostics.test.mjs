import test from "node:test";
import assert from "node:assert/strict";
import { searchTagoStations } from "../src/server/tago-api.mjs";

const station = { nodeid: "GGB123", nodenm: "공개 정류장", nodeno: 4413, gpslati: 37.2, gpslong: 127.1 };
const response = (rows, extra = {}) => ({ ok: true, status: 200, text: async () => JSON.stringify({
  response: { header: { resultCode: "00" }, body: { items: { item: rows }, pageNo: 1, numOfRows: 100, totalCount: rows.length, ...extra } },
}) });
const base = { serviceKey: "NEVER-LOG-THIS-KEY", cityCode: "31010", keyword: "4413" };
const capture = () => { const logs = []; return { logs, diagnosticLogger: line => logs.push(JSON.parse(line)) }; };

test("station diagnostics distinguish upstream zero results from transformed results", async () => {
  const captureLog = capture();
  const result = await searchTagoStations({ ...base, ...captureLog, fetchImpl: async () => response([]) });
  assert.deepEqual(result, []);
  assert.deepEqual(captureLog.logs.map(log => log.event), ["search_started", "upstream_page", "search_completed"]);
  const [start, page, end] = captureLog.logs;
  assert.equal(start.cityCode, "31010");
  assert.equal(start.queryKind, "nodeNo");
  assert.equal(start.queryLength, 4);
  assert.equal(page.totalCount, 0);
  assert.equal(page.rowCount, 0);
  assert.equal(end.resultCount, 0);
  assert.equal(end.source, "upstream");
  assert.equal(new Set(captureLog.logs.map(log => log.searchId)).size, 1);
});

test("station diagnostics count all pages and map eligible results without logging raw data", async () => {
  const captureLog = capture();
  const privateQuery = "private-person@example.test";
  const result = await searchTagoStations({ ...base, ...captureLog, keyword: privateQuery, fetchImpl: async url => {
    const pageNo = Number(url.searchParams.get("pageNo"));
    return response([{ ...station, nodeid: `GGB${pageNo}`, gpslati: pageNo === 1 ? 37.2 : "", sensitive: base.serviceKey }], { pageNo, numOfRows: 1, totalCount: 2 });
  } });
  assert.equal(result.length, 2);
  assert.equal(captureLog.logs.filter(log => log.event === "upstream_page").length, 2);
  assert.equal(captureLog.logs.at(-1).resultCount, 2);
  assert.equal(captureLog.logs.at(-1).mapEligibleCount, 1);
  const output = JSON.stringify(captureLog.logs);
  for (const secret of [base.serviceKey, privateQuery, station.nodenm, "GGB1", "37.2", "127.1"]) assert.equal(output.includes(secret), false);
});

test("cached searches are identified without another upstream call", async () => {
  const captureLog = capture(); let calls = 0;
  const fetchImpl = async () => { calls++; return response([station]); };
  await searchTagoStations({ ...base, ...captureLog, fetchImpl });
  await searchTagoStations({ ...base, ...captureLog, fetchImpl });
  assert.equal(calls, 1);
  assert.equal(captureLog.logs.at(-1).source, "cache_or_inflight");
  assert.equal(captureLog.logs.at(-1).resultCount, 1);
});

test("malformed upstream data produces a stage-only failure, not a fake empty result", async () => {
  const captureLog = capture();
  await assert.rejects(searchTagoStations({ ...base, ...captureLog, fetchImpl: async () => response([{ ...station, nodeid: "" }]) }));
  assert.equal(captureLog.logs.at(-1).event, "search_failed");
  assert.equal(captureLog.logs.at(-1).stage, "normalize");
  assert.equal(captureLog.logs.some(log => log.event === "search_completed"), false);
  const transportLog = capture();
  await assert.rejects(searchTagoStations({ ...base, ...transportLog, fetchImpl: async () => { throw new Error(base.serviceKey); } }));
  assert.equal(transportLog.logs.at(-1).stage, "upstream");
  assert.equal(JSON.stringify(transportLog.logs).includes(base.serviceKey), false);
});

test("diagnostic logger failure cannot break station search, and invalid input is never logged", async () => {
  const result = await searchTagoStations({ ...base, diagnosticLogger: () => { throw new Error("logging unavailable"); }, fetchImpl: async () => response([station]) });
  assert.equal(result.length, 1);
  const captureLog = capture();
  await assert.rejects(searchTagoStations({ ...base, ...captureLog, keyword: "" }));
  assert.deepEqual(captureLog.logs, []);
});

test("concurrent searches keep independent IDs and share one upstream request", async () => {
  const first = capture(), second = capture(); let release; let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const fetchImpl = async () => { calls++; await gate; return response([station]); };
  const a = searchTagoStations({ ...base, ...first, fetchImpl });
  const b = searchTagoStations({ ...base, ...second, fetchImpl });
  release();
  const [aResult, bResult] = await Promise.all([a, b]);
  assert.deepEqual(aResult, bResult);
  assert.equal(calls, 1);
  assert.notEqual(first.logs[0].searchId, second.logs[0].searchId);
  assert.equal(first.logs.at(-1).source, "upstream");
  assert.equal(second.logs.at(-1).source, "cache_or_inflight");
});

test("malformed metadata and city text cannot leak raw provider or input text", async () => {
  const captureLog = capture();
  await assert.rejects(searchTagoStations({ ...base, ...captureLog, cityCode: base.serviceKey,
    fetchImpl: async () => response([], { totalCount: base.serviceKey }) }));
  assert.equal(captureLog.logs[0].cityCode, "redacted");
  assert.equal(captureLog.logs.some(log => log.event === "upstream_page"), false);
  assert.equal(captureLog.logs.at(-1).stage, "upstream");
  assert.equal(JSON.stringify(captureLog.logs).includes(base.serviceKey), false);
});

test("diagnostics preserve the original validation error order", async () => {
  const captureLog = capture();
  await assert.rejects(searchTagoStations({ ...base, ...captureLog,
    fetchImpl: async () => response([null], { totalCount: "invalid" }) }), /페이지 정보/);
  assert.equal(captureLog.logs.at(-1).event, "search_failed");
});

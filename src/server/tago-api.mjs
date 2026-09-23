import { fetchWithTimeout } from "./upstream-fetch.mjs";
import { createHash, randomUUID } from "node:crypto";

// Bounded process-local metadata cache; live arrival rows never use it.
const metadataCaches = new WeakMap();
async function cachedMetadata({ fetchImpl, serviceKey, scope, ttlMs, loader }) {
  let cache = metadataCaches.get(fetchImpl);
  if (!cache) { cache = new Map(); metadataCaches.set(fetchImpl, cache); }
  const key = JSON.stringify([createHash("sha256").update(String(serviceKey ?? "").trim()).digest("hex"), ...scope]);
  const now = Date.now();
  for (const [id, entry] of cache) if (!entry.pending && entry.expiresAt <= now) cache.delete(id);
  const hit = cache.get(key);
  if (hit) return structuredClone(hit.pending ? await hit.pending : hit.value);
  if (cache.size >= 128) {
    const oldest = [...cache].find(([, entry]) => !entry.pending);
    if (oldest) cache.delete(oldest[0]);
    else return loader();
  }
  const entry = {};
  const task = Promise.resolve().then(loader).then(value => {
    entry.value = structuredClone(value);
    entry.expiresAt = Date.now() + ttlMs;
    delete entry.pending;
    return entry.value;
  }).catch(error => { cache.delete(key); throw error; });
  entry.pending = task;
  cache.set(key, entry);
  return structuredClone(await task);
}

const BASE_URL = "https://apis.data.go.kr/1613000/ArvlInfoInqireService/";
const STOP_BASE_URL = "https://apis.data.go.kr/1613000/BusSttnInfoInqireService/";
const ERROR_MESSAGES = {
  1: "제공기관 서비스 오류입니다.",
  4: "제공기관 통신 오류입니다.",
  12: "API 서비스 주소를 확인해 주세요.",
  20: "요청한 TAGO API의 활용 승인을 확인해 주세요. 도착정보와 정류소정보는 각각 승인이 필요합니다.",
  22: "API 요청 한도를 초과했습니다.",
  30: "등록되지 않은 인증키입니다. TAGO_SERVICE_KEY를 확인해 주세요.",
  31: "인증키 사용 기간이 만료되었습니다.",
  32: "허용되지 않은 서버 IP입니다.",
  99: "제공기관 오류 또는 요청값 오류입니다.",
};

function apiError(code) {
  const numericCode = /^\d{1,3}$/.test(String(code).trim()) ? Number(code) : null;
  return Object.assign(new Error(`TAGO API 오류${numericCode === null ? "" : ` (${numericCode})`}: ${ERROR_MESSAGES[numericCode] || "응답을 확인할 수 없습니다."}`), { apiCode:numericCode, retryable: [1, 4, 99].includes(numericCode) });
}

// The gateway returns its XML error body even on non-2xx HTTP responses.
// Preserve only numeric status/codes, never its raw body or a URL containing keys.
export async function readTagoResponse(response) {
  let text;
  try { text=await response.text(); }
  catch { throw Object.assign(new Error('TAGO 응답 본문을 읽지 못했습니다.'),{code:'TAGO_BODY_READ_FAILED'}); }
  const status=Number.isInteger(response.status) && response.status>=100 && response.status<=599 ? response.status : null;
  let body;
  try { body=parseTagoResponse(text); }
  catch(error) {
    if(response.ok || (Number.isInteger(error.apiCode) && error.apiCode>0)) {
      error.status=status;
      throw error;
    }
  }
  if(!response.ok) throw Object.assign(new Error('TAGO HTTP request failed.'),{status});
  return body;
}

export function describeTagoError(error) {
  const code=error?.apiCode;
  if(Number.isInteger(code) && code>0 && code<=999) {
    const reasons={1:'제공기관 서비스 오류',4:'제공기관 통신 오류',12:'API 서비스 주소 또는 제공 상태 확인 필요',
      20:'API 이용 권한 거부',22:'일일 조회 한도 초과',30:'등록되지 않은 인증키',31:'인증키 활용기간 만료',32:'등록되지 않은 서버 IP',99:'제공기관 또는 요청값 오류'};
    return `${reasons[code] || '제공기관 오류'} (TAGO ${code}${error.status ? `, HTTP ${error.status}` : ''})`;
  }
  if(error?.code==='TAGO_BODY_READ_FAILED') return 'TAGO 응답 본문 읽기 실패';
  if(Number.isInteger(error?.status) && error.status>=100 && error.status<=599)
    return `HTTP ${error.status} 응답 (TAGO 오류 코드 없음, 원인 미확인)`;
  return null;
}

function xmlValue(text, tag) {
  return text.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`))?.[1] ?? "";
}

export function parseTagoResponse(text) {
  // The public-data gateway returns XML errors even when _type=json is requested.
  if (text.trimStart().startsWith("<")) {
    throw apiError(xmlValue(text, "returnReasonCode") || xmlValue(text, "resultCode"));
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("TAGO API 응답을 읽을 수 없습니다. 잠시 후 다시 시도해 주세요.");
  }
  const code = payload?.response?.header?.resultCode;
  if (String(code) !== "00" && code !== 0) throw apiError(code);
  const body = payload?.response?.body;
  if (!body || typeof body !== "object") throw new Error("TAGO API 응답에 데이터 본문이 없습니다.");
  return body;
}

function itemsFromBody(body) {
  const item = body.items?.item;
  if (item === undefined || item === null || item === "") return [];
  const rows = Array.isArray(item) ? item : [item];
  if (rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("TAGO API 항목 형식이 올바르지 않습니다.");
  }
  return rows;
}

async function requestTago(options) {
  const timeoutMs = options.timeoutMs ?? 8000;
  const canRetry = options.service === "stops" && ["getSttnNoList", "getCtyCodeList"].includes(options.operation);
  if (!canRetry) return requestTagoOnce(options);
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await requestTagoOnce({ ...options, timeoutMs: Math.max(1, Math.min(4000, deadline - Date.now())) });
    } catch (error) {
      if (attempt || (!error.retryable && error.code !== "UPSTREAM_TIMEOUT") || deadline - Date.now() <= 250) throw error;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
}

async function requestTagoOnce({ serviceKey, operation, params = {}, service = "arrivals", fetchImpl, timeoutMs = 8000 }) {
  if (!String(serviceKey ?? "").trim()) throw new Error("TAGO_SERVICE_KEY is not configured.");
  if (!["arrivals", "stops"].includes(service)) throw new Error("Unsupported TAGO service.");
  const url = new URL(operation, service === "stops" ? STOP_BASE_URL : BASE_URL);
  // Use the Decoding key. URLSearchParams performs the single required encoding.
  url.searchParams.set("serviceKey", String(serviceKey).trim());
  url.searchParams.set("_type", "json");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return fetchWithTimeout(url, {}, {
    timeoutMs,
    fetchImpl: async (input, init) => {
      let response;
      let text;
      try {
        response = await fetchImpl(input, init);
        text = await response.text();
      } catch {
        // Transport exceptions can contain the request URL, including serviceKey.
        throw Object.assign(new Error("TAGO API 통신에 실패했습니다. 잠시 후 다시 시도해 주세요."), { retryable: true });
      }
      if (!response.ok) {
        if (text.includes("<returnReasonCode>")) throw apiError(xmlValue(text, "returnReasonCode"));
        throw Object.assign(new Error(`TAGO API request failed with ${response.status}.`), { retryable: [502, 503, 504].includes(response.status) });
      }
      return parseTagoResponse(text);
    },
  });
}

function nonnegativeInteger(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export async function fetchTagoArrivalRows({ serviceKey, cityCode, nodeId, routeId = "", fetchImpl = fetch }) {
  if (!String(cityCode ?? "").trim() || !String(nodeId ?? "").trim()) {
    throw new Error("TAGO live binding requires cityCode and nodeId.");
  }
  const selectedRouteId = String(routeId ?? "").trim();
  const operation = selectedRouteId
    ? "getSttnAcctoSpcifyRouteBusArvlPrearngeInfoList"
    : "getSttnAcctoArvlPrearngeInfoList";
  const params = { cityCode: String(cityCode).trim(), nodeId: String(nodeId).trim(), numOfRows: 100 };
  if (selectedRouteId) params.routeId = selectedRouteId;
  return fetchTagoPages({ serviceKey, operation, params, fetchImpl });
}

async function fetchTagoPages({ serviceKey, operation, params, service = "arrivals", fetchImpl, onPage }) {
  const rows = [];
  let expectedTotal = null;
  const deadline = Date.now() + 15000;
  // Never silently use a truncated result to decide the last on-time vehicle.
  for (let pageNo = 1; pageNo <= 10; pageNo += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error("TAGO API 전체 도착정보 조회 시간이 초과되었습니다.");
    const body = await requestTago({ serviceKey, operation, service, params: { numOfRows: 100, ...params, pageNo }, fetchImpl, timeoutMs: Math.min(8000, remainingMs) });
    const total = nonnegativeInteger(body.totalCount);
    const returnedPage = nonnegativeInteger(body.pageNo);
    const pageSize = nonnegativeInteger(body.numOfRows);
    if (total === null || returnedPage !== pageNo || !pageSize) {
      throw new Error("TAGO API 페이지 정보가 올바르지 않습니다.");
    }
    if (expectedTotal !== null && total !== expectedTotal) {
      throw new Error("TAGO 도착정보가 조회 중 변경되었습니다. 다시 조회해 주세요.");
    }
    expectedTotal = total;
    const pageRows = itemsFromBody(body);
    // Observe only already-validated numeric metadata, preserving validation order.
    onPage?.({ pageNo, returnedPage, totalCount: total, pageSize, rowCount: pageRows.length });
    rows.push(...pageRows);
    if (pageRows.length > pageSize || rows.length > total) throw new Error("TAGO API 도착정보 개수가 일치하지 않습니다.");
    if (rows.length === total) return rows;
    if (!pageRows.length) throw new Error("TAGO API 도착정보 일부가 누락되었습니다.");
  }
  throw new Error("TAGO API 도착정보가 조회 한도를 초과하여 안전하게 계산할 수 없습니다.");
}

export async function fetchTagoCities({ serviceKey, service = "arrivals", fetchImpl = fetch }) {
  return cachedMetadata({ fetchImpl, serviceKey, scope: ["cities", service], ttlMs: 3600000, loader: async () => {
    const body = await requestTago({ serviceKey, service, operation: "getCtyCodeList", fetchImpl });
    return itemsFromBody(body).map((row) => {
      const cityCode = String(row.citycode ?? "").trim();
      const cityName = String(row.cityname ?? "").trim();
      if (!cityCode || !cityName) throw new Error("TAGO API 도시코드 정보가 올바르지 않습니다.");
      return { cityCode, cityName };
    });
  } });
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`TAGO ${label} 값이 필요합니다.`);
  return text;
}

function normalizeTagoStation(row, cityCode) {
  const stationId = requiredText(row.nodeid, "정류장 고유번호");
  const stationName = requiredText(row.nodenm, "정류장 이름");
  const lat = typeof row.gpslati === "number" || typeof row.gpslati === "string" ? Number(row.gpslati) : NaN;
  const lng = typeof row.gpslong === "number" || typeof row.gpslong === "string" ? Number(row.gpslong) : NaN;
  const coordinatesValid = String(row.gpslati ?? "").trim() && String(row.gpslong ?? "").trim()
    && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    && !(lat === 0 && lng === 0);
  return { stationId, nodeId: stationId, stationName, cityCode: requiredText(cityCode, "도시코드"),
    stationNumber: String(row.nodeno ?? "").trim(),
    posX: coordinatesValid ? String(lng) : "", posY: coordinatesValid ? String(lat) : "" };
}

export async function searchTagoStations({ serviceKey, cityCode, keyword, fetchImpl = fetch, diagnosticLogger = console.info }) {
  const city = requiredText(cityCode, "도시코드");
  const query = requiredText(keyword, "정류장 이름 또는 번호");
  if (query.length > 100) throw new Error("정류장 검색어가 너무 깁니다.");
  const queryKind = /^\d+$/.test(query) ? "nodeNo" : "nodeNm";
  const params = { cityCode: city, [queryKind]: query };
  const searchId = randomUUID();
  const startedAt = Date.now();
  // Allowlist fields instead of redacting arbitrary text. No keyword, key, user ID,
  // station data, coordinates, response body, error message or stack is logged.
  const emit = (event, details = {}) => {
    try {
      diagnosticLogger(JSON.stringify({ component: "tago_station_search", version: 1,
        searchId, event, ...details }));
    } catch { /* Diagnostics must never change search results or availability. */ }
  };
  emit("search_started", { cityCode: /^\d{1,9}$/.test(city) ? city : "redacted", queryKind, queryLength: query.length });
  let source = "cache_or_inflight";
  let stage = "cache";
  try {
    const stations = await cachedMetadata({ fetchImpl, serviceKey, scope: ["stations", city, query], ttlMs: 300000, loader: async () => {
      source = "upstream";
      stage = "upstream";
      const rows = await fetchTagoPages({ serviceKey, service: "stops", operation: "getSttnNoList", params, fetchImpl,
        onPage: (page) => emit("upstream_page", page) });
      stage = "normalize";
      return rows.map((row) => normalizeTagoStation(row, city));
    } });
    emit("search_completed", { source, resultCount: stations.length,
      mapEligibleCount: stations.filter(station => station.posX !== "" && station.posY !== "").length,
      durationMs: Date.now() - startedAt });
    return stations;
  } catch (error) {
    emit("search_failed", { source, stage, durationMs: Date.now() - startedAt });
    throw error;
  }
}

export async function searchTagoStationRoutes({ serviceKey, cityCode, nodeId, routeNumber = "", fetchImpl = fetch }) {
  const city = requiredText(cityCode, "도시코드");
  const station = requiredText(nodeId, "정류장 고유번호");
  // This service uses lowercase nodeid, unlike arrival service's nodeId.
  let rows = await fetchTagoPages({ serviceKey, service: "stops", operation: "getSttnThrghRouteList",
    params: { cityCode: city, nodeid: station }, fetchImpl });
  const fromArrivals = rows.length === 0;
  if (fromArrivals) {
    rows = await fetchTagoArrivalRows({serviceKey, cityCode:city, nodeId:station, fetchImpl});
    if (rows.some(row => String(row.nodeid ?? "").trim() !== station)) {
      throw new Error("도착정보의 정류장과 선택한 정류장이 일치하지 않습니다. 다시 조회해 주세요.");
    }
  }
  const routes = [...new Map(rows.map((row) => ({ routeId: requiredText(row.routeid, "노선 고유번호"),
    routeNumber: requiredText(row.routeno, "노선 번호"), routeName: String(row.routeno),
    routeTypeName: String(row.routetp ?? ""), destinationName: String(row.endnodenm ?? ""),
    startStationName: String(row.startnodenm ?? ""), stationId: station, nodeId: station, cityCode: city, order: "",
    ...(fromArrivals ? {source:"live-arrivals",label:"현재 도착정보에서 확인한 노선입니다. 전체 노선 목록이 아닙니다. 방면은 목적지 경로에서 확인해 주세요."} : {})
  })).map(route => [route.routeId,route])).values()];
  const selectedNumber = String(routeNumber ?? "").trim();
  return selectedNumber ? routes.filter((route) => route.routeNumber === selectedNumber) : routes;
}

export async function searchTagoNearbyStations({ serviceKey, lat, lng, fetchImpl = fetch }) {
  const coordinate = (value, limit) => {
    if (!["string", "number"].includes(typeof value) || String(value).trim() === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
  };
  const latitude = coordinate(lat, 90), longitude = coordinate(lng, 180);
  if (latitude === null || longitude === null || (latitude === 0 && longitude === 0)) {
    throw new Error("지도의 검색 위치가 올바르지 않습니다. 위치를 다시 선택해 주세요.");
  }
  return cachedMetadata({ fetchImpl, serviceKey, scope: ["nearby-stations", latitude, longitude], ttlMs: 300000, loader: async () => {
    const rows = await fetchTagoPages({ serviceKey, service: "stops", operation: "getCrdntPrxmtSttnList",
      params: { gpsLati: latitude, gpsLong: longitude }, fetchImpl });
    // The nearby API can cross city boundaries. Preserve each returned official
    // citycode instead of copying the city selected for a separate name search.
    const stations = rows.map(row => normalizeTagoStation(row, row.citycode));
    const citiesByNode = new Map();
    for (const station of stations) {
      const city = citiesByNode.get(station.nodeId);
      if (city && city !== station.cityCode) throw new Error("정류장 고유번호의 도시 정보가 일치하지 않습니다. 잠시 후 다시 조회해 주세요.");
      citiesByNode.set(station.nodeId, station.cityCode);
    }
    return [...new Map(stations.map(station => [`${station.cityCode}:${station.nodeId}`, station])).values()];
  } });
}

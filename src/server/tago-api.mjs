import { fetchWithTimeout } from "./upstream-fetch.mjs";

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
  return new Error(`TAGO API 오류${numericCode === null ? "" : ` (${numericCode})`}: ${ERROR_MESSAGES[numericCode] || "응답을 확인할 수 없습니다."}`);
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

async function requestTago({ serviceKey, operation, params = {}, service = "arrivals", fetchImpl, timeoutMs = 8000 }) {
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
        throw new Error("TAGO API 통신에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      }
      if (!response.ok) {
        if (text.includes("<returnReasonCode>")) throw apiError(xmlValue(text, "returnReasonCode"));
        throw new Error(`TAGO API request failed with ${response.status}.`);
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

async function fetchTagoPages({ serviceKey, operation, params, service = "arrivals", fetchImpl }) {
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
    rows.push(...pageRows);
    if (pageRows.length > pageSize || rows.length > total) throw new Error("TAGO API 도착정보 개수가 일치하지 않습니다.");
    if (rows.length === total) return rows;
    if (!pageRows.length) throw new Error("TAGO API 도착정보 일부가 누락되었습니다.");
  }
  throw new Error("TAGO API 도착정보가 조회 한도를 초과하여 안전하게 계산할 수 없습니다.");
}

export async function fetchTagoCities({ serviceKey, service = "arrivals", fetchImpl = fetch }) {
  const body = await requestTago({ serviceKey, service, operation: "getCtyCodeList", fetchImpl });
  return itemsFromBody(body).map((row) => {
    const cityCode = String(row.citycode ?? "").trim();
    const cityName = String(row.cityname ?? "").trim();
    if (!cityCode || !cityName) throw new Error("TAGO API 도시코드 정보가 올바르지 않습니다.");
    return { cityCode, cityName };
  });
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

export async function searchTagoStations({ serviceKey, cityCode, keyword, fetchImpl = fetch }) {
  const city = requiredText(cityCode, "도시코드");
  const query = requiredText(keyword, "정류장 이름 또는 번호");
  if (query.length > 100) throw new Error("정류장 검색어가 너무 깁니다.");
  const params = { cityCode: city, [/^\d+$/.test(query) ? "nodeNo" : "nodeNm"]: query };
  const rows = await fetchTagoPages({ serviceKey, service: "stops", operation: "getSttnNoList", params, fetchImpl });
  return rows.map((row) => normalizeTagoStation(row, city));
}

export async function searchTagoStationRoutes({ serviceKey, cityCode, nodeId, routeNumber = "", fetchImpl = fetch }) {
  const city = requiredText(cityCode, "도시코드");
  const station = requiredText(nodeId, "정류장 고유번호");
  // This service uses lowercase nodeid, unlike arrival service's nodeId.
  const rows = await fetchTagoPages({ serviceKey, service: "stops", operation: "getSttnThrghRouteList",
    params: { cityCode: city, nodeid: station }, fetchImpl });
  const routes = rows.map((row) => ({ routeId: requiredText(row.routeid, "노선 고유번호"),
    routeNumber: requiredText(row.routeno, "노선 번호"), routeName: String(row.routeno),
    routeTypeName: String(row.routetp ?? ""), destinationName: String(row.endnodenm ?? ""),
    startStationName: String(row.startnodenm ?? ""), stationId: station, nodeId: station, cityCode: city, order: "" }));
  const selectedNumber = String(routeNumber ?? "").trim();
  return selectedNumber ? routes.filter((route) => route.routeNumber === selectedNumber) : routes;
}

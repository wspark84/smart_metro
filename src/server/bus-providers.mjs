import { fetchWithTimeout } from "./upstream-fetch.mjs";
import { fetchSubwayArrival, fetchSubwayRows, searchSubwayStations, subwayDirections } from "./subway-providers.mjs";
import { stationSearchQueries, rankStationCandidates } from "../logic/station-search.js";
import { fetchTagoArrivalRows, searchTagoStations, searchTagoStationRoutes } from "./tago-api.mjs";
export { fetchTagoCities } from "./tago-api.mjs";

function xmlDecode(value) {
  return String(value ?? "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function getXmlBlocks(xml, tagNames) {
  for (const tagName of tagNames) {
    const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "g");
    const matches = [...xml.matchAll(pattern)].map((match) => match[1]);
    if (matches.length) {
      return matches;
    }
  }

  return [];
}

function getXmlValue(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`));
  return xmlDecode(match?.[1] ?? "");
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toMinutesFromSeconds(value) {
  const seconds = toFiniteNumber(value);
  if (seconds === null || seconds < 0) {
    return null;
  }

  return Math.max(0, Math.round(seconds / 60));
}

function toMinutesFromMessage(message) {
  const match = String(message ?? "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function normalizeArrivalMinutes(values) {
  const arrivals = values.filter((value) => Number.isFinite(value) && value >= 0).map((value) => Number(value));
  if (!arrivals.length) {
    return [];
  }

  arrivals.sort((first, second) => first - second);

  return arrivals.slice(0, 2);
}

function pickFirst(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return "";
}

function readGyeonggiRows(payload) {
  return asArray(
    payload?.response?.msgBody?.busArrivalList ??
      payload?.response?.msgBody?.itemList ??
      payload?.response?.body?.items?.item ??
      payload?.msgBody?.busArrivalList ??
      payload?.msgBody?.itemList,
  );
}

function readGyeonggiStationRows(payload) {
  return asArray(
    payload?.response?.msgBody?.busStationList ??
      payload?.response?.msgBody?.itemList ??
      payload?.response?.body?.items?.item ??
      payload?.msgBody?.busStationList ??
      payload?.msgBody?.itemList,
  );
}

function readGyeonggiRouteRows(payload) {
  return asArray(
    payload?.response?.msgBody?.busRouteList ??
      payload?.response?.msgBody?.itemList ??
      payload?.response?.body?.items?.item ??
      payload?.msgBody?.busRouteList ??
      payload?.msgBody?.itemList,
  );
}

function matchesRouteId(row, routeId) {
  if (!routeId) {
    return false;
  }

  const normalizedRouteId = String(routeId).trim();
  return ["routeId", "routeid", "routeID"].some((key) => String(row?.[key] ?? "").trim() === normalizedRouteId);
}

function matchesRouteNumber(row, routeNumber) {
  if (!routeNumber) {
    return false;
  }

  const normalizedRouteNumber = String(routeNumber).trim();
  return ["routeName", "routeNm", "routeNumber", "routeno"].some(
    (key) => String(row?.[key] ?? "").trim() === normalizedRouteNumber,
  );
}

export function parseSeoulArrivalXml(xml) {
  const headerCode = getXmlValue(xml, "headerCd");
  if (headerCode && headerCode !== "0") {
    throw new Error(`Seoul API error: ${getXmlValue(xml, "headerMsg") || headerCode}`);
  }

  const itemBlocks = getXmlBlocks(xml, ["itemList"]);
  const rows = itemBlocks
    .map((block) => {
      const firstMinutes =
        toMinutesFromSeconds(getXmlValue(block, "arrtime1")) ?? toMinutesFromMessage(getXmlValue(block, "arrmsg1"));
      const secondMinutes =
        toMinutesFromSeconds(getXmlValue(block, "arrtime2")) ?? toMinutesFromMessage(getXmlValue(block, "arrmsg2"));

      return {
        routeNumber: getXmlValue(block, "busRouteAbrv"),
        stopName: getXmlValue(block, "stNm"),
        firstMinutes,
        secondMinutes,
        firstMessage: getXmlValue(block, "arrmsg1"),
        secondMessage: getXmlValue(block, "arrmsg2"),
      };
    })
    .filter((row) => row.routeNumber || row.firstMinutes !== null || row.secondMinutes !== null);

  if (!rows.length) {
    throw new Error("Seoul API returned no arrival rows.");
  }

  return rows[0];
}

export function parseSeoulStationSearchXml(xml) {
  const headerCode = getXmlValue(xml, "headerCd");
  if (headerCode && headerCode !== "0") {
    throw new Error(`Seoul station API error: ${getXmlValue(xml, "headerMsg") || headerCode}`);
  }

  return getXmlBlocks(xml, ["itemList"])
    .map((block) => ({
      stationId: getXmlValue(block, "stId"),
      stationName: getXmlValue(block, "stNm"),
      arsId: getXmlValue(block, "arsId"),
      posX: getXmlValue(block, "posX"),
      posY: getXmlValue(block, "posY"),
    }))
    .filter((row) => row.stationId || row.arsId);
}

export function parseSeoulStationRoutesXml(xml) {
  const headerCode = getXmlValue(xml, "headerCd");
  if (headerCode && headerCode !== "0") {
    throw new Error(`Seoul station-route API error: ${getXmlValue(xml, "headerMsg") || headerCode}`);
  }

  return getXmlBlocks(xml, ["itemList"])
    .map((block) => ({
      stationId: getXmlValue(block, "stId"),
      stationName: getXmlValue(block, "stNm"),
      arsId: getXmlValue(block, "arsId"),
      routeId: getXmlValue(block, "busRouteId"),
      routeNumber: getXmlValue(block, "busRouteAbrv"),
      routeName: getXmlValue(block, "rtNm"),
      order: getXmlValue(block, "staOrd"),
      direction: getXmlValue(block, "adirection"),
      routeType: getXmlValue(block, "routeType"),
      term: getXmlValue(block, "term"),
    }))
    .filter((row) => row.routeId || row.routeNumber);
}

export function normalizeSeoulArrival(row) {
  const arrivals = normalizeArrivalMinutes([row.firstMinutes, row.secondMinutes]);
  if (!arrivals.length) {
    throw new Error("Seoul API row did not include valid arrival minutes.");
  }

  return {
    stopName: row.stopName || "",
    lineNumber: row.routeNumber || "",
    arrivalsMin: arrivals,
    messages: [row.firstMessage, row.secondMessage].filter(Boolean),
  };
}

export function normalizeSeoulStations(rows) {
  if (!rows.length) {
    throw new Error("Seoul station search returned no rows.");
  }

  return rows
    .map((row) => ({
      stationId: String(row.stationId || "").trim(),
      stationName: String(row.stationName || "").trim(),
      arsId: String(row.arsId || "").trim(),
      posX: String(row.posX || "").trim(),
      posY: String(row.posY || "").trim(),
    }))
    .filter((row) => row.stationId);
}

export function normalizeSeoulStationRoutes(rows) {
  if (!rows.length) {
    throw new Error("Seoul station route search returned no rows.");
  }

  return rows
    .map((row) => ({
      routeId: String(row.routeId || "").trim(),
      routeNumber: String(row.routeNumber || row.routeName || "").trim(),
      routeName: String(row.routeName || "").trim(),
      order: String(row.order || "").trim(),
      direction: String(row.direction || "").trim(),
      routeType: String(row.routeType || "").trim(),
      term: String(row.term || "").trim(),
      stationId: String(row.stationId || "").trim(),
      stationName: String(row.stationName || "").trim(),
      arsId: String(row.arsId || "").trim(),
    }))
    .filter((row) => row.routeId);
}

export function normalizeGyeonggiArrival(payload, { routeId = "", routeNumber = "" } = {}) {
  const rows = readGyeonggiRows(payload);
  if (!rows.length) {
    throw new Error("Gyeonggi API returned no arrival rows.");
  }

  const matched = routeId
    ? rows.find((row) => matchesRouteId(row, routeId))
    : routeNumber ? rows.find((row) => matchesRouteNumber(row, routeNumber)) : rows[0];
  if (!matched) throw new Error("Gyeonggi API returned no arrivals for the selected route.");

  const arrivals = normalizeArrivalMinutes([
    toFiniteNumber(pickFirst(matched, ["predictTime1", "predictTime"])),
    toFiniteNumber(pickFirst(matched, ["predictTime2"])),
  ]);

  if (!arrivals.length) {
    throw new Error("Gyeonggi API row did not include valid arrival minutes.");
  }

  return {
    stopName: pickFirst(matched, ["stationName", "stationNm", "nodeNm"]),
    lineNumber: pickFirst(matched, ["routeName", "routeNm", "routeNumber"]),
    arrivalsMin: arrivals,
    messages: [
      pickFirst(matched, ["locationNo1"]),
      pickFirst(matched, ["locationNo2"]),
      pickFirst(matched, ["crowded1"]),
      pickFirst(matched, ["crowded2"]),
    ].filter(Boolean),
  };
}

export function normalizeGyeonggiStations(payload) {
  const rows = readGyeonggiStationRows(payload);
  if (!rows.length) {
    throw new Error("Gyeonggi station search returned no rows.");
  }

  return rows
    .map((row) => ({
      stationId: String(pickFirst(row, ["stationId", "stationid"])).trim(),
      stationName: String(pickFirst(row, ["stationName", "stationNm", "station"])).trim(),
      stationNumber: String(pickFirst(row, ["mobileNo", "stationNo"])).trim(),
      regionName: String(pickFirst(row, ["regionName", "districtName"])).trim(),
      ...(toFiniteNumber(row.x) !== null && toFiniteNumber(row.y) !== null
        ? { posX: String(row.x), posY: String(row.y) } : {}),
    }))
    .filter((row) => row.stationId);
}

export function normalizeGyeonggiStationRoutes(payload, { routeNumber = "" } = {}) {
  const rows = readGyeonggiRouteRows(payload);
  if (!rows.length) {
    throw new Error("Gyeonggi station route search returned no rows.");
  }

  const normalizedRouteNumber = String(routeNumber || "").trim().toLowerCase();

  const normalizedRows = rows
    .map((row) => ({
      routeId: String(pickFirst(row, ["routeId", "routeid"])).trim(),
      routeNumber: String(pickFirst(row, ["routeName", "routeNm", "routeNumber"])).trim(),
      routeName: String(pickFirst(row, ["routeName", "routeNm", "routeNumber"])).trim(),
      order: String(pickFirst(row, ["staOrder", "stationSeq"])).trim(),
      regionName: String(pickFirst(row, ["regionName"])).trim(),
      destinationName: String(pickFirst(row, ["routeDestName", "endStationName"])).trim(),
      routeTypeCd: String(pickFirst(row, ["routeTypeCd"])).trim(),
      routeTypeName: String(pickFirst(row, ["routeTypeName"])).trim(),
      stationId: String(pickFirst(row, ["stationId", "stationid"])).trim(),
    }))
    .filter((row) => row.routeId);

  const filteredRows = normalizedRouteNumber
    ? normalizedRows.filter((row) => row.routeNumber.toLowerCase().includes(normalizedRouteNumber))
    : normalizedRows;

  if (!filteredRows.length) {
    throw new Error("Gyeonggi station route search returned no rows.");
  }

  return filteredRows;
}

export function normalizeTagoArrival(payload, selection = "") {
  const items = payload?.response?.body?.items?.item;
  const options = typeof selection === "object" && selection !== null ? selection : { routeNumber: selection };
  const routeNumber = String(options.routeNumber ?? "").trim();
  const routeId = String(options.routeId ?? "").trim();
  const nodeId = String(options.nodeId ?? "").trim();
  const rows = asArray(items).filter((row) => !nodeId || String(row.nodeid ?? "").trim() === nodeId);

  if (!rows.length) {
    throw new Error("TAGO API returned no arrival rows.");
  }

  let candidates = routeId
    ? rows.filter((row) => String(row.routeid ?? "").trim() === routeId)
    : routeNumber ? rows.filter((row) => String(row.routeno ?? "").trim() === routeNumber) : rows;
  // Keep compatibility with legacy bindings that stored a route ID in routeNumber.
  if (!routeId && routeNumber && !candidates.length) {
    candidates = rows.filter((row) => String(row.routeid ?? "").trim() === routeNumber);
  }
  const matched = candidates[0];
  if (!matched) throw new Error("TAGO API returned no arrivals for the selected route.");
  const identities = new Set(candidates.map((row) => `${String(row.nodeid ?? "").trim()}|${String(row.routeid ?? row.routeno ?? "").trim()}`));
  if (identities.size > 1) throw new Error("TAGO 노선이 여러 개입니다. 정확한 nodeId와 routeId를 선택해 주세요.");
  // arrtime is seconds; retain fractions and every vehicle for deadline decisions.
  const seconds = candidates.map((row) => ["string", "number"].includes(typeof row.arrtime) ? toFiniteNumber(row.arrtime) : null);
  if (seconds.some((value) => value === null || !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("TAGO API row did not include valid arrival seconds.");
  }
  const arrivals = seconds.map((value) => value / 60).sort((a, b) => a - b);

  if (!arrivals.length) {
    throw new Error("TAGO API row did not include valid arrival minutes.");
  }

  return {
    stopName: matched.nodenm || "",
    lineNumber: matched.routeno || "",
    arrivalsMin: arrivals,
    messages: [],
  };
}

export async function fetchSeoulArrival({ apiKey, stationId, routeId, order, fetchImpl = fetch }) {
  if (!apiKey) {
    throw new Error("SEOUL_OPEN_API_KEY is not configured.");
  }

  if (!stationId || !routeId || !order) {
    throw new Error("Seoul live binding requires stationId, routeId, and order.");
  }

  const url = new URL(
    `http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRoute?serviceKey=${encodeURIComponent(apiKey)}&stId=${encodeURIComponent(stationId)}&busRouteId=${encodeURIComponent(routeId)}&ord=${encodeURIComponent(order)}`,
  );
  const response = await fetchWithTimeout(url, {}, { fetchImpl });
  if (!response.ok) {
    throw new Error(`Seoul API request failed with ${response.status}.`);
  }

  const xml = await response.text();
  return normalizeSeoulArrival(parseSeoulArrivalXml(xml));
}

export async function searchSeoulStations({ apiKey, keyword, fetchImpl = fetch }) {
  if (!apiKey) {
    throw new Error("SEOUL_OPEN_API_KEY is not configured.");
  }

  if (!keyword || !String(keyword).trim()) {
    throw new Error("Seoul station search requires a keyword.");
  }

  const url = new URL("http://ws.bus.go.kr/api/rest/stationinfo/getStationByName");
  url.searchParams.set("serviceKey", apiKey);
  url.searchParams.set("stSrch", String(keyword).trim());

  const response = await fetchWithTimeout(url, {}, { fetchImpl });
  if (!response.ok) {
    throw new Error(`Seoul station API request failed with ${response.status}.`);
  }

  const xml = await response.text();
  return normalizeSeoulStations(parseSeoulStationSearchXml(xml));
}

export async function searchSeoulStationRoutes({ apiKey, arsId, fetchImpl = fetch }) {
  if (!apiKey) {
    throw new Error("SEOUL_OPEN_API_KEY is not configured.");
  }

  if (!arsId || !String(arsId).trim()) {
    throw new Error("Seoul station-route search requires arsId.");
  }

  const url = new URL("http://ws.bus.go.kr/api/rest/stationinfo/getStationByUid");
  url.searchParams.set("serviceKey", apiKey);
  url.searchParams.set("arsId", String(arsId).trim());

  const response = await fetchWithTimeout(url, {}, { fetchImpl });
  if (!response.ok) {
    throw new Error(`Seoul station-route API request failed with ${response.status}.`);
  }

  const xml = await response.text();
  return normalizeSeoulStationRoutes(parseSeoulStationRoutesXml(xml));
}

export async function fetchGyeonggiArrival({ serviceKey, stationId, routeId, routeNumber, fetchImpl = fetch }) {
  if (!serviceKey) {
    throw new Error("GYEONGGI_SERVICE_KEY is not configured.");
  }

  if (!stationId) {
    throw new Error("Gyeonggi live binding requires stationId.");
  }

  const url = new URL("https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2");
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("stationId", stationId);
  url.searchParams.set("format", "json");

  const response = await fetchWithTimeout(url, {}, { fetchImpl });
  if (!response.ok) {
    throw new Error(`Gyeonggi API request failed with ${response.status}.`);
  }

  const payload = await response.json();
  return normalizeGyeonggiArrival(payload, { routeId, routeNumber });
}

export async function searchGyeonggiStations({ serviceKey, keyword, fetchImpl = fetch }) {
  if (!serviceKey) {
    throw new Error("GYEONGGI_SERVICE_KEY is not configured.");
  }

  if (!keyword || !String(keyword).trim()) {
    throw new Error("Gyeonggi station search requires a keyword.");
  }

  const url = new URL("https://apis.data.go.kr/6410000/busstationservice/v2/getBusStationListv2");
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("keyword", String(keyword).trim());
  url.searchParams.set("format", "json");

  const response = await fetchWithTimeout(url, {}, { fetchImpl });
  if (!response.ok) {
    throw new Error(`Gyeonggi station API request failed with ${response.status}.`);
  }

  const payload = await response.json();
  return normalizeGyeonggiStations(payload);
}

export async function searchGyeonggiStationRoutes({ serviceKey, stationId, routeNumber = "", fetchImpl = fetch }) {
  if (!serviceKey) {
    throw new Error("GYEONGGI_SERVICE_KEY is not configured.");
  }

  if (!stationId || !String(stationId).trim()) {
    throw new Error("Gyeonggi station-route search requires stationId.");
  }

  const url = new URL("https://apis.data.go.kr/6410000/busstationservice/v2/getBusStationViaRouteListv2");
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("stationId", String(stationId).trim());
  url.searchParams.set("format", "json");

  const response = await fetchWithTimeout(url, {}, { fetchImpl });
  if (!response.ok) {
    throw new Error(`Gyeonggi station-route API request failed with ${response.status}.`);
  }

  const payload = await response.json();
  return normalizeGyeonggiStationRoutes(payload, { routeNumber });
}

export async function fetchTagoArrival({ serviceKey, cityCode, nodeId, routeId, routeNumber, fetchImpl = fetch }) {
  if (!serviceKey) {
    throw new Error("TAGO_SERVICE_KEY is not configured.");
  }

  if (!cityCode || !nodeId) {
    throw new Error("TAGO live binding requires cityCode and nodeId.");
  }

  if (!String(routeId ?? "").trim() && !String(routeNumber ?? "").trim()) {
    throw new Error("TAGO live binding requires routeId or routeNumber.");
  }
  const rows = await fetchTagoArrivalRows({ serviceKey, cityCode, nodeId, routeId, fetchImpl });
  return normalizeTagoArrival({ response: { body: { items: { item: rows } } } }, { routeId, routeNumber, nodeId });
}

export function getBusApiConfig() {
  return {
    policy: {
      objective: "accuracy-first",
      regionPriority: {
        seoul: ["seoul", "tago"],
        gyeonggi: ["tago", "gyeonggi"],
        national: ["tago"],
      },
      guidance:
        "For time-sensitive alarms, choose the provider that has shown the most accurate ETA for that region. API ownership matters less than observed accuracy.",
      observations: {
        gyeonggi:
          "Current product rule: treat TAGO as the first ETA candidate for Gyeonggi until another provider proves more accurate in measured checks.",
      },
    },
    providers: {
      subway: { configured: Boolean(process.env.SEOUL_SUBWAY_API_KEY), label: "지하철 실시간 도착정보", note: "서울시 제공 역만 지원합니다. 전국 모든 역의 실시간 정보를 보장하지 않습니다." },
      seoul: {
        configured: Boolean(process.env.SEOUL_OPEN_API_KEY),
        label: "Seoul Direct",
        role: "regional-candidate",
        recommendedRegions: ["seoul"],
        note: "Keep Seoul Direct as the primary candidate for Seoul stops unless another source measures better.",
        setup: {
          bindingMode: "search-assisted",
          stationSearchSupported: true,
          stationRouteSearchSupported: true,
          guidance:
            "Search the official Seoul stop first so the app can fill station id, ARS number, route id, and stop order for you.",
          stationSearchIdleHint: "No search run yet.",
          stationSearchEmptyLabel: "Search stations to load official stop candidates.",
          routeSearchIdleHint: "No search run yet.",
          routeSearchEmptyLabel: "Load official route candidates after choosing a station.",
        },
      },
      gyeonggi: {
        configured: Boolean(process.env.GYEONGGI_SERVICE_KEY),
        label: "Gyeonggi Direct (Compare Accuracy)",
        role: "regional-candidate",
        recommendedRegions: ["gyeonggi"],
        note: "Keep this as a comparison source for Gyeonggi and promote it only when it measures more accurate than TAGO.",
        setup: {
          bindingMode: "search-assisted",
          stationSearchSupported: true,
          stationRouteSearchSupported: true,
          guidance:
            "Search the official Gyeonggi stop first, then compare accuracy against the provider currently winning for that route-stop pair.",
          stationSearchIdleHint: "No search run yet.",
          stationSearchEmptyLabel: "Search stations to load official stop candidates.",
          routeSearchIdleHint: "No search run yet.",
          routeSearchEmptyLabel: "Load official route candidates after choosing a station.",
        },
      },
      tago: {
        configured: Boolean(process.env.TAGO_SERVICE_KEY),
        label: "TAGO (Accuracy-first candidate)",
        role: "national-candidate",
        recommendedRegions: ["national", "gyeonggi"],
        note: "Current ETA-first rule treats TAGO as the first candidate for Gyeonggi and the default national coverage source.",
        setup: {
          bindingMode: "search-assisted",
          cityCodeLookupSupported: true,
          stationSearchSupported: true,
          stationRouteSearchSupported: true,
          guidance:
            "도시를 선택하고 정류장을 검색한 다음 경유노선을 선택하세요. 정류장·노선 고유번호는 자동 입력됩니다. 집에서 정류장까지의 이동시간은 지각 계산에 넣지 않습니다.",
          stationSearchIdleHint:
            "TAGO 도시코드와 정류장 이름을 입력해 검색하세요.",
          stationSearchEmptyLabel:
            "도시 선택 후 정류장 이름 또는 번호로 검색하세요.",
          routeSearchIdleHint:
            "정류장을 선택하면 경유노선을 조회할 수 있습니다.",
          routeSearchEmptyLabel:
            "정류장을 선택하고 이용할 버스 번호와 기점·종점을 확인하세요.",
        },
      },
    },
  };
}

export async function fetchLiveArrival(binding) {
  if (binding.provider === "subway") return fetchSubwayArrival(binding);
  if (binding.provider === "seoul") {
    return {
      provider: "seoul",
      ...(await fetchSeoulArrival({
        apiKey: process.env.SEOUL_OPEN_API_KEY,
        stationId: binding.stationId,
        routeId: binding.routeId,
        order: binding.order,
      })),
    };
  }

  if (binding.provider === "gyeonggi") {
    return {
      provider: "gyeonggi",
      ...(await fetchGyeonggiArrival({
        serviceKey: process.env.GYEONGGI_SERVICE_KEY,
        stationId: binding.stationId,
        routeId: binding.routeId,
        routeNumber: binding.routeNumber,
      })),
    };
  }

  if (binding.provider === "tago") {
    return {
      provider: "tago",
      ...(await fetchTagoArrival({
        serviceKey: process.env.TAGO_SERVICE_KEY,
        cityCode: binding.cityCode,
        nodeId: binding.nodeId,
        routeId: binding.routeId,
        routeNumber: binding.routeNumber,
      })),
    };
  }

  throw new Error("Unsupported or missing live provider.");
}

export async function searchLiveStations(binding) {
  if (binding.provider === "subway") return {provider:"subway",stations:await searchSubwayStations(binding.keyword)};
  const queries = stationSearchQueries(binding.keyword);
  if (!queries.length) throw new Error("정류장 이름 또는 번호를 입력해 주세요.");
  for (const keyword of queries) {
    const result = await searchLiveStationsExact({...binding,keyword});
    if (result.stations.length) return {...result, stations:rankStationCandidates(result.stations,binding.keyword), matchedQuery:keyword};
  }
  return {provider:binding.provider,stations:[]};
}

async function searchLiveStationsExact(binding) {
  if (binding.provider === "tago") {
    return { provider: "tago", stations: await searchTagoStations({ serviceKey: process.env.TAGO_SERVICE_KEY,
      cityCode: binding.cityCode, keyword: binding.keyword }) };
  }
  if (binding.provider === "seoul") {
    return {
      provider: "seoul",
      stations: await searchSeoulStations({
        apiKey: process.env.SEOUL_OPEN_API_KEY,
        keyword: binding.keyword,
      }),
    };
  }

  if (binding.provider === "gyeonggi") {
    return {
      provider: "gyeonggi",
      stations: await searchGyeonggiStations({
        serviceKey: process.env.GYEONGGI_SERVICE_KEY,
        keyword: binding.keyword,
      }),
    };
  }

  throw new Error("Unsupported or missing live provider for station search.");
}

export async function searchLiveStationRoutes(binding) {
  if (binding.provider === "subway") return {provider:"subway",routes:subwayDirections(await fetchSubwayRows(binding.stationName))};
  if (binding.provider === "tago") {
    return { provider: "tago", routes: await searchTagoStationRoutes({ serviceKey: process.env.TAGO_SERVICE_KEY,
      cityCode: binding.cityCode, nodeId: binding.nodeId, routeNumber: binding.routeNumber }) };
  }
  if (binding.provider === "seoul") {
    return {
      provider: "seoul",
      routes: await searchSeoulStationRoutes({
        apiKey: process.env.SEOUL_OPEN_API_KEY,
        arsId: binding.arsId,
      }),
    };
  }

  if (binding.provider === "gyeonggi") {
    return {
      provider: "gyeonggi",
      routes: await searchGyeonggiStationRoutes({
        serviceKey: process.env.GYEONGGI_SERVICE_KEY,
        stationId: binding.stationId,
        routeNumber: binding.routeNumber,
      }),
    };
  }

  throw new Error("Unsupported or missing live provider for station-route search.");
}

import { fetchWithTimeout } from "./upstream-fetch.mjs";

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
  const arrivals = values.filter((value) => Number.isFinite(value)).map((value) => Number(value));
  if (!arrivals.length) {
    return [];
  }

  arrivals.sort((first, second) => first - second);
  if (arrivals.length === 1) {
    arrivals.push(arrivals[0] + 10);
  }

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

  const matched =
    rows.find((row) => matchesRouteId(row, routeId)) ||
    rows.find((row) => matchesRouteNumber(row, routeNumber)) ||
    rows[0];

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

export function normalizeTagoArrival(payload, routeNumber = "") {
  const items = payload?.response?.body?.items?.item;
  const rows = asArray(items);

  if (!rows.length) {
    throw new Error("TAGO API returned no arrival rows.");
  }

  const normalizedRouteNumber = String(routeNumber || "").trim();
  const matched =
    rows.find((row) => String(row.routeno || "").trim() === normalizedRouteNumber) ||
    rows.find((row) => String(row.routeid || "").trim() === normalizedRouteNumber) ||
    rows[0];

  const arrivals = normalizeArrivalMinutes(
    rows
      .filter((row) => String(row.routeno || "").trim() === String(matched.routeno || "").trim())
      .map((row) => toMinutesFromSeconds(row.arrtime)),
  );

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

export async function fetchTagoArrival({ serviceKey, cityCode, nodeId, routeNumber, fetchImpl = fetch }) {
  if (!serviceKey) {
    throw new Error("TAGO_SERVICE_KEY is not configured.");
  }

  if (!cityCode || !nodeId) {
    throw new Error("TAGO live binding requires cityCode and nodeId.");
  }

  const url = new URL("http://apis.data.go.kr/1613000/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList");
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "30");
  url.searchParams.set("_type", "json");
  url.searchParams.set("cityCode", cityCode);
  url.searchParams.set("nodeId", nodeId);

  const response = await fetchWithTimeout(url, {}, { fetchImpl });
  if (!response.ok) {
    throw new Error(`TAGO API request failed with ${response.status}.`);
  }

  const payload = await response.json();
  return normalizeTagoArrival(payload, routeNumber);
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
          bindingMode: "manual",
          stationSearchSupported: false,
          stationRouteSearchSupported: false,
          guidance:
            "Accuracy matters more than API ownership. If TAGO is the most accurate source for this commute, keep it selected and enter city code, node id, route id, route number, and stop order manually below.",
          stationSearchIdleHint:
            "Manual TAGO binding: station search is disabled for this provider in the current mobile shell.",
          stationSearchEmptyLabel:
            "TAGO does not load station candidates here. Enter the live binding fields manually below.",
          routeSearchIdleHint:
            "Manual TAGO binding: route candidate lookup is disabled for this provider in the current mobile shell.",
          routeSearchEmptyLabel:
            "TAGO does not load route candidates here. Enter route id, route number, stop order, city code, and node id manually below.",
        },
      },
    },
  };
}

export async function fetchLiveArrival(binding) {
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
        routeNumber: binding.routeNumber,
      })),
    };
  }

  throw new Error("Unsupported or missing live provider.");
}

export async function searchLiveStations(binding) {
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

// Stop finder for the app's "출발 정류장·역" picker.
// 1) nearby: every official bus stop and subway station around a map point,
//    merged from the regional APIs and labelled with their opposite-side twin.
// 2) describe: which way a bus stop faces (next stop, destinations) so the
//    user can tell the two same-named stops on either side of a road apart.
import { haversineDistanceMeters } from "../logic/commute.js";
import { searchNearbyBoardingStations } from "./nearby-stations.mjs";
import { searchSeoulStationRoutes, searchGyeonggiStationRoutes, regionalBusProvider } from "./bus-providers.mjs";
import { searchTagoStationRoutes } from "./tago-api.mjs";
import { routeRows } from "./tago-headway-binding.mjs";
import { kakaoSubwayStation, subwayStationRoutes } from "./subway-providers.mjs";
import { fetchWithTimeout } from "./upstream-fetch.mjs";

export const NEARBY_RADIUS_M = 400;
export const OPPOSITE_RADIUS_M = 300;
const text = (value, max = 150) => String(value ?? "").trim().slice(0, max);
const nameKey = (value) => String(value || "").replace(/[\s.,·()\-]/g, "").replace(/(정류장|정류소)$/, "");
const fail = (message) => Object.assign(new Error(message), { statusCode: 400, code: "INVALID_INPUT" });

export function validPoint(lat, lng) {
  const value = { lat: Number(lat), lng: Number(lng) };
  if (String(lat ?? "").trim() === "" || String(lng ?? "").trim() === "") return null;
  return Number.isFinite(value.lat) && Number.isFinite(value.lng) && value.lat >= 33 && value.lat <= 39 && value.lng >= 124 && value.lng <= 132 ? value : null;
}

// Seoul and its bus API only cover the capital area.
export const inCapitalArea = ({ lat, lng }) => lat >= 37.0 && lat <= 38.0 && lng >= 126.5 && lng <= 127.5;

function xmlValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return String(match?.[1] ?? "").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&").trim();
}

export function parseSeoulStationsByPos(xml) {
  const code = xmlValue(xml, "headerCd");
  if (code === "4") return [];
  if (code && code !== "0") throw new Error("서울 버스 주변 정류장 조회에 실패했습니다.");
  return [...xml.matchAll(/<itemList>([\s\S]*?)<\/itemList>/g)].map((match) => ({
    stationId: xmlValue(match[1], "stationId"), stationName: xmlValue(match[1], "stationNm"), arsId: xmlValue(match[1], "arsId"),
    posX: xmlValue(match[1], "gpsX"), posY: xmlValue(match[1], "gpsY"),
  })).filter((row) => row.stationId && row.arsId && row.arsId !== "0" && validPoint(row.posY, row.posX));
}

// Official: http://api.bus.go.kr (stationinfo/getStationByPos), radius in meters.
export async function searchSeoulStationsByPos({ apiKey, lat, lng, radius = NEARBY_RADIUS_M, fetchImpl = fetch }) {
  if (!apiKey) return [];
  const url = new URL("http://ws.bus.go.kr/api/rest/stationinfo/getStationByPos");
  url.searchParams.set("serviceKey", apiKey);
  url.searchParams.set("tmX", String(lng));
  url.searchParams.set("tmY", String(lat));
  url.searchParams.set("radius", String(radius));
  const response = await fetchWithTimeout(url, {}, { fetchImpl });
  if (!response.ok) throw new Error("서울 버스 주변 정류장 조회에 실패했습니다.");
  return parseSeoulStationsByPos(await response.text());
}

// Official: https://developers.kakao.com/docs/latest/ko/local/dev-guide#search-by-category
export async function searchNearbySubwayStations({ apiKey, lat, lng, radius = 800, fetchImpl = fetch }) {
  if (!apiKey) return [];
  const params = new URLSearchParams({ category_group_code: "SW8", x: String(lng), y: String(lat), radius: String(radius), sort: "distance", size: "15" });
  const response = await fetchWithTimeout(`https://dapi.kakao.com/v2/local/search/category.json?${params}`,
    { headers: { Authorization: `KakaoAK ${apiKey}` } }, { fetchImpl });
  if (!response.ok) throw new Error("주변 지하철역 조회에 실패했습니다.");
  const payload = await response.json();
  return (payload.documents || []).map(kakaoSubwayStation).filter(Boolean);
}

function busStop(station, provider) {
  const lat = Number(station.posY), lng = Number(station.posX);
  const stationId = text(station.stationId || station.nodeId);
  return {
    key: `${provider}:${provider === "tago" ? `${text(station.cityCode)}:` : ""}${stationId}`, mode: "bus", provider,
    stationId, stationName: text(station.stationName), arsId: text(station.arsId), cityCode: text(station.cityCode),
    nodeId: provider === "tago" ? text(station.nodeId || stationId) : "", stationNumber: text(station.stationNumber || station.arsId, 20),
    lineName: "", lat, lng,
  };
}

function subwayStop(station) {
  return { key: `subway:${station.stationId}:${nameKey(station.lineName)}`, mode: "subway", provider: "subway",
    stationId: text(station.stationId), stationName: text(station.stationName), arsId: "", cityCode: "", nodeId: "",
    stationNumber: "", lineName: text(station.lineName, 60), lat: Number(station.posY), lng: Number(station.posX) };
}

// Merge sources, prefer the regional agency for a physical stop it also
// publishes (same name within 30 m), sort by distance and pair opposite stops.
export function mergeNearbyStops(center, groups, radius = NEARBY_RADIUS_M) {
  const kept = [];
  for (const stop of groups.flat()) {
    if (!validPoint(stop.lat, stop.lng) || !stop.stationName || !stop.stationId) continue;
    const distance = haversineDistanceMeters(center, stop);
    if (distance === null || distance > (stop.mode === "subway" ? radius * 2 : radius)) continue;
    const twin = stop.mode === "bus" && kept.find((other) => other.mode === "bus" && other.provider !== stop.provider &&
      nameKey(other.stationName) === nameKey(stop.stationName) && haversineDistanceMeters(other, stop) <= 30);
    if (twin) continue; // earlier groups win; callers pass regional sources first
    if (kept.some((other) => other.key === stop.key)) continue;
    kept.push({ ...stop, distanceM: Math.round(distance) });
  }
  kept.sort((a, b) => a.distanceM - b.distanceM);
  for (const stop of kept) {
    if (stop.mode !== "bus") { stop.oppositeKey = ""; continue; }
    const candidates = kept.filter((other) => other !== stop && other.mode === "bus" && nameKey(other.stationName) === nameKey(stop.stationName))
      .map((other) => ({ other, meters: haversineDistanceMeters(other, stop) }))
      .filter((item) => item.meters !== null && item.meters <= OPPOSITE_RADIUS_M)
      .sort((a, b) => a.meters - b.meters);
    stop.oppositeKey = candidates[0]?.other.key || "";
  }
  return kept.slice(0, 40);
}

export async function findNearbyStops({ lat, lng }, deps = {}) {
  const center = validPoint(lat, lng);
  if (!center) throw fail("지도 위치가 올바르지 않습니다. 다시 검색해 주세요.");
  const env = deps.env || process.env, fetchImpl = deps.fetchImpl || fetch;
  const seoul = deps.seoul || searchSeoulStationsByPos, national = deps.national || searchNearbyBoardingStations, subway = deps.subway || searchNearbySubwayStations;
  const jobs = [
    inCapitalArea(center) ? seoul({ apiKey: env.SEOUL_OPEN_API_KEY, ...center, fetchImpl })
      .then((rows) => rows.map((row) => busStop(row, regionalBusProvider("seoul", row.stationId)))) : Promise.resolve([]),
    national(center).then((result) => (result?.stations || []).map((row) => busStop(row, row.provider === "gyeonggi" ? "gyeonggi" : result.provider || "tago"))),
    subway({ apiKey: env.KAKAO_LOCAL_REST_API_KEY, ...center, fetchImpl }).then((rows) => rows.map(subwayStop)),
  ];
  const results = await Promise.allSettled(jobs);
  const warnings = [];
  const labels = ["서울 버스", "전국 버스", "지하철"];
  results.forEach((result, index) => { if (result.status === "rejected" && (index !== 0 || inCapitalArea(center))) warnings.push(`${labels[index]} 정보를 가져오지 못했습니다.`); });
  if (results.every((result) => result.status === "rejected")) throw Object.assign(new Error("주변 정류장·역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."), { statusCode: 503, code: "UPSTREAM_FAILED" });
  const groups = results.map((result) => result.status === "fulfilled" ? result.value : []);
  return { center, radiusMeters: NEARBY_RADIUS_M, stops: mergeNearbyStops(center, groups), warnings };
}

// ---- Direction --------------------------------------------------------------

const describeCache = new Map();
const DESCRIBE_TTL_MS = 10 * 60_000;
const mostCommon = (values) => {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
};

export function nextStopFromSequence(rows, stationId, { idKey, nameKey: nameField, orderKey }) {
  const ordered = rows.filter((row) => row && Number.isFinite(Number(row[orderKey]))).sort((a, b) => Number(a[orderKey]) - Number(b[orderKey]));
  const index = ordered.findIndex((row) => String(row[idKey]) === String(stationId));
  return index >= 0 && index + 1 < ordered.length ? text(ordered[index + 1][nameField]) : "";
}

async function gyeonggiRouteStations({ serviceKey, routeId, fetchImpl }) {
  const url = new URL("https://apis.data.go.kr/6410000/busrouteservice/v2/getBusRouteStationListv2");
  for (const [key, value] of Object.entries({ serviceKey, routeId, format: "json" })) url.searchParams.set(key, value);
  const response = await fetchWithTimeout(url, {}, { fetchImpl });
  if (!response.ok) throw new Error("경기 노선 정류장 조회 실패");
  const payload = await response.json();
  const list = payload?.response?.msgBody?.busRouteStationList ?? payload?.msgBody?.busRouteStationList ?? [];
  return Array.isArray(list) ? list : [list];
}

export async function describeStop(input = {}, deps = {}) {
  const provider = regionalBusProvider(text(input.provider, 20), text(input.stationId));
  if (!["seoul", "gyeonggi", "tago", "subway"].includes(provider)) throw fail("정류장 정보를 다시 선택해 주세요.");
  const env = deps.env || process.env, fetchImpl = deps.fetchImpl || fetch;
  const cacheKey = JSON.stringify([provider, input.stationId, input.arsId, input.cityCode, input.nodeId, input.lineName, input.stationName]);
  const cached = describeCache.get(cacheKey);
  if (!deps.noCache && cached && cached.expiresAt > Date.now()) return cached.value;
  let value;
  if (provider === "subway") {
    const routes = await (deps.subwayRoutes || subwayStationRoutes)({ provider, stationName: text(input.stationName), lineName: text(input.lineName, 60),
      stationId: text(input.stationId), posX: text(input.lng), posY: text(input.lat) });
    const directions = [...new Set((routes || []).map((route) => text(route.destinationName || route.nextStation || route.direction, 60)).filter(Boolean))].slice(0, 4);
    value = { provider, nextStop: "", heading: "", routes: [], directions, timetable: (routes || []).length > 0 && (routes || []).every((route) => route.basis === "timetable") };
  } else {
    let routes = [], nextStop = "";
    if (provider === "seoul") {
      routes = await (deps.seoulRoutes || searchSeoulStationRoutes)({ apiKey: env.SEOUL_OPEN_API_KEY, arsId: text(input.arsId), fetchImpl });
      nextStop = mostCommon(routes.map((route) => text(route.nextStationName)));
      routes = routes.map((route) => ({ routeNumber: text(route.routeNumber, 40), destination: text(route.direction, 60) }));
    } else if (provider === "gyeonggi") {
      const found = await (deps.gyeonggiRoutes || searchGyeonggiStationRoutes)({ serviceKey: env.GYEONGGI_SERVICE_KEY, stationId: text(input.stationId), fetchImpl });
      routes = found.map((route) => ({ routeId: route.routeId, routeNumber: text(route.routeNumber, 40), destination: text(route.destinationName, 60) }));
      try {
        const stations = await (deps.gyeonggiRouteStations || gyeonggiRouteStations)({ serviceKey: env.GYEONGGI_SERVICE_KEY, routeId: routes[0]?.routeId, fetchImpl });
        nextStop = nextStopFromSequence(stations, input.stationId, { idKey: "stationId", nameKey: "stationName", orderKey: "stationSeq" });
      } catch { /* direction falls back to destinations */ }
    } else {
      const found = await (deps.tagoRoutes || searchTagoStationRoutes)({ serviceKey: env.TAGO_SERVICE_KEY, cityCode: text(input.cityCode), nodeId: text(input.nodeId || input.stationId), fetchImpl });
      routes = found.map((route) => ({ routeId: route.routeId, routeNumber: text(route.routeNumber, 40), destination: text(route.destinationName, 60) }));
      try {
        const rows = await (deps.tagoRouteStations || ((params) => routeRows("getRouteAcctoThrghSttnList", params, { env, fetchImpl: deps.fetchImpl })))({ cityCode: text(input.cityCode), routeId: routes[0]?.routeId });
        nextStop = nextStopFromSequence(rows, input.nodeId || input.stationId, { idKey: "nodeid", nameKey: "nodenm", orderKey: "nodeord" });
      } catch { /* direction falls back to destinations */ }
    }
    const unique = [...new Map(routes.filter((route) => route.routeNumber).map((route) => [route.routeNumber, { routeNumber: route.routeNumber, destination: route.destination }])).values()];
    value = { provider, nextStop, heading: mostCommon(unique.map((route) => route.destination)), routes: unique.slice(0, 20), directions: [], timetable: false };
  }
  describeCache.set(cacheKey, { value, expiresAt: Date.now() + DESCRIBE_TTL_MS });
  if (describeCache.size > 2000) describeCache.delete(describeCache.keys().next().value);
  return value;
}

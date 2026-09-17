import { fetchWithTimeout } from "./upstream-fetch.mjs";
import { isValidLocation } from "../logic/commute.js";
import { rankStationCandidates, stationSearchQueries } from "../logic/station-search.js";

const LINES = {1001:"1호선",1002:"2호선",1003:"3호선",1004:"4호선",1005:"5호선",1006:"6호선",1007:"7호선",1008:"8호선",1009:"9호선",1063:"경의중앙선",1065:"공항철도",1067:"경춘선",1075:"수인분당선",1077:"신분당선",1092:"우이신설선",1032:"GTX-A"};
const text = value => String(value ?? "").trim();
const ALIASES = {"서울역":"서울","응암":"응암순환(상선)","공릉":"공릉(서울산업대입구)","대모산입구":"대모산","천호":"천호(풍납토성)","몽촌토성":"몽촌토성(평화의문)","남한산성입구":"남한산성입구(성남법원, 검찰청)"};

export async function searchSubwayStations(keyword, env = process.env, fetchImpl = fetch) {
  if (!text(env.KAKAO_LOCAL_REST_API_KEY)) throw new Error("지하철역 검색에 카카오 장소 검색 키가 필요합니다.");
  let stations = [];
  for (const query of stationSearchQueries(keyword)) {
    const params = new URLSearchParams({query, category_group_code:"SW8",size:"15"});
    const response = await fetchWithTimeout(`https://dapi.kakao.com/v2/local/search/keyword.json?${params}`, {headers:{Authorization:`KakaoAK ${env.KAKAO_LOCAL_REST_API_KEY}`}}, {fetchImpl});
    if (!response.ok) throw new Error(`지하철역 검색 실패 (${response.status}).`);
    const payload = await response.json();
    stations = (payload.documents || []).filter(item => item.category_group_code === "SW8").map(item => {
      const name = text(item.place_name).replace(/\s+[^\s]*(?:호선|분당선|중앙선|철도|신설선|경춘선|GTX-A).*$/i, "");
      const stationName = name.replace(/역$/, "");
      return {stationId:`kakao:${text(item.id)}`, stationName, displayName:text(item.place_name),
        address:text(item.road_address_name || item.address_name), posX:text(item.x), posY:text(item.y),
        stationNumber:"", category:text(item.category_name)};
    }).filter(item => item.stationId !== "kakao:" && item.stationName && isValidLocation({lat:item.posY,lng:item.posX}));
    if (stations.length) break;
  }
  return rankStationCandidates(stations, keyword);
}

export async function fetchSubwayRows(stationName, env = process.env, fetchImpl = fetch) {
  const key = text(env.SEOUL_SUBWAY_API_KEY);
  if (!key) throw new Error("지하철 실시간 연결이 필요합니다. Vercel에 SEOUL_SUBWAY_API_KEY를 등록해 주세요. TAGO 키와는 별도입니다.");
  const name = text(stationName);
  if (!name || name.length > 60) throw new Error("지하철역을 먼저 선택해 주세요.");
  const apiName = ALIASES[name] || name;
  // The official TOPIS endpoint is HTTP; the key stays on the server and is never returned.
  const response = await fetchWithTimeout(`http://swopenapi.seoul.go.kr/api/subway/${encodeURIComponent(key)}/json/realtimeStationArrival/0/100/${encodeURIComponent(apiName)}`, {}, {fetchImpl});
  if (!response.ok) throw new Error(`지하철 도착정보 조회 실패 (${response.status}).`);
  const payload = await response.json();
  if (payload.errorMessage?.code && payload.errorMessage.code !== "INFO-000") throw new Error("지하철 정보를 제공받지 못했습니다. 인증키·지원 역·운행 시간을 확인해 주세요.");
  return Array.isArray(payload.realtimeArrivalList) ? payload.realtimeArrivalList : [];
}

export function subwayDirections(rows) {
  const routes = new Map();
  for (const row of rows) {
    const line = text(row.subwayId), direction = text(row.updnLine), stationId = text(row.statnId);
    const nextStation = text(row.trainLineNm).match(/-\s*(.+?)방면/)?.[1]?.trim() || "";
    const destination = text(row.bstatnNm), trainType = text(row.btrainSttus);
    if (!line || !direction || !stationId || !nextStation || !destination || !trainType) continue;
    const routeId = JSON.stringify([line,direction,stationId,nextStation,destination,trainType]);
    routes.set(routeId,{routeId,routeNumber:LINES[line] || text(row.subwayNm) || `노선 ${line}`, stationId,
      direction, nextStation, destinationName:destination, trainType,
      stationName:text(row.statnNm), label:`${direction} · ${nextStation} 방면 · ${destination}행 · ${trainType}`});
  }
  return [...routes.values()];
}

export function normalizeSubwayArrival(rows, binding, now = new Date()) {
  const selected = subwayDirections(rows).find(route => route.routeId === binding.routeId);
  if (!selected) throw new Error("선택한 역·노선·방향의 열차 정보가 없습니다. 운행 중인 방향을 다시 확인해 주세요.");
  const arrivals = rows.filter(row => subwayDirections([row])[0]?.routeId === selected.routeId).flatMap(row => {
    const seconds = text(row.barvlDt), received = text(row.recptnDt);
    const at = Date.parse(received.replace(" ", "T") + (/Z$|[+-]\d\d:\d\d$/.test(received) ? "" : "+09:00"));
    const age = now.getTime() - at;
    // Zero often means no prediction; departed trains must never become catchable.
    if (!seconds || !Number.isFinite(Number(seconds)) || Number(seconds) <= 0 || text(row.arvlCd) === "2" || !Number.isFinite(age) || age < 0 || age > 120_000) return [];
    const minutes = (Number(seconds) - age / 1000) / 60;
    return minutes > 0 ? [minutes] : [];
  }).sort((a,b) => a-b);
  if (!arrivals.length) throw new Error("이 방향의 유효한 도착 예정시간이 없습니다. 잠시 후 다시 조회해 주세요.");
  return {provider:"subway",stopName:selected.stationName,lineNumber:selected.routeNumber,arrivalsMin:arrivals,
    direction:selected.label,vehicleType:"SUBWAY",fetchedAt:now.toISOString()};
}

export async function fetchSubwayArrival(binding) {
  return normalizeSubwayArrival(await fetchSubwayRows(binding.stationName),binding);
}

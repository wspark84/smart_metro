import { createHash } from "node:crypto";
import { isValidLocation } from "../logic/commute.js";
import { transitQueryKey, transitQueryForState } from "../logic/transit-journey.js";
import { fetchWithTimeout } from "./upstream-fetch.mjs";
import { parseSubwayRouteId } from "../logic/station-search.js";

// Official contract: https://developers.kakao.com/docs/ko/kakaomap/rest-api
const PUBLIC_TRANSIT_URL = "https://dapi.kakao.com/v2/routing/publictraffic";
const clean = (value) => String(value || "").trim();
const sameName = (a, b) => clean(a).replace(/\s/g, "") === clean(b).replace(/\s/g, "");

export function getTransitApiConfig(env = {}) {
  const source = env.KAKAO_TRANSIT_REST_API_KEY ? "KAKAO_TRANSIT_REST_API_KEY" :
    env.KAKAO_LOCAL_REST_API_KEY ? "KAKAO_LOCAL_REST_API_KEY" : null;
  return { id: "kakaoTransit", configured: Boolean(source), source,
    label: "카카오 대중교통 경로", reason: source ? "키 설정됨 · 실제 API 이용 권한은 조회로 확인합니다." :
      "KAKAO_TRANSIT_REST_API_KEY 또는 KAKAO_LOCAL_REST_API_KEY를 서버에 설정해 주세요." };
}

export function normalizeTransitRoutes(payload, query, fetchedAt = new Date().toISOString()) {
  if (payload?.status !== "OK") throw new Error(`대중교통 경로를 찾지 못했습니다 (${clean(payload?.status) || "INVALID_RESPONSE"}).`);
  const queryKey = transitQueryKey(query);
  const routes = (Array.isArray(payload.routes) ? payload.routes : []).flatMap((route) => {
    const steps = (Array.isArray(route?.steps) ? route.steps : []).map((step) => ({
      type: step?.properties?.type,
      durationSec: step?.properties?.time,
      guidance: clean(step?.properties?.guidance),
      stops: (step?.properties?.stops || []).map((stop) => clean(stop?.name)),
      vehicles: (step?.properties?.vehicles || []).map((vehicle) => ({ name: clean(vehicle?.name), type: clean(vehicle?.type) })),
    }));
    const firstIndex = steps.findIndex((step) => ["BUS", "SUBWAY"].includes(step.type));
    if (firstIndex < 0 || steps.some((step) => !["BUS", "SUBWAY", "WALKING"].includes(step.type) ||
      typeof step.durationSec !== "number" || !Number.isFinite(step.durationSec) || step.durationSec < 0)) return [];
    const first = steps[firstIndex];
    const remaining = steps.slice(firstIndex);
    const onboardDurationSec = remaining.reduce((sum, step) => sum + step.durationSec, 0);
    if (onboardDurationSec <= 0) return [];
    // Do not add totalTime to an ETA: it may include the initial wait/access walk.
    // Segment times are estimates, not real-time transfer/traffic guarantees.
    const identity = remaining.map((step) => [step.type, step.stops, step.vehicles]);
    const id = createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24);
    const subway = query.provider === "subway" ? parseSubwayRouteId(query.routeId) : null;
    const stationEqual = (a,b) => sameName(clean(a).replace(/\([^)]*\)/g, "").replace(/역$/, ""),clean(b).replace(/\([^)]*\)/g, "").replace(/역$/, ""));
    const stationMatches = Boolean(query.stationName && first.stops[0] && (subway ? stationEqual(query.stationName, first.stops[0]) : sameName(query.stationName, first.stops[0])));
    const lineMatches = Boolean(query.routeNumber && first.vehicles.some((vehicle) => sameName(vehicle.name, query.routeNumber)));
    const bindingReady = query.provider === "seoul" ? Boolean(query.stationId && query.routeId && query.order) :
      query.provider === "gyeonggi" ? Boolean(query.stationId && query.routeId) :
      query.provider === "tago" ? Boolean(query.cityCode && query.nodeId) : Boolean(subway && query.stationId === subway.stationId);
    const endIndex = subway ? first.stops.findIndex(stop => stationEqual(stop,subway.destination)) : -1;
    const subwayCompatible = Boolean(subway && first.type === "SUBWAY" && stationEqual(subway.nextStation,first.stops[1]) &&
      first.vehicles.some(vehicle => sameName(vehicle.type,subway.trainType)) && (endIndex < 0 || endIndex === first.stops.length - 1));
    const compatible = stationMatches && lineMatches && Boolean(first.stops[1]) && (query.provider === "subway" ? subwayCompatible : first.type === "BUS") && bindingReady;
    return [{ id, queryKey, fetchedAt, provider: "kakao-transit", vehicleType: first.type,
      boardingStation: first.stops[0] || "", nextStation: first.stops[1] || "",
      firstVehicles: first.vehicles, guidance: first.guidance, steps: remaining,
      onboardDurationSec, excludedAccessWalkSec: steps.slice(0, firstIndex).reduce((sum, step) => sum + step.durationSec, 0),
      transfers: Math.max(0, remaining.filter((step) => step.type !== "WALKING").length - 1),
      compatible, boardingConfirmed: false,
      unavailableReason: compatible ? "" : first.type === "SUBWAY" ? "선택한 지하철역·노선·다음 역·열차 종류가 경로와 일치하지 않습니다. 탑승 방향을 다시 선택해 주세요." :
        "선택한 정류장·버스 번호·방향 또는 공식 실시간 연결 정보가 확인되지 않았습니다.",
      durationBasis: "provider-step-estimate", warning: "탑승 후 경로 예상시간입니다. 환승 대기와 실제 운행 지연은 달라질 수 있습니다. 선택한 노선 안에서만 비교합니다." }];
  });
  return { provider: "kakao-transit", fetchedAt, queryKey, routes };
}

export async function fetchTransitRoutes(query, env = {}, fetchImpl = fetch) {
  if (!isValidLocation(query?.stopLocation) || !isValidLocation(query?.workLocation)) {
    throw new Error("선택한 정류장·역 좌표와 목적지 좌표가 필요합니다. 집 주소는 필요하지 않습니다.");
  }
  const config = getTransitApiConfig(env);
  if (!config.configured) throw new Error(config.reason);
  const params = new URLSearchParams({ start_x: String(query.stopLocation.lng), start_y: String(query.stopLocation.lat),
    end_x: String(query.workLocation.lng), end_y: String(query.workLocation.lat), input_coord: "WGS84", output_coord: "WGS84" });
  const response = await fetchWithTimeout(`${PUBLIC_TRANSIT_URL}?${params}`, {
    headers: { Authorization: `KakaoAK ${env[config.source]}`, Accept: "application/json" },
  }, { fetchImpl });
  if (!response.ok) throw new Error(`카카오 대중교통 조회 실패 (${response.status}). 서버 키·카카오맵 사용 설정·이용 한도를 확인해 주세요.`);
  return normalizeTransitRoutes(await response.json(), query);
}

export async function refreshTransitJourney(state, now, loadRoutes) {
  const previous = state?.commute?.transitJourney;
  if (!previous?.boardingConfirmed) return state;
  const query = transitQueryForState(state);
  if (previous.queryKey !== transitQueryKey(query)) return { ...state, commute: { ...state.commute, transitJourney: null } };
  const age = now.getTime() - Date.parse(previous.fetchedAt || "");
  if (age >= 0 && age < 5 * 60_000) return state;
  try {
    const result = await loadRoutes(query);
    const current = result.routes.find((route) => route.id === previous.id && route.compatible);
    return { ...state, commute: { ...state.commute, transitJourney: current ? { ...current, boardingConfirmed: true } : null } };
  } catch {
    // Keep the snapshot only within the shared 15-minute expiry; never renew failed data.
    return state;
  }
}

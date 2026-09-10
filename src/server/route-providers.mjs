import {
  buildAddressAwareRouteEstimate,
  estimateWalkMinutes,
  haversineDistanceMeters,
  isValidLocation,
} from "../logic/commute.js";
import { fetchWithTimeout } from "./upstream-fetch.mjs";
import { getTransitApiConfig } from "./transit-providers.mjs";

const KAKAO_WALKING_DIRECTIONS_URL = "https://apis-navi.kakaomobility.com/affiliate/walking/v1/directions";

function resolveKakaoMobilityRestApiKey(env = {}) {
  const mobilityKey = String(env.KAKAO_MOBILITY_REST_API_KEY || "").trim();
  if (mobilityKey) {
    return {
      key: mobilityKey,
      source: "KAKAO_MOBILITY_REST_API_KEY",
    };
  }

  const localKey = String(env.KAKAO_LOCAL_REST_API_KEY || "").trim();
  if (localKey) {
    return {
      key: localKey,
      source: "KAKAO_LOCAL_REST_API_KEY",
    };
  }

  return {
    key: "",
    source: "",
  };
}

function normalizePoint(point, label = "point") {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  if (!isValidLocation(point)) {
    throw new Error(`A valid ${label} with lat/lng is required.`);
  }

  return {
    lat,
    lng,
  };
}

function buildStraightLineWalk(origin, destination) {
  const distanceM = haversineDistanceMeters(origin, destination);
  const walkMinutes = estimateWalkMinutes(distanceM);
  return {
    provider: "straight-line",
    fallback: true,
    distanceM,
    durationSec: walkMinutes !== null ? walkMinutes * 60 : null,
    walkMinutes,
  };
}

export function getRouteApiConfig(env = {}) {
  const kakao = resolveKakaoMobilityRestApiKey(env);
  return {
    providers: {
      kakaoTransit: getTransitApiConfig(env),
      kakaoWalking: {
        id: "kakaoWalking",
        label: "Kakao Mobility Walking Directions",
        configured: Boolean(kakao.key),
        source: kakao.source || null,
        reason: kakao.key
          ? `Kakao walking API key is available from ${kakao.source}.`
          : "Set KAKAO_MOBILITY_REST_API_KEY or reuse KAKAO_LOCAL_REST_API_KEY for official walking estimates.",
      },
      straightLine: {
        id: "straightLine",
        label: "Straight-line fallback",
        configured: true,
        source: "built-in",
        reason: "A local straight-line walking estimate is always available as a fallback.",
      },
    },
  };
}

export async function estimateWalkRoute({ origin, destination, priority = "DISTANCE" }, env = {}, fetchImpl = fetch) {
  const safeOrigin = normalizePoint(origin, "origin");
  const safeDestination = normalizePoint(destination, "destination");
  const kakao = resolveKakaoMobilityRestApiKey(env);

  if (!kakao.key) {
    return {
      ...buildStraightLineWalk(safeOrigin, safeDestination),
      reason: "Kakao walking API key is not configured, so the server used the local straight-line fallback.",
    };
  }

  const params = new URLSearchParams({
    origin: `${safeOrigin.lng},${safeOrigin.lat}`,
    destination: `${safeDestination.lng},${safeDestination.lat}`,
    priority: String(priority || "DISTANCE"),
    summary: "true",
  });

  const response = await fetchWithTimeout(
    `${KAKAO_WALKING_DIRECTIONS_URL}?${params.toString()}`,
    {
      headers: {
        accept: "application/json",
        Authorization: `KakaoAK ${kakao.key}`,
        service: "buswakeup-prototype",
        "Content-Type": "application/json",
      },
    },
    { fetchImpl },
  );

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Kakao walking API failed (${response.status}).`);
  }

  const route = Array.isArray(payload.routes) ? payload.routes[0] : null;
  const summary = route?.summary || null;
  if (!route || route.result_code !== 0 || !summary) {
    throw new Error(route?.result_message || "Kakao walking API returned no usable route summary.");
  }

  const distanceM = Number(summary.distance);
  const durationSec = Number(summary.duration);
  const walkMinutes = Number.isFinite(durationSec) ? Math.max(1, Math.round(durationSec / 60)) : null;

  return {
    provider: "kakao-walking",
    fallback: false,
    distanceM: Number.isFinite(distanceM) ? distanceM : null,
    durationSec: Number.isFinite(durationSec) ? durationSec : null,
    walkMinutes,
    reason: `Official Kakao walking route estimated with ${kakao.source}.`,
  };
}

export async function estimateCommuteRoute(payload, env = {}, fetchImpl = fetch) {
  const safeHome = normalizePoint(payload?.homeLocation, "homeLocation");
  const safeStop = normalizePoint(payload?.stopLocation, "stopLocation");
  const safeWork = payload?.workLocation ? normalizePoint(payload.workLocation, "workLocation") : null;
  const busRideMin = Math.max(0, Number(payload?.busRideMin) || 0);
  const alightToWorkWalkMin = Math.max(0, Number(payload?.alightToWorkWalkMin) || 0);

  let walkLeg;
  try {
    walkLeg = await estimateWalkRoute({ origin: safeHome, destination: safeStop }, env, fetchImpl);
  } catch (error) {
    walkLeg = {
      ...buildStraightLineWalk(safeHome, safeStop),
      reason: error instanceof Error ? error.message : "Unknown Kakao walking error. Straight-line fallback used.",
      provider: "straight-line-fallback",
    };
  }

  const localReference = buildAddressAwareRouteEstimate({
    homeLocation: safeHome,
    workLocation: safeWork,
    stopLocation: safeStop,
    busRideMin,
    alightToWorkWalkMin,
  });

  const totalCommuteMin =
    walkLeg.walkMinutes !== null ? walkLeg.walkMinutes + busRideMin + alightToWorkWalkMin : localReference.totalCommuteMin;

  return {
    provider: walkLeg.provider,
    fallback: Boolean(walkLeg.fallback),
    reason: walkLeg.reason || "",
    fetchedAt: new Date().toISOString(),
    homeToStop: {
      distanceM: walkLeg.distanceM,
      durationSec: walkLeg.durationSec,
      walkMinutes: walkLeg.walkMinutes,
      straightLineDistanceM: localReference.homeToStopDistanceM,
    },
    busRideMin,
    alightToWorkWalkMin,
    totalCommuteMin,
    homeToWorkCrowDistanceM: localReference.homeToWorkDistanceM,
  };
}

import { isValidLocation } from "./commute.js";

export const TRANSIT_ROUTE_MAX_AGE_MS = 15 * 60_000;

export function transitQueryForState(state) {
  return {
    stopLocation: state?.commute?.stopLocation,
    workLocation: state?.user?.workLocation,
    stationName: String(state?.live?.stationName || "").trim(),
    routeNumber: String(state?.live?.routeNumber || "").trim(),
    provider: String(state?.live?.provider || "none"),
    stationId: String(state?.live?.stationId || state?.live?.nodeId || ""),
    routeId: String(state?.live?.routeId || ""),
    order: String(state?.live?.order || ""),
    cityCode: String(state?.live?.cityCode || ""),
    nodeId: String(state?.live?.nodeId || ""),
    arsId: String(state?.live?.arsId || ""),
  };
}

export function transitQueryKey(query) {
  const point = (value) => isValidLocation(value) ? [Number(value.lng), Number(value.lat)] : null;
  return JSON.stringify([point(query?.stopLocation), point(query?.workLocation),
    query?.stationName || "", query?.routeNumber || "", query?.provider || "none",
    query?.stationId || "", query?.routeId || "", query?.order || "",
    query?.cityCode || "", query?.nodeId || "", query?.arsId || ""]);
}

export function resolveJourneyDuration(state, now = new Date()) {
  if (!state?.live?.provider || state.live.provider === "none") {
    return { durationAvailable: true, vehicleType: "BUS",
      onboardToDestinationMin: Number(state?.commute?.busRideMin || 0) + Number(state?.commute?.alightToWorkWalkMin || 0),
      source: "demo" };
  }
  const journey = state?.commute?.transitJourney;
  const age = now.getTime() - Date.parse(journey?.fetchedAt || "");
  const duration = journey?.onboardDurationSec;
  const valid = journey?.queryKey === transitQueryKey(transitQueryForState(state)) &&
    journey?.boardingConfirmed === true && journey?.compatible === true &&
    age >= 0 && age <= TRANSIT_ROUTE_MAX_AGE_MS && typeof duration === "number" && duration > 0;
  return {
    durationAvailable: Boolean(valid),
    onboardToDestinationMin: valid ? duration / 60 : null,
    vehicleType: journey?.vehicleType || "BUS",
    source: valid ? "kakao-transit-estimate" : "route-unavailable",
  };
}

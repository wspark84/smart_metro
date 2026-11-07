// An ETA is relative to the provider fetch time, never the cache response time.
export const MAX_LIVE_ETA_AGE_MS = 120_000;
// A snapshot can be stamped a moment after the "now" a request started with
// (the lookup runs after it), and server clocks differ slightly. Such a
// snapshot is current, not invalid: treat up to two minutes ahead as age 0.
export const CLOCK_SKEW_MS = 120_000;

export function projectLiveArrivals(snapshot, now = new Date()) {
  const fetchedAt = Date.parse(snapshot?.fetchedAt || "");
  const nowMs = new Date(now).getTime();
  const rawAge = nowMs - fetchedAt;
  if (!Number.isFinite(rawAge) || rawAge < -CLOCK_SKEW_MS || rawAge > MAX_LIVE_ETA_AGE_MS) return [];
  const age = Math.max(0, rawAge);
  return (Array.isArray(snapshot?.arrivalsMin) ? snapshot.arrivalsMin : [])
    .filter((value) => value !== null && value !== "" && Number.isFinite(Number(value)))
    .map((value) => Number(value) - age / 60_000)
    .filter((value) => value >= 0)
    .sort((a, b) => a - b);
}

export function isLiveConfigured(state) {
  return Boolean(state?.live?.provider && state.live.provider !== "none");
}

export function resolveCommuteLine(state, demoLine) {
  if (!isLiveConfigured(state) || !state.live.routeNumber) return demoLine;
  return { ...demoLine, number: String(state.live.routeNumber), label: state.live.provider === "subway" ? "지하철" : "등록한 노선",
    destination: "", rideMin: state.commute.busRideMin };
}

export function resolveCommuteStop(state, library) {
  const stop = library.find((item) => item.id === state.commute.selectedStopId) || library[0];
  if (!isLiveConfigured(state)) return stop;
  return { ...stop, id: state.commute.selectedStopId,
    lat: state.commute.stopLocation?.lat ?? null,
    lng: state.commute.stopLocation?.lng ?? null,
    name: state.live.stationName || "탑승 지점을 선택하세요",
    stopCode: state.live.arsId || state.live.stationId || state.live.nodeId || "" };
}

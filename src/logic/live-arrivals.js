// An ETA is relative to the provider fetch time, never the cache response time.
export const MAX_LIVE_ETA_AGE_MS = 120_000;

export function projectLiveArrivals(snapshot, now = new Date()) {
  const fetchedAt = Date.parse(snapshot?.fetchedAt || "");
  const nowMs = new Date(now).getTime();
  const age = nowMs - fetchedAt;
  if (!Number.isFinite(age) || age < 0 || age > MAX_LIVE_ETA_AGE_MS) return [];
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

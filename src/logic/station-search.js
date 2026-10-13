export function normalizeStationText(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[\s.·,()\-]/g, "");
}

export function stationSelectionKey(station) {
  return String(station?.selectionId || station?.stationId || "");
}

export function parseSubwayRouteId(value) {
  try {
    const parts = JSON.parse(value);
    if (!Array.isArray(parts) || parts.length !== 6 || parts.some(part => typeof part !== "string" || !part)) return null;
    const [lineId, direction, stationId, nextStation, destination, trainType] = parts;
    return {lineId, direction, stationId, nextStation, destination, trainType};
  } catch { return null; }
}

export function stationSearchQueries(value) {
  const original = String(value || "").trim().slice(0, 80);
  const compact = original.replace(/\s+/g, "");
  if (/^\d+$/.test(compact)) return [...new Set([compact,compact.length===4?compact.padStart(5,"0"):compact])];
  const prefix = compact.length >= 5 ? compact.slice(0, Math.max(3, Math.floor(compact.length * 0.65))) : "";
  return [...new Set([original, compact, prefix].filter(Boolean))].slice(0, 3);
}

export function rankStationCandidates(items, query) {
  const needle = normalizeStationText(query);
  const score = item => {
    const name = normalizeStationText(item.stationName);
    if (name === needle) return 100;
    if (name.includes(needle)) return 80;
    let overlap = 0;
    for (let i = 0; i < needle.length - 1; i++) if (name.includes(needle.slice(i, i + 2))) overlap++;
    return overlap / Math.max(1, needle.length - 1) * 60;
  };
  const unique = new Map(items.map(item => [String(item.stationId), item]));
  return [...unique.values()].sort((a, b) => score(b) - score(a) || String(a.stationName).localeCompare(String(b.stationName), "ko"));
}

// Line labels differ between Kakao ("부산 1호선") and TAGO ("부산1호선" or "1호선").
// Treat lines as different only when a region or line number clearly disagrees.
const LINE_REGIONS = ["서울", "부산", "대구", "광주", "대전", "인천", "김해", "의정부", "용인", "김포", "경기"];
export function normalizeLineName(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, "").replace(/도시철도|지하철/g, "").replace(/선$/, "");
}
export function linesCompatible(first, second) {
  const a = normalizeLineName(first), b = normalizeLineName(second);
  if (!a || !b || a === b) return true;
  const ra = LINE_REGIONS.filter((region) => a.includes(region)), rb = LINE_REGIONS.filter((region) => b.includes(region));
  if (ra.length && rb.length && !ra.some((region) => rb.includes(region))) return false;
  const da = a.match(/\d+/)?.[0], db = b.match(/\d+/)?.[0];
  if (da && db) return da === db;
  if (da || db) return false;
  return a.includes(b) || b.includes(a);
}

// Timetable-based subway directions reuse the six-part route id with this marker.
export const SUBWAY_TIMETABLE_TRAIN_TYPE = "시간표";
export function isTimetableSubwayRoute(direction) {
  return direction?.trainType === SUBWAY_TIMETABLE_TRAIN_TYPE && String(direction?.stationId || "").startsWith("tago:");
}

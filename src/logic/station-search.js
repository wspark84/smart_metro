export function normalizeStationText(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[\s.·,()\-]/g, "");
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

// Nationwide subway support outside Seoul's real-time API.
// Uses the official TAGO subway station timetable (국토교통부_(TAGO)_지하철정보).
// Results are always labelled as timetable-based, never as real-time.
import { fetchWithTimeout } from "./upstream-fetch.mjs";
import { readTagoResponse } from "./tago-api.mjs";
import { readCatalogRows } from "./transit-catalog.mjs";
import { loadWithCache } from "./request-cache.mjs";
import { loadOfficialHolidayYear } from "./holiday-providers.mjs";
import { linesCompatible, normalizeStationText, parseSubwayRouteId, isTimetableSubwayRoute, SUBWAY_TIMETABLE_TRAIN_TYPE } from "../logic/station-search.js";

// Current gateway path first, then the legacy one still served for older approvals.
const ENDPOINTS = [
  { base: "https://apis.data.go.kr/1613000/SubwayInfo/", stations: "GetKwrdFndSubwaySttnList", timetable: "GetSubwaySttnAcctoSchdulList" },
  { base: "https://apis.data.go.kr/1613000/SubwayInfoService/", stations: "getKwrdFndSubwaySttnList", timetable: "getSubwaySttnAcctoSchdulList" },
];
const DAY_MS = 86_400_000;
const KST_MS = 9 * 3_600_000;
const text = (value) => String(value ?? "").trim();
const stationName = (value) => normalizeStationText(text(value).replace(/\([^)]*\)/g, "").replace(/역$/, ""));

async function fetchTagoSubwayRows(kind, params, { env = process.env, fetchImpl = fetch, maxPages = 5 } = {}) {
  if (!env.TAGO_SERVICE_KEY) throw Object.assign(new Error("전국 지하철 시간표 연결에 TAGO 인증키가 필요합니다."), { code: "KEY_MISSING" });
  let firstError;
  for (const endpoint of ENDPOINTS) {
    try {
      const rows = [];
      for (let page = 1; page <= maxPages; page += 1) {
        const url = new URL(endpoint.base + endpoint[kind]);
        for (const [key, value] of Object.entries({ ...params, serviceKey: env.TAGO_SERVICE_KEY, _type: "json", numOfRows: 100, pageNo: page })) url.searchParams.set(key, value);
        const response = await fetchWithTimeout(url, {}, { fetchImpl, timeoutMs: 6000 });
        // The current Swagger wraps header/body at the root; the legacy API uses "response".
        const body = await readTagoResponse({ ok: response.ok, status: response.status, text: async () => {
          const raw = await response.text();
          try { const value = JSON.parse(raw); return value.header && value.body ? JSON.stringify({ response: value }) : raw; } catch { return raw; }
        } });
        const item = body?.items?.item;
        const batch = item == null || item === "" ? [] : Array.isArray(item) ? item : [item];
        rows.push(...batch.filter((row) => row && typeof row === "object"));
        const total = Number(body?.totalCount);
        if (!Number.isFinite(total) || page * 100 >= total || !batch.length) return rows;
      }
      throw new Error("시간표 페이지가 너무 많습니다.");
    } catch (error) {
      firstError ||= error;
    }
  }
  throw firstError;
}

export async function findTagoSubwayStations(name, lineName, deps = {}) {
  const wanted = stationName(name);
  if (!wanted) return [];
  const catalog = deps.readCatalog ? await deps.readCatalog() : await readCatalogRows("subway", "GetKwrdFndSubwaySttnList", {}, deps.env);
  const rows = catalog || (await loadWithCache({ key: ["tago-subway-stations", wanted], ttlMs: DAY_MS, allowStaleOnError: true,
    loader: () => fetchTagoSubwayRows("stations", { subwayStationName: text(name).replace(/역$/, "") }, deps) })).value;
  return rows.filter((row) => stationName(row.subwayStationName) === wanted && linesCompatible(lineName, row.subwayRouteName))
    .map((row) => ({ stationId: text(row.subwayStationId), stationName: text(row.subwayStationName), routeName: text(row.subwayRouteName) }))
    .filter((row) => /^[A-Za-z0-9_-]{1,60}$/.test(row.stationId));
}

export async function loadStationTimetable(stationId, dailyTypeCode, upDownTypeCode, deps = {}) {
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(text(stationId)) || !["01", "02", "03"].includes(dailyTypeCode) || !["U", "D"].includes(upDownTypeCode)) {
    throw new Error("지하철 시간표 조회 정보가 올바르지 않습니다.");
  }
  const params = { subwayStationId: stationId, dailyTypeCode, upDownTypeCode };
  const result = await loadWithCache({ key: ["tago-subway-timetable", params], ttlMs: 12 * 3_600_000, allowStaleOnError: true,
    loader: async () => {
      const catalog = deps.readCatalog ? null : await readCatalogRows("subway", "GetSubwaySttnAcctoSchdulList", params, deps.env);
      const rows = catalog || await fetchTagoSubwayRows("timetable", params, deps);
      return rows.filter((row) => text(row.subwayStationId || stationId) === stationId &&
        text(row.dailyTypeCode || dailyTypeCode) === dailyTypeCode && text(row.upDownTypeCode || upDownTypeCode) === upDownTypeCode);
    } });
  return result.value;
}

// "053000", "0530", "05:30:00" and after-midnight "243500" → seconds after service-day midnight.
export function timetableSeconds(value) {
  const digits = text(value).replace(/:/g, "");
  if (!/^\d{3,6}$/.test(digits) || /^0+$/.test(digits)) return null;
  const padded = digits.length <= 4 ? digits.padStart(4, "0") + "00" : digits.padStart(6, "0");
  const h = Number(padded.slice(0, 2)), m = Number(padded.slice(2, 4)), s = Number(padded.slice(4, 6));
  if (m > 59 || s > 59 || h > 29) return null;
  // Trains listed at 00:00–02:59 run after midnight of the same service day.
  return ((h < 3 ? h + 24 : h) * 3600) + m * 60 + s;
}

export function kstDateKey(epochMs) {
  return new Date(epochMs + KST_MS).toISOString().slice(0, 10);
}

export function dailyTypeFor(dateKey, holidays = new Set()) {
  if (holidays.has(dateKey)) return "03";
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return day === 0 ? "03" : day === 6 ? "02" : "01";
}

async function holidaySet(years, loadHolidays) {
  const set = new Set();
  let known = true;
  for (const year of new Set(years)) {
    try {
      for (const item of (await loadHolidays(year)).holidays || []) {
        const key = text(item.date).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
        set.add(key);
      }
    } catch { known = false; }
  }
  return { set, known };
}

const boardable = (row) => timetableSeconds(row.depTime) !== null;

function terminalLabel(rows) {
  const counts = new Map();
  for (const row of rows) { const name = text(row.endSubwayStationNm); if (name) counts.set(name, (counts.get(name) || 0) + 1); }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name).join("·");
}

export async function timetableSubwayDirections(binding, deps = {}) {
  const now = deps.now || new Date();
  const loadHolidays = deps.loadHolidays || loadOfficialHolidayYear;
  const dateKey = kstDateKey(now.getTime());
  const { set } = await holidaySet([dateKey.slice(0, 4)], loadHolidays);
  const dailyTypeCode = dailyTypeFor(dateKey, set);
  const candidates = binding.tagoStationId
    ? [{ stationId: text(binding.tagoStationId), stationName: text(binding.stationName), routeName: text(binding.lineName) }]
    : await findTagoSubwayStations(binding.stationName, binding.lineName, deps);
  const routes = [];
  for (const station of candidates.slice(0, 3)) {
    for (const upDown of ["U", "D"]) {
      let rows;
      try { rows = (await loadStationTimetable(station.stationId, dailyTypeCode, upDown, deps)).filter(boardable); }
      catch (error) { if (!routes.length && station === candidates[0] && upDown === "U") deps.onError?.(error); continue; }
      if (!rows.length) continue;
      const direction = upDown === "U" ? "상행" : "하행";
      const destination = terminalLabel(rows) || direction;
      const lineLabel = text(binding.lineName) || station.routeName || "지하철";
      const stationId = `tago:${station.stationId}:${upDown}`;
      routes.push({
        routeId: JSON.stringify([lineLabel, direction, stationId, `${destination}`, destination, SUBWAY_TIMETABLE_TRAIN_TYPE]),
        routeNumber: lineLabel, stationId, direction, nextStation: destination, destinationName: destination,
        trainType: SUBWAY_TIMETABLE_TRAIN_TYPE, stationName: station.stationName || text(binding.stationName),
        tagoStationId: station.stationId, tagoRouteName: station.routeName, upDownTypeCode: upDown,
        basis: "timetable", realtime: false,
        label: `${lineLabel} · ${direction} · ${destination} 방면 · 시간표 기준`,
      });
    }
  }
  return routes;
}

export function parseTimetableBinding(routeId) {
  const direction = parseSubwayRouteId(routeId);
  if (!isTimetableSubwayRoute(direction)) return null;
  const [, stationId, upDown] = direction.stationId.split(":");
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(stationId || "") || !["U", "D"].includes(upDown)) return null;
  return { ...direction, tagoStationId: stationId, upDownTypeCode: upDown };
}

export async function fetchTimetableSubwayArrival(binding, deps = {}) {
  const parsed = parseTimetableBinding(binding.routeId);
  if (!parsed) throw new Error("지하철 시간표 방향 정보를 다시 선택해 주세요.");
  const now = deps.now || new Date();
  const loadHolidays = deps.loadHolidays || loadOfficialHolidayYear;
  const nowMs = now.getTime();
  const todayStart = Date.parse(`${kstDateKey(nowMs)}T00:00:00+09:00`);
  const hour = new Date(nowMs + KST_MS).getUTCHours();
  // Service days that can still have departures in the next few hours.
  const starts = [hour < 3 ? todayStart - DAY_MS : null, todayStart, hour >= 20 ? todayStart + DAY_MS : null].filter((v) => v !== null);
  const keys = starts.map((start) => kstDateKey(start));
  const holidays = await holidaySet(keys.map((key) => key.slice(0, 4)), loadHolidays);
  const minutes = [];
  for (const [index, start] of starts.entries()) {
    const rows = await loadStationTimetable(parsed.tagoStationId, dailyTypeFor(keys[index], holidays.set), parsed.upDownTypeCode, deps);
    for (const row of rows) {
      const seconds = timetableSeconds(row.depTime);
      if (seconds === null) continue;
      const delta = (start + seconds * 1000 - nowMs) / 60_000;
      if (delta > 0 && delta <= 8 * 60) minutes.push(delta);
    }
  }
  const arrivalsMin = [...new Set(minutes.map((value) => Math.round(value * 100) / 100))].sort((a, b) => a - b).slice(0, 12);
  if (!arrivalsMin.length) throw new Error("이 방향은 앞으로 몇 시간 안에 출발하는 열차가 시간표에 없습니다.");
  return { provider: "subway", stopName: text(binding.stationName), lineNumber: parsed.lineId, arrivalsMin,
    direction: `${parsed.direction} · ${parsed.destination} 방면 · 시간표 기준`, vehicleType: "SUBWAY",
    fetchedAt: now.toISOString(), basis: "timetable", realtime: false, holidayCalendarKnown: holidays.known,
    notice: "공식 시간표 기준입니다. 실제 운행은 지연될 수 있습니다." };
}

// Confirms that a timetable direction at station A really heads to the next
// station B of a route: trains of the same terminal reach B shortly after
// leaving A. Returns false (unverified) whenever the evidence is weak.
export async function verifyTimetableDirection(binding, nextStationName, deps = {}) {
  const parsed = parseTimetableBinding(binding.routeId);
  if (!parsed || !text(nextStationName)) return false;
  const now = deps.now || new Date();
  const dateKey = kstDateKey(now.getTime());
  const { set } = await holidaySet([dateKey.slice(0, 4)], deps.loadHolidays || loadOfficialHolidayYear);
  const day = dailyTypeFor(dateKey, set);
  const neighbours = (await findTagoSubwayStations(nextStationName, parsed.lineId, deps)).filter((s) => s.stationId !== parsed.tagoStationId);
  if (neighbours.length !== 1) return false;
  const [here, there] = await Promise.all([
    loadStationTimetable(parsed.tagoStationId, day, parsed.upDownTypeCode, deps),
    loadStationTimetable(neighbours[0].stationId, day, parsed.upDownTypeCode, deps),
  ]);
  const byTerminal = new Map();
  for (const row of there) {
    const at = timetableSeconds(row.arrTime) ?? timetableSeconds(row.depTime);
    if (at === null) continue;
    const key = text(row.endSubwayStationId || row.endSubwayStationNm);
    if (!byTerminal.has(key)) byTerminal.set(key, []);
    byTerminal.get(key).push(at);
  }
  const offsets = [];
  for (const row of here) {
    const dep = timetableSeconds(row.depTime);
    const times = byTerminal.get(text(row.endSubwayStationId || row.endSubwayStationNm));
    if (dep === null || !times) continue;
    let best = null;
    for (const at of times) if (Math.abs(at - dep) <= 600 && (best === null || Math.abs(at - dep) < Math.abs(best))) best = at - dep;
    if (best !== null) offsets.push(best);
  }
  if (offsets.length < 3) return false;
  offsets.sort((a, b) => a - b);
  const median = offsets[Math.floor(offsets.length / 2)];
  return median >= 20 && median <= 360;
}

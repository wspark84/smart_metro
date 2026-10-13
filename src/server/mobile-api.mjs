// Mobile (Flutter) API. The app never edits the whole app-state document;
// the server applies the same field changes the web client makes, so the
// alarm engine keeps reading one consistent format.
import { buildJourneyOptionsPlan } from "../logic/journey-options.js";
import { normalizeBoardingAccessMin, isValidLocation, dateOnlyKey } from "../logic/commute.js";
import { transitQueryForState } from "../logic/transit-journey.js";
import { normalizeTripSchedules, scheduleValidation } from "../logic/trip-schedules.js";
import { parseSubwayRouteId, isTimetableSubwayRoute } from "../logic/station-search.js";

const PROVIDERS = new Set(["seoul", "gyeonggi", "tago", "subway"]);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const str = (value, max = 150) => String(value ?? "").trim().slice(0, max);
const clone = (value) => JSON.parse(JSON.stringify(value ?? {}));
const fail = (statusCode, message, code = "INVALID_INPUT") => Object.assign(new Error(message), { statusCode, code });

function point(lat, lng) {
  const value = { lat: Number(lat), lng: Number(lng) };
  // Service area is South Korea; rejects empty (0,0) and swapped coordinates.
  return isValidLocation({ lat, lng }) && value.lat >= 33 && value.lat <= 39 && value.lng >= 124 && value.lng <= 132 ? value : null;
}

export function applyCommuteSetup(previous, patch = {}) {
  const state = clone(previous);
  state.user ||= {}; state.commute ||= {}; state.live ||= {}; state.meta ||= {};
  if (patch.requiredArrivalTime !== undefined) {
    if (!TIME.test(String(patch.requiredArrivalTime))) throw fail(400, "도착 목표 시각을 HH:MM 형식으로 입력해 주세요.");
    state.user.requiredArrivalTime = patch.requiredArrivalTime;
  }
  if (patch.boardingAccessMin !== undefined) {
    const access = normalizeBoardingAccessMin(patch.boardingAccessMin);
    if (access === null) throw fail(400, "정류장·역까지 걸리는 시간은 0~180분으로 입력해 주세요.");
    state.commute.boardingAccessMin = access;
  }
  if (patch.destination !== undefined) {
    const location = point(patch.destination?.lat, patch.destination?.lng);
    if (!location) throw fail(400, "검색 결과에서 도착지를 선택해 주세요.");
    const address = str(patch.destination.address, 300) || str(patch.destination.label, 300);
    state.user.workAddress = address;
    state.user.workLocation = { ...location, source: "search", label: str(patch.destination.label, 300) || address };
  }
  if (patch.boarding !== undefined) {
    const b = patch.boarding || {};
    const provider = str(b.provider, 20);
    const location = point(b.lat, b.lng);
    if (!PROVIDERS.has(provider) || !str(b.stationName) || !(str(b.stationId) || str(b.nodeId)) || !location) {
      throw fail(400, "검색 결과에서 출발 정류장 또는 역을 선택해 주세요.");
    }
    const nodeId = provider === "tago" ? str(b.nodeId) || str(b.stationId) : str(b.nodeId);
    state.live = { ...state.live, provider, stationId: str(b.stationId), stationName: str(b.stationName), arsId: str(b.arsId),
      cityCode: str(b.cityCode), nodeId, lineName: provider === "subway" ? str(b.lineName, 60) : "",
      routeId: "", routeNumber: "", order: "", snapshot: null, status: "idle", lastError: "", lastSyncedAt: "" };
    state.commute.stopLocation = location;
    state.commute.selectedStopId = str(b.stationId) || nodeId;
    state.commute.transitJourney = null;
    state.commute.planningOfficialHeadwayMin = null;
  }
  state.commute.routingMode = "all-routes";
  state.commute.planningHeadwayMin = null;
  state.commute.planningBindingKey = JSON.stringify([state.live.provider, state.live.stationId || state.live.nodeId, state.live.routeId || "", state.live.order || ""]);
  state.meta.demoMode = false;
  return state;
}

export function setupSummary(state) {
  const live = state?.live || {}, user = state?.user || {}, commute = state?.commute || {};
  const destination = isValidLocation(user.workLocation) && user.workLocation.source !== "demo"
    ? { address: str(user.workAddress, 300), label: str(user.workLocation.label, 300), lat: Number(user.workLocation.lat), lng: Number(user.workLocation.lng) } : null;
  const boarding = PROVIDERS.has(live.provider) && live.stationName && isValidLocation(commute.stopLocation)
    ? { provider: live.provider, mode: live.provider === "subway" ? "subway" : "bus", stationId: str(live.stationId), stationName: str(live.stationName),
      lineName: str(live.lineName, 60), arsId: str(live.arsId), cityCode: str(live.cityCode), nodeId: str(live.nodeId),
      lat: Number(commute.stopLocation.lat), lng: Number(commute.stopLocation.lng) } : null;
  const access = normalizeBoardingAccessMin(commute.boardingAccessMin);
  const missing = [!destination && "destination", !boarding && "boarding", access === null && "boardingAccessMin",
    !TIME.test(String(user.requiredArrivalTime || "")) && "requiredArrivalTime"].filter(Boolean);
  return { requiredArrivalTime: TIME.test(String(user.requiredArrivalTime || "")) ? user.requiredArrivalTime : "09:00",
    boardingAccessMin: access, destination, boarding, complete: missing.length === 0, missing };
}

export function todayAlarmStatus(state, now = new Date()) {
  const today = dateOnlyKey(now), schedule = state?.schedule || {};
  const armed = schedule.enabled !== false && schedule.oneTimeDate === today && schedule.snoozeDate !== today;
  return { armed, date: today, departedToday: schedule.snoozeDate === today && schedule.oneTimeDate === today };
}

// Free home alarm: arm for today only (server enforces the one-day window).
export function applyTodayAlarm(previous, enabled, now = new Date()) {
  const state = clone(previous), today = dateOnlyKey(now);
  state.schedule = { ...(state.schedule || {}) };
  if (enabled) {
    state.schedule.enabled = true;
    state.schedule.repeatPreset = "DAILY";
    state.schedule.skipHolidays = false;
    if (state.schedule.snoozeDate === today) state.schedule.snoozeDate = null;
  } else {
    state.schedule.snoozeDate = today;
  }
  return state;
}

export function applyTrips(previous, trips) {
  if (!Array.isArray(trips) || trips.length > 10) throw fail(400, "일정은 최대 10개까지 저장할 수 있습니다.");
  const normalized = normalizeTripSchedules(trips);
  if (normalized.length !== trips.length) throw fail(400, "일정 정보가 올바르지 않습니다. 다시 확인해 주세요.");
  for (const trip of normalized) {
    const problem = trip.enabled ? scheduleValidation(trip) : "";
    if (problem) throw fail(400, `${trip.name}: ${problem}`);
  }
  // Re-normalizing the stored list keeps unchanged schedules byte-identical.
  const state = clone(previous);
  state.tripSchedules = JSON.stringify(normalizeTripSchedules(previous?.tripSchedules)) === JSON.stringify(normalized)
    ? previous.tripSchedules : normalized;
  return state;
}

function rowBasis(row) {
  if (row.estimated) return "estimate";
  const direction = row.binding?.provider === "subway" ? parseSubwayRouteId(row.binding.routeId) : null;
  return isTimetableSubwayRoute(direction) ? "timetable" : "realtime";
}

export function buildHomeForecast({ state, automatic, now = new Date() }) {
  const setup = setupSummary(state);
  if (!setup.complete) return { status: "setup-required", missing: setup.missing, rows: [] };
  const holidays = [...(state.holidayDates || []), ...(state.officialHolidays || []).map((item) => item?.date).filter(Boolean)];
  const options = Array.isArray(automatic?.options) ? automatic.options : [];
  const plan = buildJourneyOptionsPlan({ now, requiredArrivalTime: setup.requiredArrivalTime, boardingAccessMin: setup.boardingAccessMin,
    holidays, incomplete: Boolean(automatic?.unverifiedCount), options });
  const at = (minutes) => Number.isFinite(minutes) ? new Date(now.getTime() + minutes * 60_000).toISOString() : null;
  const target = plan.risk.targetResult;
  const rows = plan.rows.filter((row) => row.arrivalMinutes >= 0).slice(0, 8).map((row) => ({
    routeNumber: str(row.routeNumber, 40), direction: str(row.direction, 80), boardingAt: at(row.arrivalMinutes),
    minutes: Math.max(0, Math.floor(row.arrivalMinutes)), onTime: row.level !== "UNKNOWN" && row.deltaMinutes >= 0,
    catchable: Boolean(row.catchable), basis: rowBasis(row), target: row.optionId === target?.optionId && row.arrivalMinutes === target?.arrivalMinutes,
  }));
  const departure = plan.risk.departure;
  return {
    status: options.length ? (Number.isFinite(target?.arrivalMinutes) ? "ready" : "no-catchable") : "no-route",
    leaveAt: departure?.leaveAt ? new Date(departure.leaveAt).toISOString() : null,
    leaveInMinutes: departure ? departure.minutes : null,
    overdue: Boolean(departure && departure.remainingMin < 0),
    boardingAt: at(target?.arrivalMinutes),
    routeNumber: str(target?.routeNumber, 40), direction: str(target?.direction, 80),
    basis: target && Number.isFinite(target.arrivalMinutes) ? rowBasis(target) : null,
    urgent: Boolean(plan.urgentBoarding), message: str(plan.risk.message, 300), rows,
    unverifiedCount: Number(automatic?.unverifiedCount) || 0, warning: str(automatic?.warning, 300),
    checkedAt: now.toISOString(),
  };
}

// ---- HTTP layer -------------------------------------------------------------

const ROUTES = {
  "GET /api/mobile/home": "home", "POST /api/mobile/setup": "setup", "POST /api/mobile/today": "today",
  "GET /api/mobile/trips": "trips", "PUT /api/mobile/trips": "saveTrips",
};

export async function handleMobileApi(request, response, deps) {
  const url = new URL(request.url, "http://internal");
  const action = ROUTES[`${request.method} ${url.pathname}`];
  if (!action) { deps.sendJson(response, 404, { error: "지원하지 않는 앱 요청입니다." }); return; }
  if (request.method !== "GET" && !deps.isTrustedMutation(request)) { deps.sendJson(response, 403, { error: "허용되지 않은 요청입니다." }); return; }
  const auth = await deps.authenticate(request, response);
  if (!auth) { deps.sendJson(response, 401, { error: "로그인이 필요합니다.", code: "LOGIN_REQUIRED" }); return; }
  try {
    const input = request.method === "GET" ? {} : await deps.readJsonBody(request);
    const now = deps.now ? deps.now() : new Date();
    const result = await deps.withUserDocuments(auth, async (docs) => {
      const state = await docs.readState();
      const subscription = async () => { try { return await deps.subscriptionStatus(auth.user.id); } catch { return { active: false, available: false, unknown: true }; } };
      const view = async (current, extra = {}) => {
        const setup = setupSummary(current);
        let automatic = null, forecastError = "";
        if (setup.complete && action !== "trips" && action !== "saveTrips") {
          try { automatic = await docs.loadOptions(transitQueryForState(current), { requiredArrivalTime: setup.requiredArrivalTime, boardingAccessMin: setup.boardingAccessMin }); }
          catch (error) { forecastError = error?.routeFailureCode ? "경로·도착정보를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요." : "도착정보 확인이 지연되고 있습니다."; }
        }
        return { setup, today: todayAlarmStatus(current, now), forecast: buildHomeForecast({ state: current, automatic, now }),
          forecastError, trips: current.tripSchedules || [], subscription: await subscription(), ...extra };
      };
      if (action === "home") return view(state);
      if (action === "trips") return { trips: state.tripSchedules || [], subscription: await subscription() };
      let next;
      if (action === "setup") next = applyCommuteSetup(state, input);
      else if (action === "today") next = applyTodayAlarm(state, input?.enabled === true, now);
      else {
        next = applyTrips(state, input?.trips);
        deps.assertTripScheduleChange(state, next, (await subscription()).active === true);
      }
      const saved = await docs.saveState(next);
      return action === "saveTrips" ? { ok: true, trips: saved.tripSchedules || [] } : { ok: true, ...(await view(saved)) };
    });
    deps.sendJson(response, 200, result);
  } catch (error) {
    const known = ["INVALID_INPUT", "SUBSCRIPTION_REQUIRED", "BILLING_NOT_READY", "DOCUMENT_CONFLICT"].includes(error?.code);
    deps.sendJson(response, error?.statusCode || 503, { error: known ? error.message : "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", code: error?.code || "MOBILE_API_ERROR" });
  }
}

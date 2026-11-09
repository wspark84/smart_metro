// Mobile (Flutter) API. The app never edits the whole app-state document;
// the server applies the same field changes the web client makes, so the
// alarm engine keeps reading one consistent format.
import { buildJourneyOptionsPlan } from "../logic/journey-options.js";
import { normalizeBoardingAccessMin, isValidLocation, dateOnlyKey, combineDateAndTime } from "../logic/commute.js";
import { transitQueryForState } from "../logic/transit-journey.js";
import { normalizeTripSchedules, scheduleValidation, normalizeAlarmLeads, ALARM_LEAD_CHOICES, DEFAULT_ALARM_LEADS, REMINDER_CHOICES } from "../logic/trip-schedules.js";
import { parseSubwayRouteId, isTimetableSubwayRoute } from "../logic/station-search.js";
import { findNearbyStops, describeStop } from "./stop-finder.mjs";
import { regionalBusProvider } from "./bus-providers.mjs";
import { createUserThrottle } from "./ops-access.mjs";

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

// Changing where/when you commute is a new plan for today: alarms that were
// stopped with 출발했어요 (or switched off) come back on.
function commuteChanged(previous, next) {
  const pick = (state) => JSON.stringify([state?.user?.requiredArrivalTime, state?.user?.workLocation?.lat, state?.user?.workLocation?.lng,
    state?.live?.provider, state?.live?.stationId, state?.live?.nodeId, state?.live?.lineName, state?.commute?.boardingAccessMin]);
  return pick(previous) !== pick(next);
}

export function applyCommuteSetup(previous, patch = {}, now = new Date()) {
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
    // A Gyeonggi stop listed by Seoul's bus API is saved as a Gyeonggi stop.
    const provider = regionalBusProvider(str(b.provider, 20), str(b.stationId));
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
  state.schedule = { ...(state.schedule || {}) };
  // First app setup: 10분 전 · 5분 전 · 지금 출발 · 지각 위험.
  if (!Array.isArray(state.schedule.reminderMinutes)) {
    state.schedule.reminderMinutes = [...DEFAULT_ALARM_LEADS];
    state.schedule.lateAlert = true;
  }
  if (patch.alerts !== undefined) {
    const minutes = patch.alerts?.minutes === undefined ? state.schedule.reminderMinutes : normalizeAlarmLeads(patch.alerts.minutes);
    if (!minutes || (Array.isArray(patch.alerts?.minutes) && minutes.length !== new Set(patch.alerts.minutes.map(Number)).size))
      throw fail(400, "알림 시간을 다시 골라 주세요.");
    const late = patch.alerts?.late === undefined ? state.schedule.lateAlert === true : patch.alerts.late === true;
    if (!minutes.length && !late) throw fail(400, "알림을 하나 이상 골라 주세요.");
    state.schedule.reminderMinutes = minutes;
    state.schedule.lateAlert = late;
  }
  if (commuteChanged(previous, state)) {
    const today = dateOnlyKey(now);
    if (state.schedule.snoozeDate === today) state.schedule.snoozeDate = null;
    state.schedule.departedDate = null;
    if (Array.isArray(state.tripSchedules)) {
      state.tripSchedules = state.tripSchedules.map((trip) => trip?.snoozeDate === today ? { ...trip, snoozeDate: null, departedDate: null } : trip);
    }
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

// ---- Repeat (paid) ----------------------------------------------------------
// "매일 자동 알림" is one trip schedule that mirrors the home setup. The alarm
// engine already runs trips only for subscribers, so the home one-day alarm
// is switched off while it is on (no duplicate alarms).
export const REPEAT_TRIP_ID = "inochi-repeat";
const DEFAULT_DAYS = [1, 2, 3, 4, 5];
const repeatTrip = (state) => (Array.isArray(state?.tripSchedules) ? state.tripSchedules : []).find((trip) => trip?.id === REPEAT_TRIP_ID) || null;
const weekday = (dateKey) => new Date(`${dateKey}T00:00:00Z`).getUTCDay();
const holidayKeys = (state) => new Set([...(state?.holidayDates || []), ...(state?.officialHolidays || []).map((item) => item?.date)].filter(Boolean));

export function repeatSummary(state) {
  const trip = repeatTrip(state);
  return { enabled: trip?.enabled === true, days: trip?.daysOfWeek?.length ? [...trip.daysOfWeek].sort() : DEFAULT_DAYS,
    skipHolidays: trip ? trip.skipHolidays !== false : true };
}

function normalizeDays(days) {
  if (days === undefined) return undefined;
  if (!Array.isArray(days)) throw fail(400, "반복할 요일을 다시 선택해 주세요.");
  const unique = [...new Set(days.map(Number))].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort();
  if (!unique.length) throw fail(400, "반복할 요일을 하나 이상 선택해 주세요.");
  return unique;
}

// Rebuilds the repeat trip from the home setup; `change` toggles/edits it.
export function applyRepeat(previous, change) {
  const state = clone(previous);
  const existing = repeatTrip(state);
  if (!existing && !change?.enabled) return state;
  const current = repeatSummary(state);
  const enabled = change?.enabled === undefined ? current.enabled : change.enabled === true;
  const days = normalizeDays(change?.days) || current.days;
  const skipHolidays = change?.skipHolidays === undefined ? current.skipHolidays : change.skipHolidays !== false;
  const setup = setupSummary(state);
  if (enabled && !setup.complete) throw fail(400, "출근길 설정을 먼저 마쳐 주세요.");
  const trip = {
    id: REPEAT_TRIP_ID, name: "출근", enabled, requiredArrivalTime: setup.requiredArrivalTime,
    boardingAccessMin: setup.boardingAccessMin ?? 0,
    departure: setup.boarding ? { location: { lat: setup.boarding.lat, lng: setup.boarding.lng },
      live: Object.fromEntries(["provider", "stationId", "stationName", "arsId", "cityCode", "nodeId", "lineName"].map((key) => [key, setup.boarding[key] || ""])) } : null,
    destination: setup.destination ? { address: setup.destination.address || setup.destination.label, location: { lat: setup.destination.lat, lng: setup.destination.lng } } : null,
    daysOfWeek: days, skipHolidays, snoozeDate: existing?.snoozeDate || null, alarmStartLeadMin: existing?.alarmStartLeadMin ?? 30, repeatIntervalMin: existing?.repeatIntervalMin ?? 5,
  };
  const others = (Array.isArray(state.tripSchedules) ? state.tripSchedules : []).filter((item) => item?.id !== REPEAT_TRIP_ID);
  state.tripSchedules = normalizeTripSchedules([trip, ...others]);
  state.schedule = { ...(state.schedule || {}), enabled: !enabled };
  return state;
}

export function alertsSummary(state) {
  const minutes = normalizeAlarmLeads(state?.schedule?.reminderMinutes);
  return { minutes: minutes || [...REMINDER_CHOICES], late: state?.schedule?.lateAlert === true, choices: ALARM_LEAD_CHOICES };
}

export function todayAlarmStatus(state, now = new Date()) {
  const today = dateOnlyKey(now), schedule = state?.schedule || {};
  const trip = repeatTrip(state);
  if (trip?.enabled) {
    const repeatDay = trip.daysOfWeek.includes(weekday(today)) && !(trip.skipHolidays !== false && holidayKeys(state).has(today));
    return { armed: repeatDay && trip.snoozeDate !== today, date: today,
      departedToday: trip.snoozeDate === today && trip.departedDate === today, repeat: true, repeatDay };
  }
  const armed = schedule.enabled !== false && schedule.oneTimeDate === today && schedule.snoozeDate !== today;
  return { armed, date: today, departedToday: schedule.snoozeDate === today && schedule.oneTimeDate === today && schedule.departedDate === today,
    repeat: false, repeatDay: false };
}

// Free home alarm: arm for today only (server enforces the one-day window).
// The bell turns today's alarms off or on; 출발했어요 also turns them off but
// is remembered as "departed", so the screen can say 오늘은 출발했어요 only then.
export function applyTodayAlarm(previous, enabled, now = new Date(), { departed = false } = {}) {
  const state = clone(previous), today = dateOnlyKey(now);
  state.schedule = { ...(state.schedule || {}) };
  const departedDate = !enabled && departed ? today : null;
  const trip = repeatTrip(state);
  if (trip?.enabled) {
    // Pausing or resuming today's repeat alarm never needs a subscription check.
    state.tripSchedules = state.tripSchedules.map((item) => item?.id === REPEAT_TRIP_ID
      ? { ...item, snoozeDate: enabled ? null : today, departedDate } : item);
    if (!enabled) state.schedule.snoozeDate = today;
    state.schedule.departedDate = departedDate;
    return state;
  }
  if (enabled) {
    state.schedule.enabled = true;
    state.schedule.repeatPreset = "DAILY";
    state.schedule.skipHolidays = false;
    if (state.schedule.snoozeDate === today) state.schedule.snoozeDate = null;
  } else {
    state.schedule.snoozeDate = today;
  }
  state.schedule.departedDate = departedDate;
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

// realtime: live arrival. estimate: a later bus timed from a live one by the
// interval. schedule: no live data yet, planned from the timetable interval.
// timetable: subway timetable.
// history: no live data yet, planned from when buses passed on earlier days.
function rowBasis(row, options = []) {
  if (row.historyPlan) return "history";
  if (row.intervalPlan) return "schedule";
  if (row.estimated) return "estimate";
  // Real-time subway answered from the timetable when its countdown was unavailable.
  if (options.find((option) => option.id === row.optionId)?.snapshot?.basis === "timetable") return "timetable";
  const direction = row.binding?.provider === "subway" ? parseSubwayRouteId(row.binding.routeId) : null;
  return isTimetableSubwayRoute(direction) ? "timetable" : "realtime";
}

export function buildHomeForecast({ state, automatic, now = new Date() }) {
  const setup = setupSummary(state);
  if (!setup.complete) return { status: "setup-required", missing: setup.missing, rows: [] };
  // The arrival time has passed, or even leaving right now cannot make it:
  // ask for a new arrival time instead of looking like a lookup error.
  const late = goalCheck({ setup, automatic, now });
  if (late) return late;
  // Nothing checked yet today (automatic checks only run near the leave time).
  if (automatic === null) return { status: "not-checked", rows: [], warning: "현재 시간이 조회되지 않습니다.", checkedAt: null };
  const holidays = [...(state.holidayDates || []), ...(state.officialHolidays || []).map((item) => item?.date).filter(Boolean)];
  const options = Array.isArray(automatic?.options) ? automatic.options : [];
  const plan = buildJourneyOptionsPlan({ now, requiredArrivalTime: setup.requiredArrivalTime, boardingAccessMin: setup.boardingAccessMin,
    holidays, incomplete: Boolean(automatic?.unverifiedCount), options });
  const at = (minutes) => Number.isFinite(minutes) ? new Date(now.getTime() + minutes * 60_000).toISOString() : null;
  const target = plan.risk.targetResult;
  // Show the trains around the recommended one, not just the next few.
  // One bus can appear under several route options (different onward paths).
  // Show it once, on the fastest path; the recommendation follows that bus.
  const vehicleKey = (row) => `${row.routeNumber}|${Math.round(row.arrivalMinutes)}`;
  const fastest = new Map();
  for (const row of plan.rows.filter((item) => item.arrivalMinutes >= 0)) {
    const previous = fastest.get(vehicleKey(row));
    if (!previous || (row.deltaMinutes ?? -Infinity) > (previous.deltaMinutes ?? -Infinity)) fastest.set(vehicleKey(row), row);
  }
  const shown = target && Number.isFinite(target.arrivalMinutes) ? fastest.get(vehicleKey(target)) || target : null;
  const isTarget = (row) => row === shown;
  const upcoming = plan.rows.filter((row) => row.arrivalMinutes >= 0 && fastest.get(vehicleKey(row)) === row);
  const targetIndex = upcoming.findIndex(isTarget);
  const iso = (value) => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
  const slack = (value) => Number.isFinite(value) ? Math.floor(value) : null;
  // From the first vehicle you can still reach (walk included) through the
  // recommended one and a few after it, so every on-time option is visible.
  const firstReachable = Math.max(0, upcoming.findIndex((row) => row.catchable));
  const lastShown = Math.max(firstReachable + 8, targetIndex + 6);
  const rows = upcoming.slice(firstReachable, Math.min(lastShown, firstReachable + 40)).map((row) => ({
    routeNumber: str(row.routeNumber, 40), direction: str(row.direction, 80), boardingAt: at(row.arrivalMinutes),
    minutes: Math.max(0, Math.floor(row.arrivalMinutes)), onTime: row.level !== "UNKNOWN" && row.deltaMinutes >= 0,
    catchable: Boolean(row.catchable), basis: rowBasis(row, options), arriveAt: iso(row.arriveWorkAt), slackMinutes: slack(row.deltaMinutes), target: isTarget(row),
  }));
  const departure = plan.risk.departure;
  // Even the first bus that can still be caught arrives after the arrival
  // time (2026-11-08 19:14: "20:26 딱 맞게 도착" for a 20:00 goal). That is
  // late, not a leave time: say so, and keep the buses listed.
  if (Number.isFinite(target?.arrivalMinutes) && Number.isFinite(target?.deltaMinutes) && target.deltaMinutes < 0 && !plan.urgentBoarding && !plan.awaitingLive) {
    const goal = combineDateAndTime(now, setup.requiredArrivalTime);
    const late = lateMinutes(target.arriveWorkAt, goal);
    const vehicle = target.binding?.provider === "subway" ? str(target.routeNumber, 40) : `${str(target.routeNumber, 40)}번 버스`;
    return { status: "too-late", title: `지금 출발하면 ${late}분 지각이에요`, message: "마음을 비우고 당장 출발하세요.", rows,
      detail: `${vehicle} ${kstClock(addMinutesTo(now, target.arrivalMinutes))} 탑승 → ${kstClock(target.arriveWorkAt)} 도착 예상`,
      lateMinutes: late, basis: rowBasis(target, options), arriveAt: shown ? iso(shown.arriveWorkAt) : null,
      slackMinutes: slack(target.deltaMinutes), checkedAt: now.toISOString() };
  }
  if (plan.awaitingLive) {
    return { status: "awaiting-live", title: "아직 실시간 정보가 확인되지 않았습니다.",
      message: "실시간 정보가 확인되는 대로 다시 알려드릴게요.", rows, basis: null, checkedAt: now.toISOString() };
  }
  // No vehicle at all because the arrival APIs gave nothing usable is not
  // "no transit": say that the information is missing.
  const noLive = options.length > 0 && !plan.rows.length && options.every((option) => option.snapshot?.liveStatus === "unavailable" && !option.snapshot?.lastObservation?.arrivalsMin?.length);
  const quota = options.some((option) => /호출 한도/.test(String(option.snapshot?.arrivalMessage || "")));
  return {
    status: options.length ? (Number.isFinite(target?.arrivalMinutes) ? "ready" : noLive ? "no-live" : "no-catchable") : "no-route",
    leaveAt: departure?.leaveAt ? new Date(departure.leaveAt).toISOString() : null,
    leaveInMinutes: departure ? departure.minutes : null,
    overdue: Boolean(departure && departure.remainingMin < 0),
    boardingAt: at(target?.arrivalMinutes),
    arriveAt: shown ? iso(shown.arriveWorkAt) : null,
    slackMinutes: shown ? slack(shown.deltaMinutes) : null,
    routeNumber: str(target?.routeNumber, 40), direction: str(target?.direction, 80),
    basis: target && Number.isFinite(target.arrivalMinutes) ? rowBasis(target, options) : null,
    urgent: Boolean(plan.urgentBoarding), message: str(plan.risk.message, 300), rows,
    unverifiedCount: Number(automatic?.unverifiedCount) || 0,
    warning: noLive ? (quota ? "공공 교통정보 일일 조회 한도를 넘어 도착정보를 받지 못하고 있어요. 잠시 후 다시 확인할게요."
      : "버스·지하철 도착정보를 받지 못하고 있어요. 잠시 후 다시 확인할게요.") : str(automatic?.warning, 300),
    checkedAt: now.toISOString(),
  };
}

function spokenTime(hhmm) {
  const [hour, minute] = String(hhmm).split(":").map(Number);
  return `${hour < 12 ? "오전" : "오후"} ${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")}`;
}

/** goal-passed: the arrival time is behind us today. too-late: walking out now
 *  and taking the quickest saved route still arrives after it. */
export function goalCheck({ setup, automatic, now = new Date() }) {
  const goal = combineDateAndTime(now, setup.requiredArrivalTime);
  if (!Number.isFinite(goal.getTime())) return null;
  const label = spokenTime(setup.requiredArrivalTime);
  const base = { rows: [], goalAt: goal.toISOString(), checkedAt: now.toISOString() };
  if (now.getTime() >= goal.getTime()) {
    return { ...base, status: "goal-passed", title: "시간을 다시 설정해 보세요.",
      message: `도착 시각(${label})이 이미 지났어요.` };
  }
  const onboard = (Array.isArray(automatic?.options) ? automatic.options : [])
    .map((option) => Number(option?.onboardDurationSec) / 60).filter((minutes) => Number.isFinite(minutes) && minutes > 0);
  if (!onboard.length) return null;
  const earliest = now.getTime() + (Number(setup.boardingAccessMin) || 0) * 60_000 + Math.min(...onboard) * 60_000;
  if (earliest <= goal.getTime()) return null;
  // Best case: a bus the moment you reach the stop. So "at least".
  const late = lateMinutes(new Date(earliest), goal);
  return { ...base, status: "too-late", title: `지금 출발해도 최소 ${late}분 지각이에요`,
    message: "마음을 비우고 당장 출발하세요.", lateMinutes: late };
}

// Minutes late, counted on the clock shown (20:26 for a 20:00 goal is 26).
function lateMinutes(arrive, goal) {
  return Math.max(1, Math.floor(new Date(arrive).getTime() / 60_000) - Math.floor(goal.getTime() / 60_000));
}
const addMinutesTo = (date, minutes) => new Date(date.getTime() + minutes * 60_000);
function kstClock(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date) : "--:--";
}

// ---- HTTP layer -------------------------------------------------------------

const ROUTES = {
  "GET /api/mobile/home": "home", "POST /api/mobile/setup": "setup", "POST /api/mobile/today": "today",
  "GET /api/mobile/trips": "trips", "PUT /api/mobile/trips": "saveTrips",
  "GET /api/mobile/stops/nearby": "nearbyStops", "GET /api/mobile/stops/describe": "describeStop",
  "POST /api/mobile/refresh": "refresh",
};
export const MANUAL_REFRESH_GAP_MS = 3 * 60_000;

// How arrivals are being checked, for the app: scheduled (automatic, by time
// left), departed (stopped after the leave time), unknown (stopped: no leave
// time) or none (not checked today). Manual refresh: once every 3 minutes.
export function refreshSummary(automatic) {
  const manual = Date.parse(automatic?.manualRefreshAt || "");
  return { state: automatic?.autoRefresh || "none", checkedAt: automatic?.updatedAt || null,
    nextAt: automatic?.autoRefresh === "scheduled" ? automatic.nextRefreshAt || null : null,
    manualAvailableAt: Number.isFinite(manual) ? new Date(manual + MANUAL_REFRESH_GAP_MS).toISOString() : null };
}
// Lookups spend public-data quota; keep one person from draining it.
// Nearby is per map move; describe runs for each listed stop in turn.
const nearbyThrottle = createUserThrottle({ minIntervalMs: 400, dailyMax: 300 });
const describeThrottle = createUserThrottle({ minIntervalMs: 0, dailyMax: 1500 });

export function subscriptionRequiredError() {
  return fail(402, "매일 자동 알림은 구독 후 사용할 수 있어요.", "SUBSCRIPTION_REQUIRED");
}

// Applies setup and repeat changes, enforcing the paid repeat rule.
export function applySetupRequest(state, input, subscription, now = new Date()) {
  const { repeat, ...patch } = input || {};
  let next = applyCommuteSetup(state, patch, now);
  const before = repeatSummary(state);
  const wantsOn = repeat?.enabled === true && !before.enabled;
  if (wantsOn && subscription?.active !== true) throw subscriptionRequiredError();
  const lapsed = before.enabled && subscription?.active === false && !subscription?.unknown;
  next = applyRepeat(next, lapsed ? { ...(repeat || {}), enabled: false } : repeat);
  return next;
}

export async function handleMobileApi(request, response, deps) {
  const url = new URL(request.url, "http://internal");
  const action = ROUTES[`${request.method} ${url.pathname}`];
  if (!action) { deps.sendJson(response, 404, { error: "지원하지 않는 앱 요청입니다." }); return; }
  if (request.method !== "GET" && !deps.isTrustedMutation(request)) { deps.sendJson(response, 403, { error: "허용되지 않은 요청입니다." }); return; }
  const auth = await deps.authenticate(request, response);
  if (!auth) { deps.sendJson(response, 401, { error: "로그인이 필요합니다.", code: "LOGIN_REQUIRED" }); return; }
  if (action === "nearbyStops" || action === "describeStop") {
    const allowed = (deps.lookupThrottle || (action === "nearbyStops" ? nearbyThrottle : describeThrottle))(auth.user.id);
    if (!allowed.ok) { deps.sendJson(response, 429, { error: "조회가 너무 잦습니다. 잠시 후 다시 시도해 주세요.", code: "RATE_LIMITED" }); return; }
    try {
      const input = Object.fromEntries(url.searchParams);
      const result = action === "nearbyStops"
        ? await (deps.findNearbyStops || findNearbyStops)({ lat: input.lat, lng: input.lng })
        : await (deps.describeStop || describeStop)(input);
      deps.sendJson(response, 200, result);
    } catch (error) {
      deps.sendJson(response, error?.statusCode === 400 ? 400 : 503, { error: error?.statusCode === 400 ? error.message : "정류장 정보를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.", code: error?.code || "LOOKUP_FAILED" });
    }
    return;
  }
  let input = {}, now = new Date();
  try {
    input = request.method === "GET" ? {} : await deps.readJsonBody(request);
    now = deps.now ? deps.now() : new Date();
    // The background alarm job writes the same runtime document; a person's
    // refresh or setup retries once instead of failing on that race.
    const attempts = action === "refresh" || action === "setup" ? 2 : 1;
    let result;
    for (let attempt = 1; ; attempt++) {
      try { result = await runOnce(); break; }
      catch (error) { if (error?.code !== "DOCUMENT_CONFLICT" || attempt >= attempts) throw error; }
    }
    deps.sendJson(response, 200, result);
  } catch (error) {
    const known = ["INVALID_INPUT", "SUBSCRIPTION_REQUIRED", "BILLING_NOT_READY", "DOCUMENT_CONFLICT", "REFRESH_TOO_SOON"].includes(error?.code);
    deps.sendJson(response, error?.statusCode || 503, { error: known ? error.message : "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      code: error?.code || "MOBILE_API_ERROR", ...(error?.retryAt ? { retryAt: error.retryAt } : {}) });
  }

  function runOnce() {
    return deps.withUserDocuments(auth, async (docs) => {
      const state = await docs.readState();
      const subscription = async () => { try { return await deps.subscriptionStatus(auth.user.id); } catch { return { active: false, available: false, unknown: true }; } };
      // mode: "cached" reads only what was already checked; "force" (setup
      // changed) and "manual" (refresh button) call the providers and save it.
      const view = async (current, mode = "cached") => {
        const setup = setupSummary(current);
        let automatic = null, forecastError = "";
        if (setup.complete) {
          try {
            automatic = await docs.loadOptions(transitQueryForState(current), { requiredArrivalTime: setup.requiredArrivalTime, boardingAccessMin: setup.boardingAccessMin },
              { cachedOnly: mode === "cached", force: mode === "force", manual: mode === "manual" });
            if (mode !== "cached" && automatic) await docs.saveOptions(automatic);
          }
          catch (error) { forecastError = error?.routeFailureCode ? "경로·도착정보를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요." : "도착정보 확인이 지연되고 있습니다."; }
        }
        return { setup, repeat: repeatSummary(current), alerts: alertsSummary(current), today: todayAlarmStatus(current, now), forecast: buildHomeForecast({ state: current, automatic, now }),
          forecastError, refresh: refreshSummary(automatic), trips: current.tripSchedules || [], subscription: await subscription() };
      };
      if (action === "home") return view(state);
      if (action === "refresh") {
        const previous = docs.lastOptions?.();
        const last = Date.parse(previous?.manualRefreshAt || "");
        if (Number.isFinite(last) && now.getTime() - last < MANUAL_REFRESH_GAP_MS) {
          throw Object.assign(fail(429, "도착정보는 3분에 한 번 확인할 수 있어요.", "REFRESH_TOO_SOON"), { retryAt: new Date(last + MANUAL_REFRESH_GAP_MS).toISOString() });
        }
        return { ok: true, ...(await view(state, "manual")) };
      }
      if (action === "trips") return { trips: state.tripSchedules || [], subscription: await subscription() };
      let next;
      if (action === "setup") next = applySetupRequest(state, input, input?.repeat?.enabled === true || repeatSummary(state).enabled ? await subscription() : null, now);
      else if (action === "today") next = applyTodayAlarm(state, input?.enabled === true, now, { departed: input?.departed === true });
      else {
        next = applyTrips(state, input?.trips);
        deps.assertTripScheduleChange(state, next, (await subscription()).active === true);
      }
      const saved = await docs.saveState(next);
      if (action === "saveTrips") return { ok: true, trips: saved.tripSchedules || [] };
      // A changed commute is checked right away; other edits reuse what is saved.
      return { ok: true, ...(await view(saved, action === "setup" && commuteChanged(state, saved) ? "force" : "cached")) };
    });
  }
}

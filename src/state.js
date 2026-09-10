import { DEFAULT_DEVICE_PROFILE, sanitizeDeviceProfile } from "./device-profile.js";
import { createDefaultLiveBindings, ensureLiveBindingState } from "./logic/live-bindings.js";
import { STOP_LIBRARY } from "./mock-data.js";
import { isValidLocation } from "./logic/commute.js";

const STORAGE_KEY = "buswakeup-demo-state";

export const DEFAULT_STATE = {
  ui: {
    routeSearch: "",
    holidayDraft: "",
    holidaySyncYear: String(new Date().getFullYear()),
    homeAddressKeyword: "",
    homeAddressSearchStatus: "idle",
    homeAddressSearchError: "",
    homeAddressSearchResults: [],
    workAddressKeyword: "",
    workAddressSearchStatus: "idle",
    workAddressSearchError: "",
    workAddressSearchResults: [],
    liveSearchKeyword: "",
    liveSearchStatus: "idle",
    liveSearchError: "",
    liveSearchResults: [],
    liveRouteSearchStatus: "idle",
    liveRouteSearchError: "",
    liveRouteSearchResults: [],
  },
  meta: {
    demoMode: true,
    simulationStartedAt: new Date().toISOString(),
  },
  user: {
    name: "Demo User",
    requiredArrivalTime: "09:00",
    homeAddress: "서울 종로구 세종대로 175",
    workAddress: "경기 성남시 분당구 판교역로 166",
    homeLocation: {
      lat: 37.5725,
      lng: 126.9769,
      source: "demo",
      label: "서울 종로구 세종대로 175",
    },
    workLocation: {
      lat: 37.3951,
      lng: 127.1107,
      source: "demo",
      label: "경기 성남시 분당구 판교역로 166",
    },
  },
  commute: {
    selectedStopId: "GWANGHWAMUN",
    stopLocation: null,
    selectedLineIds: ["1002", "701"],
    primaryLineId: "1002",
    busRideMin: 43,
    homeToStopWalkMin: 5,
    transitJourney: null,
    alightToWorkWalkMin: 7,
  },
  schedule: {
    startTime: "07:00",
    endTime: "07:45",
    repeatIntervalMin: 3,
    repeatPreset: "WEEKDAYS",
    daysOfWeek: [1, 2, 3, 4, 5],
    skipHolidays: true,
    snoozeDate: null,
  },
  notification: {
    soundPresetId: "mechanical",
    vibrationStrength: 80,
    escalationEnabled: true,
    ttsVoiceId: "ko-female",
    ttsSpeed: 1.1,
    dndBypass: false,
  },
  device: DEFAULT_DEVICE_PROFILE,
  live: {
    provider: "none",
    stationId: "",
    stationName: "",
    arsId: "",
    routeId: "",
    order: "",
    cityCode: "",
    nodeId: "",
    routeNumber: "",
    status: "idle",
    lastSyncedAt: null,
    lastError: "",
    snapshot: null,
    bindings: createDefaultLiveBindings(),
  },
  history: [],
  holidayDates: [],
  officialHolidays: [],
  holidaySync: {
    status: "idle",
    lastSyncedAt: null,
    lastError: "",
    loadedYears: [],
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function merge(base, incoming) {
  if (Array.isArray(base)) {
    return Array.isArray(incoming) ? incoming : base;
  }

  if (typeof base !== "object" || base === null) {
    return incoming === undefined ? base : incoming;
  }

  const next = { ...base };
  for (const key of Object.keys(base)) {
    next[key] = merge(base[key], incoming?.[key]);
  }

  if (incoming && typeof incoming === "object") {
    for (const [key, value] of Object.entries(incoming)) {
      if (!(key in next)) {
        next[key] = value;
      }
    }
  }

  return next;
}

function sanitizeLocationState(location, fallbackLabel = "") {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  return {
    lat: isValidLocation(location) ? lat : null,
    lng: isValidLocation(location) ? lng : null,
    source: String(location?.source || "manual").trim() || "manual",
    label: String(location?.label || fallbackLabel || "").trim(),
  };
}

function sanitizeAddressResults(results) {
  if (!Array.isArray(results)) {
    return [];
  }

  return results
    .map((item) => {
      const lat = Number(item?.lat);
      const lng = Number(item?.lng);
      return {
        id: String(item?.id || "").trim(),
        label: String(item?.label || "").trim(),
        roadAddress: String(item?.roadAddress || "").trim(),
        jibunAddress: String(item?.jibunAddress || "").trim(),
        placeName: String(item?.placeName || "").trim(),
        provider: String(item?.provider || "").trim(),
        lat: isValidLocation(item) ? lat : null,
        lng: isValidLocation(item) ? lng : null,
      };
    })
    .filter((item) => item.label && item.lat !== null && item.lng !== null);
}

export function sanitizeState(state) {
  const safe = merge(clone(DEFAULT_STATE), state);
  const stop = STOP_LIBRARY.find((item) => item.id === safe.commute.selectedStopId) || STOP_LIBRARY[0];
  const liveRoute = safe.live.provider !== "none" && safe.live.routeNumber;
  const validLineIds = liveRoute ? [...new Set([String(safe.live.routeNumber), ...safe.commute.selectedLineIds.map(String)])] : stop.lines.map((line) => line.id);

  safe.commute.selectedStopId = safe.live.provider !== "none"
    ? safe.commute.selectedStopId || safe.live.stationId || safe.live.nodeId : stop.id;
  safe.commute.selectedLineIds = safe.commute.selectedLineIds.filter((lineId) => validLineIds.includes(lineId));
  if (!safe.commute.selectedLineIds.length) {
    safe.commute.selectedLineIds = validLineIds.slice(0, 2);
  }

  if (!safe.commute.selectedLineIds.includes(safe.commute.primaryLineId)) {
    safe.commute.primaryLineId = safe.commute.selectedLineIds[0];
  }

  safe.commute.busRideMin = Math.max(0, Number(safe.commute.busRideMin) || 0);
  safe.commute.homeToStopWalkMin = Math.max(0, Number(safe.commute.homeToStopWalkMin) || 0);
  safe.commute.alightToWorkWalkMin = Math.max(0, Number(safe.commute.alightToWorkWalkMin) || 0);

  if (!Array.isArray(safe.schedule.daysOfWeek)) {
    safe.schedule.daysOfWeek = [1, 2, 3, 4, 5];
  }
  safe.schedule.daysOfWeek = [...new Set(safe.schedule.daysOfWeek.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];

  if (!/^\d{4}$/.test(String(safe.ui.holidaySyncYear || "").trim())) {
    safe.ui.holidaySyncYear = String(new Date().getFullYear());
  }

  safe.holidayDates = Array.isArray(safe.holidayDates)
    ? [...new Set(safe.holidayDates.map((value) => String(value || "").trim()).filter(Boolean))].sort()
    : [];

  safe.officialHolidays = Array.isArray(safe.officialHolidays)
    ? safe.officialHolidays
        .map((item) => ({
          date: String(item?.date || "").trim(),
          name: String(item?.name || "").trim(),
          isHoliday: Boolean(item?.isHoliday),
          dateKind: String(item?.dateKind || "").trim(),
          sequence: String(item?.sequence || "").trim(),
        }))
        .filter((item) => item.date)
        .sort((first, second) => first.date.localeCompare(second.date))
    : [];

  safe.holidaySync.loadedYears = Array.isArray(safe.holidaySync.loadedYears)
    ? [...new Set(safe.holidaySync.loadedYears.map((value) => String(value || "").trim()).filter(Boolean))].sort()
    : [];

  safe.user.homeLocation = sanitizeLocationState(safe.user.homeLocation, safe.user.homeAddress);
  safe.commute.stopLocation = isValidLocation(safe.commute.stopLocation)
    ? sanitizeLocationState(safe.commute.stopLocation) : null;
  safe.user.workLocation = sanitizeLocationState(safe.user.workLocation, safe.user.workAddress);
  safe.ui.homeAddressSearchResults = sanitizeAddressResults(safe.ui.homeAddressSearchResults);
  safe.ui.workAddressSearchResults = sanitizeAddressResults(safe.ui.workAddressSearchResults);
  safe.device = sanitizeDeviceProfile(safe.device);
  safe.live = ensureLiveBindingState(safe.live);

  return safe;
}

export function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return clone(DEFAULT_STATE);
    }

    return sanitizeState(JSON.parse(raw));
  } catch {
    return clone(DEFAULT_STATE);
  }
}

export function saveState(state) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetState() {
  const fresh = clone(DEFAULT_STATE);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

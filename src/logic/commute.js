const MINUTE_MS = 60_000;
const DEFAULT_WALK_METERS_PER_MINUTE = 72;
export const KOREA_TIME_ZONE = "Asia/Seoul";

function getKoreaDateParts(date) {
  const safeDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(safeDate.getTime())) {
    throw new Error("A valid date is required.");
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KOREA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(safeDate);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function getKoreaWeekday(date) {
  const { year, month, day } = getKoreaDateParts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * MINUTE_MS);
}

export function dateOnlyKey(date) {
  const { year, month: monthNumber, day: dayNumber } = getKoreaDateParts(date);
  const month = String(monthNumber).padStart(2, "0");
  const day = String(dayNumber).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function combineDateAndTime(baseDate, timeText) {
  const [rawHours, rawMinutes] = String(timeText || "00:00").split(":").map(Number);
  const hours = Number.isInteger(rawHours) && rawHours >= 0 && rawHours <= 23 ? rawHours : 0;
  const minutes = Number.isInteger(rawMinutes) && rawMinutes >= 0 && rawMinutes <= 59 ? rawMinutes : 0;
  const dateKey = dateOnlyKey(baseDate);
  const clock = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00+09:00`;
  return new Date(`${dateKey}T${clock}`);
}

export function mergeHolidayDates(...groups) {
  return [...new Set(groups.flatMap((group) => (Array.isArray(group) ? group : [])))]
    .map((value) => String(value || "").trim())
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort();
}

export function determineLateRiskLevel(deltaMinutes) {
  if (deltaMinutes >= 10) return "GREEN";
  if (deltaMinutes >= 0) return "YELLOW";
  if (deltaMinutes >= -5) return "ORANGE";
  return "RED";
}

export function getRiskMeta(level) {
  return {
    UNKNOWN: { tone: "neutral", label: "정보 없음", chip: "도착 정보 확인 필요" },
    GREEN: { tone: "green", label: "여유", chip: "여유 있음" },
    YELLOW: { tone: "yellow", label: "정시", chip: "정시 가능" },
    ORANGE: { tone: "orange", label: "위험", chip: "서둘러야 함" },
    RED: { tone: "red", label: "지각", chip: "지각 가능성 높음" },
  }[level];
}

export function normalizeBoardingAccessMin(value) {
  if (value === null || value === undefined || String(value).trim() === "" || !["number", "string"].includes(typeof value)) return null;
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= 180 ? minutes : null;
}

export function buildDepartureGuidance(arrivalMinutes, accessMinutes, now) {
  const accessMin = normalizeBoardingAccessMin(accessMinutes);
  if (accessMin === null || !Number.isFinite(arrivalMinutes)) return null;
  const remainingMin = arrivalMinutes - accessMin;
  const minutes = Math.max(0, Math.floor(remainingMin));
  const message = remainingMin < 0
    ? `입력한 이동시간 ${accessMin}분을 고려하면 출발 기한이 지났습니다. 지금 집에서 출발하면 이 교통편 탑승이 어려울 수 있습니다.`
    : remainingMin === 0 ? `첫 정류장·역까지 ${accessMin}분 걸립니다. 지금 출발해야 합니다.`
    : remainingMin < 1 ? `첫 정류장·역까지 ${accessMin}분 걸립니다. 1분 안에 바로 출발해야 합니다.`
    : `첫 정류장·역까지 ${accessMin}분 걸립니다. ${minutes}분 안에 출발해야 합니다.`;
  return {accessMin, remainingMin, minutes, leaveAt:addMinutes(now, remainingMin), message};
}

export function evaluateLateRisk({ requiredArrivalTime, route, busArrivalsMin, now }) {
  const requiredAt = combineDateAndTime(now, requiredArrivalTime);
  const etaRiskBufferMin = Math.max(0, Number(route?.etaRiskBufferMin) || 0);
  const rawDuration = route?.onboardToDestinationMin ??
    (Number(route?.busRideMin) + Number(route?.alightToWorkWalkMin));
  const durationKnown = route?.durationAvailable !== false && rawDuration !== null &&
    rawDuration !== "" && Number.isFinite(Number(rawDuration)) && Number(rawDuration) > 0;
  const vehicle = route?.vehicleType === "SUBWAY" ? "지하철" : "버스";
  const accessMin = normalizeBoardingAccessMin(route?.boardingAccessMin);

  const arrivals = (Array.isArray(busArrivalsMin) ? busArrivalsMin : [])
    .filter((value) => value !== null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0)
    .map(Number).sort((a, b) => a - b);
  const results = Array.from({ length: Math.max(2, arrivals.length) }, (_, index) => {
    const arrivalMinutes = arrivals[index];
    if (arrivalMinutes === undefined || !durationKnown) return {
      index, arrivalMinutes: arrivalMinutes ?? null, catchWindowMin: null, catchable: false,
      arriveWorkAt: null, deltaMinutes: null, etaRiskBufferMin,
      level: "UNKNOWN", risk: getRiskMeta("UNKNOWN"),
    };
    // Manual access time changes the leave-home deadline, never onboard duration.
    const catchWindowMin = arrivalMinutes - (accessMin ?? 0);
    const catchable = catchWindowMin >= 0;
    const arriveWorkAt = addMinutes(
      now,
      arrivalMinutes + Number(rawDuration) + etaRiskBufferMin,
    );
    const deltaMinutes = Math.floor((requiredAt.getTime() - arriveWorkAt.getTime()) / MINUTE_MS);
    const level = determineLateRiskLevel(deltaMinutes);

    return {
      index,
      arrivalMinutes,
      catchWindowMin,
      catchable,
      arriveWorkAt,
      deltaMinutes,
      etaRiskBufferMin,
      level,
      risk: getRiskMeta(level),
    };
  });

  const primaryResult = results[0];
  const onTime = results.filter((result) => result.level !== "UNKNOWN" && result.deltaMinutes >= 0);
  const targetResult = onTime.at(-1) || primaryResult;
  const followingResult = results[targetResult.index + 1] || null;
  const lastChanceConfirmed = onTime.length > 0 && followingResult?.level !== "UNKNOWN" &&
    followingResult?.deltaMinutes < 0;
  let urgency = "RELAXED";
  let message;
  if (primaryResult.level === "UNKNOWN") {
    urgency = "UNKNOWN";
    message = !durationKnown
      ? "목적지까지의 경로 시간이 확인되지 않아 지각 여부를 판단할 수 없습니다. 대중교통 경로를 조회하고 선택해 주세요."
      : "현재 교통편 도착 정보를 확인할 수 없습니다. 실시간 정보를 다시 확인해 주세요.";
  } else if (lastChanceConfirmed) {
    urgency = "MUST_CATCH";
    message = `선택한 노선 기준, ${Math.ceil(targetResult.arrivalMinutes)}분 후 오는 ${vehicle}를 놓치면 다음 차는 목적지에 약 ${Math.abs(followingResult.deltaMinutes)}분 늦을 것으로 예상됩니다.`;
  } else if (!onTime.length) {
    urgency = "HURRY";
    message = `가장 먼저 오는 ${vehicle}를 타도 목적지에 약 ${Math.abs(primaryResult.deltaMinutes)}분 늦을 것으로 예상됩니다. 다른 이동 방법을 확인해 주세요.`;
  } else {
    message = `조회된 교통편 중 ${Math.ceil(targetResult.arrivalMinutes)}분 후 오는 ${vehicle}까지 정시 도착이 예상됩니다. 그 이후 차 정보가 없어 마지막 기회인지는 아직 확인할 수 없습니다.`;
  }

  const departure = primaryResult.level !== "UNKNOWN"
    ? buildDepartureGuidance(targetResult.arrivalMinutes, accessMin, now) : null;
  if (departure) {
    message = `${departure.message} ${message}`;
    if (departure.remainingMin <= 0) urgency = "HURRY";
  }

  return {
    requiredAt,
    results,
    urgency,
    message,
    etaRiskBufferMin,
    targetResult,
    followingResult,
    lastChanceConfirmed: Boolean(lastChanceConfirmed),
    notificationArrivalsMin: arrivals.slice(targetResult.index),
    onboardToDestinationMin: durationKnown ? Number(rawDuration) : null,
    scope: "selected-route",
    departure,
  };
}

export function shouldFireToday(schedule, todayDate, holidayDates = []) {
  const weekday = getKoreaWeekday(todayDate);
  const todayKey = dateOnlyKey(todayDate);

  if (schedule.snoozeDate === todayKey) return false;
  if (schedule.repeatPreset === "WEEKDAYS" && (weekday === 0 || weekday === 6)) return false;
  if (schedule.repeatPreset === "WEEKENDS" && weekday >= 1 && weekday <= 5) return false;
  if (schedule.repeatPreset === "CUSTOM" && !schedule.daysOfWeek.includes(weekday)) return false;
  if (schedule.skipHolidays && holidayDates.includes(todayKey)) return false;

  return true;
}

export function describeScheduleState(schedule, todayDate, holidayDates = []) {
  const todayKey = dateOnlyKey(todayDate);
  const weekday = getKoreaWeekday(todayDate);
  const weekdayNames = ["일", "월", "화", "수", "목", "금", "토"];

  if (schedule.snoozeDate === todayKey) {
    return {
      firing: false,
      badge: "오늘 꺼짐",
      detail: "사용자가 오늘만 알림을 쉬도록 설정했습니다.",
    };
  }

  if (schedule.repeatPreset === "WEEKDAYS" && (weekday === 0 || weekday === 6)) {
    return {
      firing: false,
      badge: "주말 스킵",
      detail: `${weekdayNames[weekday]}요일은 평일 반복에 포함되지 않습니다.`,
    };
  }

  if (schedule.repeatPreset === "WEEKENDS" && weekday >= 1 && weekday <= 5) {
    return {
      firing: false,
      badge: "평일 대기",
      detail: "주말 전용 일정이라 오늘은 실행하지 않습니다.",
    };
  }

  if (schedule.repeatPreset === "CUSTOM" && !schedule.daysOfWeek.includes(weekday)) {
    return {
      firing: false,
      badge: "커스텀 제외",
      detail: "선택한 요일 목록에 오늘이 포함되지 않습니다.",
    };
  }

  if (schedule.skipHolidays && holidayDates.includes(todayKey)) {
    return {
      firing: false,
      badge: "공휴일 스킵",
      detail: "공휴일 자동 스킵이 켜져 있어서 오늘은 알림이 울리지 않습니다.",
    };
  }

  return {
    firing: true,
    badge: "실행 예정",
    detail: `${schedule.startTime}부터 ${schedule.endTime}까지 ${schedule.repeatIntervalMin}분 간격으로 반복 알림을 보냅니다.`,
  };
}

export function buildSchedulePreview(schedule, startDate, holidayDates = [], days = 7) {
  return Array.from({ length: days }, (_, index) => {
    const date = addMinutes(startDate, index * 24 * 60);
    const status = describeScheduleState(schedule, date, holidayDates);
    return {
      date,
      ...status,
    };
  });
}

export function formatClock(date, locale = "ko-KR") {
  return new Intl.DateTimeFormat(locale, {
    timeZone: KOREA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatLongDate(date, locale = "ko-KR") {
  return new Intl.DateTimeFormat(locale, {
    timeZone: KOREA_TIME_ZONE,
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

export function haversineDistanceMeters(from, to) {
  if (!isValidLocation(from) || !isValidLocation(to)) return null;
  const fromLat = Number(from?.lat);
  const fromLng = Number(from?.lng);
  const toLat = Number(to?.lat);
  const toLng = Number(to?.lng);
  if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) {
    return null;
  }

  const earthRadius = 6_371_000;
  const toRadians = (value) => (value * Math.PI) / 180;
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadius * c);
}

export function estimateWalkMinutes(distanceMeters, metersPerMinute = DEFAULT_WALK_METERS_PER_MINUTE) {
  if (distanceMeters === null || distanceMeters === undefined || distanceMeters === "") return null;
  const distance = Number(distanceMeters);
  if (!Number.isFinite(distance) || distance < 0) {
    return null;
  }

  return Math.max(1, Math.ceil(distance / metersPerMinute));
}

export function isValidLocation(point) {
  return Boolean(point && [point.lat, point.lng].every((value) =>
    value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number(value))) &&
    Math.abs(Number(point.lat)) <= 90 && Math.abs(Number(point.lng)) <= 180);
}

export function rankLocationsByDistance(origin, locations = [], limit = 3) {
  const ranked = (Array.isArray(locations) ? locations : [])
    .map((item) => ({
      ...item,
      distanceM: haversineDistanceMeters(origin, item),
    }))
    .filter((item) => Number.isFinite(item.distanceM))
    .sort((first, second) => first.distanceM - second.distanceM);

  return ranked.slice(0, Math.max(1, Number(limit) || 1));
}

export function buildAddressAwareRouteEstimate({
  homeLocation,
  workLocation,
  stopLocation,
  busRideMin = 0,
  alightToWorkWalkMin = 0,
}) {
  const homeToStopDistanceM = haversineDistanceMeters(homeLocation, stopLocation);
  const homeToWorkDistanceM = haversineDistanceMeters(homeLocation, workLocation);
  const homeToStopWalkMin = estimateWalkMinutes(homeToStopDistanceM);
  const totalCommuteMin =
    homeToStopWalkMin !== null
      ? homeToStopWalkMin + Math.max(0, Number(busRideMin) || 0) + Math.max(0, Number(alightToWorkWalkMin) || 0)
      : null;

  return {
    homeToStopDistanceM,
    homeToStopWalkMin,
    homeToWorkDistanceM,
    busRideMin: Math.max(0, Number(busRideMin) || 0),
    alightToWorkWalkMin: Math.max(0, Number(alightToWorkWalkMin) || 0),
    totalCommuteMin,
  };
}

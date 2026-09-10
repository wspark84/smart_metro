import { STOP_LIBRARY } from "../mock-data.js";
import {
  addMinutes,
  combineDateAndTime,
  dateOnlyKey,
  describeScheduleState,
  evaluateLateRisk,
  mergeHolidayDates,
} from "../logic/commute.js";
import { buildLiveEtaGuard } from "../logic/live-eta-guard.js";
import { isLiveConfigured, projectLiveArrivals, resolveCommuteLine, resolveCommuteStop } from "../logic/live-arrivals.js";
import { buildEscalationTimeline, getNotificationSpec } from "../logic/notification-engine.js";
import { resolveJourneyDuration } from "../logic/transit-journey.js";

const MINUTE_MS = 60_000;

function getSelectedStop(state) {
  return resolveCommuteStop(state, STOP_LIBRARY);
}

function getPrimaryLine(state, stop = getSelectedStop(state)) {
  const selectedLineIds = Array.isArray(state?.commute?.selectedLineIds) ? state.commute.selectedLineIds : [];
  const selected = stop.lines.filter((line) => selectedLineIds.includes(line.id));
  return resolveCommuteLine(state, selected.find((line) => line.id === state?.commute?.primaryLineId) || selected[0] || stop.lines[0]);
}

function normalizeEndAt(startAt, endAt) {
  if (endAt.getTime() >= startAt.getTime()) {
    return endAt;
  }

  return addMinutes(endAt, 24 * 60);
}

function normalizeArrivals(seedArrivals, headwayMin, elapsedMinutes) {
  const safeHeadway = Math.max(Number(headwayMin) || 10, 1);
  const arrivals = (Array.isArray(seedArrivals) ? seedArrivals : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .map((value) => {
      let next = value - elapsedMinutes;
      while (next <= 0) {
        next += safeHeadway;
      }

      return next;
    })
    .sort((first, second) => first - second);

  if (!arrivals.length) {
    return [safeHeadway, safeHeadway * 2];
  }

  if (arrivals.length === 1) {
    arrivals.push(arrivals[0] + safeHeadway);
  }

  if (arrivals[1] <= arrivals[0]) {
    arrivals[1] = arrivals[0] + safeHeadway;
  }

  return arrivals.slice(0, 2);
}

function getHolidayDates(state) {
  return mergeHolidayDates(
    state?.holidayDates,
    Array.isArray(state?.officialHolidays) ? state.officialHolidays.filter((holiday) => holiday.isHoliday).map((holiday) => holiday.date) : [],
  );
}

function getTriggerTimes(schedule, now) {
  const startAt = combineDateAndTime(now, schedule.startTime);
  const endAt = normalizeEndAt(startAt, combineDateAndTime(now, schedule.endTime));
  const step = Math.max(Number(schedule.repeatIntervalMin) || 1, 1);
  const totalTriggers = [];

  for (let cursor = startAt; cursor.getTime() <= endAt.getTime(); cursor = addMinutes(cursor, step)) {
    totalTriggers.push(new Date(cursor));
  }

  const remainingTriggers = totalTriggers.filter((triggerAt) => triggerAt.getTime() >= now.getTime());

  return {
    startAt,
    endAt,
    totalTriggers,
    remainingTriggers,
  };
}

function getArrivalProjectionSource(state, primaryLine, triggerAt, now) {
  const liveSnapshot = state?.live?.snapshot;
  const snapshotMatchesLine =
    liveSnapshot &&
    Array.isArray(liveSnapshot.arrivalsMin) &&
    liveSnapshot.arrivalsMin.length &&
    (!liveSnapshot.lineNumber || String(liveSnapshot.lineNumber) === String(primaryLine.number));

  if (snapshotMatchesLine) {
    const projected = projectLiveArrivals(liveSnapshot, triggerAt);
    return {
      source: projected.length ? "live-snapshot" : "live-unavailable",
      arrivalsMin: projected,
    };
  }

  if (isLiveConfigured(state)) return { source: "live-unavailable", arrivalsMin: [] };

  const simulationStartedAt = new Date(state?.meta?.simulationStartedAt || now);
  const elapsedMinutes = Math.max(0, Math.floor((triggerAt.getTime() - simulationStartedAt.getTime()) / MINUTE_MS));
  return {
    source: "demo-projection",
    arrivalsMin: normalizeArrivals(primaryLine.arrivalsMin, primaryLine.headwayMin, elapsedMinutes),
  };
}

function buildAccuracyNotificationContext(accuracyRuntime) {
  const runtime = accuracyRuntime && typeof accuracyRuntime === "object" ? accuracyRuntime : {};
  return {
    liveEtaDisagreementLevel: String(runtime.lastObservedDisagreementLevel || "").trim().toLowerCase(),
    accuracySpreadMin: Number.isFinite(Number(runtime.lastObservedEtaSpreadMin))
      ? Math.round(Number(runtime.lastObservedEtaSpreadMin) * 10) / 10
      : null,
    comparableProviderCount: Math.max(0, Number(runtime.lastObservedComparableProviderCount) || 0),
    historicalBiasLevel: String(runtime.lastHistoricalBiasLevel || "").trim().toLowerCase(),
    historicalBiasRouteTraceCount: Math.max(0, Number(runtime.lastHistoricalBiasRouteTraceCount) || 0),
    historicalBiasWeekdayTraceCount: Math.max(0, Number(runtime.lastHistoricalBiasWeekdayTraceCount) || 0),
  };
}

function buildAccuracyLiveEtaGuard(accuracyRuntime) {
  const accuracyContext = buildAccuracyNotificationContext(accuracyRuntime);
  return buildLiveEtaGuard({
    disagreementLevel: accuracyContext.liveEtaDisagreementLevel,
    spreadMin: accuracyContext.accuracySpreadMin,
    comparableProviderCount: accuracyContext.comparableProviderCount,
    historicalBiasLevel: accuracyContext.historicalBiasLevel,
  });
}

function buildDeliveryPriorityContext({ triggerAt, triggerKind = "alarm", triggerWindow, accuracyRuntime = null }) {
  const accuracyContext = buildAccuracyNotificationContext(accuracyRuntime);
  const triggerMs = triggerAt instanceof Date ? triggerAt.getTime() : new Date(triggerAt).getTime();
  const windowStartMs = triggerWindow?.startAt instanceof Date ? triggerWindow.startAt.getTime() : NaN;

  if (triggerKind === "stability-precheck") {
    return {
      deliveryPriorityClass: "precheck",
      deliveryPriorityReason: "historical-instability-precheck",
    };
  }

  if (
    triggerKind === "alarm" &&
    accuracyContext.historicalBiasLevel === "high" &&
    Number.isFinite(triggerMs) &&
    Number.isFinite(windowStartMs) &&
    triggerMs === windowStartMs
  ) {
    return {
      deliveryPriorityClass: "boosted",
      deliveryPriorityReason: "high-watch-first-main-alarm",
    };
  }

  return {
    deliveryPriorityClass: "normal",
    deliveryPriorityReason: "",
  };
}

function buildTriggerEntry({
  state,
  primaryLine,
  triggerAt,
  now,
  accuracyRuntime = null,
  triggerWindow = null,
  triggerKind = "alarm",
  triggerLabel = "",
  stabilityPrecheckLeadMin = 0,
}) {
  // Due alarms use the latest observation time, not a scheduled time in the past.
  const evaluationAt = triggerAt.getTime() < now.getTime() ? now : triggerAt;
  const projection = getArrivalProjectionSource(state, primaryLine, evaluationAt, now);
  const liveEtaGuard = buildAccuracyLiveEtaGuard(accuracyRuntime);
  const risk = evaluateLateRisk({
    requiredArrivalTime: state.user.requiredArrivalTime,
    route: {
      ...resolveJourneyDuration(state, evaluationAt),
      etaRiskBufferMin: liveEtaGuard.recommendedRiskBufferMin,
    },
    busArrivalsMin: projection.arrivalsMin,
    now: evaluationAt,
  });
  const deliveryPriority = buildDeliveryPriorityContext({
    triggerAt,
    triggerKind,
    triggerWindow,
    accuracyRuntime,
  });

  const notificationContext = {
    riskLevel: risk.targetResult.level,
    routeNumber: primaryLine.number,
    arrivalsMin: risk.notificationArrivalsMin,
    vehicleType: resolveJourneyDuration(state, evaluationAt).vehicleType,
    urgency: risk.urgency,
    riskMessage: risk.message,
    escalationEnabled: state.notification.escalationEnabled,
    dndBypass: state.notification.dndBypass,
    preferredSoundPresetId: state.notification.soundPresetId,
    preferredSpeechRate: state.notification.ttsSpeed,
    vibrationStrength: state.notification.vibrationStrength,
    accuracyRiskBufferMin: risk.etaRiskBufferMin,
    stabilityPrecheck: triggerKind === "stability-precheck",
    stabilityPrecheckLeadMin,
    deliveryPriorityClass: deliveryPriority.deliveryPriorityClass,
    deliveryPriorityReason: deliveryPriority.deliveryPriorityReason,
    ...buildAccuracyNotificationContext(accuracyRuntime),
  };
  const notificationSpec = getNotificationSpec(notificationContext);

  return {
    triggerAt: triggerAt.toISOString(),
    triggerKind,
    triggerLabel: triggerLabel || (triggerKind === "stability-precheck" ? "Stability precheck" : "Alarm"),
    stabilityPrecheckLeadMin: Math.max(0, Number(stabilityPrecheckLeadMin) || 0),
    source: projection.source,
    arrivalsMin: risk.notificationArrivalsMin,
    observedArrivalsMin: projection.arrivalsMin,
    lastChanceConfirmed: risk.lastChanceConfirmed,
    urgency: risk.urgency,
    riskLevel: risk.targetResult.level,
    etaRiskBufferMin: risk.etaRiskBufferMin,
    liveEtaGuardMode: liveEtaGuard.mode,
    message: risk.message,
    arrivalAtWork: risk.targetResult.arriveWorkAt?.toISOString() || null,
    deliveryPriorityClass: deliveryPriority.deliveryPriorityClass,
    deliveryPriorityReason: deliveryPriority.deliveryPriorityReason,
    notificationSpec,
    escalationTimeline: buildEscalationTimeline(notificationContext).map((item) => ({
      secondsSinceTrigger: item.secondsSinceTrigger,
      escalationLabel: item.escalationLabel,
      volumePercent: item.volumePercent,
      fullScreen: item.fullScreen,
      vibrationRepeats: item.vibrationRepeats,
    })),
  };
}

function buildStabilityPrecheckTrigger({
  state,
  primaryLine,
  triggerWindow,
  today,
  scheduleState,
  accuracyRuntime = null,
}) {
  const accuracyContext = buildAccuracyNotificationContext(accuracyRuntime);
  if (!scheduleState?.firing || accuracyContext.historicalBiasLevel !== "high") {
    return null;
  }

  if (today.getTime() >= triggerWindow.startAt.getTime()) {
    return null;
  }

  const stabilityPrecheckLeadMin = 10;
  const precheckAt = addMinutes(triggerWindow.startAt, -stabilityPrecheckLeadMin);
  if (dateOnlyKey(precheckAt) !== dateOnlyKey(triggerWindow.startAt)) {
    return null;
  }

  return buildTriggerEntry({
    state,
    primaryLine,
    triggerAt: precheckAt,
    now: today,
    accuracyRuntime,
    triggerWindow,
    triggerKind: "stability-precheck",
    triggerLabel: "High-watch precheck",
    stabilityPrecheckLeadMin,
  });
}

function sortTriggers(triggers = []) {
  return [...triggers].sort((left, right) => new Date(left.triggerAt).getTime() - new Date(right.triggerAt).getTime());
}

export function buildAlarmPlan(state, now = new Date(), options = {}) {
  if (!state || typeof state !== "object") {
    throw new Error("Alarm plan requires an app state object.");
  }

  const today = now instanceof Date ? now : new Date(now);
  const accuracyRuntime = options?.accuracyRuntime || null;
  const holidayDates = getHolidayDates(state);
  const scheduleState = describeScheduleState(state.schedule, today, holidayDates);
  const stop = getSelectedStop(state);
  const primaryLine = getPrimaryLine(state, stop);
  const triggerWindow = getTriggerTimes(state.schedule, today);
  const baseTriggers = scheduleState.firing
    ? triggerWindow.totalTriggers.map((triggerAt) =>
        buildTriggerEntry({
          state,
          primaryLine,
          triggerAt,
          now: today,
          accuracyRuntime,
          triggerWindow,
        }),
      )
    : [];
  const stabilityPrecheckTrigger = buildStabilityPrecheckTrigger({
    state,
    primaryLine,
    triggerWindow,
    today,
    scheduleState,
    accuracyRuntime,
  });
  const extraTriggers = stabilityPrecheckTrigger ? [stabilityPrecheckTrigger] : [];
  const allTriggers = sortTriggers([...extraTriggers, ...baseTriggers]);
  const triggers = allTriggers.filter((trigger) => new Date(trigger.triggerAt).getTime() >= today.getTime());
  const accuracyContext = buildAccuracyNotificationContext(accuracyRuntime);
  const remainingPrecheckTriggers = triggers.filter((trigger) => trigger.triggerKind === "stability-precheck").length;

  return {
    generatedAt: today.toISOString(),
    dateKey: dateOnlyKey(today),
    todayStatus: scheduleState,
    stop: {
      id: stop.id,
      name: isLiveConfigured(state) ? state.live.stationName || stop.name : stop.name,
      stopCode: stop.stopCode,
    },
    route: {
      id: primaryLine.id,
      number: primaryLine.number,
      label: primaryLine.label,
      destination: primaryLine.destination,
    },
    window: {
      startAt: triggerWindow.startAt.toISOString(),
      endAt: triggerWindow.endAt.toISOString(),
      repeatIntervalMin: state.schedule.repeatIntervalMin,
    },
    totalTriggers: allTriggers.length,
    baseTriggerCount: baseTriggers.length,
    precheckTriggerCount: extraTriggers.length,
    remainingTriggers: triggers.length,
    remainingPrecheckTriggers,
    nextTrigger: triggers[0] || null,
    stabilityWatch: {
      level: accuracyContext.historicalBiasLevel || "none",
      routeTraceCount: accuracyContext.historicalBiasRouteTraceCount,
      weekdayTraceCount: accuracyContext.historicalBiasWeekdayTraceCount,
      precheckLeadMin: stabilityPrecheckTrigger ? stabilityPrecheckTrigger.stabilityPrecheckLeadMin : 0,
      precheckTriggerAt: stabilityPrecheckTrigger?.triggerAt || null,
    },
    triggers,
    allTriggers,
  };
}

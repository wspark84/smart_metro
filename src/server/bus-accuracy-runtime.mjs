import { combineDateAndTime, shouldFireToday } from "../logic/commute.js";
import { buildLiveEtaGuard } from "../logic/live-eta-guard.js";

function asIsoString(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asFiniteNonNegativeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return null;
  }

  return number;
}

function toUniqueStrings(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function clampProbeIntervalMs(intervalMs) {
  return Math.max(15_000, Number(intervalMs) || 15_000);
}

function getHistoricalPreStartLeadMs(bias = null) {
  const level = String(bias?.level || "").trim().toLowerCase();
  if (level === "high") {
    return 30 * 60_000;
  }

  if (level === "elevated") {
    return 20 * 60_000;
  }

  return 15 * 60_000;
}

function isHighBiasWarmupWindow(windowStart, now, bias = null) {
  const level = String(bias?.level || "").trim().toLowerCase();
  if (level !== "high") {
    return false;
  }

  const nowMs = now.getTime();
  const windowStartMs = windowStart.getTime();
  const warmupLeadMs = 10 * 60_000;
  return nowMs < windowStartMs && nowMs >= windowStartMs - warmupLeadMs;
}

function applyHistoricalConservativeBias(plan, bias = null) {
  const safePlan = plan && typeof plan === "object" ? plan : {};
  const safeBias = bias && typeof bias === "object" ? bias : null;
  if (!safePlan.enabled || !safeBias?.shouldTighten) {
    return {
      ...safePlan,
      historicalBias: safeBias,
    };
  }

  const baseIntervalMs = clampProbeIntervalMs(safePlan.intervalMs);
  let tightenedIntervalMs = baseIntervalMs;

  if (safeBias.level === "high") {
    if (baseIntervalMs >= 90_000) {
      tightenedIntervalMs = 45_000;
    } else if (baseIntervalMs >= 45_000) {
      tightenedIntervalMs = 30_000;
    } else if (baseIntervalMs >= 30_000) {
      tightenedIntervalMs = 20_000;
    } else {
      tightenedIntervalMs = 15_000;
    }
  } else if (safeBias.level === "elevated") {
    if (baseIntervalMs >= 90_000) {
      tightenedIntervalMs = 60_000;
    } else if (baseIntervalMs >= 45_000) {
      tightenedIntervalMs = 30_000;
    } else if (baseIntervalMs >= 30_000) {
      tightenedIntervalMs = 20_000;
    }
  }

  if (tightenedIntervalMs >= baseIntervalMs) {
    return {
      ...safePlan,
      historicalBias: safeBias,
    };
  }

  return {
    ...safePlan,
    reason: `${safePlan.reason}+${safeBias.reasonCode}`,
    cadence: `${safePlan.cadence}-history-${safeBias.level}`,
    intervalMs: tightenedIntervalMs,
    historicalBias: safeBias,
  };
}

export function createBusAccuracyRuntimeState() {
  return {
    lastAutoProbeAt: null,
    lastProbeKey: "",
    lastStatus: "idle",
    lastReason: "",
    lastComparisonCount: 0,
    autoProbeCount: 0,
    lastCadence: "steady",
    lastIntervalMs: 60_000,
    lastAutoResolvedAt: null,
    lastAutoResolvedRouteKey: "",
    lastAutoResolvedProviderCount: 0,
    autoResolvedArrivalCount: 0,
    lastObservedProbeAt: null,
    lastObservedProbeSource: "none",
    lastObservedProbeComparisonCount: 0,
    lastObservedComparableProviderCount: 0,
    lastObservedComparableProviders: [],
    lastObservedEtaMin: null,
    lastObservedEtaMax: null,
    lastObservedEtaSpreadMin: null,
    lastObservedDisagreementLevel: "unknown",
    lastHistoricalBiasLevel: "none",
    lastHistoricalBiasRouteTraceCount: 0,
    lastHistoricalBiasWeekdayTraceCount: 0,
  };
}

export function normalizeBusAccuracyRuntimeState(state) {
  const safe = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  return {
    lastAutoProbeAt: asIsoString(safe.lastAutoProbeAt),
    lastProbeKey: String(safe.lastProbeKey || "").trim(),
    lastStatus: String(safe.lastStatus || "idle").trim() || "idle",
    lastReason: String(safe.lastReason || "").trim(),
    lastComparisonCount: Math.max(0, Number(safe.lastComparisonCount) || 0),
    autoProbeCount: Math.max(0, Number(safe.autoProbeCount) || 0),
    lastCadence: String(safe.lastCadence || "steady").trim() || "steady",
    lastIntervalMs: Math.max(15_000, Number(safe.lastIntervalMs) || 60_000),
    lastAutoResolvedAt: asIsoString(safe.lastAutoResolvedAt),
    lastAutoResolvedRouteKey: String(safe.lastAutoResolvedRouteKey || "").trim(),
    lastAutoResolvedProviderCount: Math.max(0, Number(safe.lastAutoResolvedProviderCount) || 0),
    autoResolvedArrivalCount: Math.max(0, Number(safe.autoResolvedArrivalCount) || 0),
    lastObservedProbeAt: asIsoString(safe.lastObservedProbeAt),
    lastObservedProbeSource: String(safe.lastObservedProbeSource || "none").trim() || "none",
    lastObservedProbeComparisonCount: Math.max(0, Number(safe.lastObservedProbeComparisonCount) || 0),
    lastObservedComparableProviderCount: Math.max(0, Number(safe.lastObservedComparableProviderCount) || 0),
    lastObservedComparableProviders: toUniqueStrings(safe.lastObservedComparableProviders),
    lastObservedEtaMin: asFiniteNonNegativeNumber(safe.lastObservedEtaMin),
    lastObservedEtaMax: asFiniteNonNegativeNumber(safe.lastObservedEtaMax),
    lastObservedEtaSpreadMin: asFiniteNonNegativeNumber(safe.lastObservedEtaSpreadMin),
    lastObservedDisagreementLevel: String(safe.lastObservedDisagreementLevel || "unknown").trim() || "unknown",
    lastHistoricalBiasLevel: String(safe.lastHistoricalBiasLevel || "none").trim() || "none",
    lastHistoricalBiasRouteTraceCount: Math.max(0, Number(safe.lastHistoricalBiasRouteTraceCount) || 0),
    lastHistoricalBiasWeekdayTraceCount: Math.max(0, Number(safe.lastHistoricalBiasWeekdayTraceCount) || 0),
  };
}

export function summarizeBusAccuracyComparisons(comparisons = []) {
  const safeComparisons = Array.isArray(comparisons) ? comparisons : [];
  const comparable = safeComparisons
    .map((item) => ({
      provider: String(item?.provider || "").trim(),
      firstArrivalMinutes: asFiniteNonNegativeNumber(item?.arrivalsMin?.[0]),
    }))
    .filter((item) => item.provider && item.firstArrivalMinutes !== null);
  const comparableProviders = toUniqueStrings(comparable.map((item) => item.provider));
  const comparableProviderCount = comparableProviders.length;

  if (comparableProviderCount < 2) {
    return {
      comparisonCount: safeComparisons.length,
      comparableProviderCount,
      comparableProviders,
      etaMin: comparable[0]?.firstArrivalMinutes ?? null,
      etaMax: comparable[0]?.firstArrivalMinutes ?? null,
      etaSpreadMin: 0,
      disagreementLevel: comparableProviderCount === 1 ? "single-provider" : "insufficient",
    };
  }

  const etaMin = Math.min(...comparable.map((item) => item.firstArrivalMinutes));
  const etaMax = Math.max(...comparable.map((item) => item.firstArrivalMinutes));
  const etaSpreadMin = Math.round((etaMax - etaMin) * 10) / 10;
  const disagreementLevel =
    etaSpreadMin <= 1 ? "aligned" : etaSpreadMin <= 3 ? "watch" : "diverged";

  return {
    comparisonCount: safeComparisons.length,
    comparableProviderCount,
    comparableProviders,
    etaMin,
    etaMax,
    etaSpreadMin,
    disagreementLevel,
  };
}

export function markBusAccuracyProbeObservation(
  runtimeState,
  {
    now = new Date(),
    source = "manual",
    comparisonCount = 0,
    comparisonSummary = null,
  } = {},
) {
  const safeState = normalizeBusAccuracyRuntimeState(runtimeState);
  const safeSummary =
    comparisonSummary && typeof comparisonSummary === "object"
      ? comparisonSummary
      : summarizeBusAccuracyComparisons([]);

  return normalizeBusAccuracyRuntimeState({
    ...safeState,
    lastObservedProbeAt: now.toISOString(),
    lastObservedProbeSource: String(source || "manual").trim() || "manual",
    lastObservedProbeComparisonCount: Math.max(0, Number(comparisonCount) || 0),
    lastObservedComparableProviderCount: Math.max(0, Number(safeSummary.comparableProviderCount) || 0),
    lastObservedComparableProviders: toUniqueStrings(safeSummary.comparableProviders),
    lastObservedEtaMin: asFiniteNonNegativeNumber(safeSummary.etaMin),
    lastObservedEtaMax: asFiniteNonNegativeNumber(safeSummary.etaMax),
    lastObservedEtaSpreadMin: asFiniteNonNegativeNumber(safeSummary.etaSpreadMin),
    lastObservedDisagreementLevel: String(safeSummary.disagreementLevel || "unknown").trim() || "unknown",
  });
}

export function buildBusAccuracyAutoProbePlan({
  now = new Date(),
  schedule = null,
  holidayDates = [],
  nextArrivalMinutes = null,
  activeAlertRiskLevel = "",
  liveEtaDisagreementLevel = "",
  liveEtaSpreadMin = null,
  comparableProviderCount = 0,
  historicalConservativeBias = null,
} = {}) {
  const safeSchedule = schedule && typeof schedule === "object" ? schedule : null;
  if (!safeSchedule) {
    return {
      enabled: true,
      reason: "no-schedule-context",
      cadence: "steady",
      intervalMs: 60_000,
    };
  }

  if (!shouldFireToday(safeSchedule, now, holidayDates)) {
    return {
      enabled: false,
      reason: "schedule-disabled-today",
      cadence: "off-window",
      intervalMs: 300_000,
    };
  }

  const windowStart = combineDateAndTime(now, safeSchedule.startTime);
  const windowEnd = combineDateAndTime(now, safeSchedule.endTime);
  const preStartLeadMs = getHistoricalPreStartLeadMs(historicalConservativeBias);
  const postEndGraceMs = 10 * 60_000;

  if (now.getTime() < windowStart.getTime() - preStartLeadMs) {
    const biasLevel = String(historicalConservativeBias?.level || "").trim().toLowerCase();
    return {
      enabled: false,
      reason:
        biasLevel === "high"
          ? "before-probe-window-history-high"
          : biasLevel === "elevated"
            ? "before-probe-window-history-elevated"
            : "before-probe-window",
      cadence: "off-window",
      intervalMs: 300_000,
      preStartLeadMin: Math.round(preStartLeadMs / 60_000),
    };
  }

  if (now.getTime() > windowEnd.getTime() + postEndGraceMs) {
    return {
      enabled: false,
      reason: "after-probe-window",
      cadence: "off-window",
      intervalMs: 300_000,
      preStartLeadMin: Math.round(preStartLeadMs / 60_000),
    };
  }

  const riskLevel = String(activeAlertRiskLevel || "").trim().toUpperCase();
  const arrivalMinutes = Number.isFinite(Number(nextArrivalMinutes)) ? Number(nextArrivalMinutes) : null;
  const liveEtaGuard = buildLiveEtaGuard({
    disagreementLevel: liveEtaDisagreementLevel,
    spreadMin: liveEtaSpreadMin,
    comparableProviderCount,
    historicalBiasLevel: historicalConservativeBias?.level || "",
  });

  if (riskLevel === "RED" || riskLevel === "ORANGE" || (arrivalMinutes !== null && arrivalMinutes <= 1)) {
    return applyHistoricalConservativeBias({
      enabled: true,
      reason: "critical-imminence",
      cadence: "critical",
      intervalMs: 15_000,
      preStartLeadMin: Math.round(preStartLeadMs / 60_000),
    }, historicalConservativeBias);
  }

  if (liveEtaGuard.mode === "conservative") {
    return applyHistoricalConservativeBias({
      enabled: true,
      reason: liveEtaGuard.reasonCode === "eta-watch-history-high" ? "eta-watch-history-high" : "eta-disagreement-diverged",
      cadence: liveEtaGuard.reasonCode === "eta-watch-history-high" ? "verify-history-high" : "verify-diverged",
      intervalMs: 20_000,
      preStartLeadMin: Math.round(preStartLeadMs / 60_000),
    }, historicalConservativeBias);
  }

  if (isHighBiasWarmupWindow(windowStart, now, historicalConservativeBias)) {
    return applyHistoricalConservativeBias({
      enabled: true,
      reason: "precheck-warmup",
      cadence: "precheck-warmup",
      intervalMs: 30_000,
      preStartLeadMin: Math.round(preStartLeadMs / 60_000),
    }, historicalConservativeBias);
  }

  if (arrivalMinutes !== null && arrivalMinutes <= 3) {
    return applyHistoricalConservativeBias({
      enabled: true,
      reason: "imminent-arrival",
      cadence: "imminent",
      intervalMs: 30_000,
      preStartLeadMin: Math.round(preStartLeadMs / 60_000),
    }, historicalConservativeBias);
  }

  if (liveEtaGuard.mode === "watch") {
    return applyHistoricalConservativeBias({
      enabled: true,
      reason: "eta-disagreement-watch",
      cadence: "verify-watch",
      intervalMs: 30_000,
      preStartLeadMin: Math.round(preStartLeadMs / 60_000),
    }, historicalConservativeBias);
  }

  if (arrivalMinutes !== null && arrivalMinutes <= 10) {
    return applyHistoricalConservativeBias({
      enabled: true,
      reason: "near-arrival",
      cadence: "near",
      intervalMs: 45_000,
      preStartLeadMin: Math.round(preStartLeadMs / 60_000),
    }, historicalConservativeBias);
  }

  return applyHistoricalConservativeBias({
    enabled: true,
    reason: "steady-window",
    cadence: "steady",
    intervalMs: 90_000,
    preStartLeadMin: Math.round(preStartLeadMs / 60_000),
  }, historicalConservativeBias);
}

export function shouldRunBusAccuracyAutoProbe(runtimeState, { probeKey = "", now = new Date(), intervalMs = 60_000 } = {}) {
  const safeState = normalizeBusAccuracyRuntimeState(runtimeState);
  const safeProbeKey = String(probeKey || "").trim();
  if (!safeProbeKey) {
    return {
      shouldRun: false,
      reason: "missing-probe-key",
    };
  }

  if (!safeState.lastAutoProbeAt) {
    return {
      shouldRun: true,
      reason: "first-probe",
    };
  }

  const nowMs = now.getTime();
  const lastMs = new Date(safeState.lastAutoProbeAt).getTime();
  const withinCooldown = nowMs - lastMs < intervalMs;

  if (safeState.lastProbeKey === safeProbeKey && withinCooldown) {
    return {
      shouldRun: false,
      reason: "cooldown",
      nextEligibleAt: new Date(lastMs + intervalMs).toISOString(),
    };
  }

  return {
    shouldRun: true,
    reason: safeState.lastProbeKey === safeProbeKey ? "interval-elapsed" : "probe-key-changed",
  };
}

export function markBusAccuracyAutoProbeResult(
  runtimeState,
  {
    probeKey = "",
    now = new Date(),
    status = "ready",
    reason = "",
    comparisonCount = 0,
    cadence = "steady",
    intervalMs = 60_000,
    comparisonSummary = null,
    historicalBias = null,
  } = {},
) {
  const observedState = markBusAccuracyProbeObservation(runtimeState, {
    now,
    source: "auto",
    comparisonCount,
    comparisonSummary,
  });
  const safeState = normalizeBusAccuracyRuntimeState(observedState);
  return normalizeBusAccuracyRuntimeState({
    ...safeState,
    lastAutoProbeAt: now.toISOString(),
    lastProbeKey: String(probeKey || "").trim(),
    lastStatus: String(status || "ready").trim() || "ready",
    lastReason: String(reason || "").trim(),
    lastComparisonCount: Math.max(0, Number(comparisonCount) || 0),
    autoProbeCount: safeState.autoProbeCount + 1,
    lastCadence: String(cadence || "steady").trim() || "steady",
    lastIntervalMs: Math.max(15_000, Number(intervalMs) || 60_000),
    lastHistoricalBiasLevel: String(historicalBias?.level || "none").trim() || "none",
    lastHistoricalBiasRouteTraceCount: Math.max(0, Number(historicalBias?.routeSignalCount) || 0),
    lastHistoricalBiasWeekdayTraceCount: Math.max(0, Number(historicalBias?.weekdayInWindowCount) || 0),
  });
}

export function shouldRunBusAccuracyAutoResolve(
  runtimeState,
  { routeKey = "", now = new Date(), intervalMs = 180_000 } = {},
) {
  const safeState = normalizeBusAccuracyRuntimeState(runtimeState);
  const safeRouteKey = String(routeKey || "").trim();

  if (!safeRouteKey) {
    return {
      shouldRun: false,
      reason: "missing-route-key",
    };
  }

  if (!safeState.lastAutoResolvedAt || safeState.lastAutoResolvedRouteKey !== safeRouteKey) {
    return {
      shouldRun: true,
      reason: safeState.lastAutoResolvedAt ? "route-key-changed" : "first-auto-resolve",
    };
  }

  const nowMs = now.getTime();
  const lastMs = new Date(safeState.lastAutoResolvedAt).getTime();
  if (nowMs - lastMs < intervalMs) {
    return {
      shouldRun: false,
      reason: "auto-resolve-cooldown",
      nextEligibleAt: new Date(lastMs + intervalMs).toISOString(),
    };
  }

  return {
    shouldRun: true,
    reason: "auto-resolve-interval-elapsed",
  };
}

export function markBusAccuracyAutoResolveResult(
  runtimeState,
  { routeKey = "", now = new Date(), providerCount = 0 } = {},
) {
  const safeState = normalizeBusAccuracyRuntimeState(runtimeState);
  return normalizeBusAccuracyRuntimeState({
    ...safeState,
    lastAutoResolvedAt: now.toISOString(),
    lastAutoResolvedRouteKey: String(routeKey || "").trim(),
    lastAutoResolvedProviderCount: Math.max(0, Number(providerCount) || 0),
    autoResolvedArrivalCount: safeState.autoResolvedArrivalCount + 1,
  });
}

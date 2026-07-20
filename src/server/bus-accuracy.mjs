function asIsoString(value, fallback = new Date().toISOString()) {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback).toISOString() : date.toISOString();
}

function asNormalizedText(value) {
  return String(value || "").trim();
}

function normalizeStopKey(value) {
  return String(value || "").trim().toLowerCase();
}

function asRouteKey({ region = "", routeNumber = "", stopName = "", stopKey = "" }) {
  return [region, routeNumber, normalizeStopKey(stopKey) || stopName]
    .map((value) => asNormalizedText(value).toLowerCase())
    .join("::");
}

function toFiniteMinutes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return null;
  }

  return number;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

const ACCURACY_RECOMMENDATION_POLICY = {
  minSamplesPerProvider: 2,
  minProvidersForMeasuredRecommendation: 2,
  minWinningGapMin: 0.5,
};

const RECENT_SAMPLE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SAMPLE_WEIGHT_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_ACCURACY_TIME_ZONE = "Asia/Seoul";
const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parseClockMinutes(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

function getClockMinutesForIso(iso, timeZone = DEFAULT_ACCURACY_TIME_ZONE) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? Number.NaN);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? Number.NaN);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  return hour * 60 + minute;
}

function getWeekdayIndexForIso(iso, timeZone = DEFAULT_ACCURACY_TIME_ZONE) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const weekdayToken = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
  const lookup = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return Number.isInteger(lookup[weekdayToken]) ? lookup[weekdayToken] : null;
}

function isMinuteInsideWindow(valueMinutes, startMinutes, endMinutes) {
  if (valueMinutes === null || startMinutes === null || endMinutes === null) {
    return false;
  }

  if (startMinutes <= endMinutes) {
    return valueMinutes >= startMinutes && valueMinutes <= endMinutes;
  }

  return valueMinutes >= startMinutes || valueMinutes <= endMinutes;
}

function normalizeTimeSliceOptions(options = {}) {
  const startTime = asNormalizedText(options?.startTime);
  const endTime = asNormalizedText(options?.endTime);
  const startMinutes = parseClockMinutes(startTime);
  const endMinutes = parseClockMinutes(endTime);
  const timeZone = asNormalizedText(options?.timeZone || DEFAULT_ACCURACY_TIME_ZONE) || DEFAULT_ACCURACY_TIME_ZONE;
  const rawTargetWeekday = Number(options?.targetWeekday);
  const targetWeekday =
    Number.isInteger(rawTargetWeekday) && rawTargetWeekday >= 0 && rawTargetWeekday <= 6 ? rawTargetWeekday : null;
  const weekdayLabel =
    targetWeekday === null
      ? ""
      : asNormalizedText(options?.weekdayLabel || WEEKDAY_LABELS[targetWeekday] || "");

  if (startMinutes === null || endMinutes === null) {
    return {
      mode: "all-samples",
      key: "all-samples",
      label: "All scored arrivals",
      startTime: "",
      endTime: "",
      timeZone,
      targetWeekday: null,
      weekdayLabel: "",
    };
  }

  return {
    mode: "schedule-window",
    key: `${startTime}-${endTime}`,
    label: asNormalizedText(options?.label || `${startTime} - ${endTime}`),
    startTime,
    endTime,
    startMinutes,
    endMinutes,
    timeZone,
    targetWeekday,
    weekdayLabel,
  };
}

export function createBusAccuracyState() {
  return {
    pendingObservations: [],
    resolvedSamples: [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizePendingObservation(observation) {
  const provider = asNormalizedText(observation?.provider);
  const routeNumber = asNormalizedText(observation?.routeNumber);
  const stopName = asNormalizedText(observation?.stopName);
  const stopKey = normalizeStopKey(observation?.stopKey);
  const region = asNormalizedText(observation?.region || "unknown");
  const observedAt = asIsoString(observation?.observedAt);
  const predictedMinutes = toFiniteMinutes(observation?.predictedMinutes);

  if (!provider || !routeNumber || !stopName || predictedMinutes === null) {
    throw new Error("Accuracy observation requires provider, routeNumber, stopName, and predictedMinutes.");
  }

  const predictedArrivalAt = asIsoString(
    observation?.predictedArrivalAt,
    new Date(new Date(observedAt).getTime() + predictedMinutes * 60_000).toISOString(),
  );
  const routeKey = asRouteKey({ region, routeNumber, stopName, stopKey });

  return {
    id:
      asNormalizedText(observation?.id) ||
      [provider, routeKey, observedAt, String(predictedMinutes)].join("::"),
    provider,
    region,
    routeNumber,
    stopName,
    stopKey,
    routeKey,
    observedAt,
    predictedMinutes,
    predictedArrivalAt,
    source: asNormalizedText(observation?.source || "live"),
    recordedAt: asIsoString(observation?.recordedAt || observedAt),
  };
}

function normalizeResolvedSample(sample) {
  const provider = asNormalizedText(sample?.provider);
  const routeNumber = asNormalizedText(sample?.routeNumber);
  const stopName = asNormalizedText(sample?.stopName);
  const stopKey = normalizeStopKey(sample?.stopKey);
  const region = asNormalizedText(sample?.region || "unknown");
  const observedAt = asIsoString(sample?.observedAt);
  const predictedArrivalAt = asIsoString(sample?.predictedArrivalAt);
  const actualArrivalAt = asIsoString(sample?.actualArrivalAt);
  const predictedMinutes = toFiniteMinutes(sample?.predictedMinutes);
  const absoluteErrorSec = Number(sample?.absoluteErrorSec);

  if (!provider || !routeNumber || !stopName || predictedMinutes === null || !Number.isFinite(absoluteErrorSec)) {
    throw new Error("Resolved accuracy sample is missing required fields.");
  }

  return {
    id:
      asNormalizedText(sample?.id) ||
      [provider, asRouteKey({ region, routeNumber, stopName, stopKey }), observedAt, actualArrivalAt].join("::"),
    provider,
    region,
    routeNumber,
    stopName,
    stopKey,
    routeKey: asRouteKey({ region, routeNumber, stopName, stopKey }),
    observedAt,
    predictedArrivalAt,
    actualArrivalAt,
    predictedMinutes,
    absoluteErrorSec,
    absoluteErrorMin: Math.round((absoluteErrorSec / 60) * 10) / 10,
    resolvedBy: asNormalizedText(sample?.resolvedBy || "manual-actual-arrival"),
  };
}

export function normalizeBusAccuracyState(state) {
  const safe = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  return {
    pendingObservations: Array.isArray(safe.pendingObservations)
      ? safe.pendingObservations.map(normalizePendingObservation)
      : [],
    resolvedSamples: Array.isArray(safe.resolvedSamples) ? safe.resolvedSamples.map(normalizeResolvedSample) : [],
    updatedAt: asIsoString(safe.updatedAt),
  };
}

function prunePendingObservations(observations, nowIso) {
  const nowMs = new Date(nowIso).getTime();
  return observations.filter((item) => {
    const observedMs = new Date(item.observedAt).getTime();
    const predictedMs = new Date(item.predictedArrivalAt).getTime();
    return observedMs >= nowMs - 6 * 60 * 60 * 1000 && predictedMs >= nowMs - 60 * 60 * 1000;
  });
}

function pruneResolvedSamples(samples, nowIso) {
  const nowMs = new Date(nowIso).getTime();
  return samples.filter((item) => new Date(item.actualArrivalAt).getTime() >= nowMs - 30 * 24 * 60 * 60 * 1000);
}

export function recordForecastObservation(state, observation) {
  const safeState = normalizeBusAccuracyState(state);
  const normalizedObservation = normalizePendingObservation(observation);
  const alreadyExists = safeState.pendingObservations.some((item) => item.id === normalizedObservation.id);
  const nextPending = alreadyExists
    ? safeState.pendingObservations
    : [normalizedObservation, ...safeState.pendingObservations];
  const updatedAt = asIsoString(observation?.recordedAt || observation?.observedAt);

  return normalizeBusAccuracyState({
    ...safeState,
    pendingObservations: prunePendingObservations(nextPending, updatedAt),
    resolvedSamples: pruneResolvedSamples(safeState.resolvedSamples, updatedAt),
    updatedAt,
  });
}

export function resolveActualArrival(state, payload = {}) {
  const safeState = normalizeBusAccuracyState(state);
  const routeNumber = asNormalizedText(payload.routeNumber);
  const stopName = asNormalizedText(payload.stopName);
  const stopKey = normalizeStopKey(payload.stopKey);
  const region = asNormalizedText(payload.region);
  const actualArrivalAt = asIsoString(payload.actualArrivalAt);

  if (!routeNumber || !stopName) {
    throw new Error("Actual arrival logging requires routeNumber and stopName.");
  }

  const actualMs = new Date(actualArrivalAt).getTime();
  const matched = safeState.pendingObservations.filter((item) => {
    if (item.routeNumber !== routeNumber) {
      return false;
    }

    if (stopKey) {
      if (item.stopKey) {
        if (item.stopKey !== stopKey) {
          return false;
        }
      } else if (item.stopName !== stopName) {
        return false;
      }
    } else if (item.stopName !== stopName) {
      return false;
    }

    if (region && item.region !== region) {
      return false;
    }

    const observedMs = new Date(item.observedAt).getTime();
    return observedMs >= actualMs - 90 * 60 * 1000 && observedMs <= actualMs + 10 * 60 * 1000;
  });

  const latestByProvider = new Map();
  for (const item of matched) {
    const current = latestByProvider.get(item.provider);
    if (!current || new Date(item.observedAt).getTime() > new Date(current.observedAt).getTime()) {
      latestByProvider.set(item.provider, item);
    }
  }

  const resolvedSamples = [...latestByProvider.values()].map((item) =>
    normalizeResolvedSample({
      provider: item.provider,
      region: item.region,
      routeNumber: item.routeNumber,
      stopName: item.stopName,
      stopKey: item.stopKey,
      observedAt: item.observedAt,
      predictedArrivalAt: item.predictedArrivalAt,
      actualArrivalAt,
      predictedMinutes: item.predictedMinutes,
      absoluteErrorSec: Math.abs(new Date(item.predictedArrivalAt).getTime() - actualMs) / 1000,
      resolvedBy: "manual-actual-arrival",
    }),
  );

  const consumedIds = new Set(matched.map((item) => item.id));
  const nextState = normalizeBusAccuracyState({
    ...safeState,
    pendingObservations: safeState.pendingObservations.filter((item) => !consumedIds.has(item.id)),
    resolvedSamples: [...resolvedSamples, ...safeState.resolvedSamples].slice(0, 500),
    updatedAt: actualArrivalAt,
  });

  return {
    state: nextState,
    resolvedSamples,
  };
}

function calculateWeightedMeanAbsoluteErrorMin(samples, referenceIso) {
  const referenceMs = new Date(referenceIso).getTime();
  let weightedErrorSum = 0;
  let weightSum = 0;

  for (const item of samples) {
    const actualMs = new Date(item.actualArrivalAt).getTime();
    const ageMs = Math.max(0, referenceMs - actualMs);
    const weight = Math.pow(0.5, ageMs / SAMPLE_WEIGHT_HALF_LIFE_MS);
    weightedErrorSum += item.absoluteErrorSec * weight;
    weightSum += weight;
  }

  if (!weightSum) {
    return null;
  }

  return Math.round((weightedErrorSum / weightSum / 60) * 10) / 10;
}

function calculateSampleAgeMs(sampleIso, referenceIso) {
  const sampleMs = new Date(sampleIso).getTime();
  const referenceMs = new Date(referenceIso).getTime();
  if (Number.isNaN(sampleMs) || Number.isNaN(referenceMs)) {
    return null;
  }

  return Math.max(0, referenceMs - sampleMs);
}

function roundAgeDays(ageMs) {
  if (!Number.isFinite(ageMs)) {
    return null;
  }

  return Math.round((ageMs / (24 * 60 * 60 * 1000)) * 10) / 10;
}

function summarizeProviderSamples(samples, referenceIso) {
  const totalErrorSec = samples.reduce((sum, item) => sum + item.absoluteErrorSec, 0);
  const meanAbsoluteErrorMin = samples.length ? Math.round((totalErrorSec / samples.length / 60) * 10) / 10 : null;
  const weightedMeanAbsoluteErrorMin = calculateWeightedMeanAbsoluteErrorMin(samples, referenceIso);
  const latestActualArrivalAt = samples[0]?.actualArrivalAt || null;
  const referenceMs = new Date(referenceIso).getTime();
  const recentSampleCount = samples.filter(
    (item) => referenceMs - new Date(item.actualArrivalAt).getTime() <= RECENT_SAMPLE_WINDOW_MS,
  ).length;
  const latestSampleAgeMs = latestActualArrivalAt ? calculateSampleAgeMs(latestActualArrivalAt, referenceIso) : null;

  return {
    sampleCount: samples.length,
    recentSampleCount,
    meanAbsoluteErrorMin,
    weightedMeanAbsoluteErrorMin,
    latestActualArrivalAt,
    latestSampleAgeMs,
    latestSampleAgeDays: roundAgeDays(latestSampleAgeMs),
    hasFreshRecentSample: recentSampleCount > 0,
  };
}

function summarizeProviderWindowSamples(samples, referenceIso, timeSlice) {
  const baseSummary = summarizeProviderSamples(samples, referenceIso);
  if (timeSlice.mode !== "schedule-window") {
    return {
      ...baseSummary,
      timeSliceSampleCount: baseSummary.sampleCount,
      timeSliceRecentSampleCount: baseSummary.recentSampleCount,
      timeSliceMeanAbsoluteErrorMin: baseSummary.meanAbsoluteErrorMin,
      timeSliceWeightedMeanAbsoluteErrorMin: baseSummary.weightedMeanAbsoluteErrorMin,
      timeSliceLatestActualArrivalAt: baseSummary.latestActualArrivalAt,
      weekdayTimeSliceSampleCount: baseSummary.sampleCount,
      weekdayTimeSliceRecentSampleCount: baseSummary.recentSampleCount,
      weekdayTimeSliceMeanAbsoluteErrorMin: baseSummary.meanAbsoluteErrorMin,
      weekdayTimeSliceWeightedMeanAbsoluteErrorMin: baseSummary.weightedMeanAbsoluteErrorMin,
      weekdayTimeSliceLatestActualArrivalAt: baseSummary.latestActualArrivalAt,
    };
  }

  const timeSliceSamples = samples.filter((item) =>
    isMinuteInsideWindow(
      getClockMinutesForIso(item.actualArrivalAt, timeSlice.timeZone),
      timeSlice.startMinutes,
      timeSlice.endMinutes,
    ),
  );
  const windowSummary = summarizeProviderSamples(timeSliceSamples, referenceIso);
  const weekdayTimeSliceSamples =
    timeSlice.targetWeekday === null
      ? timeSliceSamples
      : timeSliceSamples.filter(
          (item) => getWeekdayIndexForIso(item.actualArrivalAt, timeSlice.timeZone) === timeSlice.targetWeekday,
        );
  const weekdayWindowSummary = summarizeProviderSamples(weekdayTimeSliceSamples, referenceIso);

  return {
    ...baseSummary,
    timeSliceSampleCount: windowSummary.sampleCount,
    timeSliceRecentSampleCount: windowSummary.recentSampleCount,
    timeSliceMeanAbsoluteErrorMin: windowSummary.meanAbsoluteErrorMin,
    timeSliceWeightedMeanAbsoluteErrorMin: windowSummary.weightedMeanAbsoluteErrorMin,
    timeSliceLatestActualArrivalAt: windowSummary.latestActualArrivalAt,
    weekdayTimeSliceSampleCount: weekdayWindowSummary.sampleCount,
    weekdayTimeSliceRecentSampleCount: weekdayWindowSummary.recentSampleCount,
    weekdayTimeSliceMeanAbsoluteErrorMin: weekdayWindowSummary.meanAbsoluteErrorMin,
    weekdayTimeSliceWeightedMeanAbsoluteErrorMin: weekdayWindowSummary.weightedMeanAbsoluteErrorMin,
    weekdayTimeSliceLatestActualArrivalAt: weekdayWindowSummary.latestActualArrivalAt,
  };
}

function hasConfirmedArrivalMessage(messages = []) {
  return messages.some((message) => {
    const text = String(message || "").trim();
    if (!text) {
      return false;
    }

    return text.includes("도착") && !text.includes("곧");
  });
}

function getFirstArrivalMinutes(comparison) {
  if (!Array.isArray(comparison?.arrivalsMin) || !comparison.arrivalsMin.length) {
    return null;
  }

  return toFiniteMinutes(comparison.arrivalsMin[0]);
}

export function resolveAutoDetectedArrival(
  state,
  {
    comparisons = [],
    region = "",
    routeNumber = "",
    stopName = "",
    stopKey = "",
    actualArrivalAt = new Date().toISOString(),
    minProviderCount = 2,
    maxArrivalMinutes = 1,
  } = {},
) {
  const safeState = normalizeBusAccuracyState(state);
  const safeComparisons = Array.isArray(comparisons) ? comparisons : [];
  const normalizedRouteNumber = asNormalizedText(routeNumber);
  const normalizedStopName = asNormalizedText(stopName);
  const normalizedStopKey = normalizeStopKey(stopKey);
  const normalizedRegion = asNormalizedText(region);
  const providerSignals = safeComparisons
    .map((comparison) => ({
      provider: asNormalizedText(comparison?.provider),
      firstArrivalMinutes: getFirstArrivalMinutes(comparison),
      hasConfirmedArrivalMessage: hasConfirmedArrivalMessage(comparison?.messages),
    }))
    .filter((item) => item.provider);

  const uniqueProviders = uniqueValues(providerSignals.map((item) => item.provider));
  const imminentProviders = providerSignals.filter(
    (item) => item.firstArrivalMinutes !== null && item.firstArrivalMinutes <= maxArrivalMinutes,
  );
  const imminentProviderNames = uniqueValues(imminentProviders.map((item) => item.provider));
  const hasConfirmedSignal = imminentProviders.some(
    (item) => item.firstArrivalMinutes === 0 || item.hasConfirmedArrivalMessage,
  );

  if (!normalizedRouteNumber || !normalizedStopName) {
    return {
      state: safeState,
      autoDetected: false,
      resolvedSamples: [],
      detectedProviders: [],
      detectionReason: "missing-route-context",
    };
  }

  if (uniqueProviders.length < minProviderCount) {
    return {
      state: safeState,
      autoDetected: false,
      resolvedSamples: [],
      detectedProviders: imminentProviderNames,
      detectionReason: "not-enough-provider-signals",
    };
  }

  if (imminentProviderNames.length < minProviderCount || imminentProviderNames.length !== uniqueProviders.length) {
    return {
      state: safeState,
      autoDetected: false,
      resolvedSamples: [],
      detectedProviders: imminentProviderNames,
      detectionReason: "providers-not-yet-converged",
    };
  }

  if (!hasConfirmedSignal) {
    return {
      state: safeState,
      autoDetected: false,
      resolvedSamples: [],
      detectedProviders: imminentProviderNames,
      detectionReason: "no-confirmed-arrival-signal",
    };
  }

  const resolved = resolveActualArrival(safeState, {
    region: normalizedRegion,
    routeNumber: normalizedRouteNumber,
    stopName: normalizedStopName,
    stopKey: normalizedStopKey,
    actualArrivalAt,
  });

  return {
    state: resolved.state,
    autoDetected: resolved.resolvedSamples.length > 0,
    resolvedSamples: resolved.resolvedSamples,
    detectedProviders: imminentProviderNames,
    detectionReason: "multi-provider-imminent",
  };
}

function buildRecommendationSummary(providers, fallbackOrder, recommendationScope) {
  const policy = ACCURACY_RECOMMENDATION_POLICY;
  const eligibleProviders = providers.filter((item) => item.meetsRecommendationThreshold);
  const freshEligibleProviders = eligibleProviders.filter((item) => item.activeRecentSampleCount > 0);
  const staleEligibleProviders = eligibleProviders.filter((item) => item.activeRecentSampleCount <= 0);
  const fallbackRecommendedProviders = uniqueValues([...fallbackOrder, ...providers.map((item) => item.provider)]);
  const leader = freshEligibleProviders[0] || null;
  const runnerUp = freshEligibleProviders[1] || null;
  const measuredLeaderGapMin =
    leader &&
    runnerUp &&
    leader.activeWeightedMeanAbsoluteErrorMin !== null &&
    runnerUp.activeWeightedMeanAbsoluteErrorMin !== null
      ? Math.round((runnerUp.activeWeightedMeanAbsoluteErrorMin - leader.activeWeightedMeanAbsoluteErrorMin) * 10) / 10
      : null;
  const recommendationMetric =
    recommendationScope === "schedule-window-weekday"
      ? "schedule-window-weekday-weighted-recent-mae"
      : recommendationScope === "schedule-window"
        ? "schedule-window-weighted-recent-mae"
        : "weighted-recent-mae";

  if (eligibleProviders.length < policy.minProvidersForMeasuredRecommendation) {
    return {
      recommendedProviders: fallbackRecommendedProviders,
      recommendationBasis: "policy-default",
      recommendationReason: eligibleProviders.length ? "not-enough-compared-providers" : "no-provider-met-sample-threshold",
      recommendationConfidence: eligibleProviders.length ? "medium" : "low",
      measuredLeaderGapMin,
      measuredEligibleProviders: eligibleProviders.map((item) => item.provider),
      freshMeasuredEligibleProviders: freshEligibleProviders.map((item) => item.provider),
      staleMeasuredEligibleProviders: staleEligibleProviders.map((item) => item.provider),
      recommendationMetric,
      recommendationScope,
      recommendationPolicy: { ...policy },
      freshnessPolicy: {
        recentSampleWindowDays: Math.round(RECENT_SAMPLE_WINDOW_MS / (24 * 60 * 60 * 1000)),
      },
    };
  }

  if (!freshEligibleProviders.length) {
    return {
      recommendedProviders: fallbackRecommendedProviders,
      recommendationBasis: "policy-default",
      recommendationReason: "measured-samples-stale",
      recommendationConfidence: "low",
      measuredLeaderGapMin,
      measuredEligibleProviders: eligibleProviders.map((item) => item.provider),
      freshMeasuredEligibleProviders: [],
      staleMeasuredEligibleProviders: staleEligibleProviders.map((item) => item.provider),
      recommendationMetric,
      recommendationScope,
      recommendationPolicy: { ...policy },
      freshnessPolicy: {
        recentSampleWindowDays: Math.round(RECENT_SAMPLE_WINDOW_MS / (24 * 60 * 60 * 1000)),
      },
    };
  }

  if (freshEligibleProviders.length < policy.minProvidersForMeasuredRecommendation) {
    return {
      recommendedProviders: fallbackRecommendedProviders,
      recommendationBasis: "policy-default",
      recommendationReason: "not-enough-recent-compared-providers",
      recommendationConfidence: "medium",
      measuredLeaderGapMin,
      measuredEligibleProviders: eligibleProviders.map((item) => item.provider),
      freshMeasuredEligibleProviders: freshEligibleProviders.map((item) => item.provider),
      staleMeasuredEligibleProviders: staleEligibleProviders.map((item) => item.provider),
      recommendationMetric,
      recommendationScope,
      recommendationPolicy: { ...policy },
      freshnessPolicy: {
        recentSampleWindowDays: Math.round(RECENT_SAMPLE_WINDOW_MS / (24 * 60 * 60 * 1000)),
      },
    };
  }

  if (measuredLeaderGapMin === null || measuredLeaderGapMin < policy.minWinningGapMin) {
    return {
      recommendedProviders: fallbackRecommendedProviders,
      recommendationBasis: "policy-default",
      recommendationReason: "measured-gap-too-small",
      recommendationConfidence: "medium",
      measuredLeaderGapMin,
      measuredEligibleProviders: eligibleProviders.map((item) => item.provider),
      freshMeasuredEligibleProviders: freshEligibleProviders.map((item) => item.provider),
      staleMeasuredEligibleProviders: staleEligibleProviders.map((item) => item.provider),
      recommendationMetric,
      recommendationScope,
      recommendationPolicy: { ...policy },
      freshnessPolicy: {
        recentSampleWindowDays: Math.round(RECENT_SAMPLE_WINDOW_MS / (24 * 60 * 60 * 1000)),
      },
    };
  }

  return {
    recommendedProviders: uniqueValues([...freshEligibleProviders.map((item) => item.provider), ...fallbackOrder]),
    recommendationBasis: "measured-accuracy",
    recommendationReason: "measured-winner",
    recommendationConfidence: measuredLeaderGapMin >= 1 ? "high" : "medium",
    measuredLeaderGapMin,
    measuredEligibleProviders: eligibleProviders.map((item) => item.provider),
    freshMeasuredEligibleProviders: freshEligibleProviders.map((item) => item.provider),
    staleMeasuredEligibleProviders: staleEligibleProviders.map((item) => item.provider),
    recommendationMetric,
    recommendationScope,
    recommendationPolicy: { ...policy },
    freshnessPolicy: {
      recentSampleWindowDays: Math.round(RECENT_SAMPLE_WINDOW_MS / (24 * 60 * 60 * 1000)),
    },
  };
}

function toConfidenceRank(confidence = "") {
  const normalized = String(confidence || "").trim().toLowerCase();
  if (normalized === "high") {
    return 3;
  }
  if (normalized === "medium") {
    return 2;
  }
  return 1;
}

export function buildBusAccuracySnapshot(
  state,
  { region = "", routeNumber = "", stopName = "", stopKey = "", fallbackOrder = [], timeSlice = null } = {},
) {
  const safeState = normalizeBusAccuracyState(state);
  const referenceIso = safeState.updatedAt || new Date().toISOString();
  const normalizedRegion = asNormalizedText(region);
  const normalizedRouteNumber = asNormalizedText(routeNumber);
  const normalizedStopName = asNormalizedText(stopName);
  const normalizedStopKey = normalizeStopKey(stopKey);
  const normalizedTimeSlice = normalizeTimeSliceOptions(timeSlice || {});

  const matchesFilter = (item) => {
    if (normalizedRegion && item.region !== normalizedRegion) {
      return false;
    }
    if (normalizedRouteNumber && item.routeNumber !== normalizedRouteNumber) {
      return false;
    }
    if (normalizedStopKey) {
      if (item.stopKey) {
        if (item.stopKey !== normalizedStopKey) {
          return false;
        }
      } else if (normalizedStopName && item.stopName !== normalizedStopName) {
        return false;
      }
    } else if (normalizedStopName && item.stopName !== normalizedStopName) {
      return false;
    }
    return true;
  };

  const pending = safeState.pendingObservations.filter(matchesFilter);
  const resolved = safeState.resolvedSamples.filter(matchesFilter);
  const grouped = new Map();
  for (const item of resolved) {
    const current = grouped.get(item.provider) || [];
    current.push(item);
    grouped.set(item.provider, current);
  }

  const providerSummaries = [...grouped.entries()].map(([provider, samples]) => ({
    provider,
    ...summarizeProviderWindowSamples(samples, referenceIso, normalizedTimeSlice),
  }));
  const weekdayWindowEligibleProviders = providerSummaries.filter(
    (item) => item.weekdayTimeSliceSampleCount >= ACCURACY_RECOMMENDATION_POLICY.minSamplesPerProvider,
  );
  const windowEligibleProviders = providerSummaries.filter(
    (item) => item.timeSliceSampleCount >= ACCURACY_RECOMMENDATION_POLICY.minSamplesPerProvider,
  );
  const recommendationScope =
    normalizedTimeSlice.mode === "schedule-window" &&
    normalizedTimeSlice.targetWeekday !== null &&
    weekdayWindowEligibleProviders.length >= ACCURACY_RECOMMENDATION_POLICY.minProvidersForMeasuredRecommendation
      ? "schedule-window-weekday"
      : normalizedTimeSlice.mode === "schedule-window" &&
          windowEligibleProviders.length >= ACCURACY_RECOMMENDATION_POLICY.minProvidersForMeasuredRecommendation
      ? "schedule-window"
      : "all-samples";

  const providers = providerSummaries
    .map((provider) => {
      const useWeekdayTimeSlice = recommendationScope === "schedule-window-weekday";
      const useTimeSlice = recommendationScope === "schedule-window";
      const activeSampleCount = useWeekdayTimeSlice
        ? provider.weekdayTimeSliceSampleCount
        : useTimeSlice
          ? provider.timeSliceSampleCount
          : provider.sampleCount;
      const activeRecentSampleCount = useWeekdayTimeSlice
        ? provider.weekdayTimeSliceRecentSampleCount
        : useTimeSlice
          ? provider.timeSliceRecentSampleCount
          : provider.recentSampleCount;
      const activeMeanAbsoluteErrorMin = useWeekdayTimeSlice
        ? provider.weekdayTimeSliceMeanAbsoluteErrorMin
        : useTimeSlice
          ? provider.timeSliceMeanAbsoluteErrorMin
          : provider.meanAbsoluteErrorMin;
      const activeWeightedMeanAbsoluteErrorMin = useWeekdayTimeSlice
        ? provider.weekdayTimeSliceWeightedMeanAbsoluteErrorMin
        : useTimeSlice
          ? provider.timeSliceWeightedMeanAbsoluteErrorMin
          : provider.weightedMeanAbsoluteErrorMin;
      const activeLatestActualArrivalAt = useWeekdayTimeSlice
        ? provider.weekdayTimeSliceLatestActualArrivalAt || provider.timeSliceLatestActualArrivalAt || provider.latestActualArrivalAt
        : useTimeSlice
          ? provider.timeSliceLatestActualArrivalAt || provider.latestActualArrivalAt
          : provider.latestActualArrivalAt;
      const activeLatestSampleAgeMs = activeLatestActualArrivalAt
        ? calculateSampleAgeMs(activeLatestActualArrivalAt, referenceIso)
        : null;

      return {
        ...provider,
        activeSampleCount,
        activeRecentSampleCount,
        activeMeanAbsoluteErrorMin,
        activeWeightedMeanAbsoluteErrorMin,
        activeLatestActualArrivalAt,
        activeLatestSampleAgeMs,
        activeLatestSampleAgeDays: roundAgeDays(activeLatestSampleAgeMs),
        activeFreshnessState:
          activeRecentSampleCount > 0
            ? "fresh"
            : activeLatestActualArrivalAt
              ? "stale"
              : "none",
        activeScope: recommendationScope,
        meetsRecommendationThreshold: activeSampleCount >= ACCURACY_RECOMMENDATION_POLICY.minSamplesPerProvider,
      };
    })
    .sort((first, second) => {
      const freshnessDelta = Number(second.activeRecentSampleCount > 0) - Number(first.activeRecentSampleCount > 0);
      if (freshnessDelta !== 0) {
        return freshnessDelta;
      }
      if (first.activeWeightedMeanAbsoluteErrorMin === second.activeWeightedMeanAbsoluteErrorMin) {
        if (first.activeRecentSampleCount === second.activeRecentSampleCount) {
          if (first.activeMeanAbsoluteErrorMin === second.activeMeanAbsoluteErrorMin) {
            return second.activeSampleCount - first.activeSampleCount;
          }
          return (first.activeMeanAbsoluteErrorMin ?? Number.POSITIVE_INFINITY) - (second.activeMeanAbsoluteErrorMin ?? Number.POSITIVE_INFINITY);
        }
        return second.activeRecentSampleCount - first.activeRecentSampleCount;
      }
      if (first.activeWeightedMeanAbsoluteErrorMin === null || second.activeWeightedMeanAbsoluteErrorMin === null) {
        return second.activeSampleCount - first.activeSampleCount;
      }
      return first.activeWeightedMeanAbsoluteErrorMin - second.activeWeightedMeanAbsoluteErrorMin;
    });

  const recommendation = buildRecommendationSummary(providers, fallbackOrder, recommendationScope);

  return {
    region: normalizedRegion,
    routeNumber: normalizedRouteNumber,
    stopName: normalizedStopName,
    stopKey: normalizedStopKey,
    sampleCount: resolved.length,
    pendingCount: pending.length,
    providers,
    recommendedProviders: recommendation.recommendedProviders,
    recommendationBasis: recommendation.recommendationBasis,
    recommendationReason: recommendation.recommendationReason,
    recommendationConfidence: recommendation.recommendationConfidence,
    measuredLeaderGapMin: recommendation.measuredLeaderGapMin,
    measuredEligibleProviders: recommendation.measuredEligibleProviders,
    freshMeasuredEligibleProviders: recommendation.freshMeasuredEligibleProviders || [],
    staleMeasuredEligibleProviders: recommendation.staleMeasuredEligibleProviders || [],
    recommendationMetric: recommendation.recommendationMetric || "weighted-recent-mae",
    recommendationScope: recommendation.recommendationScope || recommendationScope,
    recommendationPolicy: recommendation.recommendationPolicy,
    freshnessPolicy: recommendation.freshnessPolicy,
    timeSlice: {
      mode: normalizedTimeSlice.mode,
      key: normalizedTimeSlice.key,
      label: normalizedTimeSlice.label,
      startTime: normalizedTimeSlice.startTime,
      endTime: normalizedTimeSlice.endTime,
      timeZone: normalizedTimeSlice.timeZone,
      targetWeekday: normalizedTimeSlice.targetWeekday,
      weekdayLabel: normalizedTimeSlice.weekdayLabel,
      usedForRecommendation:
        recommendationScope === "schedule-window" || recommendationScope === "schedule-window-weekday",
      usedWeekdayForRecommendation: recommendationScope === "schedule-window-weekday",
      eligibleProviderCount: windowEligibleProviders.length,
      weekdayEligibleProviderCount: weekdayWindowEligibleProviders.length,
    },
    lastActualArrivalAt: resolved[0]?.actualArrivalAt || null,
    updatedAt: safeState.updatedAt,
  };
}

export function buildBusAccuracyLeaderboard(
  state,
  {
    region = "",
    limit = 8,
    fallbackOrderResolver = () => [],
    timeSlice = null,
  } = {},
) {
  const safeState = normalizeBusAccuracyState(state);
  const normalizedRegion = asNormalizedText(region);
  const routeMap = new Map();

  for (const item of safeState.resolvedSamples) {
    if (normalizedRegion && item.region !== normalizedRegion) {
      continue;
    }

    if (!routeMap.has(item.routeKey)) {
      routeMap.set(item.routeKey, {
        region: item.region,
        routeNumber: item.routeNumber,
        stopName: item.stopName,
        stopKey: item.stopKey || "",
      });
    }
  }

  const entries = [...routeMap.values()]
    .map((route) => {
      const summary = buildBusAccuracySnapshot(safeState, {
        region: route.region,
        routeNumber: route.routeNumber,
        stopName: route.stopName,
        stopKey: route.stopKey,
        fallbackOrder: fallbackOrderResolver(route.region),
        timeSlice,
      });

      return {
        routeKey: asRouteKey(route),
        region: route.region,
        routeNumber: route.routeNumber,
        stopName: route.stopName,
        stopKey: route.stopKey || "",
        recommendedProvider: summary.recommendedProviders[0] || "",
        recommendationBasis: summary.recommendationBasis,
        recommendationReason: summary.recommendationReason,
        recommendationConfidence: summary.recommendationConfidence,
        recommendationMetric: summary.recommendationMetric,
        recommendationScope: summary.recommendationScope,
        measuredLeaderGapMin: summary.measuredLeaderGapMin,
        sampleCount: summary.sampleCount,
        pendingCount: summary.pendingCount,
        recentSampleCount: summary.providers.reduce((sum, provider) => sum + provider.recentSampleCount, 0),
        activeRecentSampleCount: summary.providers.reduce((sum, provider) => sum + provider.activeRecentSampleCount, 0),
        timeSlice: summary.timeSlice,
        lastActualArrivalAt: summary.lastActualArrivalAt,
        providers: summary.providers,
      };
    })
    .sort((first, second) => {
      if (first.recommendationBasis !== second.recommendationBasis) {
        return first.recommendationBasis === "measured-accuracy" ? -1 : 1;
      }

      const confidenceDelta = toConfidenceRank(second.recommendationConfidence) - toConfidenceRank(first.recommendationConfidence);
      if (confidenceDelta !== 0) {
        return confidenceDelta;
      }

      if (first.activeRecentSampleCount !== second.activeRecentSampleCount) {
        return second.activeRecentSampleCount - first.activeRecentSampleCount;
      }

      if (first.sampleCount !== second.sampleCount) {
        return second.sampleCount - first.sampleCount;
      }

      return new Date(second.lastActualArrivalAt || 0).getTime() - new Date(first.lastActualArrivalAt || 0).getTime();
    });

  return {
    region: normalizedRegion,
    totalRoutes: entries.length,
    entries: entries.slice(0, Math.max(1, Number(limit) || 8)),
    generatedAt: safeState.updatedAt,
    timeSlice: entries[0]?.timeSlice || normalizeTimeSliceOptions(timeSlice || {}),
  };
}

export const LIVE_ETA_GUARD_THRESHOLDS = {
  minComparableProviderCount: 2,
  watchSpreadMin: 1,
  divergedSpreadMin: 3,
  conservativeBufferMin: 1,
  conservativeBufferStepSpreadMin: 2,
  conservativeBufferMaxMin: 3,
};

function deriveConservativeBufferMin(spreadMin) {
  const safeSpread = Number.isFinite(Number(spreadMin)) ? Number(spreadMin) : null;
  if (safeSpread === null || safeSpread < LIVE_ETA_GUARD_THRESHOLDS.divergedSpreadMin) {
    return 0;
  }

  const extraSpread = Math.max(0, safeSpread - LIVE_ETA_GUARD_THRESHOLDS.divergedSpreadMin);
  const extraSteps = Math.floor(extraSpread / LIVE_ETA_GUARD_THRESHOLDS.conservativeBufferStepSpreadMin);
  return Math.min(
    LIVE_ETA_GUARD_THRESHOLDS.conservativeBufferMaxMin,
    LIVE_ETA_GUARD_THRESHOLDS.conservativeBufferMin + extraSteps,
  );
}

export function buildLiveEtaGuard({
  disagreementLevel = "",
  spreadMin = null,
  comparableProviderCount = 0,
  historicalBiasLevel = "",
} = {}) {
  const level = String(disagreementLevel || "").trim().toLowerCase();
  const comparableCount = Math.max(0, Number(comparableProviderCount) || 0);
  const safeSpread = Number.isFinite(Number(spreadMin)) ? Math.round(Number(spreadMin) * 10) / 10 : null;
  const hasComparableProviders = comparableCount >= LIVE_ETA_GUARD_THRESHOLDS.minComparableProviderCount;
  const biasLevel = String(historicalBiasLevel || "").trim().toLowerCase();

  if (!hasComparableProviders) {
    return {
      mode: "insufficient",
      hasComparableProviders: false,
      spreadMin: safeSpread,
      historicalBiasLevel: biasLevel || "none",
      shouldWarnDeparture: false,
      shouldHoldProviderSwitch: false,
      shouldTightenProbe: false,
      recommendedLeaveBufferMin: 0,
      recommendedRiskBufferMin: 0,
      bannerTone: "neutral",
      reasonCode: "insufficient-providers",
    };
  }

  if (level === "diverged" && safeSpread !== null && safeSpread >= LIVE_ETA_GUARD_THRESHOLDS.divergedSpreadMin) {
    const conservativeBufferMin = deriveConservativeBufferMin(safeSpread);
    return {
      mode: "conservative",
      hasComparableProviders: true,
      spreadMin: safeSpread,
      historicalBiasLevel: biasLevel || "none",
      shouldWarnDeparture: true,
      shouldHoldProviderSwitch: true,
      shouldTightenProbe: true,
      recommendedLeaveBufferMin: conservativeBufferMin,
      recommendedRiskBufferMin: conservativeBufferMin,
      bannerTone: "critical",
      reasonCode: "eta-diverged",
    };
  }

  if (
    level === "watch" &&
    safeSpread !== null &&
    safeSpread >= LIVE_ETA_GUARD_THRESHOLDS.watchSpreadMin &&
    biasLevel === "high"
  ) {
    return {
      mode: "conservative",
      hasComparableProviders: true,
      spreadMin: safeSpread,
      historicalBiasLevel: biasLevel,
      shouldWarnDeparture: true,
      shouldHoldProviderSwitch: true,
      shouldTightenProbe: true,
      recommendedLeaveBufferMin: 1,
      recommendedRiskBufferMin: 1,
      bannerTone: "critical",
      reasonCode: "eta-watch-history-high",
    };
  }

  if (level === "watch" && safeSpread !== null && safeSpread >= LIVE_ETA_GUARD_THRESHOLDS.watchSpreadMin) {
    return {
      mode: "watch",
      hasComparableProviders: true,
      spreadMin: safeSpread,
      historicalBiasLevel: biasLevel || "none",
      shouldWarnDeparture: true,
      shouldHoldProviderSwitch: biasLevel === "elevated",
      shouldTightenProbe: true,
      recommendedLeaveBufferMin: 0,
      recommendedRiskBufferMin: 0,
      bannerTone: "watch",
      reasonCode: biasLevel === "elevated" ? "eta-watch-history-elevated" : "eta-watch",
    };
  }

  if (level === "aligned") {
    return {
      mode: "aligned",
      hasComparableProviders: true,
      spreadMin: safeSpread,
      historicalBiasLevel: biasLevel || "none",
      shouldWarnDeparture: false,
      shouldHoldProviderSwitch: false,
      shouldTightenProbe: false,
      recommendedLeaveBufferMin: 0,
      recommendedRiskBufferMin: 0,
      bannerTone: "stable",
      reasonCode: "eta-aligned",
    };
  }

  return {
    mode: "unknown",
    hasComparableProviders,
    spreadMin: safeSpread,
    historicalBiasLevel: biasLevel || "none",
    shouldWarnDeparture: false,
    shouldHoldProviderSwitch: false,
    shouldTightenProbe: false,
    recommendedLeaveBufferMin: 0,
    recommendedRiskBufferMin: 0,
    bannerTone: "neutral",
    reasonCode: "eta-unknown",
  };
}

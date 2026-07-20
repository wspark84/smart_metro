import test from "node:test";
import assert from "node:assert/strict";

import { buildLiveEtaGuard, LIVE_ETA_GUARD_THRESHOLDS } from "../src/logic/live-eta-guard.js";

test("buildLiveEtaGuard enters conservative mode when live ETA spread is sharply diverged", () => {
  const guard = buildLiveEtaGuard({
    disagreementLevel: "diverged",
    spreadMin: 5,
    comparableProviderCount: 2,
  });

  assert.equal(guard.mode, "conservative");
  assert.equal(guard.shouldWarnDeparture, true);
  assert.equal(guard.shouldHoldProviderSwitch, true);
  assert.equal(guard.shouldTightenProbe, true);
  assert.equal(guard.recommendedLeaveBufferMin, 2);
  assert.equal(guard.recommendedRiskBufferMin, 2);
});

test("buildLiveEtaGuard enters watch mode when providers are only mildly split", () => {
  const guard = buildLiveEtaGuard({
    disagreementLevel: "watch",
    spreadMin: 2,
    comparableProviderCount: 2,
  });

  assert.equal(guard.mode, "watch");
  assert.equal(guard.shouldWarnDeparture, true);
  assert.equal(guard.shouldHoldProviderSwitch, false);
  assert.equal(guard.shouldTightenProbe, true);
  assert.equal(guard.recommendedLeaveBufferMin, 0);
  assert.equal(guard.recommendedRiskBufferMin, 0);
});

test("buildLiveEtaGuard upgrades a mild split to conservative mode when the route has a high recent instability history", () => {
  const guard = buildLiveEtaGuard({
    disagreementLevel: "watch",
    spreadMin: 2,
    comparableProviderCount: 2,
    historicalBiasLevel: "high",
  });

  assert.equal(guard.mode, "conservative");
  assert.equal(guard.shouldWarnDeparture, true);
  assert.equal(guard.shouldHoldProviderSwitch, true);
  assert.equal(guard.shouldTightenProbe, true);
  assert.equal(guard.recommendedLeaveBufferMin, 1);
  assert.equal(guard.recommendedRiskBufferMin, 1);
  assert.equal(guard.reasonCode, "eta-watch-history-high");
});

test("buildLiveEtaGuard holds provider switching during a mild split when the recent history is elevated", () => {
  const guard = buildLiveEtaGuard({
    disagreementLevel: "watch",
    spreadMin: 2,
    comparableProviderCount: 2,
    historicalBiasLevel: "elevated",
  });

  assert.equal(guard.mode, "watch");
  assert.equal(guard.shouldWarnDeparture, true);
  assert.equal(guard.shouldHoldProviderSwitch, true);
  assert.equal(guard.shouldTightenProbe, true);
  assert.equal(guard.recommendedRiskBufferMin, 0);
  assert.equal(guard.reasonCode, "eta-watch-history-elevated");
});

test("buildLiveEtaGuard stays neutral when there are not enough comparable providers", () => {
  const guard = buildLiveEtaGuard({
    disagreementLevel: "diverged",
    spreadMin: 8,
    comparableProviderCount: 1,
  });

  assert.equal(guard.mode, "insufficient");
  assert.equal(guard.shouldWarnDeparture, false);
  assert.equal(guard.shouldHoldProviderSwitch, false);
  assert.equal(guard.shouldTightenProbe, false);
  assert.equal(guard.recommendedRiskBufferMin, 0);
});

test("buildLiveEtaGuard caps the conservative buffer even when providers are far apart", () => {
  const guard = buildLiveEtaGuard({
    disagreementLevel: "diverged",
    spreadMin: 9,
    comparableProviderCount: 3,
  });

  assert.equal(guard.mode, "conservative");
  assert.equal(guard.recommendedLeaveBufferMin, LIVE_ETA_GUARD_THRESHOLDS.conservativeBufferMaxMin);
  assert.equal(guard.recommendedRiskBufferMin, LIVE_ETA_GUARD_THRESHOLDS.conservativeBufferMaxMin);
});

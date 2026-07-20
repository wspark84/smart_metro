import test from "node:test";
import assert from "node:assert/strict";

import {
  buildConservativeProbeBias,
  buildConservativeReliabilityReport,
  buildConservativeWatchlistHighlight,
} from "../src/logic/conservative-report.js";

test("buildConservativeReliabilityReport returns an empty summary when no conservative traces exist", () => {
  const report = buildConservativeReliabilityReport({
    events: [{ title: "Normal event", accuracyRiskBufferMin: 0 }],
    dispatchBundles: [],
    dispatchExecutions: [],
    pushGatewayAttempts: [],
    retryQueue: [],
  });

  assert.equal(report.totalSignals, 0);
  assert.equal(report.distinctRouteStopCount, 0);
  assert.equal(report.maxRiskBufferMin, 0);
  assert.equal(report.averageRiskBufferMin, 0);
  assert.equal(report.latestSignal, null);
  assert.deepEqual(report.routeStopLeaders, []);
});

test("buildConservativeReliabilityReport aggregates recent conservative traces across the pipeline", () => {
  const report = buildConservativeReliabilityReport({
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
    },
    events: [
      {
        title: "Alarm fired",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-17T07:01:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 2,
        accuracySpreadMin: 5,
      },
    ],
    dispatchBundles: [
      {
        title: "Dispatch bundle",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-17T07:01:05+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 2,
        accuracySpreadMin: 5,
      },
    ],
    dispatchExecutions: [
      {
        title: "Dispatch execution",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        executedAt: "2026-05-17T07:01:07+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 2,
        accuracySpreadMin: 5,
      },
    ],
    pushGatewayAttempts: [
      {
        title: "Push gateway attempt",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-17T07:01:09+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 3,
        accuracySpreadMin: 7,
      },
    ],
    retryQueue: [
      {
        title: "Retry item",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        scheduledAt: "2026-05-17T07:01:20+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 3,
        accuracySpreadMin: 7,
      },
      {
        title: "Second route retry",
        routeNumber: "700",
        stopName: "City Hall",
        scheduledAt: "2026-05-17T07:02:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 1,
        accuracySpreadMin: 3,
      },
    ],
  });

  assert.equal(report.totalSignals, 6);
  assert.equal(report.distinctRouteStopCount, 2);
  assert.equal(report.maxRiskBufferMin, 3);
  assert.equal(report.averageRiskBufferMin, 2.2);
  assert.equal(report.averageSpreadMin, 5.3);
  assert.equal(report.latestSignal.source, "retry_queue");
  assert.equal(report.latestSignal.routeNumber, "700");
  assert.equal(report.deepestTrace.routeNumber, "1002");
  assert.equal(report.deepestTrace.sourceCount, 5);
  assert.deepEqual(
    report.sourceBreakdown.map((item) => [item.source, item.count]),
    [
      ["retry_queue", 2],
      ["dispatch_bundle", 1],
      ["dispatch_execution", 1],
      ["push_attempt", 1],
      ["server_event", 1],
    ],
  );
  assert.equal(report.routeStopLeaders[0].routeNumber, "1002");
  assert.equal(report.routeStopLeaders[0].count, 5);
  assert.equal(report.routeStopLeaders[0].averageRiskBufferMin, 2.4);
  assert.equal(report.routeStopLeaders[0].averageSpreadMin, 5.8);
  assert.equal(report.weekdayWindow.windowLabel, "07:00 - 07:45");
  assert.equal(report.weekdayWindow.inWindowCount, 6);
  assert.equal(report.weekdayWindow.outOfWindowCount, 0);
  assert.equal(report.weekdayWindow.topWeekday.weekdayLabel, "Sun");
});

test("buildConservativeReliabilityReport separates alarm-window traces from outside-window traces by weekday", () => {
  const report = buildConservativeReliabilityReport({
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
    },
    events: [
      {
        title: "Mon in window",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-18T07:10:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 2,
        accuracySpreadMin: 5,
      },
      {
        title: "Mon outside window",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-18T08:10:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 1,
        accuracySpreadMin: 3,
      },
      {
        title: "Tue in window",
        routeNumber: "700",
        stopName: "City Hall",
        createdAt: "2026-05-19T07:20:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 3,
        accuracySpreadMin: 6,
      },
    ],
  });

  assert.equal(report.totalSignals, 3);
  assert.equal(report.weekdayWindow.inWindowCount, 2);
  assert.equal(report.weekdayWindow.outOfWindowCount, 1);
  assert.equal(report.weekdayWindow.topWeekday.weekdayLabel, "Mon");
  assert.deepEqual(
    report.weekdayWindow.rows.map((item) => [item.weekdayLabel, item.inWindowCount, item.outOfWindowCount]),
    [
      ["Mon", 1, 1],
      ["Tue", 1, 0],
    ],
  );
});

test("buildConservativeReliabilityReport ignores conservative traces older than the rolling window", () => {
  const report = buildConservativeReliabilityReport({
    now: "2026-05-17T09:00:00+09:00",
    days: 7,
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
    },
    events: [
      {
        title: "Fresh trace",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-16T07:10:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 2,
        accuracySpreadMin: 5,
      },
      {
        title: "Old trace",
        routeNumber: "700",
        stopName: "City Hall",
        createdAt: "2026-05-05T07:10:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 3,
        accuracySpreadMin: 7,
      },
    ],
  });

  assert.equal(report.rollingDays, 7);
  assert.equal(report.totalSignals, 1);
  assert.equal(report.distinctRouteStopCount, 1);
  assert.equal(report.latestSignal.routeNumber, "1002");
  assert.equal(report.routeStopLeaders[0].routeNumber, "1002");
});

test("buildConservativeReliabilityReport builds a structural watchlist for repeated route-stop instability", () => {
  const report = buildConservativeReliabilityReport({
    now: "2026-05-18T09:00:00+09:00",
    days: 7,
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
    },
    events: [
      {
        title: "A1",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-18T07:05:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 2,
        accuracySpreadMin: 5,
      },
      {
        title: "A2",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-17T07:12:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 3,
        accuracySpreadMin: 6,
      },
      {
        title: "A3",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-16T07:18:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 2,
        accuracySpreadMin: 4,
      },
      {
        title: "A4",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-15T07:22:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 3,
        accuracySpreadMin: 7,
      },
      {
        title: "B1",
        routeNumber: "700",
        stopName: "City Hall",
        createdAt: "2026-05-18T07:25:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 1,
        accuracySpreadMin: 3,
      },
      {
        title: "B2",
        routeNumber: "700",
        stopName: "City Hall",
        createdAt: "2026-05-17T07:35:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 1,
        accuracySpreadMin: 2,
      },
    ],
  });

  assert.equal(report.watchlist.totalEntries, 2);
  assert.equal(report.watchlist.highCount, 1);
  assert.equal(report.watchlist.elevatedCount, 1);
  assert.equal(report.watchlist.topEntry.routeNumber, "1002");
  assert.equal(report.watchlist.topEntry.severityLevel, "high");
  assert.equal(report.watchlist.entries[1].routeNumber, "700");
  assert.equal(report.watchlist.entries[1].severityLevel, "elevated");
});

test("buildConservativeProbeBias marks a route-stop as high risk when the same pair keeps entering conservative mode", () => {
  const report = buildConservativeReliabilityReport({
    now: "2026-05-18T09:00:00+09:00",
    days: 7,
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
    },
    events: [
      {
        title: "Trace 1",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-18T07:05:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 2,
      },
      {
        title: "Trace 2",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-17T07:10:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 2,
      },
      {
        title: "Trace 3",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-16T07:15:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 3,
      },
      {
        title: "Trace 4",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-15T07:20:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 3,
      },
    ],
  });

  const bias = buildConservativeProbeBias(report, {
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    now: "2026-05-18T07:30:00+09:00",
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
    },
  });

  assert.equal(bias.shouldTighten, true);
  assert.equal(bias.level, "high");
  assert.equal(bias.reasonCode, "route-stop-history-high");
  assert.equal(bias.routeSignalCount, 4);
});

test("buildConservativeProbeBias marks a weekday window as elevated even when route-specific history is still light", () => {
  const report = buildConservativeReliabilityReport({
    now: "2026-05-18T09:00:00+09:00",
    days: 7,
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
    },
    events: [
      {
        title: "Sunday route A",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-17T07:05:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 2,
      },
      {
        title: "Sunday route B",
        routeNumber: "700",
        stopName: "City Hall",
        createdAt: "2026-05-17T07:25:00+09:00",
        liveEtaGuardMode: "conservative",
        accuracyRiskBufferMin: 1,
      },
    ],
  });

  const bias = buildConservativeProbeBias(report, {
    routeNumber: "500",
    stopName: "Jongno",
    now: "2026-05-17T07:30:00+09:00",
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
    },
  });

  assert.equal(bias.shouldTighten, true);
  assert.equal(bias.level, "elevated");
  assert.equal(bias.reasonCode, "weekday-window-history-elevated");
  assert.equal(bias.routeSignalCount, 0);
  assert.equal(bias.weekdayInWindowCount, 2);
});

test("buildConservativeWatchlistHighlight prefers the current route-stop pair when it is on the watchlist", () => {
  const report = buildConservativeReliabilityReport({
    now: "2026-05-18T09:00:00+09:00",
    days: 7,
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
    },
    events: [
      {
        title: "A1",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-18T07:05:00+09:00",
        accuracyRiskBufferMin: 2,
      },
      {
        title: "A2",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-17T07:12:00+09:00",
        accuracyRiskBufferMin: 3,
      },
      {
        title: "B1",
        routeNumber: "700",
        stopName: "City Hall",
        createdAt: "2026-05-18T07:25:00+09:00",
        accuracyRiskBufferMin: 1,
      },
      {
        title: "B2",
        routeNumber: "700",
        stopName: "City Hall",
        createdAt: "2026-05-17T07:35:00+09:00",
        accuracyRiskBufferMin: 1,
      },
    ],
  });

  const highlight = buildConservativeWatchlistHighlight(report, {
    routeNumber: "700",
    stopName: "City Hall",
  });

  assert.equal(highlight.isCurrentRouteHighlighted, true);
  assert.equal(highlight.currentEntry.routeNumber, "700");
  assert.equal(highlight.highlightEntry.routeNumber, "700");
});

test("buildConservativeWatchlistHighlight falls back to the top watchlist route when the current pair is not listed", () => {
  const report = buildConservativeReliabilityReport({
    now: "2026-05-18T09:00:00+09:00",
    days: 7,
    schedule: {
      startTime: "07:00",
      endTime: "07:45",
    },
    events: [
      {
        title: "A1",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-18T07:05:00+09:00",
        accuracyRiskBufferMin: 2,
      },
      {
        title: "A2",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-17T07:12:00+09:00",
        accuracyRiskBufferMin: 3,
      },
      {
        title: "A3",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-16T07:18:00+09:00",
        accuracyRiskBufferMin: 2,
      },
      {
        title: "A4",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-05-15T07:22:00+09:00",
        accuracyRiskBufferMin: 3,
      },
    ],
  });

  const highlight = buildConservativeWatchlistHighlight(report, {
    routeNumber: "500",
    stopName: "Jongno",
  });

  assert.equal(highlight.isCurrentRouteHighlighted, false);
  assert.equal(highlight.currentEntry, null);
  assert.equal(highlight.topEntry.routeNumber, "1002");
  assert.equal(highlight.highlightEntry.routeNumber, "1002");
});

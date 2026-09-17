const SOURCE_LABELS = {
  server_event: "서버 기록",
  dispatch_bundle: "알림 전송 묶음",
  dispatch_execution: "알림 전송 처리",
  push_attempt: "푸시 전송",
  retry_queue: "재시도 대기열",
};
const WEEKDAY_LABELS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveDateValue(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseTimeTextToMinutes(timeText) {
  const parts = String(timeText || "")
    .split(":")
    .map((value) => Number(value));
  const [hours, minutes] = parts;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  return Math.max(0, Math.min(23 * 60 + 59, hours * 60 + minutes));
}

function getWindowMinutes(schedule = {}) {
  const startMinutes = parseTimeTextToMinutes(schedule.startTime);
  const endMinutes = parseTimeTextToMinutes(schedule.endTime);
  if (startMinutes === null || endMinutes === null || endMinutes < startMinutes) {
    return null;
  }
  return {
    startMinutes,
    endMinutes,
    label: `${schedule.startTime} - ${schedule.endTime}`,
  };
}

function classifySignalTime(createdAt, schedule = {}) {
  if (!createdAt) {
    return {
      weekdayIndex: null,
      weekdayLabel: "",
      minuteOfDay: null,
      insideScheduleWindow: false,
      scheduleWindowLabel: "",
    };
  }

  const date = new Date(createdAt);
  const minuteOfDay = date.getHours() * 60 + date.getMinutes();
  const window = getWindowMinutes(schedule);
  return {
    weekdayIndex: date.getDay(),
    weekdayLabel: WEEKDAY_LABELS[date.getDay()] || "",
    minuteOfDay,
    insideScheduleWindow: Boolean(window && minuteOfDay >= window.startMinutes && minuteOfDay <= window.endMinutes),
    scheduleWindowLabel: window?.label || "",
  };
}

function normalizeSignal({
  source = "",
  routeNumber = "",
  stopName = "",
  title = "",
  createdAt = "",
  liveEtaGuardMode = "",
  accuracyRiskBufferMin = 0,
  accuracySpreadMin = null,
} = {}) {
  const riskBufferMin = Math.max(0, normalizeNumber(accuracyRiskBufferMin, 0));
  if (!riskBufferMin) {
    return null;
  }

  const safeCreatedAt = createdAt ? new Date(createdAt).toISOString() : null;
  const timeMeta = classifySignalTime(safeCreatedAt);
  return {
    source,
    sourceLabel: SOURCE_LABELS[source] || "처리 기록",
    routeNumber: String(routeNumber || "").trim(),
    stopName: String(stopName || "").trim(),
    title: String(title || "").trim(),
    createdAt: safeCreatedAt,
    liveEtaGuardMode: String(liveEtaGuardMode || "").trim(),
    accuracyRiskBufferMin: riskBufferMin,
    accuracySpreadMin: normalizeNumber(accuracySpreadMin, null),
    weekdayIndex: timeMeta.weekdayIndex,
    weekdayLabel: timeMeta.weekdayLabel,
    minuteOfDay: timeMeta.minuteOfDay,
  };
}

function buildRouteStopKey(signal) {
  const routePart = signal.routeNumber || "unknown-route";
  const stopPart = signal.stopName || "unknown-stop";
  return `${routePart}::${stopPart}`;
}

function buildSignals(input = {}) {
  const events = Array.isArray(input.events) ? input.events : [];
  const dispatchBundles = Array.isArray(input.dispatchBundles) ? input.dispatchBundles : [];
  const dispatchExecutions = Array.isArray(input.dispatchExecutions) ? input.dispatchExecutions : [];
  const pushGatewayAttempts = Array.isArray(input.pushGatewayAttempts) ? input.pushGatewayAttempts : [];
  const retryQueue = Array.isArray(input.retryQueue) ? input.retryQueue : [];

  return [
    ...events.map((item) =>
      normalizeSignal({
        source: "server_event",
        routeNumber: item.routeNumber,
        stopName: item.stopName,
        title: item.title || item.kind,
        createdAt: item.createdAt,
        liveEtaGuardMode: item.liveEtaGuardMode,
        accuracyRiskBufferMin: item.accuracyRiskBufferMin,
        accuracySpreadMin: item.accuracySpreadMin,
      }),
    ),
    ...dispatchBundles.map((item) =>
      normalizeSignal({
        source: "dispatch_bundle",
        routeNumber: item.routeNumber,
        stopName: item.stopName,
        title: item.title,
        createdAt: item.createdAt,
        liveEtaGuardMode: item.liveEtaGuardMode,
        accuracyRiskBufferMin: item.accuracyRiskBufferMin,
        accuracySpreadMin: item.accuracySpreadMin,
      }),
    ),
    ...dispatchExecutions.map((item) =>
      normalizeSignal({
        source: "dispatch_execution",
        routeNumber: item.routeNumber,
        stopName: item.stopName,
        title: item.title,
        createdAt: item.executedAt || item.createdAt,
        liveEtaGuardMode: item.liveEtaGuardMode,
        accuracyRiskBufferMin: item.accuracyRiskBufferMin,
        accuracySpreadMin: item.accuracySpreadMin,
      }),
    ),
    ...pushGatewayAttempts.map((item) =>
      normalizeSignal({
        source: "push_attempt",
        routeNumber: item.routeNumber,
        stopName: item.stopName,
        title: item.title,
        createdAt: item.createdAt,
        liveEtaGuardMode: item.liveEtaGuardMode,
        accuracyRiskBufferMin: item.accuracyRiskBufferMin,
        accuracySpreadMin: item.accuracySpreadMin,
      }),
    ),
    ...retryQueue.map((item) =>
      normalizeSignal({
        source: "retry_queue",
        routeNumber: item.routeNumber,
        stopName: item.stopName,
        title: item.title,
        createdAt: item.scheduledAt || item.createdAt,
        liveEtaGuardMode: item.liveEtaGuardMode,
        accuracyRiskBufferMin: item.accuracyRiskBufferMin,
        accuracySpreadMin: item.accuracySpreadMin,
      }),
    ),
  ]
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      return rightTime - leftTime;
    });
}

function filterSignalsByRollingWindow(signals, { now = new Date(), days = 0 } = {}) {
  const safeDays = Math.max(0, Number(days) || 0);
  const safeNow = resolveDateValue(now) || new Date();
  if (!safeDays) {
    return {
      signals,
      days: safeDays,
      windowStartAt: null,
      windowEndAt: safeNow.toISOString(),
    };
  }

  const windowStart = new Date(safeNow.getTime() - safeDays * 24 * 60 * 60 * 1000);
  const filteredSignals = signals.filter((signal) => {
    const createdAt = resolveDateValue(signal.createdAt);
    return createdAt && createdAt.getTime() >= windowStart.getTime() && createdAt.getTime() <= safeNow.getTime();
  });

  return {
    signals: filteredSignals,
    days: safeDays,
    windowStartAt: windowStart.toISOString(),
    windowEndAt: safeNow.toISOString(),
  };
}

function summarizeRouteStopSignals(signals) {
  const routeStopMap = new Map();

  for (const signal of signals) {
    const key = buildRouteStopKey(signal);
    const current = routeStopMap.get(key) || {
      routeNumber: signal.routeNumber,
      stopName: signal.stopName,
      count: 0,
      totalRiskBufferMin: 0,
      totalSpreadMin: 0,
      spreadCount: 0,
      maxRiskBufferMin: 0,
      latestAt: null,
      latestSource: "",
      sources: new Set(),
    };

    current.count += 1;
    current.totalRiskBufferMin += signal.accuracyRiskBufferMin;
    current.maxRiskBufferMin = Math.max(current.maxRiskBufferMin, signal.accuracyRiskBufferMin);
    if (signal.accuracySpreadMin !== null) {
      current.totalSpreadMin += signal.accuracySpreadMin;
      current.spreadCount += 1;
    }
    current.sources.add(signal.sourceLabel);

    if (!current.latestAt || (signal.createdAt && new Date(signal.createdAt).getTime() > new Date(current.latestAt).getTime())) {
      current.latestAt = signal.createdAt;
      current.latestSource = signal.sourceLabel;
    }

    routeStopMap.set(key, current);
  }

  return Array.from(routeStopMap.values())
    .map((entry) => ({
      routeNumber: entry.routeNumber,
      stopName: entry.stopName,
      count: entry.count,
      averageRiskBufferMin: Math.round((entry.totalRiskBufferMin / entry.count) * 10) / 10,
      maxRiskBufferMin: entry.maxRiskBufferMin,
      averageSpreadMin: entry.spreadCount ? Math.round((entry.totalSpreadMin / entry.spreadCount) * 10) / 10 : null,
      latestAt: entry.latestAt,
      latestSource: entry.latestSource,
      sourceCount: entry.sources.size,
      sourceLabels: Array.from(entry.sources).sort(),
    }))
    .sort((left, right) => {
      if (right.sourceCount !== left.sourceCount) {
        return right.sourceCount - left.sourceCount;
      }
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      const leftTime = left.latestAt ? new Date(left.latestAt).getTime() : 0;
      const rightTime = right.latestAt ? new Date(right.latestAt).getTime() : 0;
      return rightTime - leftTime;
    });
}

function summarizeWeekdayWindowSignals(signals, schedule = {}) {
  const window = getWindowMinutes(schedule);
  const weekdayMap = new Map();

  for (const signal of signals) {
    const timeMeta = classifySignalTime(signal.createdAt, schedule);
    const weekdayKey = timeMeta.weekdayLabel || "Unknown";
    const current = weekdayMap.get(weekdayKey) || {
      weekdayLabel: weekdayKey,
      totalCount: 0,
      inWindowCount: 0,
      totalRiskBufferMin: 0,
      totalSpreadMin: 0,
      spreadCount: 0,
      latestAt: null,
    };

    current.totalCount += 1;
    current.totalRiskBufferMin += signal.accuracyRiskBufferMin;
    if (signal.accuracySpreadMin !== null) {
      current.totalSpreadMin += signal.accuracySpreadMin;
      current.spreadCount += 1;
    }
    if (timeMeta.insideScheduleWindow) {
      current.inWindowCount += 1;
    }
    if (!current.latestAt || (signal.createdAt && new Date(signal.createdAt).getTime() > new Date(current.latestAt).getTime())) {
      current.latestAt = signal.createdAt;
    }

    weekdayMap.set(weekdayKey, current);
  }

  const rows = Array.from(weekdayMap.values())
    .map((entry) => ({
      weekdayLabel: entry.weekdayLabel,
      totalCount: entry.totalCount,
      inWindowCount: entry.inWindowCount,
      outOfWindowCount: entry.totalCount - entry.inWindowCount,
      averageRiskBufferMin: Math.round((entry.totalRiskBufferMin / entry.totalCount) * 10) / 10,
      averageSpreadMin: entry.spreadCount ? Math.round((entry.totalSpreadMin / entry.spreadCount) * 10) / 10 : null,
      latestAt: entry.latestAt,
    }))
    .sort((left, right) => {
      if (right.inWindowCount !== left.inWindowCount) {
        return right.inWindowCount - left.inWindowCount;
      }
      if (right.totalCount !== left.totalCount) {
        return right.totalCount - left.totalCount;
      }
      return String(left.weekdayLabel).localeCompare(String(right.weekdayLabel));
    });

  return {
    windowLabel: window?.label || "",
    inWindowCount: signals.filter((signal) => classifySignalTime(signal.createdAt, schedule).insideScheduleWindow).length,
    outOfWindowCount: signals.filter((signal) => !classifySignalTime(signal.createdAt, schedule).insideScheduleWindow).length,
    topWeekday: rows[0] || null,
    rows,
  };
}

function classifyWatchlistEntry({ count = 0, inWindowCount = 0 } = {}) {
  const safeCount = Math.max(0, Number(count) || 0);
  const safeInWindowCount = Math.max(0, Number(inWindowCount) || 0);

  if (safeCount >= 4 || safeInWindowCount >= 3) {
    return {
      level: "high",
      reasonCode: safeCount >= 4 ? "route-stop-history-high" : "alarm-window-history-high",
      label: "HIGH",
    };
  }

  if (safeCount >= 2 || safeInWindowCount >= 2) {
    return {
      level: "elevated",
      reasonCode: safeCount >= 2 ? "route-stop-history-elevated" : "alarm-window-history-elevated",
      label: "ELEVATED",
    };
  }

  return {
    level: "watch",
    reasonCode: "recent-watch",
    label: "WATCH",
  };
}

function summarizeConservativeWatchlist(signals, schedule = {}) {
  const watchMap = new Map();

  for (const signal of signals) {
    const key = buildRouteStopKey(signal);
    const timeMeta = classifySignalTime(signal.createdAt, schedule);
    const current = watchMap.get(key) || {
      routeNumber: signal.routeNumber,
      stopName: signal.stopName,
      count: 0,
      inWindowCount: 0,
      outOfWindowCount: 0,
      totalRiskBufferMin: 0,
      totalSpreadMin: 0,
      spreadCount: 0,
      maxRiskBufferMin: 0,
      latestAt: null,
      sourceLabels: new Set(),
    };

    current.count += 1;
    current.inWindowCount += timeMeta.insideScheduleWindow ? 1 : 0;
    current.outOfWindowCount += timeMeta.insideScheduleWindow ? 0 : 1;
    current.totalRiskBufferMin += signal.accuracyRiskBufferMin;
    current.maxRiskBufferMin = Math.max(current.maxRiskBufferMin, signal.accuracyRiskBufferMin);
    if (signal.accuracySpreadMin !== null) {
      current.totalSpreadMin += signal.accuracySpreadMin;
      current.spreadCount += 1;
    }
    current.sourceLabels.add(signal.sourceLabel);

    if (!current.latestAt || (signal.createdAt && new Date(signal.createdAt).getTime() > new Date(current.latestAt).getTime())) {
      current.latestAt = signal.createdAt;
    }

    watchMap.set(key, current);
  }

  const entries = Array.from(watchMap.values())
    .map((entry) => {
      const severity = classifyWatchlistEntry({
        count: entry.count,
        inWindowCount: entry.inWindowCount,
      });

      return {
        routeNumber: entry.routeNumber,
        stopName: entry.stopName,
        count: entry.count,
        inWindowCount: entry.inWindowCount,
        outOfWindowCount: entry.outOfWindowCount,
        averageRiskBufferMin: Math.round((entry.totalRiskBufferMin / entry.count) * 10) / 10,
        maxRiskBufferMin: entry.maxRiskBufferMin,
        averageSpreadMin: entry.spreadCount ? Math.round((entry.totalSpreadMin / entry.spreadCount) * 10) / 10 : null,
        latestAt: entry.latestAt,
        sourceCount: entry.sourceLabels.size,
        sourceLabels: Array.from(entry.sourceLabels).sort(),
        severityLevel: severity.level,
        severityLabel: severity.label,
        severityReasonCode: severity.reasonCode,
      };
    })
    .filter((entry) => entry.severityLevel !== "watch")
    .sort((left, right) => {
      const rank = { high: 2, elevated: 1, watch: 0 };
      const severityDelta = (rank[right.severityLevel] || 0) - (rank[left.severityLevel] || 0);
      if (severityDelta !== 0) {
        return severityDelta;
      }
      if (right.inWindowCount !== left.inWindowCount) {
        return right.inWindowCount - left.inWindowCount;
      }
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return new Date(right.latestAt || 0).getTime() - new Date(left.latestAt || 0).getTime();
    });

  return {
    totalEntries: entries.length,
    highCount: entries.filter((entry) => entry.severityLevel === "high").length,
    elevatedCount: entries.filter((entry) => entry.severityLevel === "elevated").length,
    topEntry: entries[0] || null,
    entries,
  };
}

export function buildConservativeReliabilityReport(input = {}) {
  const rawSignals = buildSignals(input);
  const filteredWindow = filterSignalsByRollingWindow(rawSignals, {
    now: input.now,
    days: input.days,
  });
  const signals = filteredWindow.signals;
  const sourceCountMap = new Map();

  for (const signal of signals) {
    const current = sourceCountMap.get(signal.source) || {
      source: signal.source,
      sourceLabel: signal.sourceLabel,
      count: 0,
    };
    current.count += 1;
    sourceCountMap.set(signal.source, current);
  }

  const routeStopLeaders = summarizeRouteStopSignals(signals);
  const weekdayWindow = summarizeWeekdayWindowSignals(signals, input.schedule || {});
  const watchlist = summarizeConservativeWatchlist(signals, input.schedule || {});
  const totalSignals = signals.length;
  const totalRiskBufferMin = signals.reduce((sum, item) => sum + item.accuracyRiskBufferMin, 0);
  const spreadSignals = signals.filter((item) => item.accuracySpreadMin !== null);
  const totalSpreadMin = spreadSignals.reduce((sum, item) => sum + item.accuracySpreadMin, 0);
  const deepestTrace = routeStopLeaders[0] || null;

  return {
    generatedAt: filteredWindow.windowEndAt,
    rollingDays: filteredWindow.days,
    windowStartAt: filteredWindow.windowStartAt,
    windowEndAt: filteredWindow.windowEndAt,
    totalSignals,
    distinctRouteStopCount: routeStopLeaders.length,
    maxRiskBufferMin: signals.reduce((max, item) => Math.max(max, item.accuracyRiskBufferMin), 0),
    averageRiskBufferMin: totalSignals ? Math.round((totalRiskBufferMin / totalSignals) * 10) / 10 : 0,
    averageSpreadMin: spreadSignals.length ? Math.round((totalSpreadMin / spreadSignals.length) * 10) / 10 : null,
    latestSignal: signals[0] || null,
    deepestTrace,
    sourceBreakdown: Array.from(sourceCountMap.values()).sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      // Tie-breaking must not change when display labels are translated.
      return String(left.source).localeCompare(String(right.source));
    }),
    weekdayWindow,
    watchlist,
    routeStopLeaders,
    signals,
  };
}

export function buildConservativeProbeBias(
  report,
  {
    routeNumber = "",
    stopName = "",
    now = new Date(),
    schedule = {},
  } = {},
) {
  const safeReport = report && typeof report === "object" ? report : {};
  const routeStopLeaders = Array.isArray(safeReport.routeStopLeaders) ? safeReport.routeStopLeaders : [];
  const weekdayRows = Array.isArray(safeReport.weekdayWindow?.rows) ? safeReport.weekdayWindow.rows : [];
  const safeNow = resolveDateValue(now) || new Date();
  const weekdayLabel = WEEKDAY_LABELS[safeNow.getDay()] || "";
  const routeStopEntry =
    routeStopLeaders.find(
      (entry) =>
        normalizeText(entry.routeNumber) === normalizeText(routeNumber) &&
        normalizeText(entry.stopName) === normalizeText(stopName),
    ) || null;
  const weekdayEntry = weekdayRows.find((entry) => entry.weekdayLabel === weekdayLabel) || null;
  const routeSignalCount = Math.max(0, Number(routeStopEntry?.count) || 0);
  const weekdayInWindowCount = Math.max(0, Number(weekdayEntry?.inWindowCount) || 0);

  let level = "none";
  let reasonCode = "stable-history";
  if (routeSignalCount >= 4 || weekdayInWindowCount >= 3) {
    level = "high";
    reasonCode = routeSignalCount >= 4 ? "route-stop-history-high" : "weekday-window-history-high";
  } else if (routeSignalCount >= 2 || weekdayInWindowCount >= 2) {
    level = "elevated";
    reasonCode = routeSignalCount >= 2 ? "route-stop-history-elevated" : "weekday-window-history-elevated";
  }

  return {
    shouldTighten: level !== "none",
    level,
    reasonCode,
    weekdayLabel,
    routeSignalCount,
    weekdayInWindowCount,
    routeStopEntry,
    weekdayEntry,
  };
}

export function buildConservativeWatchlistHighlight(
  report,
  {
    routeNumber = "",
    stopName = "",
  } = {},
) {
  const safeReport = report && typeof report === "object" ? report : {};
  const watchlist = safeReport.watchlist && typeof safeReport.watchlist === "object" ? safeReport.watchlist : {};
  const entries = Array.isArray(watchlist.entries) ? watchlist.entries : [];
  const currentEntry =
    entries.find(
      (entry) =>
        normalizeText(entry.routeNumber) === normalizeText(routeNumber) &&
        normalizeText(entry.stopName) === normalizeText(stopName),
    ) || null;
  const topEntry = watchlist.topEntry || entries[0] || null;
  const highlightEntry = currentEntry || topEntry || null;

  return {
    currentEntry,
    topEntry,
    highlightEntry,
    isCurrentRouteHighlighted: Boolean(currentEntry),
    totalEntries: Math.max(0, Number(watchlist.totalEntries) || 0),
    highCount: Math.max(0, Number(watchlist.highCount) || 0),
    elevatedCount: Math.max(0, Number(watchlist.elevatedCount) || 0),
  };
}

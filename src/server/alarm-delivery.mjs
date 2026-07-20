function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function triggerKeyFromEvent(event) {
  if (!event?.dateKey || !event?.triggerAt) {
    return "";
  }

  return `${event.dateKey}:${event.triggerAt}`;
}

export function createAlarmDeliveryState() {
  return {
    currentAlert: null,
    handledTriggerKeys: [],
    lastAction: "",
    lastActionAt: null,
  };
}

export function reconcileAlarmDelivery(deliveryState = createAlarmDeliveryState(), runtimeResult, now = new Date()) {
  const currentNow = now instanceof Date ? now : new Date(now);
  const next = {
    ...createAlarmDeliveryState(),
    ...(deliveryState && typeof deliveryState === "object" ? clone(deliveryState) : {}),
    handledTriggerKeys: Array.isArray(deliveryState?.handledTriggerKeys)
      ? [...new Set(deliveryState.handledTriggerKeys.map((value) => String(value || "").trim()).filter(Boolean))]
      : [],
  };

  if (next.currentAlert?.snoozedUntil && new Date(next.currentAlert.snoozedUntil).getTime() <= currentNow.getTime()) {
    next.currentAlert = {
      ...next.currentAlert,
      status: "ACTIVE",
      activatedAt: currentNow.toISOString(),
      snoozedUntil: null,
    };
  }

  const runtimeDateKey = runtimeResult?.runtime?.dateKey || null;
  if (next.currentAlert && runtimeDateKey && next.currentAlert.dateKey && next.currentAlert.dateKey !== runtimeDateKey) {
    next.currentAlert = null;
  }

  const dueEvents = Array.isArray(runtimeResult?.dueEvents) ? runtimeResult.dueEvents : [];
  const unhandled = dueEvents.filter((event) => {
    const triggerKey = triggerKeyFromEvent(event);
    return triggerKey && !next.handledTriggerKeys.includes(triggerKey);
  });

  if (unhandled.length) {
    const newest = unhandled[unhandled.length - 1];
    for (const staleEvent of unhandled.slice(0, -1)) {
      next.handledTriggerKeys.push(triggerKeyFromEvent(staleEvent));
    }

    next.currentAlert = {
      ...newest,
      triggerKey: triggerKeyFromEvent(newest),
      status: "ACTIVE",
      activatedAt: currentNow.toISOString(),
      snoozedUntil: null,
    };
  }

  next.handledTriggerKeys = [...new Set(next.handledTriggerKeys)].slice(-200);
  return next;
}

export function applyAlarmDeliveryAction(deliveryState, action, now = new Date()) {
  if (!deliveryState || typeof deliveryState !== "object") {
    throw new Error("Alarm delivery action requires a delivery state.");
  }

  const currentNow = now instanceof Date ? now : new Date(now);
  const next = {
    ...createAlarmDeliveryState(),
    ...clone(deliveryState),
    handledTriggerKeys: Array.isArray(deliveryState.handledTriggerKeys) ? [...deliveryState.handledTriggerKeys] : [],
  };
  const type = String(action?.type || "").trim().toUpperCase();

  if (!next.currentAlert) {
    throw new Error("No active alarm delivery exists.");
  }

  const triggerKey = String(next.currentAlert.triggerKey || "").trim();
  if (!triggerKey) {
    throw new Error("Current alarm delivery does not have a trigger key.");
  }

  if (type === "ACK_DEPARTED" || type === "DISMISS") {
    next.handledTriggerKeys.push(triggerKey);
    next.handledTriggerKeys = [...new Set(next.handledTriggerKeys)].slice(-200);
    next.lastAction = type;
    next.lastActionAt = currentNow.toISOString();
    next.currentAlert = null;
    return next;
  }

  if (type === "SNOOZE_1M") {
    const snoozedUntil = new Date(currentNow.getTime() + 60_000).toISOString();
    next.lastAction = type;
    next.lastActionAt = currentNow.toISOString();
    next.currentAlert = {
      ...next.currentAlert,
      status: "SNOOZED",
      snoozedUntil,
    };
    return next;
  }

  throw new Error(`Unsupported alarm delivery action: ${type}`);
}

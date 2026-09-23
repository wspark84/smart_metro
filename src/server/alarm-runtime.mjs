import { buildAlarmPlan } from "./alarm-plan.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createAlarmRuntimeState() {
  return {
    status: "idle",
    dateKey: null,
    lastTickAt: null,
    nextTriggerAt: null,
    firedTriggerKeys: [],
    firedCountToday: 0,
    pendingCount: 0,
    lastEvent: null,
    lastError: "",
  };
}

function buildTriggerKey(dateKey, triggerAt) {
  return `${dateKey}:${triggerAt}`;
}

function buildTriggeredEvent({ plan, trigger, now }) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    kind: trigger.triggerKind === "stability-precheck" ? "ALARM_PRECHECK" : "ALARM_TRIGGERED",
    level: trigger.riskLevel,
    title: trigger.notificationSpec?.title || `Bus ${plan.route.number} alert`,
    detail: trigger.notificationSpec?.body || trigger.message || "",
    createdAt: now.toISOString(),
    triggerAt: trigger.triggerAt,
    triggerKind: trigger.triggerKind || "alarm",
    triggerLabel: trigger.triggerLabel || "Alarm",
    stabilityPrecheckLeadMin: Math.max(0, Number(trigger.stabilityPrecheckLeadMin) || 0),
    deliveryPriorityClass: String(trigger.deliveryPriorityClass || "normal"),
    deliveryPriorityReason: String(trigger.deliveryPriorityReason || ""),
    dateKey: plan.dateKey,
    routeNumber: plan.route.number,
    stopName: plan.stop.name,
    riskLevel: trigger.riskLevel,
    urgency: trigger.urgency,
    arrivalsMin: trigger.arrivalsMin,
    source: trigger.source,
    liveEtaGuardMode: trigger.liveEtaGuardMode || "",
    accuracyRiskBufferMin: Number.isFinite(Number(trigger.etaRiskBufferMin)) ? Number(trigger.etaRiskBufferMin) : 0,
    accuracySpreadMin: Number.isFinite(Number(trigger.notificationSpec?.accuracySpreadMin))
      ? Number(trigger.notificationSpec.accuracySpreadMin)
      : null,
    volumePercent: Number.isFinite(Number(trigger.notificationSpec?.volumePercent))
      ? Number(trigger.notificationSpec.volumePercent)
      : 0,
    vibrationRepeats: Number.isFinite(Number(trigger.notificationSpec?.vibrationRepeats))
      ? Number(trigger.notificationSpec.vibrationRepeats)
      : 0,
    mechanicalLoopBoost: Number.isFinite(Number(trigger.notificationSpec?.mechanicalLoopBoost))
      ? Number(trigger.notificationSpec.mechanicalLoopBoost)
      : 0,
    speechRepeatCount: Number.isFinite(Number(trigger.notificationSpec?.speechRepeatCount))
      ? Number(trigger.notificationSpec.speechRepeatCount)
      : 1,
    notificationSpec: trigger.notificationSpec,
  };
}

export function reconcileAlarmRuntime(
  state,
  runtimeState = createAlarmRuntimeState(),
  now = new Date(),
  options = {},
) {
  if (!state || typeof state !== "object") {
    throw new Error("Alarm runtime requires an app state object.");
  }

  const currentNow = now instanceof Date ? now : new Date(now);
  const plan = buildAlarmPlan(state, currentNow, {...options,planningObservation:runtimeState?.planningObservation});
  const nextRuntime = {
    ...createAlarmRuntimeState(),
    ...(runtimeState && typeof runtimeState === "object" ? clone(runtimeState) : {}),
    firedTriggerKeys: Array.isArray(runtimeState?.firedTriggerKeys) ? [...new Set(runtimeState.firedTriggerKeys)] : [],
  };

  if (nextRuntime.dateKey !== plan.dateKey) {
    nextRuntime.firedTriggerKeys = [];
    nextRuntime.firedCountToday = 0;
    nextRuntime.lastEvent = null;
  }

  const dueEvents = [];
  const latestDepartureDue = plan.mode === 'departure-deadline'
    ? plan.allTriggers.filter(t=>Date.parse(t.triggerAt)<=currentNow.getTime()).at(-1) : null;
  for (const trigger of plan.allTriggers) {
    const triggerKey = buildTriggerKey(plan.dateKey, trigger.reminderKey || trigger.triggerAt);
    if (new Date(trigger.triggerAt).getTime() > currentNow.getTime()) {
      continue;
    }

    if (nextRuntime.firedTriggerKeys.includes(triggerKey)) {
      continue;
    }

    // A restarted server must not ring the entire morning's expired alarms.
    const latenessMs = currentNow.getTime() - Date.parse(trigger.triggerAt);
    nextRuntime.firedTriggerKeys.push(triggerKey);
    if (plan.mode === 'departure-deadline') {
      // Consume skipped stages together, but deliver only the most urgent one.
      // Stage keys stay stable when live ETAs move the departure deadline.
      if (trigger !== latestDepartureDue || latenessMs > 60_000 ||
          currentNow.getTime() > Date.parse(plan.window.endAt) - 2*60_000) continue;
    } else if (latenessMs > 90_000 || currentNow.getTime() > Date.parse(plan.window.endAt) + 90_000) continue;
    const event = buildTriggeredEvent({
      plan,
      trigger,
      now: currentNow,
    });
    dueEvents.push(event);
    nextRuntime.lastEvent = event;
  }

  const nextUpcoming = plan.allTriggers.find((trigger) => new Date(trigger.triggerAt).getTime() > currentNow.getTime()) || null;

  nextRuntime.status = plan.todayStatus.firing ? "running" : "paused";
  nextRuntime.dateKey = plan.dateKey;
  nextRuntime.lastTickAt = currentNow.toISOString();
  nextRuntime.nextTriggerAt = nextUpcoming?.triggerAt || null;
  nextRuntime.firedCountToday += dueEvents.length;
  nextRuntime.pendingCount = plan.allTriggers.filter((trigger) => new Date(trigger.triggerAt).getTime() > currentNow.getTime()).length;
  nextRuntime.lastError = "";
  if (plan.planningObservation) nextRuntime.planningObservation = plan.planningObservation;

  return {
    runtime: nextRuntime,
    plan,
    dueEvents,
  };
}

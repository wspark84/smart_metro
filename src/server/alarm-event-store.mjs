import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const DEFAULT_ALARM_EVENT_FILE = join(process.cwd(), "data", "alarm-events.json");

function normalizeEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("Alarm event must be a JSON object.");
  }

  const notificationSpec =
    event.notificationSpec && typeof event.notificationSpec === "object" && !Array.isArray(event.notificationSpec)
      ? event.notificationSpec
      : null;

  return {
    id: String(event.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    kind: String(event.kind || "APP_ACTION"),
    level: String(event.level || "INFO"),
    title: String(event.title || ""),
    detail: String(event.detail || ""),
    createdAt: String(event.createdAt || new Date().toISOString()),
    triggerAt: event.triggerAt ? String(event.triggerAt) : null,
    dateKey: event.dateKey ? String(event.dateKey) : null,
    routeNumber: event.routeNumber ? String(event.routeNumber) : "",
    stopName: event.stopName ? String(event.stopName) : "",
    riskLevel: event.riskLevel ? String(event.riskLevel) : "",
    urgency: event.urgency ? String(event.urgency) : "",
    arrivalsMin: Array.isArray(event.arrivalsMin) ? event.arrivalsMin.map((value) => Number(value)).filter(Number.isFinite) : [],
    source: event.source ? String(event.source) : "",
    liveEtaGuardMode: event.liveEtaGuardMode ? String(event.liveEtaGuardMode) : "",
    deliveryPriorityClass: event.deliveryPriorityClass ? String(event.deliveryPriorityClass) : "normal",
    deliveryPriorityReason: event.deliveryPriorityReason ? String(event.deliveryPriorityReason) : "",
    accuracyRiskBufferMin: Number.isFinite(Number(event.accuracyRiskBufferMin))
      ? Math.max(0, Number(event.accuracyRiskBufferMin))
      : 0,
    accuracySpreadMin: Number.isFinite(Number(event.accuracySpreadMin))
      ? Math.max(0, Number(event.accuracySpreadMin))
      : null,
    volumePercent: Number.isFinite(Number(event.volumePercent ?? notificationSpec?.volumePercent))
      ? Math.max(0, Number(event.volumePercent ?? notificationSpec?.volumePercent))
      : 0,
    vibrationRepeats: Number.isFinite(Number(event.vibrationRepeats ?? notificationSpec?.vibrationRepeats))
      ? Math.max(0, Number(event.vibrationRepeats ?? notificationSpec?.vibrationRepeats))
      : 0,
    mechanicalLoopBoost: Number.isFinite(Number(event.mechanicalLoopBoost ?? notificationSpec?.mechanicalLoopBoost))
      ? Math.max(0, Number(event.mechanicalLoopBoost ?? notificationSpec?.mechanicalLoopBoost))
      : 0,
    speechRepeatCount: Number.isFinite(Number(event.speechRepeatCount ?? notificationSpec?.speechRepeatCount))
      ? Math.max(1, Number(event.speechRepeatCount ?? notificationSpec?.speechRepeatCount))
      : 1,
    notificationSpec,
  };
}

function normalizeEvents(events) {
  if (!Array.isArray(events)) {
    throw new Error("Alarm event payload must be an array.");
  }

  return events.map(normalizeEvent);
}

export async function readAlarmEvents(filePath = DEFAULT_ALARM_EVENT_FILE) {
  try {
    const raw = await readFile(filePath, "utf8");
    return normalizeEvents(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function writeAlarmEvents(events, filePath = DEFAULT_ALARM_EVENT_FILE) {
  const safeEvents = normalizeEvents(events);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(safeEvents, null, 2)}\n`, "utf8");
  return safeEvents;
}

export async function appendAlarmEvents(events, filePath = DEFAULT_ALARM_EVENT_FILE) {
  const existing = await readAlarmEvents(filePath);
  const incoming = normalizeEvents(Array.isArray(events) ? events : [events]);
  const merged = [...incoming.reverse(), ...existing].slice(0, 200);
  await writeAlarmEvents(merged, filePath);
  return merged;
}

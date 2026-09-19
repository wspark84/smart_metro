import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { DEFAULT_DEVICE_PROFILE, sanitizeDeviceProfile } from "./src/device-profile.js";
import { applyDomainSnapshotToState, projectDomainSnapshot, updateDomainEntity } from "./src/domain-model.js";
import { buildConservativeProbeBias, buildConservativeReliabilityReport } from "./src/logic/conservative-report.js";
import { dateOnlyKey, mergeHolidayDates } from "./src/logic/commute.js";
import { buildDeliveryIntensityReport } from "./src/logic/delivery-intensity-report.js";
import { applyAlarmDeliveryAction, createAlarmDeliveryState, reconcileAlarmDelivery } from "./src/server/alarm-delivery.mjs";
import { resetDispatchQueueForAlert, resetPushGatewayHandledKeysForAlert } from "./src/server/alert-pipeline-reset.mjs";
import { sanitizeAuthUser } from "./src/server/auth-service.mjs";
import { readAlarmDeliveryState, writeAlarmDeliveryState } from "./src/server/alarm-delivery-store.mjs";
import { readAppState, writeAppState } from "./src/server/app-state-store.mjs";
import { appendAlarmEvents, readAlarmEvents } from "./src/server/alarm-event-store.mjs";
import {
  buildBusAccuracyLeaderboard,
  buildBusAccuracySnapshot,
  createBusAccuracyState,
  recordForecastObservation,
  resolveAutoDetectedArrival,
  resolveActualArrival,
} from "./src/server/bus-accuracy.mjs";
import {
  buildBusAccuracyAutoProbePlan,
  createBusAccuracyRuntimeState,
  markBusAccuracyProbeObservation,
  markBusAccuracyAutoResolveResult,
  markBusAccuracyAutoProbeResult,
  summarizeBusAccuracyComparisons,
  shouldRunBusAccuracyAutoResolve,
  shouldRunBusAccuracyAutoProbe,
} from "./src/server/bus-accuracy-runtime.mjs";
import {
  readBusAccuracyRuntimeState,
  writeBusAccuracyRuntimeState,
} from "./src/server/bus-accuracy-runtime-store.mjs";
import { readBusAccuracyState, writeBusAccuracyState } from "./src/server/bus-accuracy-store.mjs";
import { createDispatchExecutionState, reconcileDispatchExecutions } from "./src/server/dispatch-execution-engine.mjs";
import { readDispatchExecutionState, writeDispatchExecutionState } from "./src/server/dispatch-execution-store.mjs";
import { buildAlarmPlan } from "./src/server/alarm-plan.mjs";
import { refreshAlarmArrivals, isAlarmRefreshWindow } from "./src/server/alarm-arrival-refresh.mjs";
import { fetchLiveArrival, fetchTagoCities, getBusApiConfig, searchLiveStationRoutes, searchLiveStations } from "./src/server/bus-providers.mjs";
import { TRANSIT_LOOKUP_PATHS, transitLookup } from "./src/server/transit-lookups.mjs";
import { createDispatchQueueState, reconcileDispatchQueue } from "./src/server/dispatch-engine.mjs";
import { readDispatchQueueState, writeDispatchQueueState } from "./src/server/dispatch-queue-store.mjs";
import { readDeviceProfile, writeDeviceProfile } from "./src/server/device-profile-store.mjs";
import {
  analyzeDevicePushTarget,
  markDevicePushTokenInvalidated,
  registerDevicePushToken,
} from "./src/server/device-token.mjs";
import { readDomainSnapshot, writeDomainSnapshot } from "./src/server/domain-store.mjs";
import { readFcmAuthStatus } from "./src/server/fcm-auth.mjs";
import { fetchOfficialHolidays, getHolidayApiConfig } from "./src/server/holiday-providers.mjs";
import { buildMobileHealthPayload } from "./src/server/mobile-health.mjs";
import { createAsyncMutex } from "./src/server/async-mutex.mjs";
import { createAlarmRuntimeState, reconcileAlarmRuntime } from "./src/server/alarm-runtime.mjs";
import { readAlarmRuntimeState, writeAlarmRuntimeState } from "./src/server/alarm-runtime-store.mjs";
import { getPushGatewayConfig, runPushGatewayDispatch, buildPushGatewayPlan } from "./src/server/push-gateway.mjs";
import {
  buildRetrySimulationBundle,
  buildRetrySimulationQueueFromItems,
  buildRetrySimulationQueueState,
  createSimulationDeviceProfile,
  createSimulationDispatchRunner,
  pruneSimulationGatewayState,
} from "./src/server/push-gateway-simulation.mjs";
import {
  recordPushGatewayAttempt,
  reconcilePushGatewayState,
  summarizePushGatewayState,
} from "./src/server/push-gateway-runtime.mjs";
import { createPushGatewayState, readPushGatewayState, writePushGatewayState } from "./src/server/push-gateway-store.mjs";
import { buildPushPreview } from "./src/server/push-preview.mjs";
import { getPlaceApiConfig, searchAddressPlaces } from "./src/server/place-providers.mjs";
import { loadWithCache } from "./src/server/request-cache.mjs";
import { estimateCommuteRoute, getRouteApiConfig } from "./src/server/route-providers.mjs";
import { fetchTransitRoutes, refreshTransitJourney } from "./src/server/transit-providers.mjs";
import { buildTestPushPreview } from "./src/server/test-push.mjs";
import { buildUserDataFilePath } from "./src/server/user-storage.mjs";
import { isAssetPath, resolvePublicStaticFile } from "./src/server/static-assets.mjs";
import { ensureLiveBindingState } from "./src/logic/live-bindings.js";
import { STOP_LIBRARY } from "./src/mock-data.js";
import { createRequestAuth, isTrustedMutation } from "./src/server/supabase-session.mjs";
import { createSupabaseGateway } from "./src/server/supabase-gateway.mjs";
import { bufferedResponse, runWithDocumentStorage } from "./src/server/document-storage.mjs";
import { handleSocialLoginRoute, sendAuthJson } from "./src/server/social-login-routes.mjs";

const PORT = Number(process.env.PORT || 4173);
const ROOT = process.cwd();
const LIVE_ARRIVAL_CACHE_TTL_MS = 10_000;
const MAX_REQUEST_BODY_BYTES = 256 * 1024;
const runWithRuntimeLock = createAsyncMutex();
const PUBLIC_API_PATHS = new Set([
  "/api/bus/config",
  "/api/holidays/config",
  "/api/holidays",
  "/api/mobile/health",
  "/api/places/config",
  "/api/commute/config",
]);

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function requestBodyTooLargeError() {
  const error = new Error("Request body is too large.");
  error.statusCode = 413;
  return error;
}

async function readRequestBody(request) {
  const body = await new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    let settled = false;

    const rejectOnce = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      size += Buffer.byteLength(chunk, "utf8");
      if (size > MAX_REQUEST_BODY_BYTES) {
        request.resume();
        rejectOnce(requestBodyTooLargeError());
        return;
      }
      raw += chunk;
    });
    request.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(raw);
      }
    });
    request.on("error", rejectOnce);
  });

  return body;
}

async function readJsonBody(request) {
  const body = await readRequestBody(request);
  return body ? JSON.parse(body) : {};
}


async function ensureUserWorkspaceSeeded(user) {
  await activateUserContext(user);
  const initialState = await readEffectiveAppState();
  if (initialState) {
    return;
  }

  const seedSnapshot = projectDomainSnapshot({});
  seedSnapshot.user.name = user.name || seedSnapshot.user.name;
  seedSnapshot.user.email = user.email || seedSnapshot.user.email;
  const seededState = applyDomainSnapshotToState(seedSnapshot);
  seededState.user.name = user.name || seededState.user.name;
  await Promise.all([
    writeAppState(seededState, getActiveFiles().appState),
    writeDomainSnapshot(projectDomainSnapshot(seededState), getActiveFiles().domain),
  ]);
}

function buildUserFileMap(userId) {
  return {
    appState: buildUserDataFilePath(userId, "app-state.json"),
    domain: buildUserDataFilePath(userId, "domain-store.json"),
    deviceProfile: buildUserDataFilePath(userId, "device-profile.json"),
    busAccuracy: buildUserDataFilePath(userId, "bus-accuracy.json"),
    busAccuracyRuntime: buildUserDataFilePath(userId, "bus-accuracy-runtime.json"),
    alarmRuntime: buildUserDataFilePath(userId, "alarm-runtime.json"),
    alarmDelivery: buildUserDataFilePath(userId, "alarm-delivery.json"),
    alarmEvents: buildUserDataFilePath(userId, "alarm-events.json"),
    dispatchQueue: buildUserDataFilePath(userId, "dispatch-queue.json"),
    dispatchExecutions: buildUserDataFilePath(userId, "dispatch-executions.json"),
    pushGateway: buildUserDataFilePath(userId, "push-gateway-state.json"),
  };
}

let activeUserContext = null;

function getActiveFiles() {
  if (!activeUserContext?.files) {
    throw new Error("No authenticated user context is active.");
  }

  return activeUserContext.files;
}

async function readEffectiveDomainSnapshot() {
  const files = getActiveFiles();
  const domainSnapshot = await readDomainSnapshot(files.domain);
  if (domainSnapshot) {
    return domainSnapshot;
  }

  const appState = await readAppState(files.appState);
  return appState ? projectDomainSnapshot(appState) : null;
}

async function readEffectiveAppState() {
  const files = getActiveFiles();
  const appState = await readAppState(files.appState);
  if (appState) {
    return appState;
  }

  const domainSnapshot = await readDomainSnapshot(files.domain);
  return domainSnapshot ? applyDomainSnapshotToState(domainSnapshot) : null;
}

async function readEffectiveDeviceProfile() {
  const files = getActiveFiles();
  const storedProfile = await readDeviceProfile(files.deviceProfile);
  if (storedProfile) {
    return storedProfile;
  }

  const appState = await readEffectiveAppState();
  return sanitizeDeviceProfile(appState?.device || DEFAULT_DEVICE_PROFILE);
}

async function persistDomainSnapshot(domainSnapshot) {
  const files = getActiveFiles();
  const appState = applyDomainSnapshotToState(domainSnapshot, (await readAppState(files.appState)) || undefined);
  await Promise.all([writeDomainSnapshot(domainSnapshot, files.domain), writeAppState(appState, files.appState)]);
  return domainSnapshot;
}

async function persistDeviceProfile(nextProfile) {
  const files = getActiveFiles();
  deviceProfileState = await writeDeviceProfile(nextProfile, files.deviceProfile);
  const appState = await readEffectiveAppState();
  if (appState) {
    appState.device = deviceProfileState;
    await writeAppState(appState, files.appState);
  }

  if (alarmDeliveryState.currentAlert?.triggerKey) {
    dispatchQueueState = resetDispatchQueueForAlert(dispatchQueueState, alarmDeliveryState.currentAlert.triggerKey);
    pushGatewayState = resetPushGatewayHandledKeysForAlert(pushGatewayState, alarmDeliveryState.currentAlert.triggerKey);
    await Promise.all([
      writeDispatchQueueState(dispatchQueueState, files.dispatchQueue),
      writePushGatewayState(pushGatewayState, files.pushGateway),
    ]);
  }

  await safeTickAlarmRuntime(activeUserContext.user.id);
  return deviceProfileState;
}

async function invalidateDeviceTokenFromPushAttempt(attempt, now = new Date()) {
  const response = attempt?.response && typeof attempt.response === "object" ? attempt.response : {};
  if (String(response.tokenAction || "").trim().toUpperCase() !== "RE_REGISTER") {
    return false;
  }
  if (deviceProfileState.pushTokenInvalidatedAt) {
    return false;
  }

  deviceProfileState = markDevicePushTokenInvalidated(
    deviceProfileState,
    {
      code: response.providerErrorCode,
      reason: response.reason || attempt?.reason,
    },
    now,
  );

  const files = getActiveFiles();
  const appState = await readEffectiveAppState();
  await Promise.all([
    writeDeviceProfile(deviceProfileState, files.deviceProfile),
    appState
      ? writeAppState(
          {
            ...appState,
            device: deviceProfileState,
          },
          files.appState,
        )
      : Promise.resolve(),
  ]);
  return true;
}

const DOMAIN_ENDPOINTS = {
  "/api/profile": "user",
  "/api/route": "route",
  "/api/schedule": "schedule",
  "/api/notification-settings": "notificationSettings",
};

let alarmRuntimeState = createAlarmRuntimeState();
let alarmDeliveryState = createAlarmDeliveryState();
let deviceProfileState = sanitizeDeviceProfile(DEFAULT_DEVICE_PROFILE);
let busAccuracyState = createBusAccuracyState();
let busAccuracyRuntimeState = createBusAccuracyRuntimeState();
let dispatchQueueState = createDispatchQueueState();
let dispatchExecutionState = createDispatchExecutionState();
let pushGatewayState = createPushGatewayState();

async function activateUserContext(user) {
  const safeUser = user && typeof user === "object" ? user : { id: user };
  const userId = String(safeUser?.id || "").trim();
  if (!userId) {
    throw new Error("An authenticated user id is required.");
  }

  const files = buildUserFileMap(userId);
  activeUserContext = {
    user: safeUser,
    files,
  };
  // Independent document reads share this request's storage context. Keep the
  // runtime lock, but do not pay one network round trip per document in series.
  const [alarmRuntime, alarmDelivery, busAccuracy, busAccuracyRuntime, dispatchQueue,
    dispatchExecution, pushGateway, deviceProfile] = await Promise.all([
    readAlarmRuntimeState(files.alarmRuntime), readAlarmDeliveryState(files.alarmDelivery),
    readBusAccuracyState(files.busAccuracy), readBusAccuracyRuntimeState(files.busAccuracyRuntime),
    readDispatchQueueState(files.dispatchQueue), readDispatchExecutionState(files.dispatchExecutions),
    readPushGatewayState(files.pushGateway), readEffectiveDeviceProfile(),
  ]);
  alarmRuntimeState = alarmRuntime || createAlarmRuntimeState();
  alarmDeliveryState = alarmDelivery || createAlarmDeliveryState();
  busAccuracyState = busAccuracy || createBusAccuracyState();
  busAccuracyRuntimeState = busAccuracyRuntime || createBusAccuracyRuntimeState();
  dispatchQueueState = dispatchQueue || createDispatchQueueState();
  dispatchExecutionState = dispatchExecution || createDispatchExecutionState();
  pushGatewayState = pushGateway || createPushGatewayState();
  deviceProfileState = deviceProfile || sanitizeDeviceProfile(DEFAULT_DEVICE_PROFILE);
  return activeUserContext;
}


async function resolveAuthenticatedRequest(request, now = new Date()) {
  // Legacy cookies are never accepted by the social-only HTTP entry point.
  return request.smartMetroAuth || null;
}

function inferRegionHint(provider = "", hint = "") {
  const normalizedHint = String(hint || "").trim().toLowerCase();
  if (normalizedHint) {
    return normalizedHint;
  }

  if (provider === "seoul") {
    return "seoul";
  }

  if (provider === "gyeonggi") {
    return "gyeonggi";
  }

  if (provider === "tago") {
    return "gyeonggi";
  }

  return "unknown";
}

function getAccuracyFallbackOrder(region = "") {
  const config = getBusApiConfig();
  const normalizedRegion = String(region || "").trim().toLowerCase();
  return config.policy?.regionPriority?.[normalizedRegion] || config.policy?.regionPriority?.national || [];
}

function buildAccuracyStopKey({
  stopKey = "",
  selectedStopId = "",
  provider = "",
  stationId = "",
  arsId = "",
  cityCode = "",
  nodeId = "",
  stopName = "",
} = {}) {
  const normalizedStopKey = String(stopKey || "").trim().toLowerCase();
  if (normalizedStopKey) {
    return normalizedStopKey;
  }

  const normalizedSelectedStopId = String(selectedStopId || "").trim();
  if (normalizedSelectedStopId) {
    return `selected:${normalizedSelectedStopId}`.toLowerCase();
  }

  const normalizedProvider = String(provider || "").trim().toLowerCase();
  if (normalizedProvider === "seoul") {
    if (String(stationId || "").trim()) {
      return `seoul-station:${String(stationId).trim()}`.toLowerCase();
    }
    if (String(arsId || "").trim()) {
      return `seoul-ars:${String(arsId).trim()}`.toLowerCase();
    }
  }

  if (normalizedProvider === "gyeonggi" && String(stationId || "").trim()) {
    return `gyeonggi-station:${String(stationId).trim()}`.toLowerCase();
  }

  if (normalizedProvider === "tago" && String(cityCode || "").trim() && String(nodeId || "").trim()) {
    return `tago-node:${String(cityCode).trim()}:${String(nodeId).trim()}`.toLowerCase();
  }

  const normalizedStopName = String(stopName || "").trim().toLowerCase();
  return normalizedStopName ? `name:${normalizedStopName}` : "";
}

async function persistForecastObservation({
  provider,
  routeNumber,
  stopName,
  stopKey,
  predictedMinutes,
  observedAt,
  region,
  source,
}) {
  if (!activeUserContext?.user?.id) {
    return null;
  }

  if (!provider || !routeNumber || !stopName || !Number.isFinite(Number(predictedMinutes))) {
    return null;
  }

  busAccuracyState = recordForecastObservation(busAccuracyState, {
    provider,
    routeNumber,
    stopName,
    stopKey,
    predictedMinutes,
    observedAt,
    region,
    source,
  });
  await writeBusAccuracyState(busAccuracyState, getActiveFiles().busAccuracy);
  return busAccuracyState;
}

async function maybeAutoResolveArrivalFromComparisons({
  comparisons = [],
  region = "",
  routeNumber = "",
  stopName = "",
  stopKey = "",
  now = new Date(),
}) {
  if (!activeUserContext?.user?.id) {
    return {
      autoDetected: false,
      resolvedSamples: [],
      detectedProviders: [],
      detectionReason: "missing-user-context",
      runtime: busAccuracyRuntimeState,
    };
  }

  const normalizedRouteNumber = String(routeNumber || "").trim();
  const normalizedStopName = String(stopName || "").trim();
  const normalizedRegion = String(region || "").trim();

  if (!normalizedRouteNumber || !normalizedStopName) {
    return {
      autoDetected: false,
      resolvedSamples: [],
      detectedProviders: [],
      detectionReason: "missing-route-context",
      runtime: busAccuracyRuntimeState,
    };
  }

  const routeKey = JSON.stringify({
    region: normalizedRegion,
    routeNumber: normalizedRouteNumber,
    stopName: normalizedStopName,
    stopKey: String(stopKey || "").trim().toLowerCase(),
  });
  const autoResolveDecision = shouldRunBusAccuracyAutoResolve(busAccuracyRuntimeState, {
    routeKey,
    now,
    intervalMs: 180_000,
  });

  if (!autoResolveDecision.shouldRun) {
    return {
      autoDetected: false,
      resolvedSamples: [],
      detectedProviders: [],
      detectionReason: autoResolveDecision.reason,
      runtime: busAccuracyRuntimeState,
    };
  }

  const actualArrivalAt =
    comparisons
      .map((item) => new Date(item.fetchedAt || now.toISOString()))
      .filter((value) => !Number.isNaN(value.getTime()))
      .sort((first, second) => second.getTime() - first.getTime())[0]
      ?.toISOString() || now.toISOString();
  const resolved = resolveAutoDetectedArrival(busAccuracyState, {
    comparisons,
    region: normalizedRegion,
    routeNumber: normalizedRouteNumber,
    stopName: normalizedStopName,
    stopKey,
    actualArrivalAt,
    minProviderCount: 2,
    maxArrivalMinutes: 1,
  });

  if (!resolved.autoDetected || !resolved.resolvedSamples.length) {
    return {
      autoDetected: false,
      resolvedSamples: [],
      detectedProviders: resolved.detectedProviders,
      detectionReason: resolved.detectionReason,
      runtime: busAccuracyRuntimeState,
    };
  }

  busAccuracyState = resolved.state;
  busAccuracyRuntimeState = markBusAccuracyAutoResolveResult(busAccuracyRuntimeState, {
    routeKey,
    now,
    providerCount: resolved.detectedProviders.length,
  });
  await writeBusAccuracyState(busAccuracyState, getActiveFiles().busAccuracy);
  await writeBusAccuracyRuntimeState(busAccuracyRuntimeState, getActiveFiles().busAccuracyRuntime);

  return {
    autoDetected: true,
    resolvedSamples: resolved.resolvedSamples,
    detectedProviders: resolved.detectedProviders,
    detectionReason: resolved.detectionReason,
    runtime: busAccuracyRuntimeState,
  };
}

function getStopLibraryEntry(stopId = "") {
  return STOP_LIBRARY.find((item) => item.id === String(stopId || "").trim()) || null;
}

function getPrimaryLineNumberFromAppState(state) {
  const stop = getStopLibraryEntry(state?.commute?.selectedStopId);
  if (!stop) {
    return "";
  }

  const primaryLine =
    stop.lines.find((line) => line.id === String(state?.commute?.primaryLineId || "").trim()) || stop.lines[0] || null;
  return primaryLine?.number || "";
}

function buildAutoBusAccuracyContext(appState) {
  const safeState = appState && typeof appState === "object" ? appState : {};
  const liveState = ensureLiveBindingState(
    safeState.live && typeof safeState.live === "object" ? JSON.parse(JSON.stringify(safeState.live)) : {},
  );
  const primaryRouteNumber = getPrimaryLineNumberFromAppState(safeState);
  const selectedStop = getStopLibraryEntry(safeState?.commute?.selectedStopId);
  const selectedStopId = String(safeState?.commute?.selectedStopId || "").trim();
  const fallbackStopName = String(liveState.stationName || selectedStop?.name || "").trim();
  const liveBindings = liveState.bindings || {};
  const policy = getBusApiConfig().policy || {};
  const candidates = [];

  const seoulBinding = liveBindings.seoul || {};
  if (seoulBinding.stationId && seoulBinding.routeId && seoulBinding.order && (seoulBinding.routeNumber || primaryRouteNumber)) {
    candidates.push({
      provider: "seoul",
      stationId: seoulBinding.stationId,
      arsId: seoulBinding.arsId,
      routeId: seoulBinding.routeId,
      order: seoulBinding.order,
      routeNumber: seoulBinding.routeNumber || primaryRouteNumber,
      regionHint: "seoul",
      stopName: seoulBinding.stationName || fallbackStopName,
    });
  }

  const gyeonggiBinding = liveBindings.gyeonggi || {};
  if (gyeonggiBinding.stationId && (gyeonggiBinding.routeNumber || primaryRouteNumber)) {
    candidates.push({
      provider: "gyeonggi",
      stationId: gyeonggiBinding.stationId,
      routeId: gyeonggiBinding.routeId,
      order: gyeonggiBinding.order,
      routeNumber: gyeonggiBinding.routeNumber || primaryRouteNumber,
      regionHint: "gyeonggi",
      stopName: gyeonggiBinding.stationName || fallbackStopName,
    });
  }

  const tagoBinding = liveBindings.tago || {};
  if (tagoBinding.cityCode && tagoBinding.nodeId && (tagoBinding.routeId || tagoBinding.routeNumber || primaryRouteNumber)) {
    candidates.push({
      provider: "tago",
      cityCode: tagoBinding.cityCode,
      nodeId: tagoBinding.nodeId,
      routeId: tagoBinding.routeId,
      routeNumber: tagoBinding.routeNumber || primaryRouteNumber,
      regionHint: policy.regionPriority?.gyeonggi?.[0] === "tago" ? "gyeonggi" : "national",
      stopName: tagoBinding.stationName || fallbackStopName,
    });
  }

  const dedupedCandidates = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = JSON.stringify(candidate);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    dedupedCandidates.push(candidate);
  }

  const routeNumber =
    String(liveState.snapshot?.lineNumber || liveState.routeNumber || dedupedCandidates[0]?.routeNumber || primaryRouteNumber || "").trim();
  const stopName =
    String(liveState.snapshot?.stopName || liveState.stationName || dedupedCandidates[0]?.stopName || fallbackStopName || "").trim();
  const region =
    String(
      liveState.provider === "seoul"
        ? "seoul"
        : liveState.provider === "gyeonggi"
          ? "gyeonggi"
          : policy.regionPriority?.gyeonggi?.[0] === "tago"
            ? "gyeonggi"
            : "national",
    ).trim();

  return {
    region,
    routeNumber,
    stopName,
    stopKey: buildAccuracyStopKey({
      selectedStopId,
      provider: liveState.provider,
      stationId: liveState.stationId,
      arsId: liveState.arsId,
      cityCode: liveState.cityCode,
      nodeId: liveState.nodeId,
      stopName,
    }),
    candidates: dedupedCandidates,
  };
}

function getAccuracyTimeSliceOptions(appState, now = new Date()) {
  const startTime = String(appState?.schedule?.startTime || "").trim();
  const endTime = String(appState?.schedule?.endTime || "").trim();
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    return null;
  }

  const weekdayToken = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  }).format(now);
  const weekdayLookup = {
    Sun: { index: 0, label: "Sunday" },
    Mon: { index: 1, label: "Monday" },
    Tue: { index: 2, label: "Tuesday" },
    Wed: { index: 3, label: "Wednesday" },
    Thu: { index: 4, label: "Thursday" },
    Fri: { index: 5, label: "Friday" },
    Sat: { index: 6, label: "Saturday" },
  };
  const weekday = weekdayLookup[weekdayToken] || null;

  return {
    startTime,
    endTime,
    label: `Alarm window ${startTime} - ${endTime}`,
    timeZone: "Asia/Seoul",
    targetWeekday: weekday?.index ?? null,
    weekdayLabel: weekday?.label || "",
  };
}

async function runAutoBusAccuracyProbe(now = new Date()) {
  const appState = await readEffectiveAppState();
  const accuracyTimeSlice = getAccuracyTimeSliceOptions(appState, now);
  if (!appState) {
    return {
      ok: false,
      skipped: true,
      reason: "missing-app-state",
      runtime: busAccuracyRuntimeState,
      summary: buildBusAccuracySnapshot(busAccuracyState, { timeSlice: accuracyTimeSlice }),
      comparisons: [],
    };
  }

  const context = buildAutoBusAccuracyContext(appState);
  if (!context.routeNumber || !context.stopName) {
    return {
      ok: false,
      skipped: true,
      reason: "missing-route-context",
      runtime: busAccuracyRuntimeState,
      summary: buildBusAccuracySnapshot(busAccuracyState, { timeSlice: accuracyTimeSlice }),
      comparisons: [],
    };
  }

  const holidayDates = mergeHolidayDates(appState.holidayDates, appState.officialHolidays);
  const alertArrivalHint = Array.isArray(alarmDeliveryState?.currentAlert?.arrivalsMin)
    ? Number(alarmDeliveryState.currentAlert.arrivalsMin[0])
    : null;
  const snapshotArrivalHint = Array.isArray(appState?.live?.snapshot?.arrivalsMin)
    ? Number(appState.live.snapshot.arrivalsMin[0])
    : null;
  const recentConservativeReliability = buildConservativeReliabilityReport({
    schedule: appState.schedule,
    events: await readAlarmEvents(getActiveFiles().alarmEvents),
    days: 7,
    now,
  });
  const historicalConservativeBias = buildConservativeProbeBias(recentConservativeReliability, {
    routeNumber: context.routeNumber,
    stopName: context.stopName,
    now,
    schedule: appState.schedule,
  });
  const probePlan = buildBusAccuracyAutoProbePlan({
    now,
    schedule: appState.schedule,
    holidayDates,
    nextArrivalMinutes: Number.isFinite(alertArrivalHint) ? alertArrivalHint : snapshotArrivalHint,
    activeAlertRiskLevel: alarmDeliveryState?.currentAlert?.riskLevel || "",
    liveEtaDisagreementLevel: busAccuracyRuntimeState.lastObservedDisagreementLevel,
    liveEtaSpreadMin: busAccuracyRuntimeState.lastObservedEtaSpreadMin,
    comparableProviderCount: busAccuracyRuntimeState.lastObservedComparableProviderCount,
    historicalConservativeBias,
  });

  if (!probePlan.enabled) {
    return {
      ok: false,
      skipped: true,
      reason: probePlan.reason,
      probePlan,
      runtime: busAccuracyRuntimeState,
      summary: buildBusAccuracySnapshot(busAccuracyState, {
        region: context.region,
        routeNumber: context.routeNumber,
        stopName: context.stopName,
        stopKey: context.stopKey,
        fallbackOrder: getAccuracyFallbackOrder(context.region),
        timeSlice: accuracyTimeSlice,
      }),
      comparisons: [],
    };
  }

  if (context.candidates.length < 2) {
    return {
      ok: false,
      skipped: true,
      reason: "not-enough-candidates",
      probePlan,
      runtime: busAccuracyRuntimeState,
      summary: buildBusAccuracySnapshot(busAccuracyState, {
        region: context.region,
        routeNumber: context.routeNumber,
        stopName: context.stopName,
        stopKey: context.stopKey,
        fallbackOrder: getAccuracyFallbackOrder(context.region),
        timeSlice: accuracyTimeSlice,
      }),
      comparisons: [],
    };
  }

  const probeKey = JSON.stringify({
    region: context.region,
    routeNumber: context.routeNumber,
    stopName: context.stopName,
    providers: context.candidates.map((item) => item.provider).sort(),
  });
  const decision = shouldRunBusAccuracyAutoProbe(busAccuracyRuntimeState, {
    probeKey,
    now,
    intervalMs: probePlan.intervalMs,
  });

  if (!decision.shouldRun) {
    return {
      ok: true,
      skipped: true,
      reason: decision.reason,
      probePlan,
      nextEligibleAt: decision.nextEligibleAt || null,
      runtime: busAccuracyRuntimeState,
      summary: buildBusAccuracySnapshot(busAccuracyState, {
        region: context.region,
        routeNumber: context.routeNumber,
        stopName: context.stopName,
        stopKey: context.stopKey,
        fallbackOrder: getAccuracyFallbackOrder(context.region),
        timeSlice: accuracyTimeSlice,
      }),
      comparisons: [],
    };
  }

  const comparisons = [];
  for (const candidate of context.candidates) {
    const binding = {
      provider: candidate.provider,
      stationId: candidate.stationId || "",
      routeId: candidate.routeId || "",
      order: candidate.order || "",
      cityCode: candidate.cityCode || "",
      nodeId: candidate.nodeId || "",
      routeNumber: candidate.routeNumber || "",
      regionHint: candidate.regionHint || context.region,
    };
    const result = await loadWithCache({
      key: ["auto-accuracy-probe", binding],
      ttlMs: LIVE_ARRIVAL_CACHE_TTL_MS,
      loader: () => fetchLiveArrival(binding),
    });
    const payload = result.value;
    const effectiveRouteNumber = String(payload.lineNumber || binding.routeNumber || context.routeNumber).trim();
    const effectiveStopName = String(payload.stopName || candidate.stopName || context.stopName).trim();
    const effectiveRegion = inferRegionHint(payload.provider || binding.provider, binding.regionHint);

    if (result.cacheStatus !== "stale-fallback") {
      await persistForecastObservation({
        provider: payload.provider || binding.provider,
        routeNumber: effectiveRouteNumber,
        stopName: effectiveStopName,
        stopKey: context.stopKey,
        predictedMinutes: Array.isArray(payload.arrivalsMin) ? Number(payload.arrivalsMin[0]) : null,
        observedAt: result.fetchedAt || now.toISOString(),
        region: effectiveRegion,
        source: `auto-probe-${result.cacheStatus}`,
      });
    }

    comparisons.push({
      provider: payload.provider || binding.provider,
      region: effectiveRegion,
      routeNumber: effectiveRouteNumber,
      stopName: effectiveStopName,
      arrivalsMin: payload.arrivalsMin,
      messages: Array.isArray(payload.messages) ? payload.messages : [],
      cacheStatus: result.cacheStatus,
      fetchedAt: result.fetchedAt,
      fallbackError: result.fallbackError || "",
    });
  }

  const autoResolved = await maybeAutoResolveArrivalFromComparisons({
    comparisons,
    region: context.region,
    routeNumber: context.routeNumber,
    stopName: context.stopName,
    stopKey: context.stopKey,
    now,
  });
  const comparisonSummary = summarizeBusAccuracyComparisons(comparisons);

  busAccuracyRuntimeState = markBusAccuracyAutoProbeResult(busAccuracyRuntimeState, {
    probeKey,
    now,
    status: "ready",
    reason: probePlan.reason,
    comparisonCount: comparisons.length,
    cadence: probePlan.cadence,
    intervalMs: probePlan.intervalMs,
    comparisonSummary,
    historicalBias: historicalConservativeBias,
  });
  await writeBusAccuracyRuntimeState(busAccuracyRuntimeState, getActiveFiles().busAccuracyRuntime);

  return {
    ok: true,
    skipped: false,
    reason: probePlan.reason,
    probePlan,
    runtime: busAccuracyRuntimeState,
    summary: buildBusAccuracySnapshot(busAccuracyState, {
      region: context.region,
      routeNumber: context.routeNumber,
      stopName: context.stopName,
      stopKey: context.stopKey,
      fallbackOrder: getAccuracyFallbackOrder(context.region),
      timeSlice: accuracyTimeSlice,
    }),
    comparisons,
    comparisonSummary,
    autoResolved,
  };
}

async function tickAlarmRuntime(now = new Date()) {
  const files = getActiveFiles();
  let state = await readEffectiveAppState();
  if (!state) {
    alarmRuntimeState = {
      ...alarmRuntimeState,
      status: "idle",
      lastTickAt: now.toISOString(),
      lastError: "",
      nextTriggerAt: null,
      pendingCount: 0,
    };

    return {
      runtime: alarmRuntimeState,
      dueEvents: [],
      plan: null,
      delivery: alarmDeliveryState,
      dispatch: dispatchQueueState,
      executions: dispatchExecutionState,
      pushGateway: pushGatewayState,
    };
  }

  if (isAlarmRefreshWindow(state, now)) state = await refreshTransitJourney(state, now, async (query) => {
    const cached = await loadWithCache({ key: ['transit-route', query], ttlMs: 5 * 60_000,
      loader: () => fetchTransitRoutes(query, process.env) });
    return cached.value;
  });
  state = await refreshAlarmArrivals(state, now, (live) => {
    const binding = Object.fromEntries(
      ['provider', 'stationId', 'stationName', 'arsId', 'routeId', 'order', 'cityCode', 'nodeId', 'routeNumber']
        .map((key) => [key, live[key] || '']),
    );
    return loadWithCache({key:['alarm-arrivals', binding], ttlMs:LIVE_ARRIVAL_CACHE_TTL_MS,
      loader:() => fetchLiveArrival(binding)});
  });
  now = new Date();
  const result = reconcileAlarmRuntime(state, alarmRuntimeState, now, {
    accuracyRuntime: busAccuracyRuntimeState,
  });
  alarmRuntimeState = result.runtime;
  alarmDeliveryState = reconcileAlarmDelivery(alarmDeliveryState, result, now);
  if (!result.plan.todayStatus.firing || now.getTime() > Date.parse(result.plan.window.endAt) + 90_000) {
    // Cancel every queued stage when today's schedule is stopped or expired.
    // Otherwise a failed push from an older alert could still be retried.
    for (const bundle of dispatchQueueState.bundles || []) {
      if (bundle.alertTriggerKey) {
        dispatchQueueState = resetDispatchQueueForAlert(dispatchQueueState, bundle.alertTriggerKey);
      }
    }
  }
  const dispatchResult = reconcileDispatchQueue(
    dispatchQueueState,
    alarmDeliveryState,
    deviceProfileState,
    { notificationSettings: state.notification, dateKey: result.runtime.dateKey },
    now,
  );
  dispatchQueueState = dispatchResult.queue;
  const executionResult = reconcileDispatchExecutions(dispatchExecutionState, dispatchQueueState, deviceProfileState, now);
  dispatchExecutionState = executionResult.executions;
  const pushGatewayResult = await reconcilePushGatewayState(
    pushGatewayState,
    dispatchQueueState,
    deviceProfileState,
    now,
    process.env,
  );
  pushGatewayState = pushGatewayResult.state;
  const invalidatedDeviceToken = await Promise.all(
    pushGatewayResult.newAttempts.map((attempt) =>
      invalidateDeviceTokenFromPushAttempt(attempt, now),
    ),
  );

  if (result.dueEvents.length) {
    await appendAlarmEvents(result.dueEvents, files.alarmEvents);
  }

  if (dispatchResult.newBundles.length) {
    await appendAlarmEvents(
      dispatchResult.newBundles.map((bundle) => ({
        kind: "DISPATCH_GENERATED",
        level: "INFO",
        title: `Dispatch bundle created for ${bundle.title}`,
        detail: `Stage ${bundle.stage} (${bundle.escalationLabel}) queued ${bundle.summary.queued}, blocked ${bundle.summary.blocked}, disabled ${bundle.summary.disabled}.`,
        createdAt: now.toISOString(),
        triggerAt: alarmDeliveryState.currentAlert?.triggerAt || null,
        dateKey: alarmDeliveryState.currentAlert?.dateKey || null,
        routeNumber: bundle.routeNumber,
        stopName: bundle.stopName,
        riskLevel: bundle.riskLevel,
        urgency: "",
        arrivalsMin: [],
        source: "dispatch-engine",
        liveEtaGuardMode: bundle.liveEtaGuardMode || "",
        accuracyRiskBufferMin: bundle.accuracyRiskBufferMin ?? 0,
        accuracySpreadMin: bundle.accuracySpreadMin ?? null,
        notificationSpec: null,
      })),
      files.alarmEvents,
    );
  }

  if (executionResult.newAttempts.length) {
    await appendAlarmEvents(
      executionResult.newAttempts.map((attempt) => ({
        kind: "DISPATCH_EXECUTED",
        level: attempt.summary.failed ? "WARN" : "INFO",
        title: `Dispatch simulated for ${attempt.title}`,
        detail: `${attempt.summary.simulated_sent} simulated sent, ${attempt.summary.failed} failed, ${attempt.summary.skipped} skipped.`,
        createdAt: now.toISOString(),
        triggerAt: attempt.bundleCreatedAt,
        dateKey: alarmDeliveryState.currentAlert?.dateKey || null,
        routeNumber: attempt.routeNumber,
        stopName: attempt.stopName,
        riskLevel: attempt.riskLevel,
        urgency: "",
        arrivalsMin: [],
        source: "dispatch-execution",
        liveEtaGuardMode: attempt.liveEtaGuardMode || "",
        accuracyRiskBufferMin: attempt.accuracyRiskBufferMin ?? 0,
        accuracySpreadMin: attempt.accuracySpreadMin ?? null,
        notificationSpec: null,
      })),
      files.alarmEvents,
    );
  }

  if (pushGatewayResult.newAttempts.length) {
    await appendAlarmEvents(
      pushGatewayResult.newAttempts.map((attempt) => ({
        kind: "PUSH_GATEWAY_AUTO_ATTEMPT",
        level: attempt.status === "FAILED" || attempt.status === "BLOCKED" ? "WARN" : "INFO",
        title:
          attempt.origin === "retry"
            ? attempt.title
              ? `Retry push ${String(attempt.status || "unknown").toLowerCase()} for ${attempt.title}`
              : "Retry push gateway attempt"
            : attempt.title
              ? `Auto push ${String(attempt.status || "unknown").toLowerCase()} for ${attempt.title}`
              : "Auto push gateway attempt",
        detail: attempt.reason,
        createdAt: attempt.createdAt,
        triggerAt: attempt.createdAt,
        dateKey: attempt.dateKey || null,
        routeNumber: attempt.routeNumber || "",
        stopName: attempt.stopName || "",
        riskLevel: attempt.riskLevel || "",
        urgency: "",
        arrivalsMin: [],
        source: "push-gateway-auto",
        liveEtaGuardMode: attempt.liveEtaGuardMode || "",
        accuracyRiskBufferMin: attempt.accuracyRiskBufferMin ?? 0,
        accuracySpreadMin: attempt.accuracySpreadMin ?? null,
        notificationSpec: null,
      })),
      files.alarmEvents,
    );
  }

  if (invalidatedDeviceToken.some(Boolean)) {
    await appendAlarmEvents(
      {
        kind: "PUSH_TOKEN_INVALIDATED",
        level: "WARN",
        title: "Device push token needs re-registration",
        detail:
          "FCM rejected the registered device token. BusWakeUp will stop using it until this phone registers its current FCM token again.",
        createdAt: now.toISOString(),
        triggerAt: now.toISOString(),
        dateKey: pushGatewayState.dateKey || null,
        routeNumber: "",
        stopName: "",
        riskLevel: "",
        urgency: "",
        arrivalsMin: [],
        source: "push-gateway-token-health",
        liveEtaGuardMode: "",
        accuracyRiskBufferMin: 0,
        accuracySpreadMin: null,
        notificationSpec: null,
      },
      files.alarmEvents,
    );
  }

  if (pushGatewayResult.scheduledRetries.length) {
    await appendAlarmEvents(
      pushGatewayResult.scheduledRetries.map((retryItem) => ({
        kind: "PUSH_GATEWAY_RETRY_SCHEDULED",
        level: "WARN",
        title: `Push retry ${retryItem.retryAttempt} scheduled`,
        detail: `${retryItem.routeNumber || "Route"} will retry at ${retryItem.scheduledAt}.`,
        createdAt: now.toISOString(),
        triggerAt: retryItem.scheduledAt,
        dateKey: pushGatewayState.dateKey || null,
        routeNumber: retryItem.routeNumber || "",
        stopName: retryItem.stopName || "",
        riskLevel: retryItem.riskLevel || "",
        urgency: "",
        arrivalsMin: [],
        source: "push-gateway-retry",
        liveEtaGuardMode: retryItem.liveEtaGuardMode || "",
        accuracyRiskBufferMin: retryItem.accuracyRiskBufferMin ?? 0,
        accuracySpreadMin: retryItem.accuracySpreadMin ?? null,
        notificationSpec: null,
      })),
      files.alarmEvents,
    );
  }

  await Promise.all([
    writeAlarmRuntimeState(alarmRuntimeState, files.alarmRuntime),
    writeAlarmDeliveryState(alarmDeliveryState, files.alarmDelivery),
    writeDispatchQueueState(dispatchQueueState, files.dispatchQueue),
    writeDispatchExecutionState(dispatchExecutionState, files.dispatchExecutions),
    writeDeviceProfile(deviceProfileState, files.deviceProfile),
    writePushGatewayState(pushGatewayState, files.pushGateway),
  ]);

  return {
    ...result,
    delivery: alarmDeliveryState,
    dispatch: dispatchQueueState,
    executions: dispatchExecutionState,
    pushGateway: pushGatewayState,
  };
}

async function safeTickAlarmRuntime(user = activeUserContext?.user, now = new Date()) {
  if (!user) {
    return {
      runtime: alarmRuntimeState,
      dueEvents: [],
      plan: null,
      delivery: alarmDeliveryState,
      dispatch: dispatchQueueState,
      executions: dispatchExecutionState,
      pushGateway: pushGatewayState,
    };
  }

  await activateUserContext(user);
  try {
    return await tickAlarmRuntime(now);
  } catch (error) {
    const files = getActiveFiles();
    alarmRuntimeState = {
      ...alarmRuntimeState,
      status: "error",
      lastTickAt: now.toISOString(),
      lastError: error instanceof Error ? error.message : "Unknown alarm runtime error.",
    };
    await writeAlarmRuntimeState(alarmRuntimeState, files.alarmRuntime);

    return {
      runtime: alarmRuntimeState,
      dueEvents: [],
      plan: null,
      delivery: alarmDeliveryState,
      dispatch: dispatchQueueState,
      executions: dispatchExecutionState,
      pushGateway: pushGatewayState,
    };
  }
}


function parseRequestUrl(request) {
  const target = String(request?.url || "/");
  // Host is client-controlled. Routing only needs the request target, so a
  // fixed internal origin prevents a malformed Host header from crashing the
  // process before request-level error handling can run.
  const safeTarget = target.startsWith("/") ? target : "/";
  try {
    return new URL(safeTarget, "http://buswakeup.internal");
  } catch {
    return new URL("/", "http://buswakeup.internal");
  }
}

async function handleRequest(request, response) {
  const requestUrl = parseRequestUrl(request);
  const now = new Date();
  let requestAuth = null;

  if (requestUrl.pathname === "/api/mobile/health" && request.method === "GET") {
    try {
      const healthPayload = await buildMobileHealthPayload(process.env, now);
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(healthPayload));
      return;
    } catch (error) {
      response.writeHead(500, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown mobile health error." }));
      return;
    }
  }


  if (requestUrl.pathname.startsWith("/api/") && !PUBLIC_API_PATHS.has(requestUrl.pathname)) {
    requestAuth = await resolveAuthenticatedRequest(request, now);
    if (!requestAuth) {
      response.writeHead(401, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ error: "Sign in first to access your BusWakeUp workspace." }));
      return;
    }

    await activateUserContext(requestAuth.user);
  }


  if (requestUrl.pathname === "/api/account" && request.method === "GET") {
    try {
      const files = getActiveFiles();
      const [events, snapshot, pushState] = await Promise.all([
        readAlarmEvents(files.alarmEvents),
        readEffectiveDomainSnapshot(),
        readPushGatewayState(files.pushGateway),
      ]);
      const pushSummary = summarizePushGatewayState(pushState || createPushGatewayState(), 3);

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          user: sanitizeAuthUser(activeUserContext.user),
          session: requestAuth
            ? {
                id: requestAuth.session.id,
                expiresAt: requestAuth.session.expiresAt,
                updatedAt: requestAuth.session.updatedAt,
              }
            : null,
          workspace: {
            eventCount: events.length,
            pushAttemptCount: pushSummary.total,
            retryPending: pushSummary.retryPolicy?.pendingRetries || 0,
            hasRouteBinding: Boolean(snapshot?.route?.selectedStopId),
            primaryRouteNumber: snapshot?.route?.liveBinding?.routeNumber || snapshot?.route?.primaryLineId || "",
            deviceName: deviceProfileState.deviceName || "",
            platform: deviceProfileState.platform || "",
          },
          fetchedAt: now.toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown account summary error." }));
      return;
    }
  }


  if (requestUrl.pathname === "/api/app-state" && request.method === "GET") {
    try {
      const state = await readAppState(getActiveFiles().appState);
      if (!state) {
        response.writeHead(404, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify({ error: "No persisted app state yet." }));
        return;
      }

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(state));
      return;
    } catch (error) {
      response.writeHead(500, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown app-state load error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/app-state" && request.method === "POST") {
    try {
      const payload = await readJsonBody(request);
      const saved = await writeAppState(payload, getActiveFiles().appState);
      await safeTickAlarmRuntime(activeUserContext.user, now);

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ok: true,
          savedAt: new Date().toISOString(),
          state: saved,
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown app-state save error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/alarm-plan" && request.method === "GET") {
    try {
      const state = await readEffectiveAppState();
      if (!state) {
        response.writeHead(404, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify({ error: "No persisted app state yet." }));
        return;
      }

      const now = requestUrl.searchParams.get("now");
      const plan = buildAlarmPlan(state, now ? new Date(now) : new Date(), {
        accuracyRuntime: busAccuracyRuntimeState,
      });

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(plan));
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown alarm-plan load error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/alarm-plan" && request.method === "POST") {
    try {
      const payload = await readJsonBody(request);
      const previewState = payload?.state ?? payload;
      const plan = buildAlarmPlan(previewState, payload?.now ? new Date(payload.now) : new Date(), {
        accuracyRuntime: busAccuracyRuntimeState,
      });

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(plan));
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown alarm-plan preview error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/domain-snapshot" && request.method === "GET") {
    try {
      const snapshot = await readEffectiveDomainSnapshot();
      if (!snapshot) {
        response.writeHead(404, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify({ error: "No domain snapshot exists yet." }));
        return;
      }

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(snapshot));
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown domain snapshot load error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/domain-sync" && request.method === "POST") {
    try {
      const payload = await readJsonBody(request);
      const snapshot = projectDomainSnapshot(payload?.state || {});
      const saved = await persistDomainSnapshot(snapshot);
      await safeTickAlarmRuntime();

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ok: true,
          savedAt: new Date().toISOString(),
          snapshot: saved,
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown domain sync error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname in DOMAIN_ENDPOINTS && request.method === "GET") {
    try {
      const snapshot = await readEffectiveDomainSnapshot();
      if (!snapshot) {
        response.writeHead(404, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify({ error: "No domain snapshot exists yet." }));
        return;
      }

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(snapshot[DOMAIN_ENDPOINTS[requestUrl.pathname]]));
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown domain entity load error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname in DOMAIN_ENDPOINTS && request.method === "PUT") {
    try {
      const patch = await readJsonBody(request);
      const currentSnapshot = (await readEffectiveDomainSnapshot()) || projectDomainSnapshot({});
      const nextSnapshot = updateDomainEntity(currentSnapshot, DOMAIN_ENDPOINTS[requestUrl.pathname], patch);
      await persistDomainSnapshot(nextSnapshot);
      await safeTickAlarmRuntime();

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ok: true,
          savedAt: new Date().toISOString(),
          entity: nextSnapshot[DOMAIN_ENDPOINTS[requestUrl.pathname]],
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown domain entity update error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/device-profile" && request.method === "GET") {
    try {
      deviceProfileState = await readEffectiveDeviceProfile();
      const tokenHealth = analyzeDevicePushTarget(deviceProfileState);

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          profile: deviceProfileState,
          tokenHealth,
          fetchedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown device profile load error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/device-profile" && request.method === "PUT") {
    try {
      deviceProfileState = await readEffectiveDeviceProfile();
      const patch = await readJsonBody(request);
      const nextProfile = sanitizeDeviceProfile({
        ...deviceProfileState,
        ...patch,
        updatedAt: new Date().toISOString(),
      });
      if (!nextProfile.registeredAt) {
        nextProfile.registeredAt = nextProfile.updatedAt;
      }

      deviceProfileState = await persistDeviceProfile(nextProfile);

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ok: true,
          savedAt: new Date().toISOString(),
          profile: deviceProfileState,
          tokenHealth: analyzeDevicePushTarget(deviceProfileState),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown device profile save error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/device-profile/token-health" && request.method === "GET") {
    try {
      deviceProfileState = await readEffectiveDeviceProfile();

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          health: analyzeDevicePushTarget(deviceProfileState),
          fetchedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown device token health error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/device-profile/register-token" && request.method === "POST") {
    try {
      deviceProfileState = await readEffectiveDeviceProfile();
      const patch = await readJsonBody(request);
      const registered = registerDevicePushToken(deviceProfileState, patch, new Date());
      deviceProfileState = await persistDeviceProfile(registered.profile);

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ok: true,
          savedAt: new Date().toISOString(),
          profile: deviceProfileState,
          tokenHealth: analyzeDevicePushTarget(deviceProfileState),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown device token registration error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/dispatch-queue" && request.method === "GET") {
    try {
      await safeTickAlarmRuntime();
      const limit = Math.max(Number(requestUrl.searchParams.get("limit") || 4), 1);

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          bundles: dispatchQueueState.bundles.slice(0, limit),
          total: dispatchQueueState.bundles.length,
          deviceProfile: {
            deviceId: deviceProfileState.deviceId,
            deviceName: deviceProfileState.deviceName,
            platform: deviceProfileState.platform,
            pushEnabled: deviceProfileState.pushEnabled,
            localBackupEnabled: deviceProfileState.localBackupEnabled,
          },
          fetchedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown dispatch queue load error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/push-preview" && request.method === "GET") {
    try {
      await safeTickAlarmRuntime();
      const preview = buildPushPreview(dispatchQueueState.bundles[0] || null, deviceProfileState, new Date());

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          preview,
          queueTotal: dispatchQueueState.bundles.length,
          fetchedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown push preview error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/push-gateway/config" && request.method === "GET") {
    try {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          config: getPushGatewayConfig(process.env),
          fetchedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown push gateway config error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/fcm-auth/status" && request.method === "GET") {
    try {
      const status = await readFcmAuthStatus(process.env, new Date());
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          status,
          fetchedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown FCM auth status error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/push-gateway/attempts" && request.method === "GET") {
    try {
      const limit = Math.max(Number(requestUrl.searchParams.get("limit") || 4), 1);
      const summary = summarizePushGatewayState(pushGatewayState, limit);

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ...summary,
          fetchedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown push gateway attempts error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/push-gateway/dispatch" && request.method === "POST") {
    try {
      await safeTickAlarmRuntime();
      const payload = await readJsonBody(request);
      const dispatchKey = String(payload?.dispatchKey || "").trim();
      const bundle =
        (dispatchKey
          ? dispatchQueueState.bundles.find((item) => String(item.dispatchKey || "") === dispatchKey)
          : dispatchQueueState.bundles[0]) || null;
      const preview = buildPushPreview(bundle, deviceProfileState, new Date());
      const gatewayConfig = getPushGatewayConfig(process.env);
      const plan = buildPushGatewayPlan(preview, gatewayConfig, process.env, deviceProfileState);
      const attempt = await runPushGatewayDispatch(preview, gatewayConfig, new Date(), process.env, deviceProfileState);

      pushGatewayState = recordPushGatewayAttempt(pushGatewayState, attempt, {
        origin: "manual",
        preview,
        dateKey: bundle?.dispatchKey ? String(bundle.dispatchKey).slice(0, 10) : null,
        now: new Date(),
      });
      await writePushGatewayState(pushGatewayState, getActiveFiles().pushGateway);
      await invalidateDeviceTokenFromPushAttempt(attempt, new Date());

      await appendAlarmEvents({
        kind: "PUSH_GATEWAY_ATTEMPT",
        level: attempt.status === "FAILED" || attempt.status === "BLOCKED" ? "WARN" : "INFO",
        title: attempt.title ? `Push gateway ${attempt.status.toLowerCase()} for ${attempt.title}` : "Push gateway attempt",
        detail: attempt.reason,
        createdAt: attempt.createdAt,
        triggerAt: bundle?.createdAt || null,
        dateKey: bundle?.dispatchKey ? String(bundle.dispatchKey).slice(0, 10) : null,
        routeNumber: bundle?.routeNumber || "",
        stopName: bundle?.stopName || "",
        riskLevel: bundle?.riskLevel || "",
        urgency: "",
        arrivalsMin: [],
        source: "push-gateway",
        liveEtaGuardMode: attempt.liveEtaGuardMode || "",
        accuracyRiskBufferMin: attempt.accuracyRiskBufferMin ?? 0,
        accuracySpreadMin: attempt.accuracySpreadMin ?? null,
        notificationSpec: bundle?.notificationSpec || null,
      }, getActiveFiles().alarmEvents);

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ok: true,
          plan,
          attempt,
          totalAttempts: pushGatewayState.attempts.length,
          savedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown push gateway dispatch error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/push-gateway/test-dispatch" && request.method === "POST") {
    try {
      deviceProfileState = await readEffectiveDeviceProfile();
      const payload = await readJsonBody(request);
      const appState = await readEffectiveAppState();
      const preview = buildTestPushPreview(
        deviceProfileState,
        {
          routeNumber: payload?.routeNumber || appState?.live?.routeNumber || appState?.live?.routeId || appState?.commute?.primaryLineId || "1002",
          stopName: payload?.stopName || appState?.live?.stationName || appState?.commute?.selectedStopId || "Registered stop",
          riskLevel: payload?.riskLevel || "RED",
          title: payload?.title || "",
          body: payload?.body || "",
          spokenText: payload?.spokenText || "",
        },
        new Date(),
      );
      const gatewayConfig = getPushGatewayConfig(process.env);
      const plan = buildPushGatewayPlan(preview, gatewayConfig, process.env, deviceProfileState);
      const attempt = await runPushGatewayDispatch(preview, gatewayConfig, new Date(), process.env, deviceProfileState);

      pushGatewayState = recordPushGatewayAttempt(pushGatewayState, attempt, {
        origin: "test",
        preview,
        dateKey: attempt.createdAt ? String(attempt.createdAt).slice(0, 10) : null,
        now: new Date(),
      });
      await writePushGatewayState(pushGatewayState, getActiveFiles().pushGateway);
      await invalidateDeviceTokenFromPushAttempt(attempt, new Date());

      await appendAlarmEvents({
        kind: "PUSH_GATEWAY_TEST_ATTEMPT",
        level: attempt.status === "FAILED" || attempt.status === "BLOCKED" ? "WARN" : "INFO",
        title: `Test push ${attempt.status.toLowerCase()}`,
        detail: attempt.reason,
        createdAt: attempt.createdAt,
        triggerAt: attempt.createdAt,
        dateKey: attempt.createdAt.slice(0, 10),
        routeNumber: preview?.envelope?.message?.data?.routeNumber || "",
        stopName: preview?.envelope?.message?.data?.stopName || "",
        riskLevel: preview?.riskLevel || "",
        urgency: "",
        arrivalsMin: [],
        source: "push-gateway-test",
        liveEtaGuardMode: attempt.liveEtaGuardMode || "",
        accuracyRiskBufferMin: attempt.accuracyRiskBufferMin ?? 0,
        accuracySpreadMin: attempt.accuracySpreadMin ?? null,
        notificationSpec: preview?.envelope?.message || null,
      }, getActiveFiles().alarmEvents);

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ok: true,
          preview,
          plan,
          attempt,
          totalAttempts: pushGatewayState.attempts.length,
          savedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown test push dispatch error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/push-gateway/retry-simulation" && request.method === "POST") {
    try {
      deviceProfileState = await readEffectiveDeviceProfile();
      const payload = await readJsonBody(request);
      const action = String(payload?.action || "seed-retryable-failure").trim().toLowerCase();
      const now = payload?.now ? new Date(payload.now) : new Date();
      const appState = await readEffectiveAppState();
      const routeNumber =
        payload?.routeNumber || appState?.live?.routeNumber || appState?.live?.routeId || appState?.commute?.primaryLineId || "1002";
      const stopName = payload?.stopName || appState?.live?.stationName || appState?.commute?.selectedStopId || "Registered stop";
      const riskLevel = payload?.riskLevel || "RED";
      const simulationProfile = createSimulationDeviceProfile(deviceProfileState);
      let simulationBundle = null;
      let simulationResult = null;
      let outcome = "retryable-failure";

      if (action === "seed-retryable-failure") {
        simulationBundle = buildRetrySimulationBundle(
          {
            routeNumber,
            stopName,
            riskLevel,
          },
          now,
        );

        simulationResult = await reconcilePushGatewayState(
          pushGatewayState,
          buildRetrySimulationQueueState(simulationBundle, now),
          simulationProfile,
          now,
          process.env,
          {
            dispatchRunner: createSimulationDispatchRunner("retryable-failure"),
          },
        );
      } else if (action === "run-due-retry") {
        outcome = String(payload?.outcome || "success").trim().toLowerCase();
        if (!pushGatewayState.retryQueue.length) {
          response.writeHead(400, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          });
          response.end(JSON.stringify({ error: "No retry item is waiting in the simulation queue." }));
          return;
        }

        const forcedRetryState = {
          ...pushGatewayState,
          retryQueue: pushGatewayState.retryQueue.map((item) => ({
            ...item,
            scheduledAt: new Date(now.getTime() - 1_000).toISOString(),
          })),
        };

        simulationResult = await reconcilePushGatewayState(
          forcedRetryState,
          buildRetrySimulationQueueFromItems(forcedRetryState.retryQueue, now),
          simulationProfile,
          now,
          process.env,
          {
            dispatchRunner: createSimulationDispatchRunner(outcome),
          },
        );
      } else if (action === "clear-simulation") {
        pushGatewayState = pruneSimulationGatewayState(pushGatewayState);
        await writePushGatewayState(pushGatewayState, getActiveFiles().pushGateway);

        await appendAlarmEvents({
          kind: "PUSH_GATEWAY_SIMULATION",
          level: "INFO",
          title: "Push retry simulation cleared",
          detail: "Simulation-only push attempts, retry items, and handled keys were removed.",
          createdAt: now.toISOString(),
          triggerAt: now.toISOString(),
          dateKey: dateOnlyKey(now),
          routeNumber,
          stopName,
          riskLevel,
          urgency: "",
          arrivalsMin: [],
          source: "push-gateway-simulation",
          liveEtaGuardMode: "",
          accuracyRiskBufferMin: 0,
          accuracySpreadMin: null,
          notificationSpec: null,
        }, getActiveFiles().alarmEvents);

        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(
          JSON.stringify({
            ok: true,
            action,
            outcome: "cleared",
            attempt: null,
            newAttempts: [],
            scheduledRetries: [],
            pushGateway: summarizePushGatewayState(pushGatewayState, 4),
            savedAt: new Date().toISOString(),
          }),
        );
        return;
      } else {
        response.writeHead(400, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify({ error: "Unknown retry simulation action." }));
        return;
      }

      pushGatewayState = simulationResult.state;
      await writePushGatewayState(pushGatewayState, getActiveFiles().pushGateway);

      const firstAttempt = simulationResult.newAttempts[0] || null;
      await appendAlarmEvents({
        kind: "PUSH_GATEWAY_SIMULATION",
        level: firstAttempt?.status === "FAILED" || firstAttempt?.status === "BLOCKED" ? "WARN" : "INFO",
        title:
          action === "seed-retryable-failure"
            ? "Push retry simulation seeded"
            : outcome === "success"
              ? "Push retry simulation completed"
              : "Push retry simulation replayed",
        detail:
          firstAttempt?.reason ||
          (action === "seed-retryable-failure"
            ? "A retryable provider failure was simulated."
            : "A due retry item was replayed."),
        createdAt: now.toISOString(),
        triggerAt: firstAttempt?.createdAt || now.toISOString(),
        dateKey: dateOnlyKey(now),
        routeNumber: firstAttempt?.routeNumber || simulationBundle?.routeNumber || routeNumber,
        stopName: firstAttempt?.stopName || simulationBundle?.stopName || stopName,
        riskLevel: firstAttempt?.riskLevel || simulationBundle?.riskLevel || riskLevel,
        urgency: "",
        arrivalsMin: [],
        source: "push-gateway-simulation",
        liveEtaGuardMode: firstAttempt?.liveEtaGuardMode || simulationBundle?.liveEtaGuardMode || "",
        accuracyRiskBufferMin: firstAttempt?.accuracyRiskBufferMin ?? simulationBundle?.accuracyRiskBufferMin ?? 0,
        accuracySpreadMin: firstAttempt?.accuracySpreadMin ?? simulationBundle?.accuracySpreadMin ?? null,
        notificationSpec: simulationBundle?.notificationSpec || null,
      }, getActiveFiles().alarmEvents);

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ok: true,
          action,
          outcome,
          attempt: firstAttempt,
          newAttempts: simulationResult.newAttempts,
          scheduledRetries: simulationResult.scheduledRetries,
          pushGateway: summarizePushGatewayState(pushGatewayState, 4),
          savedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown push retry simulation error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/dispatch-executions" && request.method === "GET") {
    try {
      await safeTickAlarmRuntime();
      const limit = Math.max(Number(requestUrl.searchParams.get("limit") || 4), 1);

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          attempts: dispatchExecutionState.attempts.slice(0, limit),
          total: dispatchExecutionState.attempts.length,
          lastExecutedAt: dispatchExecutionState.lastExecutedAt,
          fetchedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown dispatch execution load error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/alarm-runtime" && request.method === "GET") {
    try {
      const result = await safeTickAlarmRuntime();
      const pushGatewaySummary = summarizePushGatewayState(result.pushGateway, 3);
      const [events, appState] = await Promise.all([
        readAlarmEvents(getActiveFiles().alarmEvents),
        readEffectiveAppState(),
      ]);
      const conservativeReliability = buildConservativeReliabilityReport({
        schedule: appState?.schedule || {},
        events,
        dispatchBundles: result.dispatch.bundles,
        dispatchExecutions: result.executions.attempts,
        pushGatewayAttempts: result.pushGateway.attempts,
        retryQueue: result.pushGateway.retryQueue,
        days: 7,
        now,
      });
      const deliveryIntensity = buildDeliveryIntensityReport({
        now,
        timeZone: "Asia/Seoul",
        events,
        dispatchBundles: result.dispatch.bundles,
        dispatchExecutions: result.executions.attempts,
        pushGatewayAttempts: result.pushGateway.attempts,
        retryQueue: result.pushGateway.retryQueue,
      });

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          runtime: result.runtime,
          delivery: result.delivery,
          dispatch: {
            bundles: result.dispatch.bundles.slice(0, 3),
            total: result.dispatch.bundles.length,
          },
          executions: {
            attempts: result.executions.attempts.slice(0, 3),
            total: result.executions.attempts.length,
            lastExecutedAt: result.executions.lastExecutedAt,
          },
          pushGateway: pushGatewaySummary,
          conservativeReliability,
          deliveryIntensity,
          plan: result.plan
            ? {
                generatedAt: result.plan.generatedAt,
                todayStatus: result.plan.todayStatus,
                route: result.plan.route,
                stop: result.plan.stop,
                nextTrigger: result.plan.nextTrigger,
                remainingTriggers: result.plan.remainingTriggers,
                totalTriggers: result.plan.totalTriggers,
                precheckTriggerCount: result.plan.precheckTriggerCount,
                remainingPrecheckTriggers: result.plan.remainingPrecheckTriggers,
                stabilityWatch: result.plan.stabilityWatch,
              }
            : null,
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown alarm runtime error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/alarm-delivery" && request.method === "GET") {
    try {
      const result = await safeTickAlarmRuntime();

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          delivery: result.delivery,
          runtime: result.runtime,
          fetchedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown alarm delivery load error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/alarm-delivery/actions" && request.method === "POST") {
    try {
      const payload = await readJsonBody(request);
      const actionType = String(payload?.type || "").trim().toUpperCase();
      const now = new Date();
      await safeTickAlarmRuntime(activeUserContext.user, now);

      const previousAlert = alarmDeliveryState.currentAlert;
      alarmDeliveryState = applyAlarmDeliveryAction(alarmDeliveryState, { type: actionType }, now);
      await writeAlarmDeliveryState(alarmDeliveryState, getActiveFiles().alarmDelivery);

      if (actionType === "ACK_DEPARTED") {
        const state = await readEffectiveAppState();
        if (state) {
          state.schedule.snoozeDate = dateOnlyKey(now);
          const snapshot = projectDomainSnapshot(state);
          await Promise.all([
            writeAppState(state, getActiveFiles().appState),
            writeDomainSnapshot(snapshot, getActiveFiles().domain),
          ]);
        }
      }

      if ((actionType === "SNOOZE_1M" || actionType === "ACK_DEPARTED") && previousAlert?.triggerKey) {
        dispatchQueueState = resetDispatchQueueForAlert(dispatchQueueState, previousAlert.triggerKey);
        pushGatewayState = resetPushGatewayHandledKeysForAlert(pushGatewayState, previousAlert.triggerKey);
        await Promise.all([
          writeDispatchQueueState(dispatchQueueState, getActiveFiles().dispatchQueue),
          writePushGatewayState(pushGatewayState, getActiveFiles().pushGateway),
        ]);
      }

      await appendAlarmEvents({
        kind: "DELIVERY_ACTION",
        level: "INFO",
        title:
          actionType === "ACK_DEPARTED"
            ? "Departed confirmed"
            : actionType === "SNOOZE_1M"
              ? "Alarm snoozed for 1 minute"
              : "Alarm dismissed",
        detail:
          actionType === "ACK_DEPARTED"
            ? "The user confirmed departure and stopped the rest of today's alarms."
            : actionType === "SNOOZE_1M"
              ? "The current active alert was snoozed for one minute."
              : "The current active alert was dismissed.",
        createdAt: now.toISOString(),
        triggerAt: previousAlert?.triggerAt || null,
        dateKey: previousAlert?.dateKey || null,
        routeNumber: previousAlert?.routeNumber || "",
        stopName: previousAlert?.stopName || "",
        riskLevel: previousAlert?.riskLevel || "",
        urgency: previousAlert?.urgency || "",
        arrivalsMin: Array.isArray(previousAlert?.arrivalsMin) ? previousAlert.arrivalsMin : [],
        source: "delivery-action",
        liveEtaGuardMode: previousAlert?.liveEtaGuardMode || "",
        accuracyRiskBufferMin: previousAlert?.etaRiskBufferMin ?? previousAlert?.notificationSpec?.accuracyRiskBufferMin ?? 0,
        accuracySpreadMin: previousAlert?.notificationSpec?.accuracySpreadMin ?? null,
        notificationSpec: previousAlert?.notificationSpec || null,
      }, getActiveFiles().alarmEvents);

      const result = await safeTickAlarmRuntime(activeUserContext.user, now);

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ok: true,
          action: actionType,
          delivery: result.delivery,
          runtime: result.runtime,
          savedAt: now.toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown alarm delivery action error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/alarm-events" && request.method === "GET") {
    try {
      const limit = Math.max(Number(requestUrl.searchParams.get("limit") || 8), 1);
      const events = await readAlarmEvents(getActiveFiles().alarmEvents);

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          events: events.slice(0, limit),
          total: events.length,
          fetchedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown alarm event load error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/alarm-events" && request.method === "POST") {
    try {
      const payload = await readJsonBody(request);
      const events = await appendAlarmEvents({
        kind: payload?.kind || "APP_ACTION",
        level: payload?.level || "INFO",
        title: payload?.title || "",
        detail: payload?.detail || "",
        createdAt: new Date().toISOString(),
        triggerAt: payload?.triggerAt || null,
        dateKey: payload?.dateKey || null,
        routeNumber: payload?.routeNumber || "",
        stopName: payload?.stopName || "",
        riskLevel: payload?.riskLevel || "",
        urgency: payload?.urgency || "",
        arrivalsMin: Array.isArray(payload?.arrivalsMin) ? payload.arrivalsMin : [],
        source: payload?.source || "app",
        liveEtaGuardMode: payload?.liveEtaGuardMode || "",
        accuracyRiskBufferMin: payload?.accuracyRiskBufferMin ?? 0,
        accuracySpreadMin: payload?.accuracySpreadMin ?? null,
        notificationSpec: payload?.notificationSpec || null,
      }, getActiveFiles().alarmEvents);

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ok: true,
          savedAt: new Date().toISOString(),
          event: events[0],
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown alarm event create error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/bus/config") {
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(getBusApiConfig()));
    return;
  }

  if (requestUrl.pathname === "/api/places/config") {
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(getPlaceApiConfig(process.env)));
    return;
  }

  if (requestUrl.pathname === "/api/places/search") {
    try {
      const query = requestUrl.searchParams.get("query") || "";
      const results = await searchAddressPlaces(query, process.env);

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          query,
          results,
          fetchedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown address search error." }));
      return;
    }
  }

  if (requestUrl.pathname === "/api/commute/config") {
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(getRouteApiConfig(process.env)));
    return;
  }

  if (requestUrl.pathname === "/api/commute/transit" && request.method === "POST") {
    try {
      const payload = await readJsonBody(request);
      const result = await fetchTransitRoutes(payload, process.env);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "대중교통 경로 조회에 실패했습니다." }));
    }
    return;
  }

  if (requestUrl.pathname === "/api/commute/estimate" && request.method === "POST") {
    try {
      const payload = await readJsonBody(request);
      const estimate = await estimateCommuteRoute(payload, process.env);

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(estimate));
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown commute estimate error." }));
      return;
    }
  }

  if (requestUrl.pathname === "/api/bus/arrivals") {
    try {
      const liveRequestAuth = await resolveAuthenticatedRequest(request, now);
      if (liveRequestAuth?.user) {
        await activateUserContext(liveRequestAuth.user);
      }

      const binding = {
        provider: requestUrl.searchParams.get("provider") || "",
        stationName: requestUrl.searchParams.get("stationName") || "",
        stationId: requestUrl.searchParams.get("stationId") || "",
        arsId: requestUrl.searchParams.get("arsId") || "",
        routeId: requestUrl.searchParams.get("routeId") || "",
        order: requestUrl.searchParams.get("order") || "",
        cityCode: requestUrl.searchParams.get("cityCode") || "",
        nodeId: requestUrl.searchParams.get("nodeId") || "",
        routeNumber: requestUrl.searchParams.get("routeNumber") || "",
        regionHint: requestUrl.searchParams.get("regionHint") || "",
        selectedStopId: requestUrl.searchParams.get("selectedStopId") || "",
        stopKey: requestUrl.searchParams.get("stopKey") || "",
      };
      const result = await loadWithCache({
        key: ["live-arrivals", binding],
        ttlMs: LIVE_ARRIVAL_CACHE_TTL_MS,
        loader: () => fetchLiveArrival(binding),
      });
      const payload = result.value;
      const effectiveRouteNumber = String(payload.lineNumber || binding.routeNumber || "").trim();
      const effectiveStopName = String(payload.stopName || "").trim();
      const accuracyStopKey = buildAccuracyStopKey({
        stopKey: binding.stopKey,
        selectedStopId: binding.selectedStopId,
        provider: payload.provider || binding.provider,
        stationId: binding.stationId,
        arsId: binding.arsId,
        cityCode: binding.cityCode,
        nodeId: binding.nodeId,
        stopName: effectiveStopName,
      });

      if (liveRequestAuth?.user && result.cacheStatus !== "stale-fallback") {
        await persistForecastObservation({
          provider: payload.provider || binding.provider,
          routeNumber: effectiveRouteNumber,
          stopName: effectiveStopName,
          stopKey: accuracyStopKey,
          predictedMinutes: Array.isArray(payload.arrivalsMin) ? Number(payload.arrivalsMin[0]) : null,
          observedAt: result.fetchedAt || now.toISOString(),
          region: inferRegionHint(payload.provider || binding.provider, binding.regionHint),
          source: result.cacheStatus,
        });
      }

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ...payload,
          source:
            result.cacheStatus === "stale-fallback"
              ? "fallback-cache"
              : result.cacheStatus === "cache-hit"
                ? "cache"
                : "live",
          cacheStatus: result.cacheStatus,
          stale: result.stale,
          fetchedAt: result.fetchedAt,
          servedAt: result.servedAt,
          fallbackError: result.fallbackError,
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown live arrival error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/bus/cities" && request.method === "GET") {
    try {
      if (requestUrl.searchParams.get("provider") !== "tago") throw new Error("도시코드 조회는 TAGO만 지원합니다.");
      const service = requestUrl.searchParams.get("service") || "arrivals";
      if (!["arrivals", "stops"].includes(service)) throw new Error("지원하지 않는 TAGO 서비스입니다.");
      const result = await loadWithCache({
        key: ["tago-cities", service],
        ttlMs: 24 * 60 * 60 * 1000,
        loader: () => fetchTagoCities({ serviceKey: process.env.TAGO_SERVICE_KEY, service }),
      });
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ provider: "tago", cities: result.value, fetchedAt: result.fetchedAt, stale: result.stale }));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "도시코드 조회에 실패했습니다." }));
    }
    return;
  }

  if (requestUrl.pathname === "/api/bus/stations") {
    try {
      const payload = await searchLiveStations({
        provider: requestUrl.searchParams.get("provider") || "",
        keyword: requestUrl.searchParams.get("keyword") || "",
        cityCode: requestUrl.searchParams.get("cityCode") || "",
      });

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ...payload,
          source: "live",
          fetchedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown live station search error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/bus/station-routes") {
    try {
      const payload = await searchLiveStationRoutes({
        provider: requestUrl.searchParams.get("provider") || "",
        stationName: requestUrl.searchParams.get("stationName") || "",
        arsId: requestUrl.searchParams.get("arsId") || "",
        stationId: requestUrl.searchParams.get("stationId") || "",
        routeNumber: requestUrl.searchParams.get("routeNumber") || "",
        cityCode: requestUrl.searchParams.get("cityCode") || "",
        nodeId: requestUrl.searchParams.get("nodeId") || "",
      });

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ...payload,
          source: "live",
          fetchedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown live station-route search error.",
        }),
      );
      return;
    }
  }

  if (requestUrl.pathname === "/api/bus/accuracy" && request.method === "GET") {
    try {
      const region = requestUrl.searchParams.get("region") || "";
      const routeNumber = requestUrl.searchParams.get("routeNumber") || "";
      const stopName = requestUrl.searchParams.get("stopName") || "";
      const appState = await readEffectiveAppState();
      const stopKey = buildAccuracyStopKey({
        stopKey: requestUrl.searchParams.get("stopKey") || "",
        selectedStopId: appState?.commute?.selectedStopId || "",
        stopName,
      });

      const summary = buildBusAccuracySnapshot(busAccuracyState, {
        region,
        routeNumber,
        stopName,
        stopKey,
        fallbackOrder: getAccuracyFallbackOrder(region),
        timeSlice: getAccuracyTimeSliceOptions(appState, now),
      });

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ...summary,
          runtime: busAccuracyRuntimeState,
          fetchedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown bus accuracy summary error." }));
      return;
    }
  }

  if (requestUrl.pathname === "/api/bus/accuracy/leaderboard" && request.method === "GET") {
    try {
      const region = requestUrl.searchParams.get("region") || "";
      const limit = Math.max(Number(requestUrl.searchParams.get("limit") || 6), 1);
      const appState = await readEffectiveAppState();
      const leaderboard = buildBusAccuracyLeaderboard(busAccuracyState, {
        region,
        limit,
        fallbackOrderResolver: getAccuracyFallbackOrder,
        timeSlice: getAccuracyTimeSliceOptions(appState, now),
      });

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ...leaderboard,
          fetchedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown bus accuracy leaderboard error." }));
      return;
    }
  }

  if (requestUrl.pathname === "/api/bus/accuracy/probe" && request.method === "POST") {
    try {
      const payload = await readJsonBody(request);
      const appState = await readEffectiveAppState();
      const accuracyTimeSlice = getAccuracyTimeSliceOptions(appState, now);
      const requestedStopKey = buildAccuracyStopKey({
        stopKey: payload?.stopKey || "",
        selectedStopId: appState?.commute?.selectedStopId || "",
        stopName: payload?.stopName || "",
      });
      const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
      if (!candidates.length) {
        throw new Error("At least one provider candidate is required for an accuracy probe.");
      }

      const comparisons = [];
      for (const candidate of candidates) {
        const binding = {
          provider: String(candidate?.provider || "").trim(),
          stationId: String(candidate?.stationId || "").trim(),
          routeId: String(candidate?.routeId || "").trim(),
          order: String(candidate?.order || "").trim(),
          cityCode: String(candidate?.cityCode || "").trim(),
          nodeId: String(candidate?.nodeId || "").trim(),
          routeNumber: String(candidate?.routeNumber || "").trim(),
          regionHint: String(candidate?.regionHint || payload?.region || "").trim(),
        };

        if (!binding.provider) {
          continue;
        }

        const result = await loadWithCache({
          key: ["accuracy-probe", binding],
          ttlMs: LIVE_ARRIVAL_CACHE_TTL_MS,
          loader: () => fetchLiveArrival(binding),
        });
        const livePayload = result.value;
        const effectiveRouteNumber = String(livePayload.lineNumber || binding.routeNumber || "").trim();
        const effectiveStopName = String(livePayload.stopName || "").trim();
        const region = inferRegionHint(livePayload.provider || binding.provider, binding.regionHint);

        if (result.cacheStatus !== "stale-fallback") {
          await persistForecastObservation({
            provider: livePayload.provider || binding.provider,
            routeNumber: effectiveRouteNumber,
            stopName: effectiveStopName,
            stopKey: requestedStopKey,
            predictedMinutes: Array.isArray(livePayload.arrivalsMin) ? Number(livePayload.arrivalsMin[0]) : null,
            observedAt: result.fetchedAt || now.toISOString(),
            region,
            source: `probe-${result.cacheStatus}`,
          });
        }

        comparisons.push({
          provider: livePayload.provider || binding.provider,
          region,
          routeNumber: effectiveRouteNumber,
          stopName: effectiveStopName,
          arrivalsMin: livePayload.arrivalsMin,
          messages: Array.isArray(livePayload.messages) ? livePayload.messages : [],
          cacheStatus: result.cacheStatus,
          fetchedAt: result.fetchedAt,
          fallbackError: result.fallbackError || "",
        });
      }

      const summaryRegion = String(payload?.region || comparisons[0]?.region || "").trim();
      const summaryRouteNumber = String(payload?.routeNumber || comparisons[0]?.routeNumber || "").trim();
      const summaryStopName = String(payload?.stopName || comparisons[0]?.stopName || "").trim();
      const autoResolved = await maybeAutoResolveArrivalFromComparisons({
        comparisons,
        region: summaryRegion,
        routeNumber: summaryRouteNumber,
        stopName: summaryStopName,
        stopKey: requestedStopKey,
        now,
      });
      const comparisonSummary = summarizeBusAccuracyComparisons(comparisons);
      busAccuracyRuntimeState = markBusAccuracyProbeObservation(busAccuracyRuntimeState, {
        now,
        source: "manual",
        comparisonCount: comparisons.length,
        comparisonSummary,
      });
      await writeBusAccuracyRuntimeState(busAccuracyRuntimeState, getActiveFiles().busAccuracyRuntime);

      const summary = buildBusAccuracySnapshot(busAccuracyState, {
        region: summaryRegion,
        routeNumber: summaryRouteNumber,
        stopName: summaryStopName,
        stopKey: requestedStopKey,
        fallbackOrder: getAccuracyFallbackOrder(summaryRegion),
        timeSlice: accuracyTimeSlice,
      });

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ok: true,
          comparisons,
          comparisonSummary,
          summary,
          runtime: busAccuracyRuntimeState,
          autoResolved,
          savedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown bus accuracy probe error." }));
      return;
    }
  }

  if (requestUrl.pathname === "/api/bus/accuracy/actual-arrival" && request.method === "POST") {
    try {
      const payload = await readJsonBody(request);
      const appState = await readEffectiveAppState();
      const routeNumber = String(payload?.routeNumber || "").trim();
      const stopName = String(payload?.stopName || "").trim();
      const stopKey = buildAccuracyStopKey({
        stopKey: payload?.stopKey || "",
        selectedStopId: appState?.commute?.selectedStopId || "",
        stopName,
      });
      const region = String(payload?.region || "").trim();
      const actualArrivalAt = payload?.actualArrivalAt ? String(payload.actualArrivalAt) : now.toISOString();

      const resolved = resolveActualArrival(busAccuracyState, {
        routeNumber,
        stopName,
        stopKey,
        region,
        actualArrivalAt,
      });
      busAccuracyState = resolved.state;
      await writeBusAccuracyState(busAccuracyState, getActiveFiles().busAccuracy);

      const summary = buildBusAccuracySnapshot(busAccuracyState, {
        region,
        routeNumber,
        stopName,
        stopKey,
        fallbackOrder: getAccuracyFallbackOrder(region),
        timeSlice: getAccuracyTimeSliceOptions(appState, now),
      });

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ok: true,
          resolvedSamples: resolved.resolvedSamples,
          summary,
          runtime: busAccuracyRuntimeState,
          savedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown actual arrival accuracy error." }));
      return;
    }
  }

  if (requestUrl.pathname === "/api/bus/accuracy/auto-probe" && request.method === "POST") {
    try {
      const result = await runAutoBusAccuracyProbe(now);

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          ...result,
          savedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      busAccuracyRuntimeState = markBusAccuracyAutoProbeResult(busAccuracyRuntimeState, {
        probeKey: busAccuracyRuntimeState.lastProbeKey,
        now,
        status: "error",
        reason: error instanceof Error ? error.message : "Unknown auto ETA probe error.",
        comparisonCount: 0,
      });
      await writeBusAccuracyRuntimeState(busAccuracyRuntimeState, getActiveFiles().busAccuracyRuntime);

      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ error: busAccuracyRuntimeState.lastReason }));
      return;
    }
  }

  if (requestUrl.pathname === "/api/holidays/config") {
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(getHolidayApiConfig()));
    return;
  }

  if (requestUrl.pathname === "/api/holidays") {
    try {
      const year = requestUrl.searchParams.get("year") || "";
      const payload = await fetchOfficialHolidays({
        serviceKey: process.env.HOLIDAY_API_SERVICE_KEY,
        year,
      });

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          year,
          holidays: payload,
          source: "live",
          fetchedAt: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown holiday sync error.",
        }),
      );
      return;
    }
  }

  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const publicFilePath = resolvePublicStaticFile(ROOT, pathname);

  if (publicFilePath) {
    try {
      const body = await readFile(publicFilePath);
      response.writeHead(200, {
        "Content-Type": CONTENT_TYPES[extname(publicFilePath)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(body);
      return;
    } catch {
      // Fall through to the controlled SPA fallback or 404 response.
    }
  }

  if (!isAssetPath(pathname)) {
    try {
      const fallback = await readFile(resolvePublicStaticFile(ROOT, "/index.html"));
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(fallback);
      return;
    } catch {
      // Fall through to 404.
    }
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not Found");
}

function sendUnhandledServerError(response, error) {
  if (response.writableEnded || response.headersSent) {
    response.destroy(error instanceof Error ? error : undefined);
    return;
  }

  response.writeHead(500, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify({ error: "Unexpected server error." }));
}

function sendLivenessResponse(response) {
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify({ ok: true, service: "BusWakeUp", status: "live" }));
}

const server = createServer((request, response) => {
  const requestUrl = parseRequestUrl(request);
  // Public screen assets do not read account state. A slow provider or storage
  // request must not block the HTML and scripts needed to open the app.
  if (!requestUrl.pathname.startsWith("/api/") && ["GET", "HEAD"].includes(request.method)) {
    void handleRequest(request, response).catch((error) => sendUnhandledServerError(response, error));
    return;
  }
  if (request.method === "GET" && requestUrl.pathname === "/api/healthz") {
    // This deliberately bypasses the runtime mutex and external provider checks.
    sendLivenessResponse(response);
    return;
  }

  // Auth uses a fresh request-scoped Supabase client, never the mutable alarm
  // workspace. Slow account/alarms must not queue login, callback or logout.
  // The auth handler retains its own origin, PKCE and identity checks.
  if (requestUrl.pathname.startsWith("/api/auth/") || requestUrl.pathname === "/api/account/profile") {
    void handleSocialLoginRoute(request, response, readJsonBody)
      .catch((error) => sendUnhandledServerError(response, error));
    return;
  }
  // These public configuration reads only inspect environment configuration.
  if (request.method === "GET" && ["/api/holidays/config", "/api/commute/config"].includes(requestUrl.pathname)) {
    void handleRequest(request, response).catch((error) => sendUnhandledServerError(response, error));
    return;
  }

  // Station/place lookups are read-only and do not access per-user runtime documents.
  // Authenticate them without waiting behind alarm processing or workspace writes.
  if (request.method === "GET" && TRANSIT_LOOKUP_PATHS.has(requestUrl.pathname)) {
    void (async () => {
      if (!PUBLIC_API_PATHS.has(requestUrl.pathname) && !await createRequestAuth(request,response).resolve()) {
        sendAuthJson(response,401,{error:"소셜 계정으로 로그인해 주세요."}); return;
      }
      try { sendAuthJson(response,200,await transitLookup(requestUrl)); }
      catch(error) { sendAuthJson(response,400,{error:error instanceof Error ? error.message : "검색에 실패했습니다. 다시 시도해 주세요."}); }
    })().catch(() => sendAuthJson(response,503,{error:"검색 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."}));
    return;
  }
  void runWithRuntimeLock(async () => {
    if (await handleSocialLoginRoute(request, response, readJsonBody)) return;
    const isApi = requestUrl.pathname.startsWith("/api/");
    if (isApi && !["GET", "HEAD"].includes(request.method) && !isTrustedMutation(request)) {
      sendAuthJson(response, 403, { error: "허용되지 않은 요청입니다." });
      return;
    }
    if (!isApi || PUBLIC_API_PATHS.has(requestUrl.pathname)) {
      await handleRequest(request, response);
      return;
    }
    const auth = await createRequestAuth(request, response).resolve();
    if (!auth) {
      sendAuthJson(response, 401, { error: "소셜 계정으로 로그인해 주세요." });
      return;
    }
    request.smartMetroAuth = auth;
    response.setHeader("Cache-Control", "private, no-store");
    const buffered = bufferedResponse();
    await runWithDocumentStorage(auth, createSupabaseGateway(), async () => {
      await ensureUserWorkspaceSeeded(auth.user);
      await handleRequest(request, buffered);
      return buffered;
    });
    buffered.flush(response);
  }).catch((error) => {
    if (!response.headersSent) sendAuthJson(response, error?.statusCode || 503, {
      error: error?.code === "DOCUMENT_CONFLICT" ? error.message : "요청을 저장하지 못했습니다. 새로고침 후 다시 시도해 주세요.",
    });
    else sendUnhandledServerError(response, error);
  });
});

server.listen(PORT, () => {
  console.log(`BusWakeUp prototype running at http://127.0.0.1:${PORT}`);
});

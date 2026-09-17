import {
  addMinutes,
  buildSchedulePreview,
  dateOnlyKey,
  describeScheduleState,
  evaluateLateRisk,
  formatClock,
  formatLongDate,
  mergeHolidayDates,
  rankLocationsByDistance,
  isValidLocation,
} from "./logic/commute.js";
import { buildConservativeReliabilityReport, buildConservativeWatchlistHighlight } from "./logic/conservative-report.js";
import { buildDeliveryIntensityReport } from "./logic/delivery-intensity-report.js";
import { buildLiveEtaGuard } from "./logic/live-eta-guard.js";
import { resolveJourneyDuration, transitQueryForState, transitQueryKey } from "./logic/transit-journey.js";
import { isLiveConfigured, projectLiveArrivals, resolveCommuteLine, resolveCommuteStop } from "./logic/live-arrivals.js";
import { buildEscalationTimeline, getNotificationSpec } from "./logic/notification-engine.js";
import {
  DAY_OPTIONS,
  REPEAT_PRESETS,
  SOUND_PRESETS,
  STOP_LIBRARY,
  TTS_VOICES,
} from "./mock-data.js";
import { applyDomainSnapshotToState } from "./domain-model.js";
import { DEFAULT_DEVICE_PROFILE } from "./device-profile.js";
import { ensureLiveBindingState, switchLiveProvider, syncActiveLiveBinding } from "./logic/live-bindings.js";
import {
  fetchAccountSummary,
  fetchAuthProviders,
  fetchAuthSession,
  logoutAuth,
  startSocialAuth,
  updateAccountProfile,
} from "./services/auth.js";
import { loadRemoteAppState, saveRemoteAppState } from "./services/app-state.js";
import { subscribeCurrentBrowserToPush } from "./services/web-push.js";
import { fetchAlarmPlanPreview } from "./services/alarm-plan.js";
import { fetchCommuteApiConfig, fetchCommuteEstimate } from "./services/commute-estimate.js";
import {
  fetchDeviceTokenHealth,
  fetchDispatchExecutions,
  fetchDispatchQueue,
  fetchFcmAuthStatus,
  fetchPushGatewayAttempts,
  fetchPushGatewayConfig,
  fetchPushPreview,
  loadDeviceProfile,
  registerDevicePushToken,
  runPushGatewayDispatch,
  runPushGatewayRetrySimulation,
  runPushGatewayTestDispatch,
  saveDeviceProfile,
} from "./services/device-profile.js";
import {
  createAlarmEvent,
  fetchAlarmDeliveryState,
  fetchAlarmEvents,
  fetchAlarmRuntimeStatus,
  sendAlarmDeliveryAction,
} from "./services/alarm-runtime.js";
import { loadDomainSnapshot, syncDomainSnapshot } from "./services/domain.js";
import { fetchHolidayApiConfig, fetchOfficialHolidays } from "./services/holidays.js";
import {
  fetchBusAccuracyLeaderboard,
  fetchBusAccuracySummary,
  fetchBusApiConfig,
  fetchTagoCityList,
  fetchLiveArrivals,
  recordActualBusArrival,
  runBusAccuracyAutoProbe,
  runBusAccuracyProbe,
  searchLiveStationRoutes,
  searchLiveStations,
} from "./services/live-bus.js";
import { fetchPlaceApiConfig, searchAddressPlaces } from "./services/places.js";
import { mountKakaoCommuteMap } from "./services/kakao-map.js";
import { loadState, resetState, sanitizeState, saveState } from "./state.js";

const app = document.querySelector("#app");
let state = loadState();
let audioContext = null;
let visibleTransitRefreshPending = false;
let remoteSaveTimer = null;
let remoteSaveToken = 0;
let domainSyncTimer = null;
let domainSyncToken = 0;
let deviceSyncTimer = null;
let deviceSyncToken = 0;
let alarmPlanTimer = null;
let alarmPlanToken = 0;
let alarmRuntimeTimer = null;
let alarmRuntimeToken = 0;
let pendingPanelFocus = null;
let busApiConfig = {
  policy: {
    objective: "accuracy-first",
    regionPriority: {
      seoul: ["seoul", "tago"],
      gyeonggi: ["tago", "gyeonggi"],
      national: ["tago"],
    },
    guidance:
      "For time-sensitive alarms, choose the provider that has shown the most accurate ETA for that region. API ownership matters less than observed accuracy.",
    observations: {
      gyeonggi:
        "Current product rule: treat TAGO as the first ETA candidate for Gyeonggi until another provider proves more accurate in measured checks.",
    },
  },
  providers: {
    seoul: {
      configured: false,
      label: "Seoul Direct",
      role: "regional-candidate",
      note: "Keep Seoul Direct as the primary candidate for Seoul stops unless another source measures better.",
    },
    gyeonggi: {
      configured: false,
      label: "Gyeonggi Direct (Compare Accuracy)",
      role: "regional-candidate",
      note: "Keep this as a comparison source for Gyeonggi and promote it only when it measures more accurate than TAGO.",
    },
    tago: {
      configured: false,
      label: "TAGO (Accuracy-first candidate)",
      role: "national-candidate",
      note: "Current ETA-first rule treats TAGO as the first candidate for Gyeonggi and the default national coverage source.",
    },
  },
};
let holidayApiConfig = {
  configured: false,
};
let placeApiConfig = {
  providers: {
    kakao: { configured: false },
    demo: { configured: true },
  },
  maps: {
    kakao: { configured: false, javascriptKey: "" },
  },
};
let commuteApiConfig = {
  providers: {
    kakaoWalking: { configured: false },
    straightLine: { configured: true },
  },
};
let commuteEstimateMeta = {
  status: "idle",
  snapshot: null,
  lastLoadedAt: null,
  lastError: "",
};
let persistenceMeta = {
  source: "local",
  saveStatus: "idle",
  lastSavedAt: null,
  lastError: "",
};
let domainMeta = {
  source: "local",
  syncStatus: "idle",
  lastSyncedAt: null,
  lastError: "",
};
let deviceMeta = {
  source: "local",
  syncStatus: "idle",
  lastSyncedAt: null,
  lastError: "",
  dispatchBundles: [],
  dispatchTotal: 0,
  dispatchLastLoadedAt: null,
  dispatchError: "",
  dispatchExecutions: [],
  dispatchExecutionTotal: 0,
  dispatchExecutionLastLoadedAt: null,
  dispatchExecutionError: "",
  pushPreview: null,
  pushPreviewLoadedAt: null,
  pushPreviewError: "",
  pushGatewayConfig: null,
  pushGatewayConfigLoadedAt: null,
  pushGatewayConfigError: "",
  pushGatewayAttempts: [],
  pushGatewayAttemptTotal: 0,
  pushGatewayHandledDispatchKeys: 0,
  pushGatewayRetryQueue: [],
  pushGatewayRetryPending: 0,
  pushGatewayBoostedRetryPending: 0,
  pushGatewayNextRetryAt: null,
  pushGatewayNextRetryDeliveryPriorityClass: "",
  pushGatewayRetryBackoffSeconds: [],
  pushGatewayPriorityBackoffSeconds: {
    standard: [],
    boosted: [],
  },
  pushGatewayActiveRetryProfiles: [],
  pushGatewayDateKey: "",
  pushGatewayLastAttemptAt: null,
  pushGatewayAttemptsLoadedAt: null,
  pushGatewayAttemptsError: "",
  pushGatewayDispatchStatus: "idle",
  pushGatewayDispatchError: "",
  fcmAuthStatus: null,
  fcmAuthStatusLoadedAt: null,
  fcmAuthStatusError: "",
  tokenHealth: null,
  tokenHealthLoadedAt: null,
  tokenHealthError: "",
  tokenRegisterStatus: "idle",
  tokenRegisterError: "",
};
let alarmPlanMeta = {
  status: "idle",
  plan: null,
  lastLoadedAt: null,
  lastError: "",
};
let accuracyMeta = {
  status: "idle",
  summary: null,
  leaderboard: null,
  leaderboardStatus: "idle",
  leaderboardError: "",
  lastLoadedAt: null,
  lastError: "",
  probeStatus: "idle",
  probeError: "",
  actualStatus: "idle",
  actualError: "",
  lastProbeComparisons: [],
  autoProbeStatus: "idle",
  autoProbeError: "",
  autoProbePlan: null,
  autoProbeNextEligibleAt: null,
  runtime: null,
};
let alarmRuntimeMeta = {
  status: "idle",
  runtime: null,
  plan: null,
  delivery: null,
  deliveryIntensity: null,
  conservativeReliability: null,
  events: [],
  totalEvents: 0,
  lastLoadedAt: null,
  lastError: "",
  eventSyncStatus: "idle",
  eventSyncError: "",
  actionStatus: "idle",
  actionError: "",
};
let browserPlaybackMeta = {
  primed: false,
  status: "idle",
  lastDispatchKey: "",
  lastPlayedAt: null,
  lastError: "",
  lastSpokenText: "",
};
let authMeta = {
  status: "loading",
  user: null,
  session: null,
  mode: "register",
  providerConfig: null,
  submitStatus: "idle",
  submitError: "",
  resetToken: "",
  lastCheckedAt: null,
};
let authDraft = {
  name: "",
  email: "",
  password: "",
};
let accountMeta = {
  status: "idle",
  snapshot: null,
  lastLoadedAt: null,
  lastError: "",
  profileStatus: "idle",
  profileError: "",
  passwordStatus: "idle",
  passwordError: "",
  emailVerificationStatus: "idle",
  emailVerificationError: "",
};
let accountDraft = {
  name: "",
  currentPassword: "",
  newPassword: "",
};

function isAuthenticated() {
  return authMeta.status === "authenticated" && authMeta.user;
}

function applyPushGatewaySummary(summary, loadedAt = new Date().toISOString()) {
  const safeSummary = summary && typeof summary === "object" ? summary : {};
  deviceMeta.pushGatewayAttempts = Array.isArray(safeSummary.attempts) ? safeSummary.attempts : [];
  deviceMeta.pushGatewayAttemptTotal = Number(safeSummary.total) || deviceMeta.pushGatewayAttempts.length;
  deviceMeta.pushGatewayHandledDispatchKeys = Number(safeSummary.handledDispatchKeys) || 0;
  deviceMeta.pushGatewayRetryQueue = Array.isArray(safeSummary.retryQueue) ? safeSummary.retryQueue : [];
  deviceMeta.pushGatewayRetryPending = Number(safeSummary.retryPolicy?.pendingRetries) || deviceMeta.pushGatewayRetryQueue.length;
  deviceMeta.pushGatewayBoostedRetryPending = Number(safeSummary.retryPolicy?.boostedPendingRetries) || 0;
  deviceMeta.pushGatewayNextRetryAt = safeSummary.retryPolicy?.nextRetryAt || null;
  deviceMeta.pushGatewayNextRetryDeliveryPriorityClass = String(
    safeSummary.retryPolicy?.nextRetryDeliveryPriorityClass || "",
  );
  deviceMeta.pushGatewayRetryBackoffSeconds = Array.isArray(safeSummary.retryPolicy?.backoffSeconds)
    ? safeSummary.retryPolicy.backoffSeconds
    : [];
  deviceMeta.pushGatewayPriorityBackoffSeconds =
    safeSummary.retryPolicy?.priorityBackoffSeconds &&
    typeof safeSummary.retryPolicy.priorityBackoffSeconds === "object" &&
    !Array.isArray(safeSummary.retryPolicy.priorityBackoffSeconds)
      ? safeSummary.retryPolicy.priorityBackoffSeconds
      : {
          standard: [],
          boosted: [],
        };
  deviceMeta.pushGatewayActiveRetryProfiles = Array.isArray(safeSummary.retryPolicy?.activeRetryProfiles)
    ? safeSummary.retryPolicy.activeRetryProfiles
    : [];
  deviceMeta.pushGatewayDateKey = String(safeSummary.dateKey || "");
  deviceMeta.pushGatewayLastAttemptAt = safeSummary.lastAttemptAt || null;
  deviceMeta.pushGatewayAttemptsLoadedAt = loadedAt;
  deviceMeta.pushGatewayAttemptsError = "";
}

function resetWorkspaceMeta() {
  persistenceMeta = {
    source: "local",
    saveStatus: "idle",
    lastSavedAt: null,
    lastError: "",
  };
  domainMeta = {
    source: "local",
    syncStatus: "idle",
    lastSyncedAt: null,
    lastError: "",
  };
  deviceMeta = {
    ...deviceMeta,
    source: "local",
    syncStatus: "idle",
    lastSyncedAt: null,
    lastError: "",
    dispatchBundles: [],
    dispatchTotal: 0,
    dispatchLastLoadedAt: null,
    dispatchError: "",
    dispatchExecutions: [],
    dispatchExecutionTotal: 0,
    dispatchExecutionLastLoadedAt: null,
    dispatchExecutionError: "",
    pushPreview: null,
    pushPreviewLoadedAt: null,
    pushPreviewError: "",
    pushGatewayConfig: null,
    pushGatewayConfigLoadedAt: null,
    pushGatewayConfigError: "",
      pushGatewayAttempts: [],
      pushGatewayAttemptTotal: 0,
      pushGatewayHandledDispatchKeys: 0,
      pushGatewayRetryQueue: [],
      pushGatewayRetryPending: 0,
      pushGatewayBoostedRetryPending: 0,
      pushGatewayNextRetryAt: null,
      pushGatewayNextRetryDeliveryPriorityClass: "",
      pushGatewayRetryBackoffSeconds: [],
      pushGatewayPriorityBackoffSeconds: {
        standard: [],
        boosted: [],
      },
      pushGatewayActiveRetryProfiles: [],
      pushGatewayDateKey: "",
      pushGatewayLastAttemptAt: null,
      pushGatewayAttemptsLoadedAt: null,
    pushGatewayAttemptsError: "",
    pushGatewayDispatchStatus: "idle",
    pushGatewayDispatchError: "",
    fcmAuthStatus: null,
    fcmAuthStatusLoadedAt: null,
    fcmAuthStatusError: "",
    tokenHealth: null,
    tokenHealthLoadedAt: null,
    tokenHealthError: "",
    tokenRegisterStatus: "idle",
    tokenRegisterError: "",
  };
  alarmPlanMeta = {
    status: "idle",
    plan: null,
    lastLoadedAt: null,
    lastError: "",
  };
  accuracyMeta = {
    status: "idle",
    summary: null,
    leaderboard: null,
    leaderboardStatus: "idle",
    leaderboardError: "",
    lastLoadedAt: null,
    lastError: "",
    probeStatus: "idle",
    probeError: "",
    actualStatus: "idle",
    actualError: "",
    lastProbeComparisons: [],
    autoProbeStatus: "idle",
    autoProbeError: "",
    autoProbePlan: null,
    autoProbeNextEligibleAt: null,
    runtime: null,
  };
  alarmRuntimeMeta = {
    status: "idle",
    runtime: null,
    plan: null,
    delivery: null,
    deliveryIntensity: null,
    conservativeReliability: null,
    events: [],
    totalEvents: 0,
    lastLoadedAt: null,
    lastError: "",
    eventSyncStatus: "idle",
    eventSyncError: "",
    actionStatus: "idle",
    actionError: "",
  };
  accountMeta = {
    status: "idle",
    snapshot: null,
    lastLoadedAt: null,
    lastError: "",
    profileStatus: "idle",
    profileError: "",
    passwordStatus: "idle",
    passwordError: "",
    emailVerificationStatus: "idle",
    emailVerificationError: "",
  };
  commuteEstimateMeta = {
    status: "idle",
    snapshot: null,
    lastLoadedAt: null,
    lastError: "",
  };
}

async function hydrateAuthSession() {
  authMeta.status = "loading";
  authMeta.submitError = "";
  render();

  try {
    const payload = await fetchAuthSession();
    authMeta.lastCheckedAt = payload.fetchedAt || new Date().toISOString();
    if (payload.authenticated && payload.user) {
      authMeta.status = "authenticated";
      authMeta.user = payload.user;
      authMeta.session = payload.session || null;
      if (!authDraft.name) {
        authDraft.name = payload.user.name || "";
      }
      if (!authDraft.email) {
        authDraft.email = payload.user.email || "";
      }
      return true;
    }

    authMeta.status = "anonymous";
    authMeta.user = null;
    authMeta.session = null;
    return false;
  } catch (error) {
    authMeta.status = "error";
    authMeta.user = null;
    authMeta.session = null;
    authMeta.submitError = error instanceof Error ? error.message : "Unknown auth session error.";
    return false;
  }
}

async function hydrateAuthProviders() {
  try {
    const payload = await fetchAuthProviders();
    authMeta.providerConfig = payload.config || null;
    return payload;
  } catch (error) {
    authMeta.providerConfig = null;
    authMeta.submitError = error instanceof Error ? error.message : "Unknown auth provider load error.";
    return null;
  }
}

async function hydrateAuthenticatedWorkspace() {
  resetWorkspaceMeta();
  state = sanitizeState(resetState());
  await Promise.all([refreshBusApiConfig(), refreshPlaceApiConfig(), refreshCommuteApiConfig(), refreshHolidayApiConfig()]);
  await hydrateStateFromServer();
  await hydrateStateFromDomain();
  await hydrateDeviceProfileFromServer();
  await hydrateAccountSummary();
  await refreshBusAccuracySummary();
  void runAutoBusAccuracyProbeCycle();
  ensureDemoHistory();
  refreshCommuteEstimate();
  queueAlarmPlanRefresh(0);
  queueAlarmRuntimeRefresh(0);
}

async function hydrateAccountSummary() {
  accountMeta.status = accountMeta.snapshot ? "refreshing" : "loading";
  accountMeta.lastError = "";

  try {
    const payload = await fetchAccountSummary();
    accountMeta.status = "ready";
    accountMeta.snapshot = payload;
    accountMeta.lastLoadedAt = payload.fetchedAt || new Date().toISOString();
    accountMeta.lastError = "";
    accountDraft.name = payload.user?.name || accountDraft.name;
    return payload;
  } catch (error) {
    accountMeta.status = "error";
    accountMeta.lastError = error instanceof Error ? error.message : "Unknown account summary error.";
    return null;
  }
}


async function beginSocialAuth(provider) {
  authMeta.submitStatus = "submitting";
  authMeta.submitError = "";
  render();

  try {
    const payload = await startSocialAuth({
      provider,
      redirectAfterAuth: "/#/home",
    });
    window.location.assign(payload.authorizationUrl);
  } catch (error) {
    authMeta.submitStatus = "error";
    authMeta.submitError = error instanceof Error ? error.message : "Unknown social sign-in error.";
    render();
  }
}

async function signOutWorkspace() {
  authMeta.submitStatus = "submitting";
  authMeta.submitError = "";
  render();

  try {
    await logoutAuth();
    authMeta.status = "anonymous";
    authMeta.user = null;
    authMeta.session = null;
    authMeta.submitStatus = "idle";
    authDraft.password = "";
    state = sanitizeState(resetState());
    resetWorkspaceMeta();
    render();
  } catch (error) {
    authMeta.submitStatus = "error";
    authMeta.submitError = error instanceof Error ? error.message : "Unknown sign-out error.";
    render();
  }
}

async function submitAccountProfileUpdate() {
  accountMeta.profileStatus = "saving";
  accountMeta.profileError = "";
  render();

  try {
    const payload = await updateAccountProfile({
      name: accountDraft.name,
    });
    authMeta.user = payload.user || authMeta.user;
    accountMeta.profileStatus = "saved";
    accountMeta.profileError = "";
    await hydrateAccountSummary();
    render();
  } catch (error) {
    accountMeta.profileStatus = "error";
    accountMeta.profileError = error instanceof Error ? error.message : "Unknown account profile update error.";
    render();
  }
}


function persist() {
  saveState(state);
  if (!isAuthenticated()) {
    return;
  }
  queueRemoteSave();
  queueDomainSync();
  queueDeviceSync();
  queueAlarmPlanRefresh();
  queueAlarmRuntimeRefresh();
}

function queueRemoteSave() {
  if (!isAuthenticated()) {
    return;
  }
  if (remoteSaveTimer) {
    window.clearTimeout(remoteSaveTimer);
  }

  const snapshot = JSON.parse(JSON.stringify(state));
  persistenceMeta.saveStatus = "pending";
  remoteSaveTimer = window.setTimeout(() => {
    const currentToken = remoteSaveToken + 1;
    remoteSaveToken = currentToken;
    persistenceMeta.saveStatus = "saving";
    saveRemoteAppState(snapshot)
      .then((payload) => {
        if (currentToken !== remoteSaveToken) {
          return;
        }

        persistenceMeta.source = "server";
        persistenceMeta.saveStatus = "saved";
        persistenceMeta.lastSavedAt = payload.savedAt || new Date().toISOString();
        persistenceMeta.lastError = "";
        render();
      })
      .catch((error) => {
        if (currentToken !== remoteSaveToken) {
          return;
        }

        persistenceMeta.saveStatus = "error";
        persistenceMeta.lastError = error instanceof Error ? error.message : "Unknown server save error.";
        render();
      });
  }, 250);
}

function queueDomainSync() {
  if (!isAuthenticated()) {
    return;
  }
  if (domainSyncTimer) {
    window.clearTimeout(domainSyncTimer);
  }

  const snapshot = JSON.parse(JSON.stringify(state));
  domainMeta.syncStatus = "pending";
  domainSyncTimer = window.setTimeout(() => {
    const currentToken = domainSyncToken + 1;
    domainSyncToken = currentToken;
    domainMeta.syncStatus = "syncing";
    syncDomainSnapshot(snapshot)
      .then((payload) => {
        if (currentToken !== domainSyncToken) {
          return;
        }

        domainMeta.source = "server";
        domainMeta.syncStatus = "synced";
        domainMeta.lastSyncedAt = payload.savedAt || new Date().toISOString();
        domainMeta.lastError = "";
        render();
      })
      .catch((error) => {
        if (currentToken !== domainSyncToken) {
          return;
        }

        domainMeta.syncStatus = "error";
        domainMeta.lastError = error instanceof Error ? error.message : "Unknown domain sync error.";
        render();
      });
  }, 250);
}

function queueDeviceSync() {
  if (!isAuthenticated()) {
    return;
  }
  if (deviceSyncTimer) {
    window.clearTimeout(deviceSyncTimer);
  }

  const snapshot = JSON.parse(JSON.stringify(state.device || DEFAULT_DEVICE_PROFILE));
  deviceMeta.syncStatus = "pending";
  deviceSyncTimer = window.setTimeout(() => {
    const currentToken = deviceSyncToken + 1;
    deviceSyncToken = currentToken;
    deviceMeta.syncStatus = "syncing";
    saveDeviceProfile(snapshot)
      .then((payload) => {
        if (currentToken !== deviceSyncToken) {
          return;
        }

        state.device = payload.profile || state.device;
        saveState(state);
        deviceMeta.source = "server";
        deviceMeta.syncStatus = "synced";
        deviceMeta.lastSyncedAt = payload.savedAt || new Date().toISOString();
        deviceMeta.lastError = "";
        queueAlarmRuntimeRefresh(0);
        render();
      })
      .catch((error) => {
        if (currentToken !== deviceSyncToken) {
          return;
        }

        deviceMeta.syncStatus = "error";
        deviceMeta.lastError = error instanceof Error ? error.message : "Unknown device profile sync error.";
        render();
      });
  }, 250);
}

function getActiveHistoryLiveEtaContext(runtime = accuracyMeta.runtime) {
  const liveEtaGuard = getLiveEtaGuard(runtime);
  if (liveEtaGuard.mode !== "conservative" || !liveEtaGuard.recommendedRiskBufferMin) {
    return null;
  }

  return {
    liveEtaGuardMode: liveEtaGuard.mode,
    accuracyRiskBufferMin: liveEtaGuard.recommendedRiskBufferMin,
    accuracySpreadMin: Number.isFinite(Number(liveEtaGuard.spreadMin)) ? Number(liveEtaGuard.spreadMin) : null,
  };
}

function formatLiveEtaContextCopy(context) {
  if (!context || !context.accuracyRiskBufferMin) {
    return "";
  }

  if (Number.isFinite(Number(context.accuracySpreadMin))) {
    return `Conservative ETA buffer ${context.accuracyRiskBufferMin} min is active because providers are ${context.accuracySpreadMin} min apart.`;
  }

  return `Conservative ETA buffer ${context.accuracyRiskBufferMin} min is active while live provider ETAs are still diverged.`;
}

function appendLiveEtaContextDetail(detail, context) {
  const baseDetail = String(detail || "").trim();
  const contextCopy = formatLiveEtaContextCopy(context);
  if (!contextCopy) {
    return baseDetail;
  }

  if (baseDetail.includes(contextCopy)) {
    return baseDetail;
  }

  return baseDetail ? `${baseDetail} ${contextCopy}` : contextCopy;
}

function renderConservativeContextLine(context, className = "history-detail") {
  if (!context || !context.accuracyRiskBufferMin) {
    return "";
  }

  const parts = [`Conservative ETA buffer ${context.accuracyRiskBufferMin} min`];
  if (Number.isFinite(Number(context.accuracySpreadMin))) {
    parts.push(`live spread ${context.accuracySpreadMin} min`);
  }
  if (context.liveEtaGuardMode) {
    parts.push(`mode ${String(context.liveEtaGuardMode).toUpperCase()}`);
  }

  return `<div class="${className}">${escapeHtml(parts.join(" · "))}</div>`;
}

function renderDeliveryPriorityLine(context, className = "history-detail") {
  const priorityClass = String(context?.deliveryPriorityClass || "").trim().toLowerCase();
  if (!priorityClass || priorityClass === "normal") {
    return "";
  }

  const parts =
    priorityClass === "boosted"
      ? ["Boosted first-alarm delivery", "HIGH instability route"]
      : priorityClass === "precheck"
        ? ["Stability precheck delivery", "High-watch warmup"]
        : [`Delivery ${priorityClass}`];

  if (context?.deliveryPriorityReason) {
    parts.push(String(context.deliveryPriorityReason));
  }

  return `<div class="${className}">${escapeHtml(parts.join(" · "))}</div>`;
}

function renderPlaybackIntensityLine(context, className = "history-detail") {
  const notificationSpec = context?.notificationSpec && typeof context.notificationSpec === "object" ? context.notificationSpec : null;
  const volumePercent = Number(
    context?.volumePercent ?? notificationSpec?.volumePercent ?? 0,
  );
  const vibrationRepeats = Number(
    context?.vibrationRepeats ?? notificationSpec?.vibrationRepeats ?? 0,
  );
  const mechanicalLoopBoost = Number(
    context?.mechanicalLoopBoost ?? notificationSpec?.mechanicalLoopBoost ?? 0,
  );
  const speechRepeatCount = Number(
    context?.speechRepeatCount ?? notificationSpec?.speechRepeatCount ?? 1,
  );

  if (
    !Number.isFinite(volumePercent) &&
    !Number.isFinite(vibrationRepeats) &&
    !Number.isFinite(mechanicalLoopBoost) &&
    !Number.isFinite(speechRepeatCount)
  ) {
    return "";
  }

  const parts = [];
  if (Number.isFinite(volumePercent) && volumePercent > 0) {
    parts.push(`${Math.round(volumePercent)}% volume`);
  }
  if (Number.isFinite(vibrationRepeats) && vibrationRepeats > 0) {
    parts.push(`vibration x${Math.round(vibrationRepeats)}`);
  }
  if (Number.isFinite(mechanicalLoopBoost) && mechanicalLoopBoost > 0) {
    parts.push(`mechanical +${Math.round(mechanicalLoopBoost)} loops`);
  }
  if (Number.isFinite(speechRepeatCount) && speechRepeatCount > 1) {
    parts.push(`TTS x${Math.round(speechRepeatCount)}`);
  }

  if (!parts.length) {
    return "";
  }

  return `<div class="${className}">${escapeHtml(parts.join(" · "))}</div>`;
}

function getConservativeReliabilityReport() {
  return (
    alarmRuntimeMeta.conservativeReliability ||
    buildConservativeReliabilityReport({
      schedule: state.schedule,
      events: alarmRuntimeMeta.events,
      dispatchBundles: deviceMeta.dispatchBundles,
      dispatchExecutions: deviceMeta.dispatchExecutions,
      pushGatewayAttempts: deviceMeta.pushGatewayAttempts,
      retryQueue: deviceMeta.pushGatewayRetryQueue,
    })
  );
}

function getDeliveryIntensityReport() {
  return (
    alarmRuntimeMeta.deliveryIntensity ||
    buildDeliveryIntensityReport({
      now: new Date(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul",
      events: alarmRuntimeMeta.events,
      dispatchBundles: deviceMeta.dispatchBundles,
      dispatchExecutions: deviceMeta.dispatchExecutions,
      pushGatewayAttempts: deviceMeta.pushGatewayAttempts,
      retryQueue: deviceMeta.pushGatewayRetryQueue,
    })
  );
}

function getHeroWatchlistHighlight(model) {
  const report = getConservativeReliabilityReport();
  const routeNumber = String(model?.liveSnapshot?.lineNumber || model?.primaryLine?.number || "").trim();
  const stopName = String(model?.liveSnapshot?.stopName || model?.stop?.name || "").trim();
  return {
    report,
    ...buildConservativeWatchlistHighlight(report, {
      routeNumber,
      stopName,
    }),
  };
}

function pushHistory(title, detail, kind = "INFO", serverKind = "APP_ACTION", options = {}) {
  const liveEtaContext = options.includeLiveEtaContext ? getActiveHistoryLiveEtaContext(options.runtime) : null;
  const enrichedDetail = appendLiveEtaContextDetail(detail, liveEtaContext);
  state.history = [
    {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      title,
      detail: enrichedDetail,
      kind,
      at: new Date().toISOString(),
      liveEtaGuardMode: liveEtaContext?.liveEtaGuardMode || "",
      accuracyRiskBufferMin: liveEtaContext?.accuracyRiskBufferMin || 0,
      accuracySpreadMin: liveEtaContext?.accuracySpreadMin ?? null,
    },
    ...state.history,
  ].slice(0, 12);
  persist();
  const stop = getSelectedStop();
  const primaryLine = getPrimaryLine(stop);
  syncAlarmEvent({
    kind: serverKind,
    level: kind,
    title,
    detail: enrichedDetail,
    routeNumber: primaryLine.number,
    stopName: stop.name,
    source: state.live.snapshot ? "live" : "demo",
    liveEtaGuardMode: liveEtaContext?.liveEtaGuardMode || "",
    accuracyRiskBufferMin: liveEtaContext?.accuracyRiskBufferMin || 0,
    accuracySpreadMin: liveEtaContext?.accuracySpreadMin ?? null,
  });
}

function ensureDemoHistory() {
  if (state.history.length) return;
  pushHistory("Demo ready", "This prototype stores recent actions locally so you can inspect the morning flow.");
}

function queueAlarmPlanRefresh(delayMs = 250) {
  if (!isAuthenticated()) {
    return;
  }
  if (alarmPlanTimer) {
    window.clearTimeout(alarmPlanTimer);
  }

  const snapshot = JSON.parse(JSON.stringify(state));
  alarmPlanMeta.status = alarmPlanMeta.plan ? "refreshing" : "loading";
  alarmPlanTimer = window.setTimeout(() => {
    const currentToken = alarmPlanToken + 1;
    alarmPlanToken = currentToken;
    fetchAlarmPlanPreview(snapshot, new Date().toISOString())
      .then((payload) => {
        if (currentToken !== alarmPlanToken) {
          return;
        }

        alarmPlanMeta.status = "ready";
        alarmPlanMeta.plan = payload;
        alarmPlanMeta.lastLoadedAt = new Date().toISOString();
        alarmPlanMeta.lastError = "";
        render();
      })
      .catch((error) => {
        if (currentToken !== alarmPlanToken) {
          return;
        }

        alarmPlanMeta.status = "error";
        alarmPlanMeta.lastError = error instanceof Error ? error.message : "Unknown alarm plan error.";
        render();
      });
  }, delayMs);
}

function queueAlarmRuntimeRefresh(delayMs = 250) {
  if (!isAuthenticated()) {
    return;
  }
  if (alarmRuntimeTimer) {
    window.clearTimeout(alarmRuntimeTimer);
  }

  alarmRuntimeMeta.status = alarmRuntimeMeta.runtime ? "refreshing" : "loading";
  alarmRuntimeTimer = window.setTimeout(() => {
    const currentToken = alarmRuntimeToken + 1;
    alarmRuntimeToken = currentToken;
    Promise.all([
      fetchAlarmRuntimeStatus(),
      fetchAlarmDeliveryState(),
      fetchAlarmEvents(6),
      fetchDispatchQueue(4),
      fetchDispatchExecutions(4),
      fetchPushPreview(),
      fetchDeviceTokenHealth(),
      fetchFcmAuthStatus(),
      fetchPushGatewayConfig(),
      fetchPushGatewayAttempts(4),
    ])
      .then(
        ([
          runtimePayload,
          deliveryPayload,
          eventsPayload,
          dispatchPayload,
          executionPayload,
          pushPreviewPayload,
          tokenHealthPayload,
          fcmAuthStatusPayload,
          pushGatewayConfigPayload,
          pushGatewayAttemptsPayload,
        ]) => {
        if (currentToken !== alarmRuntimeToken) {
          return;
        }

        alarmRuntimeMeta.status = "ready";
        alarmRuntimeMeta.runtime = runtimePayload.runtime || null;
        alarmRuntimeMeta.plan = runtimePayload.plan || null;
        alarmRuntimeMeta.delivery = deliveryPayload.delivery || runtimePayload.delivery || null;
        alarmRuntimeMeta.deliveryIntensity = runtimePayload.deliveryIntensity || null;
        alarmRuntimeMeta.conservativeReliability = runtimePayload.conservativeReliability || null;
        alarmRuntimeMeta.events = Array.isArray(eventsPayload.events) ? eventsPayload.events : [];
        alarmRuntimeMeta.totalEvents = Number(eventsPayload.total) || alarmRuntimeMeta.events.length;
        alarmRuntimeMeta.lastLoadedAt = new Date().toISOString();
        alarmRuntimeMeta.lastError = "";
        deviceMeta.dispatchBundles = Array.isArray(dispatchPayload.bundles) ? dispatchPayload.bundles : [];
        deviceMeta.dispatchTotal = Number(dispatchPayload.total) || deviceMeta.dispatchBundles.length;
        deviceMeta.dispatchLastLoadedAt = new Date().toISOString();
        deviceMeta.dispatchError = "";
        deviceMeta.dispatchExecutions = Array.isArray(executionPayload.attempts) ? executionPayload.attempts : [];
        deviceMeta.dispatchExecutionTotal = Number(executionPayload.total) || deviceMeta.dispatchExecutions.length;
        deviceMeta.dispatchExecutionLastLoadedAt = executionPayload.lastExecutedAt || new Date().toISOString();
        deviceMeta.dispatchExecutionError = "";
        deviceMeta.pushPreview = pushPreviewPayload.preview || null;
        deviceMeta.pushPreviewLoadedAt = pushPreviewPayload.fetchedAt || new Date().toISOString();
        deviceMeta.pushPreviewError = "";
        deviceMeta.tokenHealth = tokenHealthPayload.health || null;
        deviceMeta.tokenHealthLoadedAt = tokenHealthPayload.fetchedAt || new Date().toISOString();
        deviceMeta.tokenHealthError = "";
        deviceMeta.fcmAuthStatus = fcmAuthStatusPayload.status || null;
        deviceMeta.fcmAuthStatusLoadedAt = fcmAuthStatusPayload.fetchedAt || new Date().toISOString();
        deviceMeta.fcmAuthStatusError = "";
        deviceMeta.pushGatewayConfig = pushGatewayConfigPayload.config || null;
        deviceMeta.pushGatewayConfigLoadedAt = pushGatewayConfigPayload.fetchedAt || new Date().toISOString();
        deviceMeta.pushGatewayConfigError = "";
        applyPushGatewaySummary(pushGatewayAttemptsPayload, pushGatewayAttemptsPayload.fetchedAt || new Date().toISOString());
        maybeAutoPlayActiveAlarm();
        render();
      })
      .catch((error) => {
        if (currentToken !== alarmRuntimeToken) {
          return;
        }

        alarmRuntimeMeta.status = "error";
        alarmRuntimeMeta.lastError = error instanceof Error ? error.message : "Unknown alarm runtime error.";
        deviceMeta.dispatchError = alarmRuntimeMeta.lastError;
        deviceMeta.dispatchExecutionError = alarmRuntimeMeta.lastError;
        deviceMeta.pushPreviewError = alarmRuntimeMeta.lastError;
        deviceMeta.tokenHealthError = alarmRuntimeMeta.lastError;
        deviceMeta.fcmAuthStatusError = alarmRuntimeMeta.lastError;
        deviceMeta.pushGatewayConfigError = alarmRuntimeMeta.lastError;
        deviceMeta.pushGatewayAttemptsError = alarmRuntimeMeta.lastError;
        render();
      });
  }, delayMs);
}

async function primeAlarmPlayback() {
  if (!window.AudioContext) {
    browserPlaybackMeta.primed = false;
    return false;
  }

  if (!audioContext) {
    audioContext = new window.AudioContext();
  }

  if (audioContext.state === "suspended") {
    try {
      await audioContext.resume();
    } catch (error) {
      browserPlaybackMeta.status = "blocked";
      browserPlaybackMeta.lastError = error instanceof Error ? error.message : "Browser auto-play is still blocked.";
      return false;
    }
  }

  browserPlaybackMeta.primed = audioContext.state === "running";
  if (browserPlaybackMeta.primed && browserPlaybackMeta.status === "blocked") {
    browserPlaybackMeta.status = "ready";
    browserPlaybackMeta.lastError = "";
  }
  return browserPlaybackMeta.primed;
}

function getLatestActiveDispatchBundle() {
  const triggerKey = alarmRuntimeMeta.delivery?.currentAlert?.triggerKey;
  if (!triggerKey) {
    return null;
  }

  return deviceMeta.dispatchBundles.find((bundle) => bundle.alertTriggerKey === triggerKey) || null;
}

function getPlaybackStatusCopy() {
  if (browserPlaybackMeta.status === "playing") {
    return "Browser alarm audio is playing now.";
  }
  if (browserPlaybackMeta.status === "played") {
    return browserPlaybackMeta.lastPlayedAt
      ? `Browser alarm audio played at ${formatClock(new Date(browserPlaybackMeta.lastPlayedAt))}.`
      : "Browser alarm audio played.";
  }
  if (browserPlaybackMeta.status === "partial") {
    return browserPlaybackMeta.lastError || "Part of the browser playback was blocked.";
  }
  if (browserPlaybackMeta.status === "blocked") {
    return browserPlaybackMeta.lastError || "Browser alarm audio needs one tap before auto-play.";
  }
  if (browserPlaybackMeta.status === "muted") {
    return "Sound and TTS are both disabled on this device profile.";
  }
  return browserPlaybackMeta.lastError || "Waiting for the next active alarm stage.";
}

function resolvePreferredKoreanVoice(voices) {
  const preferred = String(state.notification.ttsVoiceId || "").toLowerCase();
  const koreanVoices = voices.filter((voice) => String(voice.lang || "").toLowerCase().startsWith("ko"));
  if (!koreanVoices.length) {
    return null;
  }

  if (preferred === "ko-male") {
    return (
      koreanVoices.find((voice) => /\bmale\b|\bman\b|남/iu.test(`${voice.name} ${voice.voiceURI}`)) ||
      koreanVoices[0]
    );
  }

  if (preferred.includes("female")) {
    return (
      koreanVoices.find((voice) => /female|woman|여/u.test(`${voice.name} ${voice.voiceURI}`)) ||
      koreanVoices[0]
    );
  }

  return koreanVoices[0];
}

function speakNotificationSpec(notificationSpec) {
  if (!("speechSynthesis" in window) || !notificationSpec?.spokenText) {
    return false;
  }

  const repeatCount = Math.max(1, Number(notificationSpec.speechRepeatCount) || 1);
  const repeatedText =
    repeatCount > 1
      ? Array.from({ length: repeatCount }, () => notificationSpec.spokenText).join(" ")
      : notificationSpec.spokenText;
  const utterance = new SpeechSynthesisUtterance(repeatedText);
  utterance.lang = "ko-KR";
  utterance.rate = Number(notificationSpec.speechRate || state.notification.ttsSpeed || 1);
  utterance.volume = Number(notificationSpec.speechVolume || 1);
  const voice = resolvePreferredKoreanVoice(window.speechSynthesis.getVoices());
  if (voice) {
    utterance.voice = voice;
  }
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return true;
}

function playNotificationSpec(notificationSpec) {
  let playedSound = false;
  let playedTts = false;

  if (state.device.soundEnabled && browserPlaybackMeta.primed) {
    playSoundPreset(notificationSpec.soundPresetId, {
      extraLoops: (notificationSpec.stage || 0) + (notificationSpec.mechanicalLoopBoost || 0),
      volumePercent: notificationSpec.volumePercent,
    });
    playedSound = true;
  }

  if (state.device.ttsEnabled) {
    playedTts = speakNotificationSpec(notificationSpec);
  }

  return {
    playedSound,
    playedTts,
  };
}

function maybeAutoPlayActiveAlarm() {
  const bundle = getLatestActiveDispatchBundle();
  const playbackKey = bundle?.dispatchKey || bundle?.id || "";

  if (!bundle || !bundle.notificationSpec) {
    if (!alarmRuntimeMeta.delivery?.currentAlert) {
      browserPlaybackMeta.status = "idle";
      browserPlaybackMeta.lastError = "";
    }
    return;
  }

  if (browserPlaybackMeta.lastDispatchKey === playbackKey) {
    return;
  }

  browserPlaybackMeta.status = "playing";
  browserPlaybackMeta.lastDispatchKey = playbackKey;
  browserPlaybackMeta.lastPlayedAt = new Date().toISOString();
  browserPlaybackMeta.lastError = "";
  browserPlaybackMeta.lastSpokenText = bundle.notificationSpec.spokenText || "";

  Promise.resolve()
    .then(async () => {
      if (state.device.soundEnabled) {
        await primeAlarmPlayback();
      }

      const playback = playNotificationSpec(bundle.notificationSpec);
      if (!playback.playedSound && !playback.playedTts) {
        browserPlaybackMeta.status = "muted";
        browserPlaybackMeta.lastError = "Sound and TTS are both unavailable for browser auto-play.";
      } else if (!playback.playedSound && playback.playedTts) {
        browserPlaybackMeta.status = "partial";
        browserPlaybackMeta.lastError = state.device.soundEnabled
          ? "Mechanical tone is waiting for one tap because browser auto-play is restricted."
          : "";
      } else {
        browserPlaybackMeta.status = "played";
        browserPlaybackMeta.lastError = "";
      }
      render();
    })
    .catch((error) => {
      browserPlaybackMeta.status = "blocked";
      browserPlaybackMeta.lastError = error instanceof Error ? error.message : "Browser auto-play failed.";
      render();
    });
}

function syncAlarmEvent(event) {
  alarmRuntimeMeta.eventSyncStatus = "sending";
  alarmRuntimeMeta.eventSyncError = "";
  createAlarmEvent(event)
    .then(() => {
      alarmRuntimeMeta.eventSyncStatus = "sent";
      alarmRuntimeMeta.eventSyncError = "";
      queueAlarmRuntimeRefresh(0);
      render();
    })
    .catch((error) => {
      alarmRuntimeMeta.eventSyncStatus = "error";
      alarmRuntimeMeta.eventSyncError = error instanceof Error ? error.message : "Unknown alarm event sync error.";
      render();
    });
}

function runAlarmDeliveryAction(type, historyTitle, historyDetail) {
  alarmRuntimeMeta.actionStatus = "sending";
  alarmRuntimeMeta.actionError = "";
  browserPlaybackMeta.lastDispatchKey = "";
  render();

  sendAlarmDeliveryAction(type)
    .then((payload) => {
      alarmRuntimeMeta.actionStatus = "sent";
      alarmRuntimeMeta.actionError = "";
      alarmRuntimeMeta.delivery = payload.delivery || null;
      alarmRuntimeMeta.runtime = payload.runtime || alarmRuntimeMeta.runtime;

      if (type === "ACK_DEPARTED") {
        state.schedule.snoozeDate = dateOnlyKey(new Date());
        saveState(state);
      }

      pushHistory(historyTitle, historyDetail, "INFO", "APP_ACTION", { includeLiveEtaContext: true });
      queueAlarmRuntimeRefresh(0);
      queueAlarmPlanRefresh(0);
      render();
    })
    .catch((error) => {
      alarmRuntimeMeta.actionStatus = "error";
      alarmRuntimeMeta.actionError = error instanceof Error ? error.message : "Unknown alarm delivery action error.";
      render();
    });
}

async function refreshBusApiConfig() {
  try {
    busApiConfig = await fetchBusApiConfig();
  } catch {
    busApiConfig = {
      policy: {
        objective: "accuracy-first",
        regionPriority: {
          seoul: ["seoul", "tago"],
          gyeonggi: ["tago", "gyeonggi"],
          national: ["tago"],
        },
        guidance:
          "For time-sensitive alarms, choose the provider that has shown the most accurate ETA for that region. API ownership matters less than observed accuracy.",
      },
      providers: {
        seoul: { configured: false, label: "Seoul Direct", role: "regional-candidate" },
        gyeonggi: { configured: false, label: "Gyeonggi Direct (Compare Accuracy)", role: "regional-candidate" },
        tago: { configured: false, label: "TAGO (Accuracy-first candidate)", role: "national-candidate" },
      },
    };
  }
}

async function refreshPlaceApiConfig() {
  try {
    placeApiConfig = await fetchPlaceApiConfig();
  } catch {
    placeApiConfig = {
      providers: {
        kakao: { configured: false },
        demo: { configured: true },
      },
      maps: {
        kakao: { configured: false, javascriptKey: "" },
      },
    };
  }
}

async function refreshCommuteApiConfig() {
  try {
    commuteApiConfig = await fetchCommuteApiConfig();
  } catch {
    commuteApiConfig = {
      providers: {
        kakaoWalking: { configured: false },
        straightLine: { configured: true },
      },
    };
  }
}

async function refreshHolidayApiConfig() {
  try {
    holidayApiConfig = await fetchHolidayApiConfig();
  } catch {
    holidayApiConfig = {
      configured: false,
    };
  }
}

async function hydrateStateFromServer() {
  try {
    const remoteState = await loadRemoteAppState();
    if (remoteState) {
      state = sanitizeState(remoteState);
      saveState(state);
      persistenceMeta.source = "server";
      persistenceMeta.saveStatus = "saved";
      persistenceMeta.lastError = "";
      return;
    }
  } catch (error) {
    persistenceMeta.saveStatus = "error";
    persistenceMeta.lastError = error instanceof Error ? error.message : "Unknown server load error.";
  }

  persistenceMeta.source = "local";
}

async function hydrateStateFromDomain() {
  try {
    const domainSnapshot = await loadDomainSnapshot();
    if (domainSnapshot) {
      state = sanitizeState(applyDomainSnapshotToState(domainSnapshot, state));
      saveState(state);
      domainMeta.source = "server";
      domainMeta.syncStatus = "synced";
      domainMeta.lastSyncedAt = domainSnapshot.meta?.updatedAt || new Date().toISOString();
      domainMeta.lastError = "";
      return;
    }
  } catch (error) {
    domainMeta.syncStatus = "error";
    domainMeta.lastError = error instanceof Error ? error.message : "Unknown domain load error.";
  }

  domainMeta.source = "local";
}

async function hydrateDeviceProfileFromServer() {
  try {
    const payload = await loadDeviceProfile();
    if (payload?.profile) {
      state.device = payload.profile;
      saveState(state);
      deviceMeta.source = "server";
      deviceMeta.syncStatus = "synced";
      deviceMeta.lastSyncedAt = payload.fetchedAt || new Date().toISOString();
      deviceMeta.lastError = "";
      deviceMeta.tokenHealth = payload.tokenHealth || null;
      deviceMeta.tokenHealthLoadedAt = payload.fetchedAt || new Date().toISOString();
      deviceMeta.tokenHealthError = "";
      return;
    }
  } catch (error) {
    deviceMeta.syncStatus = "error";
    deviceMeta.lastError = error instanceof Error ? error.message : "Unknown device profile load error.";
  }

  deviceMeta.source = "local";
}

function getLiveBinding() {
  state.live = ensureLiveBindingState(state.live);
  const primaryLine = getPrimaryLine();
  return {
    provider: state.live.provider,
    stationId: state.live.stationId,
    arsId: state.live.arsId,
    routeId: state.live.routeId,
    order: state.live.order,
    cityCode: state.live.cityCode,
    nodeId: state.live.nodeId,
    routeNumber: state.live.routeNumber || primaryLine.number,
    regionHint: getLiveRegionHint(),
    selectedStopId: state.commute.selectedStopId,
    stopKey: getAccuracyStopKey(),
  };
}

const tagoCitiesMeta = { cities: [], status: "idle", error: "" };
let liveStationRequest = 0;
let liveRouteRequest = 0;

function getLiveSearchBinding() {
  state.live = ensureLiveBindingState(state.live);
  return {
    provider: state.live.provider,
    keyword: state.ui.liveSearchKeyword,
    cityCode: state.live.provider === "tago" ? state.live.cityCode : "",
  };
}

function getLiveRouteBinding() {
  state.live = ensureLiveBindingState(state.live);
  return {
    provider: state.live.provider,
    arsId: state.live.arsId,
    stationId: state.live.stationId,
    routeNumber: state.live.routeNumber,
    cityCode: state.live.provider === "tago" ? state.live.cityCode : "",
    nodeId: state.live.provider === "tago" ? state.live.nodeId : "",
  };
}

function resetLiveSearchState() {
  liveStationRequest += 1;
  state.ui.liveSearchStatus = "idle";
  state.ui.liveSearchError = "";
  state.ui.liveSearchResults = [];
}

function resetLiveRouteSearchState() {
  liveRouteRequest += 1;
  state.ui.liveRouteSearchStatus = "idle";
  state.ui.liveRouteSearchError = "";
  state.ui.liveRouteSearchResults = [];
}

function syncLiveBindingState() {
  state.live = syncActiveLiveBinding(state.live);
}

function invalidateTagoStopSelection(path) {
  if (state.live.provider !== "tago" || !["live.cityCode", "live.nodeId"].includes(path)) return;
  if (path === "live.cityCode") state.live.nodeId = "";
  state.live.stationId = state.live.nodeId;
  state.live.stationName = "";
  state.live.arsId = "";
  state.live.routeId = "";
  state.live.routeNumber = "";
  state.live.order = "";
  state.commute.selectedStopId = state.live.nodeId;
  state.commute.stopLocation = null;
  state.commute.transitJourney = null;
  commuteEstimateMeta.snapshot = null;
  resetLiveSearchState();
  resetLiveRouteSearchState();
}

function getLiveProviderMeta(provider = state.live.provider) {
  return busApiConfig.providers?.[provider] || null;
}

function getLiveProviderLabel(provider = state.live.provider) {
  if (provider === "none") {
    return "Demo only";
  }

  return getLiveProviderMeta(provider)?.label || provider || "Demo only";
}

function getLiveProviderPolicyCopy(provider = state.live.provider) {
  if (provider === "gyeonggi") {
    return "Use this only if measured ETA accuracy beats TAGO for the same Gyeonggi stop and route.";
  }

  if (provider === "seoul") {
    return "Keep Seoul Direct for Seoul stops unless measured ETA accuracy says another source is better.";
  }

  if (provider === "tago") {
    return "This is the current accuracy-first candidate for Gyeonggi and the default national coverage source in this prototype.";
  }

  return busApiConfig.policy?.guidance || "Choose the provider that measures most accurate for that region.";
}

function getLiveRegionHint() {
  if (state.live.provider === "seoul") {
    return "seoul";
  }

  if (state.live.provider === "gyeonggi") {
    return "gyeonggi";
  }

  if (state.live.provider === "tago") {
    return busApiConfig.policy?.regionPriority?.gyeonggi?.[0] === "tago" ? "gyeonggi" : "national";
  }

  return "";
}

function getAccuracyFilter() {
  const primaryLine = getPrimaryLine();
  const stop = getSelectedStop();
  return {
    region: getLiveRegionHint(),
    routeNumber: state.live.snapshot?.lineNumber || state.live.routeNumber || primaryLine.number,
    stopName: state.live.snapshot?.stopName || state.live.stationName || stop.name,
    stopKey: getAccuracyStopKey(),
  };
}

function getAccuracyProbeCandidates() {
  state.live = ensureLiveBindingState(state.live);
  const primaryLine = getPrimaryLine();
  const liveBindings = state.live.bindings || {};
  const candidates = [];

  const seoulBinding = liveBindings.seoul || {};
  if (seoulBinding.stationId && seoulBinding.routeId && seoulBinding.order && seoulBinding.arsId) {
    candidates.push({
      provider: "seoul",
      stationId: seoulBinding.stationId,
      arsId: seoulBinding.arsId,
      routeId: seoulBinding.routeId,
      order: seoulBinding.order,
      routeNumber: seoulBinding.routeNumber || primaryLine.number,
      regionHint: "seoul",
    });
  }

  const gyeonggiBinding = liveBindings.gyeonggi || {};
  if (gyeonggiBinding.stationId && (gyeonggiBinding.routeNumber || primaryLine.number)) {
    candidates.push({
      provider: "gyeonggi",
      stationId: gyeonggiBinding.stationId,
      routeId: gyeonggiBinding.routeId,
      order: gyeonggiBinding.order,
      routeNumber: gyeonggiBinding.routeNumber || primaryLine.number,
      regionHint: "gyeonggi",
    });
  }

  const tagoBinding = liveBindings.tago || {};
  if (tagoBinding.cityCode && tagoBinding.nodeId && (tagoBinding.routeId || tagoBinding.routeNumber || primaryLine.number)) {
    candidates.push({
      provider: "tago",
      cityCode: tagoBinding.cityCode,
      nodeId: tagoBinding.nodeId,
      routeId: tagoBinding.routeId,
      routeNumber: tagoBinding.routeNumber || primaryLine.number,
      regionHint: busApiConfig.policy?.regionPriority?.gyeonggi?.[0] === "tago" ? "gyeonggi" : "national",
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = JSON.stringify(candidate);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function getAccuracyRecommendedProvider() {
  const filter = getAccuracyFilter();
  const region = String(filter.region || "").trim().toLowerCase();
  return (
    accuracyMeta.summary?.recommendedProviders?.[0] ||
    busApiConfig.policy?.regionPriority?.[region]?.[0] ||
    busApiConfig.policy?.regionPriority?.national?.[0] ||
    ""
  );
}

function getLiveEtaGuard(runtime = accuracyMeta.runtime) {
  return buildLiveEtaGuard({
    disagreementLevel: runtime?.lastObservedDisagreementLevel,
    spreadMin: runtime?.lastObservedEtaSpreadMin,
    comparableProviderCount: runtime?.lastObservedComparableProviderCount,
    historicalBiasLevel: runtime?.lastHistoricalBiasLevel,
  });
}

function getAccuracyRecommendationButtonMarkup() {
  const liveEtaGuard = getLiveEtaGuard();
  const recommendedProvider = getAccuracyRecommendedProvider();
  if (
    !recommendedProvider ||
    recommendedProvider === "none" ||
    recommendedProvider === state.live.provider ||
    liveEtaGuard.shouldHoldProviderSwitch
  ) {
    return "";
  }

  return `<button class="mini-button" data-action="apply-bus-accuracy-recommendation">Switch to ${escapeHtml(
    getLiveProviderLabel(recommendedProvider),
  )}</button>`;
}

async function refreshBusAccuracySummary() {
  if (!isAuthenticated()) {
    return null;
  }

  accuracyMeta.status = accuracyMeta.summary ? "refreshing" : "loading";
  accuracyMeta.lastError = "";

  try {
    const payload = await fetchBusAccuracySummary(getAccuracyFilter());
    accuracyMeta.status = "ready";
    accuracyMeta.summary = payload;
    accuracyMeta.runtime = payload.runtime || accuracyMeta.runtime;
    accuracyMeta.lastLoadedAt = payload.fetchedAt || new Date().toISOString();
    accuracyMeta.lastError = "";
    void refreshBusAccuracyLeaderboard();
    render();
    return payload;
  } catch (error) {
    accuracyMeta.status = "error";
    accuracyMeta.lastError = error instanceof Error ? error.message : "Unknown bus accuracy summary error.";
    render();
    return null;
  }
}

async function refreshBusAccuracyLeaderboard(limit = 6) {
  if (!isAuthenticated()) {
    return null;
  }

  accuracyMeta.leaderboardStatus = accuracyMeta.leaderboard ? "refreshing" : "loading";
  accuracyMeta.leaderboardError = "";

  try {
    const payload = await fetchBusAccuracyLeaderboard({
      region: getAccuracyFilter().region,
      limit,
    });
    accuracyMeta.leaderboard = payload;
    accuracyMeta.leaderboardStatus = "ready";
    accuracyMeta.leaderboardError = "";
    render();
    return payload;
  } catch (error) {
    accuracyMeta.leaderboardStatus = "error";
    accuracyMeta.leaderboardError =
      error instanceof Error ? error.message : "Unknown bus accuracy leaderboard error.";
    render();
    return null;
  }
}

async function probeBusAccuracyProviders() {
  const candidates = getAccuracyProbeCandidates();
  if (!candidates.length) {
    accuracyMeta.probeStatus = "error";
    accuracyMeta.probeError = "Fill in at least one live provider binding first so the app can compare ETA candidates.";
    render();
    return;
  }

  accuracyMeta.probeStatus = "loading";
  accuracyMeta.probeError = "";
  render();

  try {
    const payload = await runBusAccuracyProbe({
      ...getAccuracyFilter(),
      candidates,
    });
    accuracyMeta.probeStatus = "ready";
    accuracyMeta.probeError = "";
    accuracyMeta.lastProbeComparisons = Array.isArray(payload.comparisons) ? payload.comparisons : [];
    accuracyMeta.summary = payload.summary || accuracyMeta.summary;
    accuracyMeta.runtime = payload.runtime || accuracyMeta.runtime;
    accuracyMeta.lastLoadedAt = payload.savedAt || new Date().toISOString();
    const comparisonSummary = payload.comparisonSummary || {};
    pushHistory(
      "ETA accuracy probe completed",
      `${accuracyMeta.lastProbeComparisons.length} provider candidates were sampled for this route.${
        Number.isFinite(Number(comparisonSummary.etaSpreadMin))
          ? ` Live ETA spread is ${comparisonSummary.etaSpreadMin} min.`
          : ""
      }`,
      "INFO",
      "APP_ACTION",
      { includeLiveEtaContext: true },
    );
    if (payload.autoResolved?.autoDetected) {
      pushHistory(
        "Actual arrival auto-detected",
        `${payload.autoResolved.resolvedSamples.length} scored samples were resolved automatically from converging provider ETAs.`,
        "INFO",
        "APP_ACTION",
        { includeLiveEtaContext: true },
      );
    }
    void refreshBusAccuracyLeaderboard();
    render();
  } catch (error) {
    accuracyMeta.probeStatus = "error";
    accuracyMeta.probeError = error instanceof Error ? error.message : "Unknown ETA accuracy probe error.";
    render();
  }
}

async function recordCurrentBusArrival() {
  const filter = getAccuracyFilter();
  if (!filter.routeNumber || !filter.stopName) {
    accuracyMeta.actualStatus = "error";
    accuracyMeta.actualError = "A route number and stop name are required before actual arrival can be recorded.";
    render();
    return;
  }

  accuracyMeta.actualStatus = "loading";
  accuracyMeta.actualError = "";
  render();

  try {
    const payload = await recordActualBusArrival({
      ...filter,
      actualArrivalAt: new Date().toISOString(),
    });
    accuracyMeta.actualStatus = "ready";
    accuracyMeta.actualError = "";
    accuracyMeta.summary = payload.summary || accuracyMeta.summary;
    accuracyMeta.runtime = payload.runtime || accuracyMeta.runtime;
    accuracyMeta.lastLoadedAt = payload.savedAt || new Date().toISOString();
    pushHistory(
      "Actual arrival recorded",
      `${payload.resolvedSamples?.length || 0} provider forecast samples were scored against the real arrival moment.`,
      "INFO",
      "APP_ACTION",
      { includeLiveEtaContext: true },
    );
    void refreshBusAccuracyLeaderboard();
    render();
  } catch (error) {
    accuracyMeta.actualStatus = "error";
    accuracyMeta.actualError = error instanceof Error ? error.message : "Unknown actual arrival accuracy error.";
    render();
  }
}

async function runAutoBusAccuracyProbeCycle() {
  if (!isAuthenticated()) {
    return null;
  }

  accuracyMeta.autoProbeStatus = "loading";
  accuracyMeta.autoProbeError = "";

  try {
    const payload = await runBusAccuracyAutoProbe();
    accuracyMeta.autoProbeStatus = payload.skipped ? "idle" : "ready";
    accuracyMeta.autoProbeError = payload.skipped ? payload.reason || "" : "";
    accuracyMeta.autoProbePlan = payload.probePlan || accuracyMeta.autoProbePlan;
    accuracyMeta.autoProbeNextEligibleAt = payload.nextEligibleAt || null;
    accuracyMeta.lastProbeComparisons = Array.isArray(payload.comparisons) ? payload.comparisons : accuracyMeta.lastProbeComparisons;
    accuracyMeta.summary = payload.summary || accuracyMeta.summary;
    accuracyMeta.runtime = payload.runtime || accuracyMeta.runtime;
    accuracyMeta.lastLoadedAt = payload.savedAt || new Date().toISOString();
    const comparisonSummary = payload.comparisonSummary || {};
    if (payload.autoResolved?.autoDetected) {
      pushHistory(
        "Actual arrival auto-detected",
        `${payload.autoResolved.resolvedSamples.length} scored samples were resolved automatically from the background ETA probe.`,
        "INFO",
        "APP_ACTION",
        { includeLiveEtaContext: true },
      );
    }
    if (Number.isFinite(Number(comparisonSummary.etaSpreadMin)) && comparisonSummary.disagreementLevel === "diverged") {
      pushHistory(
        "Live ETA spread widened",
        `Providers are currently ${comparisonSummary.etaSpreadMin} min apart, so the live ETA should be treated carefully.`,
        "INFO",
        "APP_ACTION",
        { includeLiveEtaContext: true },
      );
    }
    void refreshBusAccuracyLeaderboard();
    render();
    return payload;
  } catch (error) {
    accuracyMeta.autoProbeStatus = "error";
    accuracyMeta.autoProbeError = error instanceof Error ? error.message : "Unknown automatic bus accuracy probe error.";
    accuracyMeta.autoProbeNextEligibleAt = null;
    render();
    return null;
  }
}

function describeAutoProbeReason(reason, nextEligibleAt = null) {
  const normalizedReason = String(reason || "").trim();

  if (reason === "schedule-disabled-today") {
    return "Today's schedule is off, so automatic ETA probing is paused.";
  }

  if (reason === "before-probe-window-history-high") {
    return "This route is on the recent HIGH instability watchlist, so automatic ETA probing will start 30 minutes before the morning window instead of waiting until the usual lead time.";
  }

  if (reason === "before-probe-window-history-elevated") {
    return "This route has elevated recent instability, so automatic ETA probing will start 20 minutes before the morning window instead of waiting until the usual lead time.";
  }

  if (reason === "before-probe-window") {
    return "It is still before the active morning alarm window, so automatic ETA probing is waiting.";
  }

  if (reason === "after-probe-window") {
    return "The active morning alarm window is over, so automatic ETA probing is paused.";
  }

  if (normalizedReason.startsWith("precheck-warmup")) {
    return "This route is on the recent HIGH instability watchlist, so automatic ETA probing is running in a denser warmup cadence during the last 10 minutes before the normal morning window.";
  }

  if (reason === "eta-disagreement-diverged") {
    return "Providers are currently far apart, so automatic ETA probing is temporarily running faster to verify the live arrival time.";
  }

  if (reason === "eta-disagreement-watch") {
    return "Providers are slightly split right now, so automatic ETA probing is running a bit faster to confirm the next arrival.";
  }

  if (reason === "not-enough-candidates") {
    return "At least two configured provider bindings are needed before automatic ETA probing can compare accuracy.";
  }

  if (reason === "cooldown" || reason === "auto-resolve-cooldown") {
    return nextEligibleAt
      ? `Automatic ETA probing is cooling down until ${formatClock(new Date(nextEligibleAt))}.`
      : "Automatic ETA probing is cooling down before the next sample.";
  }

  if (reason === "critical-imminence") {
    return "A bus is close, so automatic ETA probing is running at the fastest cadence.";
  }

  if (reason === "imminent-arrival") {
    return "A bus is close, so automatic ETA probing is running faster than normal.";
  }

  if (reason === "near-arrival") {
    return "A bus is approaching, so automatic ETA probing is running at a mid-speed cadence.";
  }

  if (reason === "steady-window") {
    return "Automatic ETA probing is running at the normal in-window cadence.";
  }

  if (normalizedReason.startsWith("steady-window+")) {
    return "Automatic ETA probing is running at the normal in-window cadence, but recent instability history is keeping it a little tighter than the default schedule.";
  }

  if (normalizedReason.startsWith("eta-watch-history-high")) {
    return "Providers are only mildly split right now, but this route has a strong recent instability history, so automatic ETA probing is already treating it like a conservative case.";
  }

  if (normalizedReason.startsWith("eta-disagreement-watch+")) {
    return "Providers are slightly split right now, and recent instability history is keeping automatic ETA probing tighter than the usual watch cadence.";
  }

  return accuracyMeta.autoProbeError || "Automatic ETA probing has not run yet.";
}

function loadLiveRoutesForSelectedStop() {
  const canLoadSeoulRoutes = state.live.provider === "seoul" && state.live.arsId;
  const canLoadGyeonggiRoutes = state.live.provider === "gyeonggi" && state.live.stationId;
  const canLoadTagoRoutes = state.live.provider === "tago" && state.live.cityCode && state.live.nodeId;

  if (!canLoadSeoulRoutes && !canLoadGyeonggiRoutes && !canLoadTagoRoutes) {
    resetLiveRouteSearchState();
    render();
    return;
  }

  state.ui.liveRouteSearchStatus = "loading";
  state.ui.liveRouteSearchError = "";
  state.ui.liveRouteSearchResults = [];
  render();

  const requestId = ++liveRouteRequest;
  const binding = getLiveRouteBinding();
  const isCurrent = () => requestId === liveRouteRequest && JSON.stringify(binding) === JSON.stringify(getLiveRouteBinding());
  searchLiveStationRoutes(binding)
    .then((payload) => {
      if (!isCurrent()) return;
      state.ui.liveRouteSearchStatus = "ready";
      state.ui.liveRouteSearchError = "";
      state.ui.liveRouteSearchResults = Array.isArray(payload.routes) ? payload.routes : [];
      pushHistory(
        "Official routes loaded",
        `${state.ui.liveRouteSearchResults.length} ${payload.provider} route candidates were returned for the selected stop.`,
      );
      render();
    })
    .catch((error) => {
      state.ui.liveRouteSearchStatus = "error";
      state.ui.liveRouteSearchResults = [];
      state.ui.liveRouteSearchError = error instanceof Error ? error.message : "Unknown station-route search error.";
      pushHistory("Official route search failed", state.ui.liveRouteSearchError, "ERROR");
      render();
    });
}

function getSelectedStopLocation(stop = getSelectedStop()) {
  const lat = Number(stop?.lat);
  const lng = Number(stop?.lng);
  if (!isValidLocation(stop)) {
    return null;
  }

  return {
    lat,
    lng,
    label: stop.name,
  };
}

function getRecommendedStops(limit = 2) {
  if (state.user.homeLocation.lat === null || state.user.homeLocation.lng === null) {
    return [];
  }

  return rankLocationsByDistance(
    state.user.homeLocation,
    STOP_LIBRARY.map((item) => ({
      ...item,
      lat: item.lat,
      lng: item.lng,
    })),
    limit,
  );
}

function getRouteEstimate() {
  const journey = resolveJourneyDuration(state, new Date());
  return { homeToStopDistanceM: null, homeToStopWalkMin: null,
    totalCommuteMin: journey.onboardToDestinationMin,
    provider: journey.source, fallback: false };
}

function syncHomeToStopWalkEstimate(stop = getSelectedStop(), primaryLine = getPrimaryLine(stop)) {
  const estimate = getRouteEstimate(stop, primaryLine);
  if (estimate.homeToStopWalkMin !== null) {
    state.commute.homeToStopWalkMin = estimate.homeToStopWalkMin;
  }
  return estimate;
}

function resetAddressSearchState(targetKey) {
  const prefix = targetKey === "home" ? "home" : "work";
  state.ui[`${prefix}AddressSearchStatus`] = "idle";
  state.ui[`${prefix}AddressSearchError`] = "";
  state.ui[`${prefix}AddressSearchResults`] = [];
}

function applyAddressResult(targetKey, result) {
  const safeTarget = targetKey === "home" ? "home" : "work";
  const addressText = result.roadAddress || result.label;
  const location = {
    lat: result.lat,
    lng: result.lng,
    source: result.provider || "search",
    label: result.label || addressText,
  };

  if (safeTarget === "home") {
    state.user.homeAddress = addressText;
    state.user.homeLocation = location;
    state.ui.homeAddressKeyword = addressText;
  } else {
    state.user.workAddress = addressText;
    state.user.workLocation = location;
    state.ui.workAddressKeyword = addressText;
  }

  resetAddressSearchState(safeTarget);
  syncHomeToStopWalkEstimate();
  pushHistory(
    safeTarget === "home" ? "집 주소 선택" : "회사 주소 선택",
    `${addressText} 좌표를 저장했습니다. 집에서 탑승 지점까지의 이동시간은 지각 판단에 사용하지 않습니다.`,
  );
}

function runAddressSearch(targetKey) {
  const safeTarget = targetKey === "home" ? "home" : "work";
  const keyword = String(state.ui[`${safeTarget}AddressKeyword`] || "").trim();
  if (!keyword) {
    state.ui[`${safeTarget}AddressSearchStatus`] = "error";
    state.ui[`${safeTarget}AddressSearchError`] = "먼저 주소나 건물명을 입력해 주세요.";
    persist();
    render();
    return;
  }

  state.ui[`${safeTarget}AddressSearchStatus`] = "loading";
  state.ui[`${safeTarget}AddressSearchError`] = "";
  state.ui[`${safeTarget}AddressSearchResults`] = [];
  persist();
  render();

  searchAddressPlaces(keyword)
    .then((payload) => {
      const results = Array.isArray(payload.results) ? payload.results.slice(0, 8) : [];
      state.ui[`${safeTarget}AddressSearchStatus`] = "ready";
      state.ui[`${safeTarget}AddressSearchError`] = "";
      state.ui[`${safeTarget}AddressSearchResults`] = results;
      pushHistory(
        safeTarget === "home" ? "집 주소 후보 불러옴" : "회사 주소 후보 불러옴",
        `${results.length}개의 주소 후보를 받아왔습니다.`,
      );
      render();
    })
    .catch((error) => {
      if (!isCurrent()) return;
      state.ui[`${safeTarget}AddressSearchStatus`] = "error";
      state.ui[`${safeTarget}AddressSearchResults`] = [];
      state.ui[`${safeTarget}AddressSearchError`] = error instanceof Error ? error.message : "주소 검색 중 알 수 없는 오류가 발생했습니다.";
      pushHistory(
        safeTarget === "home" ? "집 주소 검색 실패" : "회사 주소 검색 실패",
        state.ui[`${safeTarget}AddressSearchError`],
        "ERROR",
      );
      render();
    });
}

function buildCommuteEstimatePayload() {
  const query = transitQueryForState(state);
  return isValidLocation(query.stopLocation) && isValidLocation(query.workLocation) ? query : null;
}

async function refreshCommuteEstimate() {
  const payload = buildCommuteEstimatePayload();
  if (!payload) {
    commuteEstimateMeta.status = "blocked";
    commuteEstimateMeta.lastError = "탑승 정류장과 목적지를 먼저 선택해 주세요. 집 좌표는 필요하지 않습니다.";
    commuteEstimateMeta.snapshot = null;
    return render();
  }
  const queryKey = transitQueryKey(payload);
  const requestUserId = authMeta.user?.id;
  commuteEstimateMeta.status = "loading";
  commuteEstimateMeta.lastError = "";
  render();
  try {
    const result = await fetchCommuteEstimate(payload);
    if (authMeta.user?.id !== requestUserId || transitQueryKey(transitQueryForState(state)) !== queryKey) return;
    commuteEstimateMeta.status = "ready";
    commuteEstimateMeta.snapshot = result;
    commuteEstimateMeta.lastLoadedAt = result.fetchedAt;
    const previous = state.commute.transitJourney;
    const current = previous?.boardingConfirmed && previous.queryKey === queryKey
      ? result.routes.find((route) => route.id === previous.id && route.compatible) : null;
    state.commute.transitJourney = current ? { ...current, boardingConfirmed: true } : null;
    persist();
  } catch (error) {
    if (authMeta.user?.id !== requestUserId || transitQueryKey(transitQueryForState(state)) !== queryKey) return;
    commuteEstimateMeta.status = "error";
    commuteEstimateMeta.lastError = error instanceof Error ? error.message : "대중교통 경로 조회 실패";
  } finally {
    if (authMeta.user?.id === requestUserId && transitQueryKey(transitQueryForState(state)) !== queryKey) {
      commuteEstimateMeta.status = "idle";
      commuteEstimateMeta.snapshot = null;
      render();
    }
  }
  render();
}

function hasUsableLiveSnapshot(primaryLine) {
  const snapshot = state.live.snapshot;
  return Boolean(
    snapshot &&
      Array.isArray(snapshot.arrivalsMin) &&
      snapshot.arrivalsMin.length &&
      (!snapshot.lineNumber || String(snapshot.lineNumber) === String(primaryLine.number)),
  );
}

function routeToScreen(hash) {
  const screen = hash.replace(/^#\/?/, "") || "home";
  return ["home", "schedule", "settings", "onboarding"].includes(screen) ? screen : "home";
}

function goTo(screen) {
  if (routeToScreen(window.location.hash) !== screen) {
    window.location.hash = `#/${screen}`;
  } else {
    render();
  }
}

async function refreshVisibleTransit() {
  if (!isAuthenticated() || !isLiveConfigured(state) || visibleTransitRefreshPending ||
      !busApiConfig.providers?.[state.live.provider]?.configured || !state.live.routeNumber) return;
  const binding = getLiveBinding();
  const key = JSON.stringify(binding);
  const userId = authMeta.user.id;
  visibleTransitRefreshPending = true;
  try {
    const payload = await fetchLiveArrivals(binding);
    if (!isAuthenticated() || authMeta.user.id !== userId || JSON.stringify(getLiveBinding()) !== key) return;
    state.live.snapshot = payload;
    state.live.status = "ready";
    state.live.lastError = "";
    state.live.lastSyncedAt = payload.fetchedAt;
    const age = Date.now() - Date.parse(state.commute.transitJourney?.fetchedAt || "");
    if (state.commute.transitJourney?.boardingConfirmed && age > 5 * 60_000 && commuteEstimateMeta.status !== "loading") {
      await refreshCommuteEstimate();
    }
  } catch (error) {
    if (!isAuthenticated() || authMeta.user.id !== userId || JSON.stringify(getLiveBinding()) !== key) return;
    state.live.snapshot = null;
    state.live.status = "error";
    state.live.lastError = error instanceof Error ? error.message : "실시간 도착정보 조회 실패";
  } finally {
    visibleTransitRefreshPending = false;
    if (isAuthenticated()) render();
  }
}

function focusPanel(screen, panelId, panelItemId = "", panelItemKind = "", panelItemKey = "") {
  if (!screen || !panelId) {
    return;
  }

  pendingPanelFocus = {
    screen,
    panelId,
    panelItemId,
    panelItemKind,
    panelItemKey,
  };
  goTo(screen);
}

function findPanelFocusTarget(panel, focusState) {
  if (!panel || !focusState) {
    return null;
  }

  if (focusState.panelItemId) {
    return document.getElementById(focusState.panelItemId);
  }

  if (focusState.panelItemKind && focusState.panelItemKey) {
    return (
      Array.from(panel.querySelectorAll("[data-focus-kind][data-focus-key]")).find(
        (element) =>
          element.dataset.focusKind === focusState.panelItemKind &&
          element.dataset.focusKey === focusState.panelItemKey,
      ) || null
    );
  }

  return panel;
}

function flushPendingPanelFocus() {
  if (!pendingPanelFocus) {
    return;
  }

  if (routeToScreen(window.location.hash) !== pendingPanelFocus.screen) {
    return;
  }

  const panel = document.getElementById(pendingPanelFocus.panelId);
  const focusState = pendingPanelFocus;
  pendingPanelFocus = null;
  if (!panel) {
    return;
  }

  const focusTarget = findPanelFocusTarget(panel, focusState) || panel;

  window.requestAnimationFrame(() => {
    document.querySelectorAll(".focus-target-active").forEach((node) => {
      node.classList.remove("focus-target-active");
    });
    focusTarget.classList.add("focus-target-active");
    focusTarget.scrollIntoView({ behavior: "smooth", block: "start" });
    if (typeof focusTarget.focus === "function") {
      focusTarget.focus({ preventScroll: true });
    }
    window.setTimeout(() => {
      focusTarget.classList.remove("focus-target-active");
    }, 2400);
  });
}

function getSelectedStop() {
  return resolveCommuteStop(state, STOP_LIBRARY);
}

function getAccuracyStopKey() {
  const selectedStopId = String(state.commute.selectedStopId || "").trim();
  if (selectedStopId) {
    return `selected:${selectedStopId}`.toLowerCase();
  }

  if (state.live.provider === "seoul") {
    if (String(state.live.stationId || "").trim()) {
      return `seoul-station:${String(state.live.stationId).trim()}`.toLowerCase();
    }
    if (String(state.live.arsId || "").trim()) {
      return `seoul-ars:${String(state.live.arsId).trim()}`.toLowerCase();
    }
  }

  if (state.live.provider === "gyeonggi" && String(state.live.stationId || "").trim()) {
    return `gyeonggi-station:${String(state.live.stationId).trim()}`.toLowerCase();
  }

  if (state.live.provider === "tago" && String(state.live.cityCode || "").trim() && String(state.live.nodeId || "").trim()) {
    return `tago-node:${String(state.live.cityCode).trim()}:${String(state.live.nodeId).trim()}`.toLowerCase();
  }

  const stopName = String(state.live.stationName || getSelectedStop().name || "").trim().toLowerCase();
  return stopName ? `name:${stopName}` : "";
}

function getSelectedLines(stop = getSelectedStop()) {
  return stop.lines.filter((line) => state.commute.selectedLineIds.includes(line.id));
}

function getPrimaryLine(stop = getSelectedStop()) {
  const selected = getSelectedLines(stop);
  return resolveCommuteLine(state, selected.find((line) => line.id === state.commute.primaryLineId) || selected[0] || stop.lines[0]);
}

function getProjectedArrivals(line) {
  const startedAt = new Date(state.meta.simulationStartedAt);
  const elapsedMinutes = Math.floor((Date.now() - startedAt.getTime()) / 60_000);
  const arrivals = line.arrivalsMin.map((base) => {
    let projected = base - elapsedMinutes;
    while (projected <= 0) projected += line.headwayMin;
    return projected;
  });

  arrivals.sort((first, second) => first - second);
  if (arrivals.length === 1) arrivals.push(arrivals[0] + line.headwayMin);
  if (arrivals.length > 1 && arrivals[1] <= arrivals[0]) arrivals[1] = arrivals[0] + line.headwayMin;
  return arrivals.slice(0, 2);
}

function getEffectiveHolidayDates() {
  return mergeHolidayDates(
    state.holidayDates,
    state.officialHolidays.filter((holiday) => holiday.isHoliday).map((holiday) => holiday.date),
  );
}

function replaceOfficialHolidaysForYear(year, holidays) {
  const prefix = `${year}-`;
  const retained = state.officialHolidays.filter((holiday) => !String(holiday.date || "").startsWith(prefix));
  state.officialHolidays = [...retained, ...holidays].sort((first, second) => first.date.localeCompare(second.date));
}

function formatSyncStamp(value) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function describeLiveSnapshot(snapshot) {
  if (!snapshot) {
    return {
      cacheStatus: "idle",
      label: "IDLE",
      detail: "No live bus response has been loaded yet.",
    };
  }

  if (snapshot.cacheStatus === "stale-fallback") {
    return {
      cacheStatus: "stale-fallback",
      label: "STALE",
      detail: snapshot.fallbackError
        ? `Latest provider request failed. Showing the last successful response. ${snapshot.fallbackError}`
        : "Latest provider request failed. Showing the last successful response.",
    };
  }

  if (snapshot.cacheStatus === "cache-hit") {
    return {
      cacheStatus: "cache-hit",
      label: "CACHE",
      detail: "A recent successful response was reused to reduce repeated public API calls.",
    };
  }

  return {
    cacheStatus: "live",
    label: "FRESH",
    detail: "Latest response came directly from the official provider.",
  };
}

function getDashboardModel() {
  const now = new Date();
  const stop = getSelectedStop();
  const primaryLine = getPrimaryLine(stop);
  const routeEstimate = getRouteEstimate(stop, primaryLine);
  const liveSnapshot = hasUsableLiveSnapshot(primaryLine) ? state.live.snapshot : null;
  const arrivalsMin = liveSnapshot ? projectLiveArrivals(liveSnapshot, now)
    : isLiveConfigured(state) ? [] : getProjectedArrivals(primaryLine);
  const effectiveHolidayDates = getEffectiveHolidayDates();
  const liveEtaGuard = getLiveEtaGuard();
  const risk = evaluateLateRisk({
    requiredArrivalTime: state.user.requiredArrivalTime,
    route: {
      ...resolveJourneyDuration(state, now),
      etaRiskBufferMin: liveEtaGuard.recommendedRiskBufferMin,
    },
    busArrivalsMin: arrivalsMin,
    now,
  });
  const notificationContext = {
    riskLevel: risk.targetResult.level,
    routeNumber: primaryLine.number,
    arrivalsMin: risk.notificationArrivalsMin,
    urgency: risk.urgency,
    riskMessage: risk.message,
    liveEtaDisagreementLevel: accuracyMeta.runtime?.lastObservedDisagreementLevel || "",
    accuracySpreadMin: accuracyMeta.runtime?.lastObservedEtaSpreadMin,
    comparableProviderCount: accuracyMeta.runtime?.lastObservedComparableProviderCount,
    accuracyRiskBufferMin: risk.etaRiskBufferMin,
    historicalBiasLevel: accuracyMeta.runtime?.lastHistoricalBiasLevel || "",
    historicalBiasRouteTraceCount: accuracyMeta.runtime?.lastHistoricalBiasRouteTraceCount || 0,
    historicalBiasWeekdayTraceCount: accuracyMeta.runtime?.lastHistoricalBiasWeekdayTraceCount || 0,
    deliveryPriorityClass: alarmPlanMeta.plan?.nextTrigger?.deliveryPriorityClass || "normal",
    deliveryPriorityReason: alarmPlanMeta.plan?.nextTrigger?.deliveryPriorityReason || "",
    escalationEnabled: state.notification.escalationEnabled,
    dndBypass: state.notification.dndBypass,
    preferredSoundPresetId: state.notification.soundPresetId,
    preferredSpeechRate: state.notification.ttsSpeed,
    vibrationStrength: state.notification.vibrationStrength,
  };

  return {
    now,
    stop,
    primaryLine,
    routeEstimate,
    arrivalsMin,
    risk,
    liveEtaGuard,
    liveSnapshot,
    dataSource: liveSnapshot && arrivalsMin.length ? "LIVE" : isLiveConfigured(state) || liveSnapshot ? "UNAVAILABLE" : "DEMO",
    liveProviderConfigured: Boolean(busApiConfig.providers?.[state.live.provider]?.configured),
    holidayApiConfigured: Boolean(holidayApiConfig.configured),
    placeApiConfigured: Boolean(placeApiConfig.providers?.kakao?.configured),
    effectiveHolidayDates,
    notificationSpec: getNotificationSpec(notificationContext),
    notificationTimeline: buildEscalationTimeline(notificationContext),
    scheduleState: describeScheduleState(state.schedule, now, effectiveHolidayDates),
    targetBoardingAt: risk.targetResult.arrivalMinutes === null ? null : addMinutes(now, risk.targetResult.arrivalMinutes),
    forecast: buildSchedulePreview(state.schedule, now, effectiveHolidayDates, 7),
    upcomingOfficialHolidays: state.officialHolidays.filter((holiday) => holiday.date >= dateOnlyKey(now)).slice(0, 6),
  };
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function describeAccuracyFreshness(provider, recentWindowDays = 7) {
  if (!provider || provider.activeFreshnessState === "none") {
    return `No scored arrival has been logged in the last ${recentWindowDays} days yet.`;
  }

  if (provider.activeFreshnessState === "fresh") {
    return `Fresh sample window is active within the last ${recentWindowDays} days.`;
  }

  if (provider.activeLatestSampleAgeDays !== null && provider.activeLatestSampleAgeDays !== undefined) {
    return `Latest scored arrival is ${provider.activeLatestSampleAgeDays} days old, so it is too stale to flip the live recommendation by itself.`;
  }

  return `Scored arrivals exist, but none is fresh inside the last ${recentWindowDays} days.`;
}

function describeAccuracyDisagreement(runtime) {
  const comparableCount = Number(runtime?.lastObservedComparableProviderCount) || 0;
  const spread = runtime?.lastObservedEtaSpreadMin;
  const source = String(runtime?.lastObservedProbeSource || "none").trim().toUpperCase();
  const providerCopy = Array.isArray(runtime?.lastObservedComparableProviders)
    ? runtime.lastObservedComparableProviders.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean).join(", ")
    : "";

  if (!comparableCount) {
    return {
      badge: "NO DATA",
      copy: "No live multi-provider ETA comparison has been captured yet.",
    };
  }

  if (runtime?.lastObservedDisagreementLevel === "single-provider") {
    return {
      badge: "SINGLE",
      copy: `${source} probe only had one comparable provider, so live spread could not be measured yet.`,
    };
  }

  if (runtime?.lastObservedDisagreementLevel === "aligned") {
    return {
      badge: `${spread ?? "-"} MIN`,
      copy: `${source} probe shows ${providerCopy || "providers"} are tightly aligned right now.`,
    };
  }

  if (runtime?.lastObservedDisagreementLevel === "watch") {
    return {
      badge: `${spread ?? "-"} MIN`,
      copy: `${source} probe shows ${providerCopy || "providers"} differ a bit right now. Keep collecting live comparisons before trusting a flip.`,
    };
  }

  if (runtime?.lastObservedDisagreementLevel === "diverged") {
    return {
      badge: `${spread ?? "-"} MIN`,
      copy: `${source} probe shows ${providerCopy || "providers"} are far apart right now. Treat the current ETA as unstable until the spread narrows.`,
    };
  }

  return {
    badge: "UNKNOWN",
    copy: "Live ETA spread has not been classified yet.",
  };
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function renderTopBar(screen, model) {
  const userInitial = String(authMeta.user?.name || "B").trim().slice(0, 1).toUpperCase() || "B";
  if (screen === "home") {
    return `
      <header class="topbar topbar-home">
        <div class="profile-chip"><div class="avatar">${escapeHtml(userInitial)}</div></div>
        <div class="brandmark">BusWakeUp</div>
        <button class="icon-button" data-action="logout" aria-label="Sign out">
          <span class="material-symbols-outlined">logout</span>
        </button>
      </header>
    `;
  }

  const titles = {
    onboarding: "Route Registration",
    schedule: "Schedule Settings",
    settings: "Notification Style",
  };

  return `
    <header class="topbar">
      <div class="topbar-side">
        <button class="icon-button" data-action="goto" data-screen="home" aria-label="?ㅻ줈">
          <span class="material-symbols-outlined">arrow_back</span>
        </button>
        <div>
          <div class="topbar-title">${titles[screen]}</div>
          ${
            screen === "schedule"
              ? `<div class="topbar-subtitle">${model.scheduleState.badge}</div>`
              : screen === "settings"
                ? `<div class="topbar-subtitle">Web settings save the alert policy. The phone app requests the matching OS permissions.</div>`
                : `<div class="topbar-subtitle">Prototype step 3 of 5</div>`
          }
        </div>
      </div>
      ${
        screen === "onboarding"
          ? `<div class="avatar avatar-small">${escapeHtml(userInitial)}</div>`
          : `<button class="icon-button" data-action="logout" aria-label="Sign out">
              <span class="material-symbols-outlined">logout</span>
            </button>`
      }
    </header>
  `;
}

function renderAuthScreen() {
  const pending = authMeta.status === "loading" || authMeta.submitStatus === "submitting";
  const buttons = [["google", "구글"], ["kakao", "카카오"], ["naver", "네이버"]].map(([id, label]) => {
    const provider = authMeta.providerConfig?.providers?.[id];
    return `<button class="soft-button wide" data-action="start-social-auth" data-provider="${id}" ${provider?.ready && !pending ? "" : "disabled"}>${label}로 시작하기</button>
      ${provider?.ready ? "" : `<div class="field-help">${label}: ${escapeHtml(provider?.reason || "연결 상태를 확인하고 있습니다.")}</div>`}`;
  }).join("");
  return `<div class="app-shell"><main class="screen screen-form">
    <section class="headline-block"><h1>늦지 않게, Smart Metro</h1>
      <p>자주 쓰는 계정으로 시작하세요. 처음 로그인하면 계정이 만들어집니다.</p></section>
    <section class="stack-panel auth-panel">
      <div class="stack-title"><span class="material-symbols-outlined">verified_user</span>간편 로그인</div>
      <div class="live-sync-copy" role="status">${escapeHtml(authMeta.submitError || (pending ? "로그인 상태를 확인하고 있습니다." : "별도 비밀번호나 이메일 인증이 필요하지 않습니다."))}</div>
      ${buttons}
      <p class="field-help">설정한 경로와 알람을 다시 불러오려면 이전에 사용한 로그인 방법을 선택해 주세요. 계정 복구는 해당 로그인 서비스에서 진행합니다.</p>
    </section></main></div>`;
}

function renderStatusCard(model) {
  const snapshotState = describeLiveSnapshot(model.liveSnapshot);
  const liveEtaGuard = model.liveEtaGuard || getLiveEtaGuard();
  const watchlistHighlight = getHeroWatchlistHighlight(model);
  const alarmPlan = alarmPlanMeta.plan || null;
  const stabilityWatch = alarmPlan?.stabilityWatch || {};
  const highlightedWatchEntry = watchlistHighlight.highlightEntry;
  const watchWindowLabel =
    watchlistHighlight.report?.weekdayWindow?.windowLabel || `${state.schedule.startTime} - ${state.schedule.endTime}`;
  const bannerIcon =
    liveEtaGuard.mode === "conservative"
      ? "warning"
      : liveEtaGuard.mode === "watch"
        ? "notifications_active"
        : model.dataSource === "LIVE"
      ? snapshotState.cacheStatus === "stale-fallback"
        ? "history"
        : snapshotState.cacheStatus === "cache-hit"
          ? "database"
          : "cloud_done"
      : "experiment";
  const bannerText =
    model.dataSource === "UNAVAILABLE" ? "버스 도착 정보를 확인할 수 없습니다. 실시간 정보를 새로 조회해 주세요." : liveEtaGuard.mode === "conservative"
      ? liveEtaGuard.reasonCode === "eta-watch-history-high"
        ? `Providers are only about ${liveEtaGuard.spreadMin ?? "-"} min apart right now, but this route has been unstable on recent mornings. Leave conservatively and keep a ${liveEtaGuard.recommendedRiskBufferMin} min safety buffer anyway.`
        : `Providers are currently about ${liveEtaGuard.spreadMin ?? "-"} min apart. Leave conservatively, do not wait for the tighter ETA, and score late risk with a ${liveEtaGuard.recommendedRiskBufferMin} min safety buffer.`
      : liveEtaGuard.mode === "watch"
        ? liveEtaGuard.reasonCode === "eta-watch-history-elevated"
          ? `Providers are slightly split right now, and this route has also been shaky on recent mornings. Re-check the live ETA before waiting any longer and keep the current source for now.`
          : `Providers are currently about ${liveEtaGuard.spreadMin ?? "-"} min apart. Re-check the live ETA before waiting any longer.`
        : model.dataSource === "LIVE"
      ? snapshotState.cacheStatus === "stale-fallback"
        ? "Official bus data is temporarily using the last successful cached response."
        : snapshotState.cacheStatus === "cache-hit"
          ? "Official bus data was served from the recent cache."
          : "Official bus data is active on this dashboard."
      : "Demo commute data is shown until live provider credentials are connected.";
  const stateBadgeClass = model.scheduleState.firing ? "status-dot success" : "status-dot paused";
  const buttonLabel = state.schedule.snoozeDate === dateOnlyKey(model.now) ? "Enable alarms for today" : "Disable alarms for today";
  const heroWatchlistMarkup = highlightedWatchEntry
    ? `
      <div class="hero-watchlist ${highlightedWatchEntry.severityLevel === "high" ? "high" : "elevated"}">
        <div class="hero-watchlist-head">
          <span class="material-symbols-outlined">warning</span>
          <span>${escapeHtml(
            watchlistHighlight.isCurrentRouteHighlighted
              ? `${highlightedWatchEntry.severityLabel} WATCH · YOUR COMMUTE`
              : `${highlightedWatchEntry.severityLabel} WATCH · TODAY'S TOP CAUTION`,
          )}</span>
        </div>
        <div class="hero-watchlist-title">${escapeHtml(`${highlightedWatchEntry.routeNumber || "Route"} · ${highlightedWatchEntry.stopName || "Stop"}`)}</div>
        <div class="hero-watchlist-copy">${escapeHtml(
          watchlistHighlight.isCurrentRouteHighlighted
            ? `${highlightedWatchEntry.count} recent conservative traces, ${highlightedWatchEntry.inWindowCount} inside ${watchWindowLabel}, avg spread ${highlightedWatchEntry.averageSpreadMin ?? "-"} min.`
            : `This pair has the strongest recent instability signal: ${highlightedWatchEntry.count} traces, ${highlightedWatchEntry.inWindowCount} inside ${watchWindowLabel}, avg spread ${highlightedWatchEntry.averageSpreadMin ?? "-"} min.`,
        )}</div>
      </div>
    `
    : "";
  const nextTriggerPriorityClass = String(alarmPlan?.nextTrigger?.deliveryPriorityClass || "").trim().toLowerCase();
  const reinforcedMonitoringMarkup =
    stabilityWatch.level === "high"
      ? `
        <div class="hero-watchlist high">
          <div class="hero-watchlist-head">
            <span class="material-symbols-outlined">shield_with_heart</span>
            <span>${escapeHtml(
              alarmPlan?.nextTrigger?.triggerKind === "stability-precheck"
                ? "REINFORCED MONITORING ACTIVE"
                : nextTriggerPriorityClass === "boosted"
                  ? "BOOSTED FIRST ALARM ARMED"
                  : "HIGH-WATCH ROUTE PROTECTION",
            )}</span>
          </div>
          <div class="hero-watchlist-title">${escapeHtml(
            alarmPlan?.nextTrigger?.triggerKind === "stability-precheck"
              ? "Server precheck is already leading this route"
              : nextTriggerPriorityClass === "boosted"
                ? "First main alarm will use the boosted delivery path"
                : "This route stays under reinforced monitoring today",
          )}</div>
          <div class="hero-watchlist-copy">${escapeHtml(
            alarmPlan?.nextTrigger?.triggerKind === "stability-precheck"
              ? `This HIGH instability route has an extra precheck ${stabilityWatch.precheckLeadMin || 0} min before the normal window. The first main alarm is also armed with boosted delivery and 10s / 30s / 90s retry.`
              : nextTriggerPriorityClass === "boosted"
                ? "The next main alarm for this route is already marked for boosted delivery, and any retryable push failure will re-run on the faster 10s / 30s / 90s schedule."
                : "Recent mornings were unstable on this route, so the server is keeping reinforced ETA monitoring and conservative alert rules active.",
          )}</div>
        </div>
      `
      : "";
  return `
    <section class="hero-card">
      <div class="hero-card-glow"></div>
      <div class="hero-meta">TODAY · ${escapeHtml(formatLongDate(model.now))}</div>
      <div class="hero-status-row">
        <div class="${stateBadgeClass}"></div>
        <div class="hero-status">${model.scheduleState.firing ? "Active" : "Paused"}</div>
        <span class="material-symbols-outlined hero-status-icon">alarm_on</span>
      </div>
      <div class="demo-banner">
        <span class="material-symbols-outlined">${bannerIcon}</span>
        ${escapeHtml(bannerText)}
      </div>
      ${heroWatchlistMarkup}
      ${reinforcedMonitoringMarkup}
      <button class="soft-button" data-action="toggle-today-snooze">
        <span class="material-symbols-outlined">alarm_off</span>
        ${buttonLabel}
      </button>
      <div class="support-copy">${escapeHtml(model.scheduleState.detail)}</div>
    </section>
  `;
}

function renderGauge(model) {
  const target = model.risk.targetResult;
  const minutes = target.arrivalMinutes;
  const hasArrival = minutes !== null;
  const progress = hasArrival ? Math.min(100, Math.max(0, minutes / 25 * 100)) : 0;
  const label = model.risk.lastChanceConfirmed ? "놓치면 늦는 차 도착까지" :
    target.level === "UNKNOWN" ? "교통편 도착까지 · 판단 대기" :
    model.risk.urgency === "HURRY" ? "가장 빠른 차 도착까지" : "조회된 정시 가능 차 도착까지";
  return `
    <section class="gauge-section">
      <div class="gauge-shell"><div class="gauge-ring" style="--progress:${progress}%;">
        <div class="gauge-center"><div class="gauge-number">${hasArrival ? Math.ceil(minutes) : "—"}</div>
        <div class="gauge-label">분 후 도착</div></div>
      </div></div>
      <div class="gauge-caption"><strong>${escapeHtml(label)}</strong><br>
        ${escapeHtml(model.risk.message)}<br>집에서 정류장·역까지 이동시간은 계산하지 않습니다.
      </div>
    </section>
  `;
}

function renderBusCard(result, title, primaryLine, toneOverride = "") {
  if (result.level === "UNKNOWN") return `<article class="bus-card neutral"><div class="bus-card-left"><div class="bus-chip">${title === "this" ? "이번 버스" : "다음 버스"}</div><div class="bus-minutes">—</div><div class="bus-line-copy">도착 정보가 없습니다. 실시간 정보를 다시 확인해 주세요.</div></div></article>`;
  const tone = toneOverride || result.risk.tone;
  const lateText = result.deltaMinutes >= 0 ? `${result.deltaMinutes} min early` : `${Math.abs(result.deltaMinutes)} min late risk`;
  const riskCopy =
    result.etaRiskBufferMin > 0
      ? `${lateText} · includes a ${result.etaRiskBufferMin} min safety buffer`
      : lateText;
  return `
    <article class="bus-card ${tone}">
      <div class="bus-card-left">
        <div class="bus-chip ${tone}">
          ${
            title === "this"
              ? result.catchable
                ? result.risk.chip
                : "MISS RISK"
              : result.level === "RED"
                ? "LATE"
                : "NEXT"
          }
        </div>
        <div class="bus-minutes-row">
          <div class="bus-minutes">${Math.ceil(result.arrivalMinutes)}</div>
          <div class="bus-minutes-unit">min</div>
        </div>
        <div class="bus-line-copy">${escapeHtml(primaryLine.number)}번 ${escapeHtml(primaryLine.label)} · ${escapeHtml(primaryLine.destination)} 방면</div>
      </div>
      <div class="bus-card-right">
        <div class="bus-right-label">회사 도착 예상</div>
        <div class="bus-arrival-time">${escapeHtml(formatClock(result.arriveWorkAt))}</div>
        <div class="bus-risk-copy">${escapeHtml(riskCopy)}</div>
      </div>
    </article>
  `;
}

function renderCommuteSummary(model) {
  const duration = model.risk.onboardToDestinationMin;
  return `<section class="info-grid">
    <article class="info-card"><div class="info-label">목적지 도착 목표</div>
      <div class="info-value">${escapeHtml(state.user.requiredArrivalTime)}</div>
      <div class="info-copy">${escapeHtml(state.user.workAddress)}</div></article>
    <article class="info-card"><div class="info-label">선택한 탑승 지점</div>
      <div class="info-value">${escapeHtml(model.stop.name)}</div>
      <div class="info-copy">${duration === null ? "목적지까지 경로 확인 필요" : `탑승 후 약 ${Math.ceil(duration)}분 · 예상시간`}</div></article>
    </section>`;
}

function renderCommuteEstimatePanel() {
  const queryKey = transitQueryKey(transitQueryForState(state));
  const routes = commuteEstimateMeta.snapshot?.queryKey === queryKey ? commuteEstimateMeta.snapshot.routes || [] : [];
  const selected = state.commute.transitJourney;
  const busy = commuteEstimateMeta.status === "loading";
  return `<section class="stack-panel">
    <div class="stack-title"><span class="material-symbols-outlined">route</span>정류장·역 → 목적지 경로</div>
    <p class="field-help">집에서 탑승 지점까지의 시간은 제외합니다. 먼저 실시간 정류장·노선을 선택한 뒤 경로를 조회해 주세요.</p>
    <p class="field-help">카카오 경로는 예상시간이며, 버스 도착정보는 선택한 공식 제공처에서 따로 조회합니다. 다른 노선 전체와 비교한 결과가 아닙니다.</p>
    ${commuteEstimateMeta.lastError ? `<p role="alert">${escapeHtml(commuteEstimateMeta.lastError)}</p>` : ""}
    ${selected?.queryKey === queryKey ? `<p>선택한 경로: ${escapeHtml(selected.guidance)} · 탑승 후 약 ${Math.ceil(selected.onboardDurationSec / 60)}분</p>` : ""}
    <button class="soft-button wide" data-action="refresh-commute-estimate" ${busy ? "disabled" : ""}>${busy ? "경로 조회 중…" : "대중교통 경로 조회"}</button>
    ${routes.map((route) => `<article class="history-item">
      <div><strong>${escapeHtml(route.guidance || route.boardingStation)}</strong>
      <p>탑승 후 약 ${Math.ceil(route.onboardDurationSec / 60)}분 · 환승 ${route.transfers}회</p>
      <p>탑승: ${escapeHtml(route.boardingStation)} → 다음 정류장: ${escapeHtml(route.nextStation || "정보 없음")}</p>
      <p>${escapeHtml(route.compatible ? route.warning : route.unavailableReason)}</p>
      <button class="mini-button" data-action="select-transit-route" data-route-id="${escapeHtml(route.id)}" ${!route.compatible ? "disabled" : ""}>이 탑승 지점·방향이 맞습니다</button></div>
    </article>`).join("")}
    ${commuteEstimateMeta.status === "ready" && !routes.length ? "<p>사용 가능한 경로가 없습니다. 정류장과 목적지를 확인해 주세요.</p>" : ""}
  </section>`;
}

function renderHistoryPanel() {
  const items = state.history.slice(0, 4);
  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">history</span>Recent alarm history</div>
      <div class="history-list">
        ${items
          .map(
            (item) => `
              <article class="history-item">
                <div class="history-main">
                  <div class="history-title">${escapeHtml(item.title)}</div>
                  <div class="history-detail">${escapeHtml(item.detail)}</div>
                  ${renderConservativeContextLine(item)}
                </div>
                <div class="history-time">${escapeHtml(formatClock(new Date(item.at)))}</div>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderLiveSyncPanel(model) {
  const providerMeta = getLiveProviderMeta();
  const providerLabel = getLiveProviderLabel();
  const syncLabel =
    state.live.status === "loading"
      ? "Refreshing..."
      : model.dataSource === "LIVE"
        ? "Refresh live data"
        : "Try live sync";
  const configuredCopy =
    state.live.provider === "none"
      ? "Choose a provider and enter official IDs in onboarding."
      : model.liveProviderConfigured
        ? `${providerLabel} key is configured on the local server.`
        : `${providerLabel} key is not configured on the local server yet.`;
  const recommendedProvider = getAccuracyRecommendedProvider();
  const providerRoleCopy =
    state.live.provider === "none"
      ? getLiveProviderPolicyCopy("none")
      : state.live.provider === recommendedProvider
        ? `${providerLabel} is currently the active ETA recommendation for this route.`
        : `${providerLabel} stays available as a measured comparison source in this prototype.`;
  const snapshotState = describeLiveSnapshot(model.liveSnapshot);
  const fetchedCopy =
    model.liveSnapshot?.fetchedAt && model.liveSnapshot.cacheStatus !== "live"
      ? `Provider data timestamp: ${escapeHtml(formatClock(new Date(model.liveSnapshot.fetchedAt)))}`
      : state.live.lastError || snapshotState.detail;

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">sync</span>Live data sync</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">Source</div>
          <div class="live-sync-value">${model.dataSource}</div>
          <div class="live-sync-copy">${escapeHtml(configuredCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Provider policy</div>
          <div class="live-sync-value">${escapeHtml(providerLabel)}</div>
          <div class="live-sync-copy">${escapeHtml(providerRoleCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Fetch mode</div>
          <div class="live-sync-value">${escapeHtml(snapshotState.label)}</div>
          <div class="live-sync-copy">${escapeHtml(snapshotState.detail)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Last sync</div>
          <div class="live-sync-value">${state.live.lastSyncedAt ? escapeHtml(formatClock(new Date(state.live.lastSyncedAt))) : "-"}</div>
          <div class="live-sync-copy">${escapeHtml(fetchedCopy || "No sync error.")}</div>
        </article>
      </div>
      <div class="field-help">${escapeHtml(getLiveProviderPolicyCopy())}</div>
      <button class="soft-button wide" data-action="sync-live-arrivals" ${state.live.status === "loading" ? "disabled" : ""}>${syncLabel}</button>
    </section>
  `;
}

function renderBusAccuracyPanel() {
  const summary = accuracyMeta.summary;
  const configuredCandidates = getAccuracyProbeCandidates();
  const runtime = accuracyMeta.runtime;
  const liveEtaGuard = getLiveEtaGuard(runtime);
  const freshnessPolicy = summary?.freshnessPolicy || {};
  const recentWindowDays = Number(freshnessPolicy.recentSampleWindowDays) || 7;
  const topProvider = summary?.recommendedProviders?.[0] || "-";
  const policy = summary?.recommendationPolicy || {};
  const timeSlice = summary?.timeSlice || null;
  const weekdayScopeLabel =
    timeSlice?.weekdayLabel && timeSlice?.label ? `${timeSlice.weekdayLabel} ${timeSlice.label}` : timeSlice?.label || "";
  const scopeCopy =
    timeSlice?.mode === "schedule-window"
      ? summary?.recommendationScope === "schedule-window-weekday"
        ? `${weekdayScopeLabel} scored arrivals are now strong enough to drive the recommendation first.`
        : summary?.recommendationScope === "schedule-window"
          ? `${timeSlice.label} scored arrivals are strong enough, but the same-weekday slice is still warming up. The app is using the full alarm window for now.`
          : `${timeSlice.label} scored arrivals exist, but there are not enough of them yet. The app is temporarily falling back to all scored arrivals.`
      : "No active alarm window is available, so the recommendation is using all scored arrivals.";
  const basisCopy =
    summary?.recommendationBasis === "measured-accuracy"
      ? `Measured ETA error is stable enough, and newer arrivals are weighted more strongly than older ones when choosing the current winner.`
      : summary?.recommendationReason === "measured-samples-stale"
        ? `Real-arrival samples exist, but the compared providers do not have fresh scored arrivals inside the last ${recentWindowDays} days. The app is holding the safer product default for now.`
        : summary?.recommendationReason === "not-enough-recent-compared-providers"
          ? `Some fresh scored arrivals exist inside the last ${recentWindowDays} days, but fewer than ${policy.minProvidersForMeasuredRecommendation ?? 2} providers have both fresh and sufficient samples. The app is holding the default until the comparison is live enough.`
      : summary?.recommendationReason === "measured-gap-too-small"
        ? `Real-arrival samples exist, but the top providers are still too close even after giving extra weight to recent arrivals. The app is keeping the product default until the gap grows past ${policy.minWinningGapMin ?? 0.5} min.`
        : summary?.recommendationReason === "not-enough-compared-providers"
          ? `Some real-arrival samples exist, but at least ${policy.minProvidersForMeasuredRecommendation ?? 2} providers need ${policy.minSamplesPerProvider ?? 2}+ samples each before the recommendation can flip.`
          : `No provider has enough scored arrivals yet. The recommendation is still following the current product default.`;
  const confidenceCopy =
    summary?.recommendationBasis === "measured-accuracy"
      ? `${String(summary?.recommendationConfidence || "medium").toUpperCase()} confidence · ${summary?.measuredLeaderGapMin ?? "-"} min lead over the next provider on the recent-weighted metric.`
      : `${String(summary?.recommendationConfidence || "low").toUpperCase()} confidence · keep collecting scored arrivals before overriding the default source.`;
  const probeCopy =
    accuracyMeta.probeStatus === "loading"
      ? "Sampling provider ETA candidates now..."
      : accuracyMeta.probeStatus === "error"
        ? accuracyMeta.probeError || "The ETA probe failed."
        : accuracyMeta.lastProbeComparisons.length
          ? `${accuracyMeta.lastProbeComparisons.length} provider candidates were sampled in the latest probe.`
          : "Probe multiple configured providers to compare their current ETA side by side.";
  const actualCopy =
    accuracyMeta.actualStatus === "loading"
      ? "Recording the real arrival moment now..."
      : accuracyMeta.actualStatus === "error"
        ? accuracyMeta.actualError || "Actual arrival logging failed."
        : "When the bus really arrives, tap the button below so this route gains a scored accuracy sample.";
  const cadenceCopy =
    runtime?.lastCadence && runtime?.lastIntervalMs
      ? `${String(runtime.lastCadence).toUpperCase()} cadence · every ${Math.round(Number(runtime.lastIntervalMs) / 1000)} sec`
      : "";
  const disagreementState = describeAccuracyDisagreement(runtime);
  const autoCopy =
    accuracyMeta.autoProbeStatus === "loading"
      ? "Automatic ETA probe is running now..."
      : runtime?.lastAutoProbeAt
        ? `Last automatic probe ${formatClock(new Date(runtime.lastAutoProbeAt))} · ${runtime.lastComparisonCount} comparisons · ${runtime.lastStatus}${
            cadenceCopy ? ` · ${cadenceCopy}` : ""
          }${
            runtime?.lastAutoResolvedAt
              ? ` · auto arrival ${runtime.autoResolvedArrivalCount || 0} times (latest ${formatClock(new Date(runtime.lastAutoResolvedAt))})`
              : ""
          }`
        : describeAutoProbeReason(accuracyMeta.autoProbePlan?.reason || accuracyMeta.autoProbeError, accuracyMeta.autoProbeNextEligibleAt);
  const historicalBiasCopy =
    runtime?.lastHistoricalBiasLevel && runtime.lastHistoricalBiasLevel !== "none"
      ? `Historical conservative bias ${String(runtime.lastHistoricalBiasLevel).toUpperCase()} · route traces ${runtime.lastHistoricalBiasRouteTraceCount || 0} · weekday-window traces ${runtime.lastHistoricalBiasWeekdayTraceCount || 0}.`
      : "";
  const recommendationGuardCopy =
    liveEtaGuard.shouldHoldProviderSwitch
      ? liveEtaGuard.reasonCode === "eta-watch-history-elevated"
        ? "Provider ETAs are only slightly split right now, but this route has been shaky on recent mornings, so the app is holding the current live source a little longer before switching."
        : "Provider ETAs are currently too far apart, so the app is holding the current live source instead of switching recommendations right now."
      : liveEtaGuard.mode === "watch"
        ? "Provider ETAs are slightly split right now. The app will keep measuring before suggesting a stronger source change."
        : "";

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">analytics</span>ETA accuracy monitor</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">Current recommendation</div>
          <div class="live-sync-value">${escapeHtml(String(topProvider).toUpperCase())}</div>
          <div class="live-sync-copy">${escapeHtml(basisCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Confidence gate</div>
          <div class="live-sync-value">${escapeHtml(String(summary?.recommendationConfidence || "low").toUpperCase())}</div>
          <div class="live-sync-copy">${escapeHtml(confidenceCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Scoring scope</div>
          <div class="live-sync-value">${escapeHtml(summary?.recommendationScope === "schedule-window-weekday" ? "WEEKDAY-WINDOW" : summary?.recommendationScope === "schedule-window" ? "WINDOW" : "ALL-DAY")}</div>
          <div class="live-sync-copy">${escapeHtml(scopeCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Resolved samples</div>
          <div class="live-sync-value">${escapeHtml(String(summary?.sampleCount || 0))}</div>
          <div class="live-sync-copy">
            ${escapeHtml(
              summary?.lastActualArrivalAt
                ? `Last actual arrival was logged at ${formatClock(new Date(summary.lastActualArrivalAt))}.`
                : "No actual arrival has been logged yet.",
            )}
          </div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Pending forecasts</div>
          <div class="live-sync-value">${escapeHtml(String(summary?.pendingCount || 0))}</div>
          <div class="live-sync-copy">${escapeHtml("Each pending forecast becomes a scored sample once the real bus arrival is logged.")}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Configured candidates</div>
          <div class="live-sync-value">${escapeHtml(String(configuredCandidates.length))}</div>
          <div class="live-sync-copy">${escapeHtml(configuredCandidates.map((item) => item.provider.toUpperCase()).join(", ") || "No provider binding is ready yet.")}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Live ETA spread</div>
          <div class="live-sync-value">${escapeHtml(disagreementState.badge)}</div>
          <div class="live-sync-copy">${escapeHtml(disagreementState.copy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Auto probe</div>
          <div class="live-sync-value">${escapeHtml(String(runtime?.autoProbeCount || 0))}</div>
          <div class="live-sync-copy">${escapeHtml(autoCopy)}</div>
        </article>
      </div>
      <div class="history-list">
        ${
          summary?.providers?.length
            ? summary.providers
                .map(
                  (provider) => `
                    <article class="history-item">
                      <div class="history-main">
                        <div class="history-title">${escapeHtml(provider.provider.toUpperCase())}</div>
                        <div class="history-detail">${escapeHtml(
                          timeSlice?.mode === "schedule-window"
                            ? summary?.recommendationScope === "schedule-window-weekday"
                              ? `${weekdayScopeLabel} weighted ${provider.weekdayTimeSliceWeightedMeanAbsoluteErrorMin ?? "-"} min · ${provider.weekdayTimeSliceRecentSampleCount} recent / ${provider.weekdayTimeSliceSampleCount} weekday window · full window ${provider.timeSliceWeightedMeanAbsoluteErrorMin ?? "-"} min · all-day ${provider.weightedMeanAbsoluteErrorMin ?? "-"} min · ${provider.meetsRecommendationThreshold ? "eligible now" : "warming up"} · ${describeAccuracyFreshness(provider, recentWindowDays)}`
                              : `${timeSlice.label} weighted ${provider.timeSliceWeightedMeanAbsoluteErrorMin ?? "-"} min · ${provider.timeSliceRecentSampleCount} recent / ${provider.timeSliceSampleCount} window · all-day ${provider.weightedMeanAbsoluteErrorMin ?? "-"} min · ${provider.sampleCount} total · ${provider.meetsRecommendationThreshold ? "eligible now" : "warming up"} · ${describeAccuracyFreshness(provider, recentWindowDays)}`
                            : `Recent-weighted error ${provider.weightedMeanAbsoluteErrorMin ?? "-"} min · raw mean ${provider.meanAbsoluteErrorMin ?? "-"} min · ${provider.recentSampleCount} recent / ${provider.sampleCount} total · ${provider.meetsRecommendationThreshold ? "eligible" : "warming up"} · ${describeAccuracyFreshness(provider, recentWindowDays)}`,
                        )}</div>
                      </div>
                      <div class="history-time">${escapeHtml(provider.activeLatestActualArrivalAt ? formatClock(new Date(provider.activeLatestActualArrivalAt)) : "-")}</div>
                    </article>
                  `,
                )
                .join("")
            : `<div class="empty-copy">${escapeHtml(accuracyMeta.lastError || "No provider accuracy score has been computed yet.")}</div>`
        }
      </div>
      <div class="quick-actions">
        <button class="secondary-button" data-action="probe-bus-accuracy" ${accuracyMeta.probeStatus === "loading" ? "disabled" : ""}>${accuracyMeta.probeStatus === "loading" ? "Probing..." : "Probe configured providers"}</button>
        <button class="primary-cta" data-action="record-actual-arrival" ${accuracyMeta.actualStatus === "loading" ? "disabled" : ""}>
          <span>${accuracyMeta.actualStatus === "loading" ? "Recording..." : "Record actual arrival now"}</span>
          <span class="material-symbols-outlined">check_circle</span>
        </button>
        ${getAccuracyRecommendationButtonMarkup()}
      </div>
      ${recommendationGuardCopy ? `<div class="quick-actions-copy">${escapeHtml(recommendationGuardCopy)}</div>` : ""}
      ${historicalBiasCopy ? `<div class="quick-actions-copy">${escapeHtml(historicalBiasCopy)}</div>` : ""}
      <div class="quick-actions-copy">${escapeHtml(probeCopy)}</div>
      <div class="quick-actions-copy">${escapeHtml(actualCopy)}</div>
    </section>
  `;
}

function renderBusAccuracyLeaderboardPanel() {
  const leaderboard = accuracyMeta.leaderboard;
  const entries = Array.isArray(leaderboard?.entries) ? leaderboard.entries : [];
  const regionLabel = leaderboard?.region ? String(leaderboard.region).toUpperCase() : "ALL";
  const timeSlice = leaderboard?.timeSlice || null;
  const weekdayScopeLabel =
    timeSlice?.weekdayLabel && timeSlice?.label ? `${timeSlice.weekdayLabel} ${timeSlice.label}` : timeSlice?.label || "";
  const scopeCopy =
    timeSlice?.mode === "schedule-window"
      ? timeSlice?.usedWeekdayForRecommendation
        ? `Rows prefer ${weekdayScopeLabel} samples first when that same-weekday slice has enough scored arrivals.`
        : `Rows prefer ${timeSlice.label} samples first when that window has enough scored arrivals.`
      : "Rows are currently ranked from all scored arrivals.";
  const statusCopy =
    accuracyMeta.leaderboardStatus === "loading"
      ? "Building the route and stop accuracy leaderboard now..."
      : accuracyMeta.leaderboardStatus === "error"
        ? accuracyMeta.leaderboardError || "Accuracy leaderboard could not be loaded."
        : leaderboard?.generatedAt
          ? `Leaderboard built from scored arrivals as of ${formatClock(new Date(leaderboard.generatedAt))}.`
          : "No route-level accuracy leaderboard has been built yet.";

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">leaderboard</span>Accuracy leaderboard</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">Region</div>
          <div class="live-sync-value">${escapeHtml(regionLabel)}</div>
          <div class="live-sync-copy">${escapeHtml(statusCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Tracked route-stops</div>
          <div class="live-sync-value">${escapeHtml(String(leaderboard?.totalRoutes || 0))}</div>
          <div class="live-sync-copy">${escapeHtml("Each row is one route and stop combination with enough scored ETA history to evaluate.")}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Ranking scope</div>
          <div class="live-sync-value">${escapeHtml(timeSlice?.usedWeekdayForRecommendation ? "WEEKDAY-WINDOW" : timeSlice?.mode === "schedule-window" ? "WINDOW" : "ALL-DAY")}</div>
          <div class="live-sync-copy">${escapeHtml(scopeCopy)}</div>
        </article>
      </div>
      <div class="history-list">
        ${
          entries.length
            ? entries
                .map(
                  (entry) => `
                    <article class="history-item">
                      <div class="history-main">
                        <div class="history-title">${escapeHtml(`${entry.routeNumber} · ${entry.stopName}`)}</div>
                        <div class="history-detail">${escapeHtml(`Recommended ${String(entry.recommendedProvider || "-").toUpperCase()} · ${String(entry.recommendationConfidence || "low").toUpperCase()} confidence · ${entry.recommendationScope === "schedule-window-weekday" ? `${entry.timeSlice?.weekdayLabel || ""} ${entry.timeSlice?.label || "weekday window"}`.trim() : entry.recommendationScope === "schedule-window" ? entry.timeSlice?.label || "window" : "all-day"} · lead ${entry.measuredLeaderGapMin ?? "-"} min · active recent ${entry.activeRecentSampleCount ?? entry.recentSampleCount} / total ${entry.sampleCount}`)}</div>
                      </div>
                      <div class="history-time">${escapeHtml(entry.lastActualArrivalAt ? formatClock(new Date(entry.lastActualArrivalAt)) : "-")}</div>
                    </article>
                  `,
                )
                .join("")
            : `<div class="empty-copy">${escapeHtml(accuracyMeta.leaderboardError || "No route-stop leaderboard rows are available yet. Keep probing and recording arrivals.")}</div>`
        }
      </div>
    </section>
  `;
}

function renderConservativeReliabilityPanel() {
  const report = getConservativeReliabilityReport();
  const weekdayWindow = report.weekdayWindow || { rows: [] };
  const watchlist = report.watchlist || { entries: [], highCount: 0, elevatedCount: 0, topEntry: null, totalEntries: 0 };
  const latestCopy = report.latestSignal
    ? `${report.latestSignal.sourceLabel} wrote the latest conservative trace at ${formatClock(new Date(report.latestSignal.createdAt))}.`
    : "No conservative ETA trace is loaded yet.";
  const deepestCopy = report.deepestTrace
    ? `${report.deepestTrace.routeNumber || "Route"} · ${report.deepestTrace.stopName || "Stop"} has reached ${report.deepestTrace.sourceCount} pipeline stages in the current loaded window.`
    : "No route-stop trace has crossed the conservative pipeline yet.";
  const weekdayCopy = weekdayWindow.topWeekday
    ? `${weekdayWindow.topWeekday.weekdayLabel} currently has the most conservative traces inside the ${weekdayWindow.windowLabel || "active"} window.`
    : "No weekday trend has been loaded yet.";
  const watchlistCopy = watchlist.topEntry
    ? `${watchlist.topEntry.routeNumber || "Route"} · ${watchlist.topEntry.stopName || "Stop"} is the top recent watchlist pair and has ${watchlist.topEntry.inWindowCount} conservative traces inside the alarm window.`
    : "No route-stop pair has crossed the recent structural watchlist threshold yet.";
  const rollingCopy =
    report.rollingDays && report.windowStartAt && report.windowEndAt
      ? `Server-tracked rolling window: last ${report.rollingDays} days, ending ${formatClock(new Date(report.windowEndAt))}.`
      : "This report is using the currently loaded dashboard traces.";

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">shield_with_heart</span>Conservative ETA reliability</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">Loaded traces</div>
          <div class="live-sync-value">${escapeHtml(String(report.totalSignals))}</div>
          <div class="live-sync-copy">${escapeHtml(`${rollingCopy} ${latestCopy}`)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Commute pairs</div>
          <div class="live-sync-value">${escapeHtml(String(report.distinctRouteStopCount))}</div>
          <div class="live-sync-copy">${escapeHtml("This counts distinct route and stop pairs that recently entered conservative ETA mode in the loaded logs.")}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Buffer range</div>
          <div class="live-sync-value">${escapeHtml(`${report.averageRiskBufferMin || 0} / ${report.maxRiskBufferMin || 0}`)}</div>
          <div class="live-sync-copy">${escapeHtml(`Average / max conservative ETA buffer in minutes. Live spread average: ${report.averageSpreadMin ?? "-"}.`)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Deepest trace</div>
          <div class="live-sync-value">${escapeHtml(report.deepestTrace ? `${report.deepestTrace.sourceCount}/5` : "0/5")}</div>
          <div class="live-sync-copy">${escapeHtml(deepestCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Alarm-window traces</div>
          <div class="live-sync-value">${escapeHtml(`${weekdayWindow.inWindowCount || 0} / ${report.totalSignals || 0}`)}</div>
          <div class="live-sync-copy">${escapeHtml(`Inside ${weekdayWindow.windowLabel || `${state.schedule.startTime} - ${state.schedule.endTime}`}: ${weekdayWindow.inWindowCount || 0}, outside: ${weekdayWindow.outOfWindowCount || 0}.`)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Top weekday</div>
          <div class="live-sync-value">${escapeHtml(weekdayWindow.topWeekday?.weekdayLabel || "-")}</div>
          <div class="live-sync-copy">${escapeHtml(weekdayCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Risk watchlist</div>
          <div class="live-sync-value">${escapeHtml(`${watchlist.highCount || 0}H / ${watchlist.elevatedCount || 0}E`)}</div>
          <div class="live-sync-copy">${escapeHtml(watchlistCopy)}</div>
        </article>
      </div>
      ${
        report.sourceBreakdown.length
          ? `
            <div class="channel-badge-row">
              ${report.sourceBreakdown
                .map(
                  (item) => `
                    <span class="channel-badge ready">${escapeHtml(`${item.sourceLabel} ${item.count}`)}</span>
                  `,
                )
                .join("")}
            </div>
          `
          : ""
      }
      <div class="history-list">
        ${
          watchlist.entries.length
            ? watchlist.entries
                .slice(0, 4)
                .map(
                  (entry) => `
                    <article class="history-item">
                      <div class="history-main">
                        <div class="history-title">${escapeHtml(`${entry.severityLabel} · ${entry.routeNumber || "Route"} · ${entry.stopName || "Stop"}`)}</div>
                        <div class="history-detail">${escapeHtml(`${entry.count} traces total · ${entry.inWindowCount} inside ${weekdayWindow.windowLabel || "the alarm window"} · avg buffer ${entry.averageRiskBufferMin} min`)}</div>
                        <div class="history-detail">${escapeHtml(`Avg spread ${entry.averageSpreadMin ?? "-"} min · max buffer ${entry.maxRiskBufferMin} min · sources ${entry.sourceLabels.join(", ")}`)}</div>
                      </div>
                      <div class="history-time">${escapeHtml(entry.latestAt ? formatClock(new Date(entry.latestAt)) : "-")}</div>
                    </article>
                  `,
                )
                .join("")
            : `<div class="empty-copy">No route-stop pair has repeated enough recent conservative traces to enter the watchlist yet.</div>`
        }
      </div>
      <div class="history-list">
        ${
          report.routeStopLeaders.length
            ? report.routeStopLeaders
                .slice(0, 4)
                .map(
                  (entry) => `
                    <article class="history-item">
                      <div class="history-main">
                        <div class="history-title">${escapeHtml(`${entry.routeNumber || "Route"} · ${entry.stopName || "Stop"}`)}</div>
                        <div class="history-detail">${escapeHtml(`${entry.count} traces · avg buffer ${entry.averageRiskBufferMin} min · max ${entry.maxRiskBufferMin} min · avg spread ${entry.averageSpreadMin ?? "-"} min`)}</div>
                        <div class="history-detail">${escapeHtml(`Sources: ${entry.sourceLabels.join(", ")} · latest via ${entry.latestSource}`)}</div>
                      </div>
                      <div class="history-time">${escapeHtml(entry.latestAt ? formatClock(new Date(entry.latestAt)) : "-")}</div>
                    </article>
                  `,
                )
                .join("")
            : `<div class="empty-copy">No conservative ETA trace is loaded yet. As soon as live providers diverge enough to trigger a safety buffer, this report will summarize where it happened and how far it traveled through the alert pipeline.</div>`
        }
      </div>
      <div class="history-list">
        ${
          weekdayWindow.rows.length
            ? weekdayWindow.rows
                .slice(0, 4)
                .map(
                  (entry) => `
                    <article class="history-item">
                      <div class="history-main">
                        <div class="history-title">${escapeHtml(entry.weekdayLabel)}</div>
                        <div class="history-detail">${escapeHtml(`${entry.inWindowCount} traces inside ${weekdayWindow.windowLabel || "the alarm window"} · ${entry.outOfWindowCount} outside`)}</div>
                        <div class="history-detail">${escapeHtml(`Avg buffer ${entry.averageRiskBufferMin} min · avg spread ${entry.averageSpreadMin ?? "-"} min`)}</div>
                      </div>
                      <div class="history-time">${escapeHtml(entry.latestAt ? formatClock(new Date(entry.latestAt)) : "-")}</div>
                    </article>
                  `,
                )
                .join("")
            : ""
        }
      </div>
      <div class="quick-actions-copy">This report is built from the recent rolling window the local server has stored, not from a full long-term analytics warehouse.</div>
    </section>
  `;
}

function renderStateSyncPanel() {
  const sourceCopy =
    persistenceMeta.source === "server" ? "Settings are backed up to the local server file." : "Using browser-local state only.";
  const statusCopy =
    persistenceMeta.saveStatus === "pending"
      ? "Changes queued for server save."
      : persistenceMeta.saveStatus === "saving"
      ? "Saving..."
      : persistenceMeta.saveStatus === "saved"
        ? persistenceMeta.lastSavedAt
          ? `Saved at ${escapeHtml(formatClock(new Date(persistenceMeta.lastSavedAt)))}`
          : "Saved"
        : persistenceMeta.saveStatus === "error"
          ? persistenceMeta.lastError || "Server save failed."
          : "Waiting for changes.";
  const domainSourceCopy =
    domainMeta.source === "server"
      ? "Profile, route, schedule, and notification settings are mirrored into domain REST files."
      : "Domain REST snapshot has not been loaded yet.";
  const domainStatusCopy =
    domainMeta.syncStatus === "pending"
      ? "Changes queued for domain sync."
      : domainMeta.syncStatus === "syncing"
      ? "Syncing profile, route, schedule, and notification settings..."
      : domainMeta.syncStatus === "synced"
        ? domainMeta.lastSyncedAt
          ? `Synced at ${escapeHtml(formatClock(new Date(domainMeta.lastSyncedAt)))}`
          : "Synced"
        : domainMeta.syncStatus === "error"
          ? domainMeta.lastError || "Domain sync failed."
          : "Waiting for changes.";

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">cloud_sync</span>State persistence</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">Storage</div>
          <div class="live-sync-value">${persistenceMeta.source === "server" ? "SERVER" : "LOCAL"}</div>
          <div class="live-sync-copy">${escapeHtml(sourceCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Sync status</div>
          <div class="live-sync-value">${escapeHtml(persistenceMeta.saveStatus.toUpperCase())}</div>
          <div class="live-sync-copy">${escapeHtml(statusCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Domain API</div>
          <div class="live-sync-value">${escapeHtml(domainMeta.syncStatus.toUpperCase())}</div>
          <div class="live-sync-copy">${escapeHtml(domainSourceCopy)} ${escapeHtml(domainStatusCopy)}</div>
        </article>
      </div>
    </section>
  `;
}

function getTopAttentionQuickActionState(alert) {
  const quickAction = alert?.attentionQuickAction;
  if (!quickAction?.action) {
    return null;
  }

  if (quickAction.action === "register-device-token") {
    const disabled = !state.device.pushToken.trim() || deviceMeta.tokenRegisterStatus === "sending";
    return {
      action: quickAction.action,
      label: deviceMeta.tokenRegisterStatus === "sending" ? "Registering Token..." : quickAction.buttonLabel,
      disabled,
      copy: disabled
        ? "Paste or keep a device token in the input first, then re-run token registration."
        : "Re-check the current device token against the server normalization and readiness rules now.",
    };
  }

  if (quickAction.action === "run-push-gateway") {
    const disabled = deviceMeta.pushGatewayDispatchStatus === "sending" || !deviceMeta.dispatchBundles.length;
    const executeMode = deviceMeta.pushGatewayConfig?.mode === "execute";
    return {
      action: quickAction.action,
      label: deviceMeta.pushGatewayDispatchStatus === "sending"
        ? executeMode
          ? "Sending Gateway Bundle..."
          : "Preparing Gateway Preview..."
        : executeMode
          ? "Send Gateway Bundle"
          : "Preview Gateway Request",
      disabled,
      copy: disabled
        ? "A current dispatch bundle is needed before the gateway can replay this path."
        : executeMode
          ? "The gateway is in execute mode. This action can send a real provider request."
          : "The gateway is in preview mode, so this action only prepares and records the provider request.",
    };
  }

  if (quickAction.action === "run-push-retry-simulation") {
    const disabled = deviceMeta.pushGatewayDispatchStatus === "sending" || !deviceMeta.pushGatewayRetryPending;
    return {
      action: quickAction.action,
      label: deviceMeta.pushGatewayDispatchStatus === "sending" ? "Running Retry Demo..." : quickAction.buttonLabel,
      disabled,
      copy: disabled
        ? "The retry queue is empty right now, so there is no saved retry step to replay."
        : "Prototype note: this replays the saved retry path through the local retry demo flow.",
    };
  }

  return null;
}

function renderDeliveryIntensityPanel() {
  const report = getDeliveryIntensityReport();
  const topAlert = report.topAlert;
  const topAttentionAlert = report.topAttentionAlert;
  const topAttentionCause = report.topAttentionCause;
  const outcomeBreakdown = report.outcomeBreakdown || {};
  const strongestCopy = report.topSignal
    ? `${report.topSignal.sourceLabel} recorded the current strongest configured alert trace at ${formatClock(new Date(report.topSignal.createdAt))}.`
    : "No alert trace with playback intensity has been recorded yet today.";
  const routeCopy = report.topRouteStop
    ? `${report.topRouteStop.routeNumber || "Route"} · ${report.topRouteStop.stopName || "Stop"} currently has the highest intensity trace, with ${report.topRouteStop.count} playback records today.`
    : "No commute pair has enough playback traces to summarize yet.";
  const deliveryCopy = topAlert
    ? topAlert.deliveryOutcomeCopy
    : "No delivery outcome can be summarized until at least one playback-intensity trace exists.";
  const averageCopy = report.totalSignals
    ? `Today's tracked traces average ${report.averageScore} on the configured intensity score.`
    : "The score only reflects configured playback strength, not whether the phone physically sounded.";
  const deliveryHealthCopy = outcomeBreakdown.pushVisibleCount
    ? `${outcomeBreakdown.pushVisibleCount} alerts reached the push-visible layer today, and ${outcomeBreakdown.deliveredRatePercent}% of them ended in DELIVERED.`
    : "No alert has reached the real push-visible layer yet today.";
  const attentionCopy = outcomeBreakdown.needsAttentionCount
    ? `${outcomeBreakdown.needsAttentionCount} strong alerts still need attention because they are pending retry, failed, or blocked.`
    : "No strong alert is currently stuck in retry, failed, or blocked state.";
  const topIssueCopy = topAttentionCause
    ? `${topAttentionCause.label} appeared on ${topAttentionCause.count} attention alert(s) across ${topAttentionCause.routeStopCount} commute pair(s). The most severe outcome in this group is ${topAttentionCause.highestOutcomeLabel || "UNKNOWN"}.`
    : "No repeated attention cause has been recorded yet today.";
  const topIssueActionCopy = topAttentionCause
    ? `${topAttentionCause.attentionActionLabel}: ${topAttentionCause.attentionActionCopy}`
    : "";
  const topAttentionCopy = topAttentionAlert
    ? `${topAttentionAlert.routeNumber ? `Route ${topAttentionAlert.routeNumber}` : "This alert"}${topAttentionAlert.stopName ? ` · ${topAttentionAlert.stopName}` : ""} is the top attention item because it ended in ${topAttentionAlert.deliveryOutcomeLabel} with intensity score ${topAttentionAlert.maxScore}. ${topAttentionAlert.attentionActionLabel}: ${topAttentionAlert.attentionActionCopy}`
    : "There is no blocked, failed, or retry-pending strong alert that needs escalation right now.";
  const topAttentionButton = topAttentionAlert?.attentionTarget
    ? `<button class="mini-button" data-action="focus-panel" data-screen="${escapeHtml(topAttentionAlert.attentionTarget.screen)}" data-panel="${escapeHtml(topAttentionAlert.attentionTarget.panelId)}" data-panel-item-id="${escapeHtml(topAttentionAlert.attentionTarget.panelItemId || "")}" data-panel-kind="${escapeHtml(topAttentionAlert.attentionTarget.panelItemKind || "")}" data-panel-key="${escapeHtml(topAttentionAlert.attentionTarget.panelItemKey || "")}">${escapeHtml(topAttentionAlert.attentionTarget.buttonLabel)}</button>`
    : "";
  const topAttentionQuickAction = getTopAttentionQuickActionState(topAttentionAlert);
  const topAttentionQuickActionButton = topAttentionQuickAction
    ? `<button class="mini-button" data-action="${escapeHtml(topAttentionQuickAction.action)}" ${topAttentionQuickAction.disabled ? "disabled" : ""}>${escapeHtml(topAttentionQuickAction.label)}</button>`
    : "";
  const topAttentionCauseCopy = topAttentionAlert?.attentionCause
    ? `Cause: ${topAttentionAlert.attentionCause.label}. ${topAttentionAlert.attentionCause.copy}`
    : "";
  const topAttentionStatusCopy = topAttentionAlert?.attentionStatus
    ? `${topAttentionAlert.attentionStatus.label}: ${topAttentionAlert.attentionStatus.value}. ${topAttentionAlert.attentionStatus.copy}`
    : "";
  const topIssueButton = topAttentionCause?.attentionTarget
    ? `<button class="mini-button" data-action="focus-panel" data-screen="${escapeHtml(topAttentionCause.attentionTarget.screen)}" data-panel="${escapeHtml(topAttentionCause.attentionTarget.panelId)}" data-panel-item-id="${escapeHtml(topAttentionCause.attentionTarget.panelItemId || "")}" data-panel-kind="${escapeHtml(topAttentionCause.attentionTarget.panelItemKind || "")}" data-panel-key="${escapeHtml(topAttentionCause.attentionTarget.panelItemKey || "")}">${escapeHtml(topAttentionCause.attentionTarget.buttonLabel)}</button>`
    : "";
  const topIssueQuickAction = getTopAttentionQuickActionState(topAttentionCause);
  const topIssueQuickActionButton = topIssueQuickAction
    ? `<button class="mini-button" data-action="${escapeHtml(topIssueQuickAction.action)}" ${topIssueQuickAction.disabled ? "disabled" : ""}>${escapeHtml(topIssueQuickAction.label)}</button>`
    : "";
  const topIssueStatusCopy = topAttentionCause?.attentionStatus
    ? `${topAttentionCause.attentionStatus.label}: ${topAttentionCause.attentionStatus.value}. ${topAttentionCause.attentionStatus.copy}`
    : "";
  const topIssueSpreadCopy = topAttentionCause?.spreadSummary
    ? `${topAttentionCause.spreadSummary.label}: ${topAttentionCause.spreadSummary.copy}`
    : "";
  const topIssueOutcomeBadges =
    Array.isArray(topAttentionCause?.outcomeMix) && topAttentionCause.outcomeMix.length
      ? topAttentionCause.outcomeMix
          .map(
            (item) => `
              <span class="channel-badge ${escapeHtml(String(item.code || "").toLowerCase())}">${escapeHtml(`${item.label} ${item.count}`)}</span>
            `,
          )
          .join("")
      : "";
  const topIssueRouteBadges =
    Array.isArray(topAttentionCause?.topRouteStops) && topAttentionCause.topRouteStops.length
      ? topAttentionCause.topRouteStops
          .slice(0, 3)
          .map(
            (item) => `
              <span class="channel-badge ready">${escapeHtml(`${item.routeNumber || "Route"} · ${item.stopName || "Stop"} ${item.count}`)}</span>
            `,
          )
          .join("")
      : "";
  const topIssueMoreRoutesCopy =
    Array.isArray(topAttentionCause?.topRouteStops) && topAttentionCause.topRouteStops.length > 3
      ? `${topAttentionCause.topRouteStops.length - 3} more commute pair(s) share this issue today.`
      : "";

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">graphic_eq</span>Today's strongest alert</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">Tracked traces</div>
          <div class="live-sync-value">${escapeHtml(String(report.totalSignals))}</div>
          <div class="live-sync-copy">${escapeHtml(`Date ${report.dateKey || "-"}. ${strongestCopy}`)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Top intensity</div>
          <div class="live-sync-value">${escapeHtml(String(report.maxScore || 0))}</div>
          <div class="live-sync-copy">${escapeHtml(averageCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Boosted traces</div>
          <div class="live-sync-value">${escapeHtml(String(report.boostedCount || 0))}</div>
          <div class="live-sync-copy">${escapeHtml("These traces were flagged for the reinforced first-alarm delivery path.")}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Top commute pair</div>
          <div class="live-sync-value">${escapeHtml(report.topRouteStop ? `${report.topRouteStop.routeNumber || "Route"}` : "-")}</div>
          <div class="live-sync-copy">${escapeHtml(routeCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Delivery outcome</div>
          <div class="live-sync-value">${escapeHtml(topAlert?.deliveryOutcomeLabel || "-")}</div>
          <div class="live-sync-copy">${escapeHtml(deliveryCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Push-visible alerts</div>
          <div class="live-sync-value">${escapeHtml(String(outcomeBreakdown.pushVisibleCount || 0))}</div>
          <div class="live-sync-copy">${escapeHtml(deliveryHealthCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Needs attention</div>
          <div class="live-sync-value">${escapeHtml(String(outcomeBreakdown.needsAttentionCount || 0))}</div>
          <div class="live-sync-copy">${escapeHtml(attentionCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Top attention</div>
          <div class="live-sync-value">${escapeHtml(topAttentionAlert?.deliveryOutcomeLabel || "-")}</div>
          <div class="live-sync-copy">${escapeHtml(topAttentionCopy)}</div>
          ${
            topAttentionButton || topAttentionQuickActionButton
              ? `<div class="channel-badge-row">${topAttentionButton}${topAttentionQuickActionButton}</div>`
              : ""
          }
          ${topAttentionQuickAction ? `<div class="quick-actions-copy">${escapeHtml(topAttentionQuickAction.copy)}</div>` : ""}
          ${topAttentionCauseCopy ? `<div class="quick-actions-copy">${escapeHtml(topAttentionCauseCopy)}</div>` : ""}
          ${topAttentionStatusCopy ? `<div class="quick-actions-copy">${escapeHtml(topAttentionStatusCopy)}</div>` : ""}
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Top issue</div>
          <div class="live-sync-value">${escapeHtml(topAttentionCause?.label || "-")}</div>
          <div class="live-sync-copy">${escapeHtml(topIssueCopy)}</div>
          ${
            topIssueButton || topIssueQuickActionButton
              ? `<div class="channel-badge-row">${topIssueButton}${topIssueQuickActionButton}</div>`
              : ""
          }
          ${topIssueQuickAction ? `<div class="quick-actions-copy">${escapeHtml(topIssueQuickAction.copy)}</div>` : ""}
          ${topIssueActionCopy ? `<div class="quick-actions-copy">${escapeHtml(topIssueActionCopy)}</div>` : ""}
          ${topIssueStatusCopy ? `<div class="quick-actions-copy">${escapeHtml(topIssueStatusCopy)}</div>` : ""}
          ${topIssueSpreadCopy ? `<div class="quick-actions-copy">${escapeHtml(topIssueSpreadCopy)}</div>` : ""}
          ${topIssueOutcomeBadges ? `<div class="channel-badge-row">${topIssueOutcomeBadges}</div>` : ""}
          ${topIssueRouteBadges ? `<div class="channel-badge-row">${topIssueRouteBadges}</div>` : ""}
          ${topIssueMoreRoutesCopy ? `<div class="quick-actions-copy">${escapeHtml(topIssueMoreRoutesCopy)}</div>` : ""}
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Upstream only</div>
          <div class="live-sync-value">${escapeHtml(String(outcomeBreakdown.upstreamOnlyCount || 0))}</div>
          <div class="live-sync-copy">${escapeHtml("These alerts were only seen in server trigger, dispatch, or simulation layers, not in a real push-visible handoff result.")}</div>
        </article>
      </div>
      ${
        report.sourceBreakdown.length
          ? `
            <div class="channel-badge-row">
              ${report.sourceBreakdown
                .map(
                  (item) => `
                    <span class="channel-badge ready">${escapeHtml(`${item.sourceLabel} ${item.count} · max ${item.maxScore}`)}</span>
                  `,
                )
                .join("")}
            </div>
          `
          : ""
      }
      ${
        Array.isArray(report.attentionCauseBreakdown) && report.attentionCauseBreakdown.length
          ? `
            <div class="channel-badge-row">
              ${report.attentionCauseBreakdown
                .slice(0, 3)
                .map(
                  (item) => `
                    <span class="channel-badge test">${escapeHtml(`${item.label} ${item.count} · ${item.highestOutcomeLabel || "UNKNOWN"}`)}</span>
                  `,
                )
                .join("")}
            </div>
          `
          : ""
      }
      <div class="field-help">This panel ranks configured playback strength only. It does not claim that the phone speaker or vibration physically succeeded on the device.</div>
      <div class="history-list">
        ${
          report.alertLeaders.length
            ? report.alertLeaders
                .slice(0, 4)
                .map(
                  (alert) => `
                    <article class="history-item">
                      <div class="history-main">
                        <div class="history-title">${escapeHtml(`${alert.deliveryOutcomeLabel} · ${alert.title || alert.routeNumber || "Alert trace"}`)}</div>
                        <div class="history-detail">${escapeHtml(
                          [
                            alert.routeNumber ? `Route ${alert.routeNumber}` : "",
                            alert.stopName || "",
                            alert.riskLevel || "",
                            `score ${alert.maxScore}`,
                          ]
                            .filter(Boolean)
                            .join(" · "),
                        )}</div>
                        <div class="history-detail">${escapeHtml(alert.deliveryOutcomeCopy)}</div>
                        ${renderDeliveryPriorityLine(alert.topSignal)}
                        ${renderPlaybackIntensityLine(alert.topSignal)}
                      </div>
                      <div class="history-time">${escapeHtml(alert.latestAt ? formatClock(new Date(alert.latestAt)) : "-")}</div>
                    </article>
                  `,
                )
                .join("")
            : `<div class="empty-copy">No playback-intensity trace has been recorded yet today.</div>`
        }
      </div>
    </section>
  `;
}

function renderAlarmPlanPanel() {
  if (alarmPlanMeta.status === "loading" && !alarmPlanMeta.plan) {
    return `
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">event_upcoming</span>Today's alarm plan</div>
        <div class="empty-copy">The server is calculating the remaining alerts for today.</div>
      </section>
    `;
  }

  if (alarmPlanMeta.status === "error" && !alarmPlanMeta.plan) {
    return `
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">event_upcoming</span>Today's alarm plan</div>
        <div class="empty-copy">${escapeHtml(alarmPlanMeta.lastError || "Alarm plan preview failed.")}</div>
      </section>
    `;
  }

  if (!alarmPlanMeta.plan) {
    return "";
  }

  const nextTrigger = alarmPlanMeta.plan.nextTrigger;
  const stabilityWatch = alarmPlanMeta.plan.stabilityWatch || {};
  const statusCopy =
    alarmPlanMeta.status === "refreshing"
      ? "Refreshing with the latest settings..."
      : alarmPlanMeta.lastLoadedAt
        ? `Updated at ${escapeHtml(formatClock(new Date(alarmPlanMeta.lastLoadedAt)))}`
        : "Ready";
  const precheckCopy =
    alarmPlanMeta.plan.precheckTriggerCount && stabilityWatch.precheckTriggerAt
      ? `High instability route: one extra precheck ${stabilityWatch.precheckLeadMin || 0} min before the normal window.`
      : stabilityWatch.level === "high"
        ? "High instability route, but the extra precheck is no longer useful after the normal alarm window starts."
        : "No extra instability precheck is scheduled right now.";

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">event_upcoming</span>Today's alarm plan</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">Remaining</div>
          <div class="live-sync-value">${escapeHtml(String(alarmPlanMeta.plan.remainingTriggers))}</div>
          <div class="live-sync-copy">${escapeHtml(alarmPlanMeta.plan.todayStatus.detail)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Next trigger</div>
          <div class="live-sync-value">${nextTrigger ? escapeHtml(formatClock(new Date(nextTrigger.triggerAt))) : "-"}</div>
          <div class="live-sync-copy">${escapeHtml(statusCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Instability precheck</div>
          <div class="live-sync-value">${alarmPlanMeta.plan.precheckTriggerCount ? `+${escapeHtml(String(alarmPlanMeta.plan.precheckTriggerCount))}` : "OFF"}</div>
          <div class="live-sync-copy">${escapeHtml(precheckCopy)}</div>
        </article>
      </div>
      <div class="history-list">
        ${
          alarmPlanMeta.plan.triggers.length
            ? alarmPlanMeta.plan.triggers.slice(0, 4).map(
                (trigger) => `
                  <article class="history-item" data-focus-kind="push-attempt" data-focus-key="${escapeHtml(attempt.dispatchKey || "")}">
                    <div class="history-main">
                      <div class="history-title">${escapeHtml(formatClock(new Date(trigger.triggerAt)))} · ${escapeHtml(trigger.triggerKind === "stability-precheck" ? "PRECHECK" : trigger.notificationSpec.riskLevel)}</div>
                      <div class="history-detail">${escapeHtml(trigger.notificationSpec.body)}</div>
                      ${renderDeliveryPriorityLine(trigger)}
                      ${renderPlaybackIntensityLine(trigger)}
                    </div>
                    <div class="history-time">${escapeHtml(trigger.arrivalsMin.join("/"))}m</div>
                  </article>
                `,
              ).join("")
            : `<div class="empty-copy">No remaining alerts are scheduled for today.</div>`
        }
      </div>
    </section>
  `;
}

function renderBottomNav(screen) {
  const items = [
    { id: "home", label: "Dashboard", icon: "dashboard" },
    { id: "schedule", label: "Schedule", icon: "event_repeat" },
    { id: "settings", label: "Settings", icon: "tune" },
  ];

  return `
    <nav class="bottom-nav">
      ${items
        .map(
          (item) => `
            <button class="nav-item ${screen === item.id ? "active" : ""}" data-action="goto" data-screen="${item.id}">
              <span class="material-symbols-outlined">${item.icon}</span>
              <span>${item.label}</span>
            </button>
          `,
        )
        .join("")}
    </nav>
  `;
}

function renderAlarmRuntimePanel() {
  if (alarmRuntimeMeta.status === "loading" && !alarmRuntimeMeta.runtime) {
    return `
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">memory</span>Server alarm runtime</div>
        <div class="empty-copy">The server is checking whether today's alerts should already be firing.</div>
      </section>
    `;
  }

  if (alarmRuntimeMeta.status === "error" && !alarmRuntimeMeta.runtime) {
    return `
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">memory</span>Server alarm runtime</div>
        <div class="empty-copy">${escapeHtml(alarmRuntimeMeta.lastError || "Alarm runtime status failed to load.")}</div>
      </section>
    `;
  }

  if (!alarmRuntimeMeta.runtime) {
    return "";
  }

  const runtime = alarmRuntimeMeta.runtime;
  const plan = alarmRuntimeMeta.plan;
  const statusCopy =
    alarmRuntimeMeta.status === "refreshing"
      ? "Refreshing runtime state..."
      : alarmRuntimeMeta.lastLoadedAt
        ? `Updated at ${escapeHtml(formatClock(new Date(alarmRuntimeMeta.lastLoadedAt)))}`
        : "Ready";
  const nextTriggerCopy = runtime.nextTriggerAt ? escapeHtml(formatClock(new Date(runtime.nextTriggerAt))) : "-";
  const eventSyncCopy =
    alarmRuntimeMeta.eventSyncStatus === "sending"
      ? "Sending the latest app action to the server log."
      : alarmRuntimeMeta.eventSyncStatus === "error"
        ? alarmRuntimeMeta.eventSyncError || "Server event sync failed."
        : alarmRuntimeMeta.eventSyncStatus === "sent"
          ? "Latest app action was logged on the server."
          : "App actions will be mirrored into the server event log.";

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">memory</span>Server alarm runtime</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">Runtime</div>
          <div class="live-sync-value">${escapeHtml(String(runtime.status || "idle").toUpperCase())}</div>
          <div class="live-sync-copy">${plan ? escapeHtml(plan.todayStatus.detail) : "No active plan loaded yet."}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Next trigger</div>
          <div class="live-sync-value">${nextTriggerCopy}</div>
          <div class="live-sync-copy">${escapeHtml(statusCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Triggered today</div>
          <div class="live-sync-value">${escapeHtml(String(runtime.firedCountToday || 0))}</div>
          <div class="live-sync-copy">${escapeHtml(eventSyncCopy)}</div>
        </article>
      </div>
      ${
        runtime.lastEvent
          ? `
            <div class="sample-copy">
              Last server alert: ${escapeHtml(runtime.lastEvent.title)} at ${escapeHtml(formatClock(new Date(runtime.lastEvent.createdAt)))}
            </div>
          `
          : `<div class="sample-copy">No server-triggered alert has fired yet today.</div>`
      }
    </section>
  `;
}

function renderActiveAlarmPanel() {
  const delivery = alarmRuntimeMeta.delivery;
  if (!delivery?.currentAlert) {
    return `
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">notifications_active</span>Active server alarm</div>
        <div class="empty-copy">No active server-held alarm is waiting for a response right now.</div>
      </section>
    `;
  }

  const alert = delivery.currentAlert;
  const statusCopy =
    alert.status === "SNOOZED" && alert.snoozedUntil
      ? `Snoozed until ${escapeHtml(formatClock(new Date(alert.snoozedUntil)))}`
      : "The server is holding this alert as the current active morning alarm.";
  const actionCopy =
    alarmRuntimeMeta.actionStatus === "sending"
      ? "Sending the action to the server..."
      : alarmRuntimeMeta.actionStatus === "error"
        ? alarmRuntimeMeta.actionError || "The alarm action failed."
        : "Choose whether you already left or want one more minute.";
  const playbackCopy = getPlaybackStatusCopy();

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">notifications_active</span>Active server alarm</div>
      <div class="preview-card delivery-card">
        <div class="preview-label">${escapeHtml(alert.riskLevel || "INFO")} · ${escapeHtml(alert.status || "ACTIVE")}</div>
        <div class="preview-title">${escapeHtml(alert.title || "Current alarm")}</div>
        <div class="support-copy">${escapeHtml(alert.detail || "No active alarm detail.")}</div>
        ${renderDeliveryPriorityLine(alert, "sample-copy")}
        ${renderPlaybackIntensityLine(alert, "sample-copy")}
        ${renderConservativeContextLine(alert, "sample-copy")}
        <div class="sample-copy">
          Triggered at ${escapeHtml(formatClock(new Date(alert.createdAt)))} · ${escapeHtml(statusCopy)}
        </div>
        <div class="quick-actions delivery-actions">
          <button class="primary-cta" data-action="ack-active-alarm">
            <span>I've departed</span>
            <span class="material-symbols-outlined">directions_bus</span>
          </button>
          <button class="secondary-button" data-action="snooze-active-alarm">Snooze 1 min</button>
        </div>
        <div class="quick-actions-copy">${escapeHtml(actionCopy)}</div>
        <div class="sample-copy">${escapeHtml(playbackCopy)}</div>
      </div>
    </section>
  `;
}

function renderDispatchQueuePanel() {
  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">send_to_mobile</span>Dispatch queue</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">Bundles</div>
          <div class="live-sync-value">${escapeHtml(String(deviceMeta.dispatchTotal || 0))}</div>
          <div class="live-sync-copy">
            ${
              deviceMeta.dispatchLastLoadedAt
                ? `Updated at ${escapeHtml(formatClock(new Date(deviceMeta.dispatchLastLoadedAt)))}`
                : "No dispatch bundle has been loaded yet."
            }
          </div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Device</div>
          <div class="live-sync-value">${escapeHtml(String(state.device.platform || "android").toUpperCase())}</div>
          <div class="live-sync-copy">${escapeHtml(state.device.deviceName || "Primary Phone")}</div>
        </article>
      </div>
      <div class="history-list">
        ${
          deviceMeta.dispatchBundles.length
            ? deviceMeta.dispatchBundles.map(
                (bundle) => `
                  <article class="history-item">
                    <div class="history-main">
                      <div class="history-title">${escapeHtml(bundle.title || "Dispatch bundle")} · ${escapeHtml(bundle.riskLevel || "INFO")}</div>
                      <div class="history-detail">
                        ${escapeHtml(`${bundle.summary?.queued || 0} queued / ${bundle.summary?.blocked || 0} blocked / ${bundle.summary?.disabled || 0} disabled`)}
                      </div>
                      <div class="channel-badge-row">
                        ${(Array.isArray(bundle.channels) ? bundle.channels : [])
                          .slice(0, 6)
                          .map(
                            (channel) => `
                              <span class="channel-badge ${String(channel.status || "").toLowerCase()}">${escapeHtml(channel.label)} · ${escapeHtml(channel.status || "UNKNOWN")}</span>
                            `,
                          )
                          .join("")}
                      </div>
                    </div>
                    <div class="history-time">${escapeHtml(formatClock(new Date(bundle.createdAt)))}</div>
                  </article>
                `,
              ).join("")
            : `<div class="empty-copy">${escapeHtml(deviceMeta.dispatchError || "No dispatch bundle has been created yet.")}</div>`
        }
      </div>
    </section>
  `;
}

function renderDispatchExecutionPanel() {
  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">sms</span>Dispatch execution</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">Attempts</div>
          <div class="live-sync-value">${escapeHtml(String(deviceMeta.dispatchExecutionTotal || 0))}</div>
          <div class="live-sync-copy">
            ${
              deviceMeta.dispatchExecutionLastLoadedAt
                ? `Executed at ${escapeHtml(formatClock(new Date(deviceMeta.dispatchExecutionLastLoadedAt)))}`
                : "No execution result has been recorded yet."
            }
          </div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Latest result</div>
          <div class="live-sync-value">${escapeHtml(deviceMeta.dispatchExecutions[0]?.riskLevel || "IDLE")}</div>
          <div class="live-sync-copy">
            ${
              deviceMeta.dispatchExecutions[0]
                ? escapeHtml(deviceMeta.dispatchExecutions[0].title || "Dispatch execution ready.")
                : escapeHtml(deviceMeta.dispatchExecutionError || "The execution feed is waiting for the first dispatch bundle.")
            }
          </div>
        </article>
      </div>
      <div class="history-list">
        ${
          deviceMeta.dispatchExecutions.length
            ? deviceMeta.dispatchExecutions.map(
                (attempt) => `
                  <article class="history-item">
                    <div class="history-main">
                      <div class="history-title">${escapeHtml(attempt.title || "Dispatch execution")} · ${escapeHtml(attempt.riskLevel || "INFO")}</div>
                      <div class="history-detail">
                        ${escapeHtml(`${attempt.summary?.simulated_sent || 0} simulated / ${attempt.summary?.failed || 0} failed / ${attempt.summary?.skipped || 0} skipped`)}
                      </div>
                      <div class="channel-badge-row">
                        ${(Array.isArray(attempt.channels) ? attempt.channels : [])
                          .slice(0, 6)
                          .map(
                            (channel) => `
                              <span class="channel-badge ${String(channel.executionStatus || "").toLowerCase()}">${escapeHtml(channel.label)} · ${escapeHtml(channel.executionStatus || "UNKNOWN")}</span>
                            `,
                          )
                          .join("")}
                      </div>
                    </div>
                    <div class="history-time">${escapeHtml(formatClock(new Date(attempt.executedAt)))}</div>
                  </article>
                `,
              ).join("")
            : `<div class="empty-copy">${escapeHtml(deviceMeta.dispatchExecutionError || "No dispatch execution has been simulated yet.")}</div>`
        }
      </div>
    </section>
  `;
}

function renderDispatchQueuePanelStageAware() {
  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">send_to_mobile</span>Dispatch queue</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">Bundles</div>
          <div class="live-sync-value">${escapeHtml(String(deviceMeta.dispatchTotal || 0))}</div>
          <div class="live-sync-copy">
            ${
              deviceMeta.dispatchLastLoadedAt
                ? `Updated at ${escapeHtml(formatClock(new Date(deviceMeta.dispatchLastLoadedAt)))}`
                : "No dispatch bundle has been loaded yet."
            }
          </div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Device</div>
          <div class="live-sync-value">${escapeHtml(String(state.device.platform || "android").toUpperCase())}</div>
          <div class="live-sync-copy">${escapeHtml(state.device.deviceName || "Primary Phone")}</div>
        </article>
      </div>
      <div class="history-list">
        ${
          deviceMeta.dispatchBundles.length
            ? deviceMeta.dispatchBundles.map(
                (bundle) => `
                  <article class="history-item">
                    <div class="history-main">
                      <div class="history-title">${escapeHtml(bundle.title || "Dispatch bundle")} · ${escapeHtml(bundle.riskLevel || "INFO")} · ${escapeHtml(bundle.escalationLabel || "Initial")}</div>
                      <div class="history-detail">
                        ${escapeHtml(`${bundle.summary?.queued || 0} queued / ${bundle.summary?.blocked || 0} blocked / ${bundle.summary?.disabled || 0} disabled / +${bundle.secondsSinceTrigger || 0}s`)}
                      </div>
                      ${renderDeliveryPriorityLine(bundle)}
                      ${renderPlaybackIntensityLine(bundle)}
                      ${renderConservativeContextLine(bundle)}
                      <div class="channel-badge-row">
                        ${(Array.isArray(bundle.channels) ? bundle.channels : [])
                          .slice(0, 6)
                          .map(
                            (channel) => `
                              <span class="channel-badge ${String(channel.status || "").toLowerCase()}">${escapeHtml(channel.label)} · ${escapeHtml(channel.status || "UNKNOWN")}</span>
                            `,
                          )
                          .join("")}
                      </div>
                    </div>
                    <div class="history-time">${escapeHtml(formatClock(new Date(bundle.createdAt)))}</div>
                  </article>
                `,
              ).join("")
            : `<div class="empty-copy">${escapeHtml(deviceMeta.dispatchError || "No dispatch bundle has been created yet.")}</div>`
        }
      </div>
    </section>
  `;
}

function renderDispatchExecutionPanelStageAware() {
  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">sms</span>Dispatch execution</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">Attempts</div>
          <div class="live-sync-value">${escapeHtml(String(deviceMeta.dispatchExecutionTotal || 0))}</div>
          <div class="live-sync-copy">
            ${
              deviceMeta.dispatchExecutionLastLoadedAt
                ? `Executed at ${escapeHtml(formatClock(new Date(deviceMeta.dispatchExecutionLastLoadedAt)))}`
                : "No execution result has been recorded yet."
            }
          </div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Latest result</div>
          <div class="live-sync-value">${escapeHtml(deviceMeta.dispatchExecutions[0]?.riskLevel || "IDLE")}</div>
          <div class="live-sync-copy">
            ${
              deviceMeta.dispatchExecutions[0]
                ? escapeHtml(deviceMeta.dispatchExecutions[0].title || "Dispatch execution ready.")
                : escapeHtml(deviceMeta.dispatchExecutionError || "The execution feed is waiting for the first dispatch bundle.")
            }
          </div>
        </article>
      </div>
      <div class="history-list">
        ${
          deviceMeta.dispatchExecutions.length
            ? deviceMeta.dispatchExecutions.map(
                (attempt) => `
                  <article class="history-item">
                    <div class="history-main">
                      <div class="history-title">${escapeHtml(attempt.title || "Dispatch execution")} · ${escapeHtml(attempt.riskLevel || "INFO")} · ${escapeHtml(attempt.escalationLabel || "Initial")}</div>
                      <div class="history-detail">
                        ${escapeHtml(`${attempt.summary?.simulated_sent || 0} simulated / ${attempt.summary?.failed || 0} failed / ${attempt.summary?.skipped || 0} skipped / +${attempt.secondsSinceTrigger || 0}s`)}
                      </div>
                      ${renderDeliveryPriorityLine(attempt)}
                      ${renderPlaybackIntensityLine(attempt)}
                      ${renderConservativeContextLine(attempt)}
                      <div class="channel-badge-row">
                        ${(Array.isArray(attempt.channels) ? attempt.channels : [])
                          .slice(0, 6)
                          .map(
                            (channel) => `
                              <span class="channel-badge ${String(channel.executionStatus || "").toLowerCase()}">${escapeHtml(channel.label)} · ${escapeHtml(channel.executionStatus || "UNKNOWN")}</span>
                            `,
                          )
                          .join("")}
                      </div>
                    </div>
                    <div class="history-time">${escapeHtml(formatClock(new Date(attempt.executedAt)))}</div>
                  </article>
                `,
              ).join("")
            : `<div class="empty-copy">${escapeHtml(deviceMeta.dispatchExecutionError || "No dispatch execution has been simulated yet.")}</div>`
        }
      </div>
    </section>
  `;
}

function renderPushAdapterPreviewPanel() {
  const preview = deviceMeta.pushPreview;
  const statusLabel = String(preview?.status || "idle").toUpperCase();
  const adapterLabel = String(preview?.adapter || "fcm").toUpperCase();
  const envelopeJson = preview?.envelope ? JSON.stringify(preview.envelope, null, 2) : "";
  const detailCopy =
    preview?.reason ||
    deviceMeta.pushPreviewError ||
    "The server has not prepared a push adapter envelope yet.";

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">quickreply</span>Push Adapter Preview</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">Status</div>
          <div class="live-sync-value">${escapeHtml(statusLabel)}</div>
          <div class="live-sync-copy">${escapeHtml(detailCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Adapter</div>
          <div class="live-sync-value">${escapeHtml(adapterLabel)}</div>
          <div class="live-sync-copy">
            ${
              preview?.target?.tokenMasked
                ? `Token ${escapeHtml(preview.target.tokenMasked)}`
                : "No registered token yet."
            }
          </div>
        </article>
      </div>
      <div class="sample-copy">
        ${
          deviceMeta.pushPreviewLoadedAt
            ? `Updated at ${escapeHtml(formatClock(new Date(deviceMeta.pushPreviewLoadedAt)))}`
            : "Waiting for the first preview refresh."
        }
      </div>
      ${
        envelopeJson
          ? `<pre class="payload-preview">${escapeHtml(envelopeJson)}</pre>`
          : `<div class="empty-copy">${escapeHtml(detailCopy)}</div>`
      }
    </section>
  `;
}

function renderFcmAuthPanel() {
  const auth = deviceMeta.fcmAuthStatus;
  const strategy = String(auth?.authStrategy || "none").toUpperCase();
  const tokenStatus = String(auth?.accessTokenStatus || "idle").toUpperCase();
  const detailCopy =
    auth?.reason ||
    deviceMeta.fcmAuthStatusError ||
    (auth?.accessTokenStatus === "ready"
      ? auth?.accessTokenExpiresAt
        ? `Access token cached until ${formatClock(new Date(auth.accessTokenExpiresAt))}.`
        : "Manual bearer token is ready."
      : "FCM auth has not been checked yet.");

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">verified_user</span>FCM Auth Health</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">Strategy</div>
          <div class="live-sync-value">${escapeHtml(strategy)}</div>
          <div class="live-sync-copy">${escapeHtml(auth?.serviceAccountEmail || auth?.serviceAccountFilePath || "No service account configured.")}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Token</div>
          <div class="live-sync-value">${escapeHtml(tokenStatus)}</div>
          <div class="live-sync-copy">${escapeHtml(detailCopy)}</div>
        </article>
      </div>
      <div class="sample-copy">
        ${
          auth?.projectId
            ? `Project ${escapeHtml(auth.projectId)} · ${escapeHtml(String(auth.accessTokenCacheStatus || "none").toUpperCase())}`
            : "FCM project id is not configured yet."
        }
      </div>
    </section>
  `;
}

function runPushGatewayCurrentBundle() {
  const dispatchKey = String(deviceMeta.dispatchBundles[0]?.dispatchKey || "");
  deviceMeta.pushGatewayDispatchStatus = "sending";
  deviceMeta.pushGatewayDispatchError = "";
  render();

  runPushGatewayDispatch(dispatchKey)
    .then((payload) => {
      deviceMeta.pushGatewayDispatchStatus = "sent";
      deviceMeta.pushGatewayDispatchError = "";
      if (payload?.attempt) {
        deviceMeta.pushGatewayAttempts = [payload.attempt, ...deviceMeta.pushGatewayAttempts].slice(0, 4);
        deviceMeta.pushGatewayAttemptTotal = Number(payload.totalAttempts) || deviceMeta.pushGatewayAttempts.length;
        deviceMeta.pushGatewayLastAttemptAt = payload.attempt.createdAt || new Date().toISOString();
      }
      pushHistory("Push gateway checked", payload?.attempt?.reason || "The provider handoff was recorded.");
      queueAlarmRuntimeRefresh(0);
      render();
    })
    .catch((error) => {
      deviceMeta.pushGatewayDispatchStatus = "error";
      deviceMeta.pushGatewayDispatchError = error instanceof Error ? error.message : "Unknown push gateway error.";
      render();
    });
}

function runPushGatewayTestBundle() {
  deviceMeta.pushGatewayDispatchStatus = "sending";
  deviceMeta.pushGatewayDispatchError = "";
  render();

  runPushGatewayTestDispatch({
    routeNumber: state.live.routeNumber || state.live.routeId || state.commute.primaryLineId || "1002",
    stopName: state.live.stationName || state.commute.selectedStopId || "Registered stop",
    riskLevel: "RED",
  })
    .then((payload) => {
      deviceMeta.pushGatewayDispatchStatus = "sent";
      deviceMeta.pushGatewayDispatchError = "";
      if (payload?.attempt) {
        deviceMeta.pushGatewayAttempts = [payload.attempt, ...deviceMeta.pushGatewayAttempts].slice(0, 4);
        deviceMeta.pushGatewayAttemptTotal = Number(payload.totalAttempts) || deviceMeta.pushGatewayAttempts.length;
        deviceMeta.pushGatewayLastAttemptAt = payload.attempt.createdAt || new Date().toISOString();
      }
      pushHistory("Test push checked", payload?.attempt?.reason || "The test push handoff was recorded.");
      queueAlarmRuntimeRefresh(0);
      render();
    })
    .catch((error) => {
      deviceMeta.pushGatewayDispatchStatus = "error";
      deviceMeta.pushGatewayDispatchError = error instanceof Error ? error.message : "Unknown test push error.";
      render();
    });
}

function runPushGatewayRetrySimulationAction(action, outcome = "success") {
  deviceMeta.pushGatewayDispatchStatus = "sending";
  deviceMeta.pushGatewayDispatchError = "";
  render();

  runPushGatewayRetrySimulation({
    action,
    outcome,
    routeNumber: state.live.routeNumber || state.live.routeId || state.commute.primaryLineId || "1002",
    stopName: state.live.stationName || state.commute.selectedStopId || "Registered stop",
    riskLevel: "RED",
  })
    .then((payload) => {
      deviceMeta.pushGatewayDispatchStatus = "sent";
      deviceMeta.pushGatewayDispatchError = "";
      applyPushGatewaySummary(payload?.pushGateway || {}, payload?.savedAt || new Date().toISOString());
      const historyTitle =
        action === "seed-retryable-failure"
          ? "Retry simulation seeded"
          : action === "clear-simulation"
            ? "Retry simulation cleared"
            : outcome === "hard-failure"
              ? "Due retry replayed as hard failure"
              : outcome === "retryable-failure"
                ? "Due retry replayed as retryable failure"
                : "Due retry replayed as success";
      pushHistory(historyTitle, payload?.attempt?.reason || "The retry simulation completed.");
      queueAlarmRuntimeRefresh(0);
      render();
    })
    .catch((error) => {
      deviceMeta.pushGatewayDispatchStatus = "error";
      deviceMeta.pushGatewayDispatchError = error instanceof Error ? error.message : "Unknown retry simulation error.";
      render();
    });
}

function renderPushGatewayPanel() {
  const config = deviceMeta.pushGatewayConfig;
  const activeAdapter = String(deviceMeta.pushPreview?.adapter || "fcm");
  const adapterConfig = config?.adapters?.[activeAdapter] || null;
  const adapterStrategy =
    activeAdapter === "fcm" ? String(adapterConfig?.authStrategy || "none").toUpperCase() : "DRY_RUN";
  const nextRetryPriorityClass = String(deviceMeta.pushGatewayNextRetryDeliveryPriorityClass || "").trim().toLowerCase();
  const standardBackoff = Array.isArray(deviceMeta.pushGatewayPriorityBackoffSeconds?.standard)
    ? deviceMeta.pushGatewayPriorityBackoffSeconds.standard
    : deviceMeta.pushGatewayRetryBackoffSeconds;
  const boostedBackoff = Array.isArray(deviceMeta.pushGatewayPriorityBackoffSeconds?.boosted)
    ? deviceMeta.pushGatewayPriorityBackoffSeconds.boosted
    : [];
  const statusCopy =
    deviceMeta.pushGatewayDispatchStatus === "sending"
      ? "Sending or recording the provider handoff..."
      : deviceMeta.pushGatewayDispatchStatus === "error"
        ? deviceMeta.pushGatewayDispatchError || "The push gateway action failed."
          : deviceMeta.pushGatewayDispatchStatus === "sent"
            ? deviceMeta.pushGatewayLastAttemptAt
              ? `Last checked at ${escapeHtml(formatClock(new Date(deviceMeta.pushGatewayLastAttemptAt)))}` 
              : "The latest push gateway attempt was recorded."
          : "New dispatch bundles are now handed off automatically, and you can still run manual dry-runs or test pushes.";

  return `
    <section class="stack-panel" id="push-gateway-panel">
      <div class="stack-title"><span class="material-symbols-outlined">outgoing_mail</span>Push Gateway</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">Mode</div>
          <div class="live-sync-value">${escapeHtml(String(config?.mode || "preview").toUpperCase())}</div>
          <div class="live-sync-copy">${escapeHtml(statusCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Active Adapter</div>
          <div class="live-sync-value">${escapeHtml(activeAdapter.toUpperCase())}</div>
          <div class="live-sync-copy">
            ${escapeHtml(
              adapterConfig?.configured
                ? adapterConfig.executeSupported
                  ? `Credentials are present for this adapter via ${adapterStrategy}.`
                  : adapterConfig.limitation || "This adapter is limited to preview mode in the prototype."
                : deviceMeta.pushGatewayConfigError || "Credentials are missing for this adapter.",
            )}
          </div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Auto Handled</div>
          <div class="live-sync-value">${escapeHtml(String(deviceMeta.pushGatewayHandledDispatchKeys || 0))}</div>
          <div class="live-sync-copy">
            ${
              deviceMeta.pushGatewayDateKey
                ? `Dispatch keys already auto-handed off for ${escapeHtml(deviceMeta.pushGatewayDateKey)}.`
                : "No automatic push handoff has been recorded for the current day yet."
            }
          </div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Retry Queue</div>
          <div class="live-sync-value">${escapeHtml(String(deviceMeta.pushGatewayRetryPending || 0))}</div>
          <div class="live-sync-copy">
            ${
              deviceMeta.pushGatewayNextRetryAt
                ? `${
                    nextRetryPriorityClass === "boosted" ? "Next boosted first-alarm retry" : "Next retry"
                  } at ${escapeHtml(formatClock(new Date(deviceMeta.pushGatewayNextRetryAt)))}.`
                : "Only failed provider handoffs enter retry, and none are waiting right now."
            }
          </div>
        </article>
      </div>
      <div class="sample-copy">
        Auto retry runs only for provider failures such as network errors, HTTP 429, or HTTP 5xx.
        ${
          standardBackoff.length
            ? ` Standard retry: ${escapeHtml(standardBackoff.join("s / "))}s.`
            : ""
        }
        ${
          boostedBackoff.length
            ? ` Boosted first-alarm retry: ${escapeHtml(boostedBackoff.join("s / "))}s.`
            : ""
        }
      </div>
      ${
        deviceMeta.pushGatewayBoostedRetryPending
          ? `<div class="quick-actions-copy">${escapeHtml(`${deviceMeta.pushGatewayBoostedRetryPending} queued retry item(s) are using the boosted first-alarm policy because those alarms came from historically unstable routes.`)}</div>`
          : ""
      }
      ${
        deviceMeta.pushGatewayRetryQueue.length
          ? `
            <div class="retry-queue-list">
              ${deviceMeta.pushGatewayRetryQueue
                .map(
                  (item) => `
                    <article class="retry-queue-item" data-focus-kind="retry-queue" data-focus-key="${escapeHtml(item.dispatchKey || "")}">
                      <div>
                        <div class="retry-queue-title">${escapeHtml(item.title || `${item.routeNumber || "Route"} retry`)}</div>
                        <div class="retry-queue-copy">
                          ${escapeHtml(
                            [
                              item.routeNumber ? `Route ${item.routeNumber}` : "",
                              item.stopName || "",
                              item.escalationLabel || "",
                              Number(item.retryAttempt) ? `Attempt ${item.retryAttempt}` : "",
                              item.retryProfileLabel || "",
                            ]
                              .filter(Boolean)
                              .join(" · "),
                          )}
                        </div>
                        ${renderDeliveryPriorityLine(item, "retry-queue-copy")}
                        ${renderPlaybackIntensityLine(item, "retry-queue-copy")}
                        ${renderConservativeContextLine(item, "retry-queue-copy")}
                      </div>
                      <div class="retry-queue-time">${escapeHtml(formatClock(new Date(item.scheduledAt)))}</div>
                    </article>
                  `,
                )
                .join("")}
            </div>
          `
          : ""
      }
      <div class="quick-actions">
        <button class="soft-button wide" data-action="run-push-gateway" ${deviceMeta.pushGatewayDispatchStatus === "sending" ? "disabled" : ""}>
          ${
            deviceMeta.dispatchBundles.length
              ? deviceMeta.pushGatewayConfig?.mode === "execute"
                ? "Send Current Gateway Bundle"
                : "Preview Current Gateway Request"
              : "No Active Bundle"
          }
        </button>
        <button
          class="soft-button wide"
          data-action="run-test-push-gateway"
          ${
            deviceMeta.pushGatewayDispatchStatus === "sending" ||
            String(deviceMeta.tokenHealth?.deliveryReadiness || "") === "blocked" ||
            !state.device.pushEnabled
              ? "disabled"
              : ""
          }
        >
          ${deviceMeta.pushGatewayDispatchStatus === "sending" ? "Sending Test Push..." : "Run Test Push"}
        </button>
      </div>
      <div class="quick-actions">
        ${
          state.device.platform === "web"
            ? `<button class="soft-button wide" data-action="subscribe-web-push" ${deviceMeta.tokenRegisterStatus === "sending" ? "disabled" : ""}>
                 ${deviceMeta.tokenRegisterStatus === "sending" ? "Subscribing Browser..." : "Enable Browser Push"}
               </button>`
            : ""
        }
        <button
          class="soft-button wide"
          data-action="seed-push-retry-simulation"
          ${deviceMeta.pushGatewayDispatchStatus === "sending" ? "disabled" : ""}
        >
          ${deviceMeta.pushGatewayDispatchStatus === "sending" ? "Preparing Retry Demo..." : "Simulate Retryable Failure"}
        </button>
        <button
          class="soft-button wide"
          data-action="run-push-retry-simulation"
          ${
            deviceMeta.pushGatewayDispatchStatus === "sending" || !deviceMeta.pushGatewayRetryPending
              ? "disabled"
              : ""
          }
        >
          ${deviceMeta.pushGatewayDispatchStatus === "sending" ? "Running Due Retry..." : "Run Due Retry"}
        </button>
      </div>
      <div class="quick-actions">
        <button
          class="soft-button wide"
          data-action="run-push-retry-hard-failure"
          ${
            deviceMeta.pushGatewayDispatchStatus === "sending" || !deviceMeta.pushGatewayRetryPending
              ? "disabled"
              : ""
          }
        >
          ${deviceMeta.pushGatewayDispatchStatus === "sending" ? "Running Hard Fail Demo..." : "Run Due Retry as 400"}
        </button>
        <button
          class="soft-button wide"
          data-action="run-push-retry-retryable-failure"
          ${
            deviceMeta.pushGatewayDispatchStatus === "sending" || !deviceMeta.pushGatewayRetryPending
              ? "disabled"
              : ""
          }
        >
          ${deviceMeta.pushGatewayDispatchStatus === "sending" ? "Running 503 Demo..." : "Run Due Retry as 503"}
        </button>
        <button
          class="soft-button wide"
          data-action="clear-push-retry-simulation"
          ${
            deviceMeta.pushGatewayDispatchStatus === "sending" ||
            (!deviceMeta.pushGatewayRetryPending && !deviceMeta.pushGatewayAttemptTotal)
              ? "disabled"
              : ""
          }
        >
          ${deviceMeta.pushGatewayDispatchStatus === "sending" ? "Clearing Demo..." : "Clear Simulation Records"}
        </button>
      </div>
      <div class="history-list">
        ${
          deviceMeta.pushGatewayAttempts.length
            ? deviceMeta.pushGatewayAttempts.map(
                (attempt) => `
                  <article class="history-item">
                    <div class="history-main">
                      <div class="history-title">${escapeHtml(attempt.title || "Push gateway attempt")} · ${escapeHtml(attempt.status || "UNKNOWN")}</div>
                      <div class="history-detail">
                        ${escapeHtml(attempt.reason || "No detail.")}
                        ${
                          attempt.routeNumber || attempt.stopName
                            ? `<br /><span>${escapeHtml(
                                [attempt.routeNumber ? `Route ${attempt.routeNumber}` : "", attempt.stopName || ""]
                                  .filter(Boolean)
                                  .join(" · "),
                              )}</span>`
                            : ""
                        }
                      </div>
                      ${renderDeliveryPriorityLine(attempt)}
                      ${renderPlaybackIntensityLine(attempt)}
                      ${renderConservativeContextLine(attempt)}
                      <div class="channel-badge-row">
                        <span class="channel-badge ${String(attempt.adapter || "").toLowerCase()}">${escapeHtml(String(attempt.adapter || "adapter").toUpperCase())}</span>
                        <span class="channel-badge ${String(attempt.mode || "").toLowerCase()}">${escapeHtml(String(attempt.mode || "preview").toUpperCase())}</span>
                        <span class="channel-badge ${String(attempt.origin || "").toLowerCase()}">${escapeHtml(String(attempt.origin || "manual").toUpperCase())}</span>
                        ${
                          Number(attempt.retryAttempt) > 0
                            ? `<span class="channel-badge test">RETRY ${escapeHtml(String(attempt.retryAttempt))}</span>`
                            : ""
                        }
                        ${
                          attempt.response?.authSource
                            ? `<span class="channel-badge ready">${escapeHtml(String(attempt.response.authSource).toUpperCase())}</span>`
                            : ""
                        }
                      </div>
                    </div>
                    <div class="history-time">${escapeHtml(formatClock(new Date(attempt.createdAt)))}</div>
                  </article>
                `,
              ).join("")
            : `<div class="empty-copy">${escapeHtml(deviceMeta.pushGatewayAttemptsError || "No push gateway attempt has been recorded yet.")}</div>`
        }
      </div>
    </section>
  `;
}

function renderDeviceDeliveryPanel() {
  const tokenHealth = deviceMeta.tokenHealth;
  const deviceStatusCopy =
    deviceMeta.syncStatus === "pending"
      ? "Changes queued for device sync."
      : deviceMeta.syncStatus === "syncing"
        ? "Saving the device delivery profile..."
        : deviceMeta.syncStatus === "synced"
          ? deviceMeta.lastSyncedAt
            ? `Synced at ${escapeHtml(formatClock(new Date(deviceMeta.lastSyncedAt)))}`
            : "Synced"
          : deviceMeta.syncStatus === "error"
            ? deviceMeta.lastError || "Device sync failed."
            : "Waiting for changes.";
  const tokenStatusCopy =
    deviceMeta.tokenRegisterStatus === "sending"
      ? "Normalizing and registering the current token on the server..."
      : deviceMeta.tokenRegisterStatus === "error"
        ? deviceMeta.tokenRegisterError || "Device token registration failed."
        : tokenHealth?.reason || deviceMeta.tokenHealthError || "Register the current token to verify its platform format.";
  const tokenActionCopy =
    tokenHealth?.recommendedAction || "Paste a real device token first, then run token registration.";

  return `
    <section class="stack-panel" id="device-delivery-panel">
      <div class="stack-title"><span class="material-symbols-outlined">smartphone</span>Device Delivery</div>
      <div class="field-grid">
        <label class="field-block">
          <span>Device Name</span>
          <input type="text" value="${escapeHtml(state.device.deviceName)}" data-field="device.deviceName" />
        </label>
        <label class="field-block">
          <span>Platform</span>
          <select data-field="device.platform">
            ${["android", "ios", "web"]
              .map(
                (platform) => `
                  <option value="${platform}" ${state.device.platform === platform ? "selected" : ""}>${platform.toUpperCase()}</option>
                `,
              )
              .join("")}
          </select>
        </label>
      </div>
      <label class="field-block">
        <span>Push Token</span>
        <input
          id="device-push-token-input"
          type="text"
          value="${escapeHtml(state.device.pushToken)}"
          data-field="device.pushToken"
          placeholder="FCM or APNs token placeholder"
        />
      </label>
      <div class="quick-actions">
        <button
          class="soft-button wide"
          data-action="register-device-token"
          ${!state.device.pushToken.trim() || deviceMeta.tokenRegisterStatus === "sending" ? "disabled" : ""}
        >
          ${deviceMeta.tokenRegisterStatus === "sending" ? "Registering Token..." : "Register Device Token"}
        </button>
        <button
          class="soft-button wide"
          data-action="run-test-push-gateway"
          ${
            deviceMeta.pushGatewayDispatchStatus === "sending" ||
            String(tokenHealth?.deliveryReadiness || "") === "blocked" ||
            !state.device.pushEnabled
              ? "disabled"
              : ""
          }
        >
          ${deviceMeta.pushGatewayDispatchStatus === "sending" ? "Sending Test Push..." : "Send Test Push"}
        </button>
      </div>
      <div class="sample-copy">${escapeHtml(tokenActionCopy)}</div>
      <div class="toggle-row inset">
        <div>
          <div class="toggle-title">Push Delivery</div>
          <p class="field-help">Server dispatch bundles will try push first when this is on.</p>
        </div>
        <button class="toggle ${state.device.pushEnabled ? "on" : ""}" data-action="toggle-field" data-field="device.pushEnabled"><span></span></button>
      </div>
      <div class="toggle-row inset">
        <div>
          <div class="toggle-title">Full-screen Permission</div>
          <p class="field-help">Needed for red-level alerts that want a full-screen interruption.</p>
        </div>
        <button class="toggle ${state.device.fullScreenEnabled ? "on" : ""}" data-action="toggle-field" data-field="device.fullScreenEnabled"><span></span></button>
      </div>
      <div class="toggle-row inset">
        <div>
          <div class="toggle-title">DND Override Granted</div>
          <p class="field-help">Marks whether the device can legally bypass Do Not Disturb for critical alerts.</p>
        </div>
        <button class="toggle ${state.device.dndOverrideGranted ? "on" : ""}" data-action="toggle-field" data-field="device.dndOverrideGranted"><span></span></button>
      </div>
      <div class="toggle-row inset">
        <div>
          <div class="toggle-title">Battery Optimization Ignored</div>
          <p class="field-help">Local fallback alarms are more reliable when this is on.</p>
        </div>
        <button class="toggle ${state.device.batteryOptimizationIgnored ? "on" : ""}" data-action="toggle-field" data-field="device.batteryOptimizationIgnored"><span></span></button>
      </div>
      <div class="toggle-grid">
        <button class="choice-chip ${state.device.localBackupEnabled ? "selected" : ""}" data-action="toggle-field" data-field="device.localBackupEnabled">Local Backup</button>
        <button class="choice-chip ${state.device.soundEnabled ? "selected" : ""}" data-action="toggle-field" data-field="device.soundEnabled">Sound</button>
        <button class="choice-chip ${state.device.vibrationEnabled ? "selected" : ""}" data-action="toggle-field" data-field="device.vibrationEnabled">Vibration</button>
        <button class="choice-chip ${state.device.ttsEnabled ? "selected" : ""}" data-action="toggle-field" data-field="device.ttsEnabled">TTS</button>
      </div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">Profile</div>
          <div class="live-sync-value">${escapeHtml(deviceMeta.syncStatus.toUpperCase())}</div>
          <div class="live-sync-copy">${escapeHtml(deviceStatusCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Token Health</div>
          <div class="live-sync-value">${escapeHtml(String(tokenHealth?.deliveryReadiness || "unknown").toUpperCase())}</div>
          <div class="live-sync-copy">${escapeHtml(tokenStatusCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Adapter</div>
          <div class="live-sync-value">${escapeHtml(String(tokenHealth?.adapter || state.device.platform || "fcm").toUpperCase())}</div>
          <div class="live-sync-copy">
            ${escapeHtml(tokenHealth?.tokenMasked || "No token registered yet.")}
            ${
              tokenHealth?.tokenKind
                ? `<br /><span>${escapeHtml(String(tokenHealth.tokenKind).toUpperCase())}</span>`
                : ""
            }
          </div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">Dispatch Queue</div>
          <div class="live-sync-value">${escapeHtml(String(deviceMeta.dispatchTotal || 0))}</div>
          <div class="live-sync-copy">
            ${
              deviceMeta.dispatchBundles[0]
                ? escapeHtml(deviceMeta.dispatchBundles[0].title || "Latest bundle ready.")
                : escapeHtml(deviceMeta.dispatchError || "No dispatch bundle yet.")
            }
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderAccountPanel() {
  const snapshot = accountMeta.snapshot;
  const user = snapshot?.user || authMeta.user || {};
  const labels = { google: "구글", kakao: "카카오", naver: "네이버" };
  const providers = (user.providers || []).map((id) => labels[id] || id);
  const copy = accountMeta.profileStatus === "saving" ? "이름을 저장하고 있습니다."
    : accountMeta.profileStatus === "saved" ? "이름을 저장했습니다."
    : accountMeta.profileError || "앱에서 사용할 이름을 설정하세요.";
  return `<section class="stack-panel">
    <div class="stack-title"><span class="material-symbols-outlined">manage_accounts</span>내 계정</div>
    <div class="field-help">로그인 방법: ${escapeHtml(providers.join(", ") || "소셜 로그인")}</div>
    <div class="field-help">비밀번호와 계정 복구는 로그인에 사용한 서비스에서 관리합니다.</div>
    <label class="field-card"><span>표시 이름</span>
      <input class="text-field-input" type="text" maxlength="80" data-account-field="name" value="${escapeHtml(accountDraft.name)}" placeholder="이름 또는 닉네임" />
    </label>
    <div class="field-help">${escapeHtml(copy)}</div>
    <button class="soft-button wide" data-action="save-account-profile">이름 저장</button>
  </section>`;
}

function renderServerEventPanel() {
  if (alarmRuntimeMeta.status === "loading" && !alarmRuntimeMeta.events.length) {
    return `
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">list_alt</span>Server event log</div>
        <div class="empty-copy">Loading the latest server-side alarm events.</div>
      </section>
    `;
  }

  if (alarmRuntimeMeta.status === "error" && !alarmRuntimeMeta.events.length) {
    return `
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">list_alt</span>Server event log</div>
        <div class="empty-copy">${escapeHtml(alarmRuntimeMeta.lastError || "Server event feed failed to load.")}</div>
      </section>
    `;
  }

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">list_alt</span>Server event log</div>
      <div class="history-list">
        ${
          alarmRuntimeMeta.events.length
            ? alarmRuntimeMeta.events.map(
                (item) => `
                  <article class="history-item">
                    <div class="history-main">
                      <div class="history-title">${escapeHtml(item.title || item.kind || "Alarm event")}</div>
                      <div class="history-detail">${escapeHtml(item.detail || "No detail.")}</div>
                      ${renderDeliveryPriorityLine(item)}
                      ${renderPlaybackIntensityLine(item)}
                      ${renderConservativeContextLine(item)}
                    </div>
                    <div class="history-time">${escapeHtml(formatClock(new Date(item.createdAt)))}</div>
                  </article>
                `,
              ).join("")
            : `<div class="empty-copy">No server event has been written yet.</div>`
        }
      </div>
    </section>
  `;
}

function renderHome(screen, model) {
  return `
    <main class="screen screen-home">
      ${renderStatusCard(model)}
      ${renderGauge(model)}
      ${renderCommuteSummary(model)}
      ${renderLiveSyncPanel(model)}
      ${renderBusAccuracyPanel()}
      ${renderBusAccuracyLeaderboardPanel()}
      ${renderConservativeReliabilityPanel()}
      ${renderDeliveryIntensityPanel()}
      ${renderAlarmPlanPanel()}
      ${renderAlarmRuntimePanel()}
      ${renderActiveAlarmPanel()}
      ${renderDispatchQueuePanelStageAware()}
      ${renderDispatchExecutionPanelStageAware()}
      ${renderPushAdapterPreviewPanel()}
      ${renderFcmAuthPanel()}
      ${renderPushGatewayPanel()}
      ${renderStateSyncPanel()}
      <section class="panel-section">
        <div class="section-heading-row">
          <div>
            <div class="section-title">Next Buses · Route ${escapeHtml(model.primaryLine.number)}</div>
            <div class="section-caption">${escapeHtml(model.stop.name)} boarding stop</div>
          </div>
          <button class="ghost-link" data-action="goto" data-screen="onboarding">Edit commute</button>
        </div>
        ${model.risk.results.map((result, index) => renderBusCard(result, index === model.risk.targetResult.index ? "this" : "next", model.primaryLine, model.risk.lastChanceConfirmed && index === model.risk.targetResult.index ? "orange" : "")).join("")}
      </section>
      <section class="message-panel">
        <div class="message-icon"><span class="material-symbols-outlined">tips_and_updates</span></div>
        <div>
          <div class="message-title">Late-risk guidance</div>
          <div class="message-body">${escapeHtml(model.risk.message)}</div>
        </div>
      </section>
      ${renderHistoryPanel()}
      ${renderServerEventPanel()}
      <section class="quick-actions">
        <button class="primary-cta" data-action="departed">
          <span>I've departed</span>
          <span class="material-symbols-outlined">arrow_forward</span>
        </button>
        <div class="quick-actions-copy">One tap marks the current morning alarm flow as completed.</div>
      </section>
    </main>
    ${renderBottomNav(screen)}
  `;
}

function renderOnboarding() {
  const stop = getSelectedStop();
  const primaryLine = getPrimaryLine(stop);
  const routeEstimate = getRouteEstimate(stop, primaryLine);
  const recommendedStops = getRecommendedStops(2);
  const nearestStop = recommendedStops[0] || null;
  const search = state.ui.routeSearch.trim().toLowerCase();
  const placeProviderLabel = placeApiConfig.providers?.kakao?.configured ? "Kakao Local REST API" : "Demo address library";
  const filteredStops = STOP_LIBRARY.filter((item) => {
    if (!search) return true;
    return `${item.name} ${item.subtitle} ${item.stopCode}`.toLowerCase().includes(search);
  });

  return `
    <main class="screen screen-form">
      <section class="progress-shell">
        <div class="progress-meta"><span>STEP 3 OF 5</span><span>Bus Stop & Route</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:60%"></div></div>
      </section>
      <section class="panel">
        <div class="panel-title">Commute basics</div>
        <div class="field-help">주소 검색은 현재 ${escapeHtml(placeProviderLabel)} 기준으로 동작합니다. 선택한 좌표는 지도와 목적지 경로 조회에 사용합니다. 집에서 정류장까지의 시간은 지각 계산에서 제외합니다.</div>
        <div class="field-stack">
          <div class="holiday-form">
            <input class="text-field-input" type="text" placeholder="집 주소나 건물명 검색" value="${escapeHtml(state.ui.homeAddressKeyword)}" data-field="ui.homeAddressKeyword" />
            <button class="mini-button add-button" data-action="search-home-address" ${state.ui.homeAddressSearchStatus === "loading" ? "disabled" : ""}>
              ${state.ui.homeAddressSearchStatus === "loading" ? "Searching..." : "Search"}
            </button>
          </div>
          ${
            state.user.homeLocation.lat !== null && state.user.homeLocation.lng !== null
              ? `<div class="field-help">선택된 집 주소: ${escapeHtml(state.user.homeAddress)} · 좌표 ${escapeHtml(state.user.homeLocation.lat.toFixed(4))}, ${escapeHtml(state.user.homeLocation.lng.toFixed(4))}</div>`
              : `<div class="field-help">아직 집 좌표가 없습니다. 검색 결과를 하나 선택해 주세요.</div>`
          }
          ${
            state.ui.homeAddressSearchError
              ? `<div class="empty-copy">${escapeHtml(state.ui.homeAddressSearchError)}</div>`
              : !state.ui.homeAddressSearchResults.length && state.ui.homeAddressSearchStatus === "ready"
                ? `<div class="empty-copy">집 주소 검색 결과가 없습니다.</div>`
                : ""
          }
          ${
            state.ui.homeAddressSearchResults.length
              ? `
                <div class="holiday-list">
                  ${state.ui.homeAddressSearchResults
                    .map(
                      (item, index) => `
                        <article class="holiday-item">
                          <div>
                            <div class="holiday-date">${escapeHtml(item.label)}</div>
                            <div class="holiday-copy">${escapeHtml([item.placeName, item.jibunAddress].filter(Boolean).join(" · "))}</div>
                          </div>
                          <button class="mini-button" data-action="select-home-address" data-index="${index}">Use</button>
                        </article>
                      `,
                    )
                    .join("")}
                </div>
              `
              : ""
          }
          <label class="field-block compact">
            <span>Home address</span>
            <input class="text-field-input" type="text" value="${escapeHtml(state.user.homeAddress)}" data-field="user.homeAddress" />
          </label>
          <div class="holiday-form">
            <input class="text-field-input" type="text" placeholder="회사 주소나 건물명 검색" value="${escapeHtml(state.ui.workAddressKeyword)}" data-field="ui.workAddressKeyword" />
            <button class="mini-button add-button" data-action="search-work-address" ${state.ui.workAddressSearchStatus === "loading" ? "disabled" : ""}>
              ${state.ui.workAddressSearchStatus === "loading" ? "Searching..." : "Search"}
            </button>
          </div>
          ${
            state.user.workLocation.lat !== null && state.user.workLocation.lng !== null
              ? `<div class="field-help">선택된 회사 주소: ${escapeHtml(state.user.workAddress)} · 좌표 ${escapeHtml(state.user.workLocation.lat.toFixed(4))}, ${escapeHtml(state.user.workLocation.lng.toFixed(4))}</div>`
              : `<div class="field-help">아직 회사 좌표가 없습니다. 검색 결과를 하나 선택해 주세요.</div>`
          }
          ${
            state.ui.workAddressSearchError
              ? `<div class="empty-copy">${escapeHtml(state.ui.workAddressSearchError)}</div>`
              : !state.ui.workAddressSearchResults.length && state.ui.workAddressSearchStatus === "ready"
                ? `<div class="empty-copy">회사 주소 검색 결과가 없습니다.</div>`
                : ""
          }
          ${
            state.ui.workAddressSearchResults.length
              ? `
                <div class="holiday-list">
                  ${state.ui.workAddressSearchResults
                    .map(
                      (item, index) => `
                        <article class="holiday-item">
                          <div>
                            <div class="holiday-date">${escapeHtml(item.label)}</div>
                            <div class="holiday-copy">${escapeHtml([item.placeName, item.jibunAddress].filter(Boolean).join(" · "))}</div>
                          </div>
                          <button class="mini-button" data-action="select-work-address" data-index="${index}">Use</button>
                        </article>
                      `,
                    )
                    .join("")}
                </div>
              `
              : ""
          }
          <label class="field-block compact">
            <span>Work address</span>
            <input class="text-field-input" type="text" value="${escapeHtml(state.user.workAddress)}" data-field="user.workAddress" />
          </label>
          <label class="field-block compact">
            <span>Required arrival time</span>
            <input class="text-field-input time-field-input" type="time" value="${escapeHtml(state.user.requiredArrivalTime)}" data-field="user.requiredArrivalTime" />
          </label>
          <label class="field-block compact" ${isLiveConfigured(state) ? 'hidden' : ''}>
            <span>데모 전용: 하차 후 도보 시간 (분)</span>
            <input class="text-field-input" type="number" min="1" max="30" value="${escapeHtml(state.commute.alightToWorkWalkMin)}" data-field="commute.alightToWorkWalkMin" />
          </label>
        </div>
        <p class="field-help">집 주소는 선택 사항입니다. 지각 판단은 선택한 정류장·역에 오는 교통편의 도착시간을 기준으로 합니다.</p>
      </section>
      ${renderCommuteEstimatePanel(routeEstimate, stop, primaryLine)}
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">map</span>Commute Map</div>
        <div class="field-help">
          ${escapeHtml(
            placeApiConfig.maps?.kakao?.configured
              ? "Home, boarding stop, and work coordinates are shown on Kakao Maps."
              : placeApiConfig.maps?.kakao?.reason || "Kakao Maps is not configured yet.",
          )}
        </div>
        <div id="commute-map" class="commute-map" aria-label="Commute location map"></div>
      </section>
      <section class="panel">
        <div class="panel-title">Live data binding</div>
        <div class="field-stack">
          <label class="field-block compact">
            <span>Provider</span>
            <select class="text-field-input" data-field="live.provider">
              <option value="none" ${state.live.provider === "none" ? "selected" : ""}>Demo only</option>
              <option value="seoul" ${state.live.provider === "seoul" ? "selected" : ""}>Seoul Direct</option>
              <option value="gyeonggi" ${state.live.provider === "gyeonggi" ? "selected" : ""}>Gyeonggi Direct (Compare accuracy)</option>
              <option value="tago" ${state.live.provider === "tago" ? "selected" : ""}>TAGO (Recommended for Gyeonggi right now)</option>
            </select>
          </label>
          <div class="field-help">${escapeHtml(getLiveProviderPolicyCopy())}</div>
          ${
            state.live.provider === "seoul"
              ? `
                <div class="field-help">Search an official Seoul stop first, then choose a route to auto-fill routeId and station order.</div>
                <div class="holiday-form">
                  <input class="text-field-input" type="text" placeholder="Seoul stop name" value="${escapeHtml(state.ui.liveSearchKeyword)}" data-field="ui.liveSearchKeyword" />
                  <button class="mini-button add-button" data-action="search-live-stops" ${state.ui.liveSearchStatus === "loading" ? "disabled" : ""}>
                    ${state.ui.liveSearchStatus === "loading" ? "Searching..." : "Search"}
                  </button>
                </div>
                ${
                  state.live.stationName
                    ? `<div class="field-help">Selected official stop: ${escapeHtml(state.live.stationName)} (${escapeHtml(state.live.arsId || state.live.stationId)})</div>`
                    : ""
                }
                ${
                  state.ui.liveSearchError
                    ? `<div class="empty-copy">${escapeHtml(state.ui.liveSearchError)}</div>`
                    : !state.ui.liveSearchResults.length && state.ui.liveSearchStatus === "ready"
                      ? `<div class="empty-copy">No official Seoul stops matched this keyword.</div>`
                      : ""
                }
                ${
                  state.ui.liveSearchResults.length
                    ? `
                      <div class="holiday-list">
                        ${state.ui.liveSearchResults
                          .map(
                            (item) => `
                              <article class="holiday-item">
                                <div>
                                  <div class="holiday-date">${escapeHtml(item.stationName || item.stationId)}</div>
                                  <div class="holiday-copy">${escapeHtml([item.arsId, item.stationId].filter(Boolean).join(" · "))}</div>
                                </div>
                                <button class="mini-button" data-action="select-live-stop" data-station-id="${escapeHtml(item.stationId)}" data-station-name="${escapeHtml(item.stationName)}" data-ars-id="${escapeHtml(item.arsId)}">
                                  Use
                                </button>
                              </article>
                            `,
                          )
                          .join("")}
                      </div>
                    `
                    : ""
                }
                ${
                  state.ui.liveRouteSearchError
                    ? `<div class="empty-copy">${escapeHtml(state.ui.liveRouteSearchError)}</div>`
                    : !state.ui.liveRouteSearchResults.length &&
                        state.ui.liveRouteSearchStatus === "ready" &&
                        state.live.arsId
                      ? `<div class="empty-copy">No Seoul routes were returned for this stop.</div>`
                      : ""
                }
                ${
                  state.ui.liveRouteSearchResults.length
                    ? `
                      <div class="holiday-list">
                        ${state.ui.liveRouteSearchResults
                          .map(
                            (item) => `
                              <article class="holiday-item">
                                <div>
                                  <div class="holiday-date">${escapeHtml(item.routeNumber || item.routeId)}</div>
                                  <div class="holiday-copy">${escapeHtml(
                                    [item.direction, item.order ? `ord ${item.order}` : "", item.routeId].filter(Boolean).join(" · "),
                                  )}</div>
                                </div>
                                <button class="mini-button" data-action="select-live-route" data-route-id="${escapeHtml(item.routeId)}" data-route-number="${escapeHtml(item.routeNumber)}" data-order="${escapeHtml(item.order)}">
                                  Use
                                </button>
                              </article>
                            `,
                          )
                          .join("")}
                      </div>
                    `
                    : state.ui.liveRouteSearchStatus === "loading"
                      ? `<div class="empty-copy">Loading official Seoul routes for this stop...</div>`
                      : ""
                }
                <label class="field-block compact">
                  <span>Station ID (stId)</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.stationId)}" data-field="live.stationId" />
                </label>
                <label class="field-block compact">
                  <span>ARS ID</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.arsId)}" data-field="live.arsId" />
                </label>
                <label class="field-block compact">
                  <span>Route ID (busRouteId)</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.routeId)}" data-field="live.routeId" />
                </label>
                <label class="field-block compact">
                  <span>Route number</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.routeNumber)}" data-field="live.routeNumber" />
                </label>
                <label class="field-block compact">
                  <span>Station order (ord)</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.order)}" data-field="live.order" />
                </label>
              `
              : ""
          }
          ${
            state.live.provider === "gyeonggi"
              ? `
                <div class="field-help">Search an official Gyeonggi stop first, then compare this provider only when you need to measure it against the current recommendation for the same route.</div>
                ${getAccuracyRecommendationButtonMarkup()}
                <div class="holiday-form">
                  <input class="text-field-input" type="text" placeholder="Stop name or stop number" value="${escapeHtml(state.ui.liveSearchKeyword)}" data-field="ui.liveSearchKeyword" />
                  <button class="mini-button add-button" data-action="search-live-stops" ${state.ui.liveSearchStatus === "loading" ? "disabled" : ""}>
                    ${state.ui.liveSearchStatus === "loading" ? "Searching..." : "Search"}
                  </button>
                </div>
                ${
                  state.live.stationName
                    ? `<div class="field-help">Selected official stop: ${escapeHtml(state.live.stationName)} (${escapeHtml(state.live.stationId)})</div>`
                    : ""
                }
                ${
                  state.ui.liveSearchError
                    ? `<div class="empty-copy">${escapeHtml(state.ui.liveSearchError)}</div>`
                    : !state.ui.liveSearchResults.length && state.ui.liveSearchStatus === "ready"
                      ? `<div class="empty-copy">No official Gyeonggi stops matched this keyword.</div>`
                      : ""
                }
                ${
                  state.ui.liveSearchResults.length
                    ? `
                      <div class="holiday-list">
                        ${state.ui.liveSearchResults
                          .map(
                            (item) => `
                              <article class="holiday-item">
                                <div>
                                  <div class="holiday-date">${escapeHtml(item.stationName || item.stationId)}</div>
                                  <div class="holiday-copy">${escapeHtml(
                                    [item.stationNumber, item.regionName, item.stationId].filter(Boolean).join(" · "),
                                  )}</div>
                                </div>
                                <button class="mini-button" data-action="select-live-stop" data-station-id="${escapeHtml(item.stationId)}" data-station-name="${escapeHtml(item.stationName)}">
                                  Use
                                </button>
                              </article>
                            `,
                          )
                          .join("")}
                      </div>
                    `
                    : ""
                }
                ${
                  state.ui.liveRouteSearchError
                    ? `<div class="empty-copy">${escapeHtml(state.ui.liveRouteSearchError)}</div>`
                    : !state.ui.liveRouteSearchResults.length &&
                        state.ui.liveRouteSearchStatus === "ready" &&
                        state.live.stationId
                      ? `<div class="empty-copy">No official Gyeonggi routes were returned for this stop.</div>`
                      : ""
                }
                ${
                  state.ui.liveRouteSearchResults.length
                    ? `
                      <div class="holiday-list">
                        ${state.ui.liveRouteSearchResults
                          .map(
                            (item) => `
                              <article class="holiday-item">
                                <div>
                                  <div class="holiday-date">${escapeHtml(item.routeNumber || item.routeId)}</div>
                                  <div class="holiday-copy">${escapeHtml(
                                    [item.destinationName, item.order ? `seq ${item.order}` : "", item.routeId].filter(Boolean).join(" · "),
                                  )}</div>
                                </div>
                                <button class="mini-button" data-action="select-live-route" data-route-id="${escapeHtml(item.routeId)}" data-route-number="${escapeHtml(item.routeNumber)}" data-order="${escapeHtml(item.order)}">
                                  Use
                                </button>
                              </article>
                            `,
                          )
                          .join("")}
                      </div>
                    `
                    : state.ui.liveRouteSearchStatus === "loading"
                      ? `<div class="empty-copy">Loading official Gyeonggi routes for this stop...</div>`
                      : ""
                }
                <label class="field-block compact">
                  <span>Station ID (stationId)</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.stationId)}" data-field="live.stationId" />
                </label>
                <label class="field-block compact">
                  <span>Route ID (routeId)</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.routeId)}" data-field="live.routeId" />
                </label>
                <label class="field-block compact">
                  <span>Route number (routeName)</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.routeNumber)}" data-field="live.routeNumber" />
                </label>
                <label class="field-block compact">
                  <span>Stop order (staOrder)</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.order)}" data-field="live.order" />
                </label>
              `
              : ""
          }
          ${
            state.live.provider === "tago"
              ? `
                <div class="field-help">도시 → 정류장 → 이용할 버스 순서로 선택하세요. 집에서 정류장까지 걸리는 시간은 계산하지 않습니다.</div>
                <button class="mini-button" data-action="load-tago-cities" ${tagoCitiesMeta.status === "loading" ? "disabled" : ""}>${tagoCitiesMeta.status === "loading" ? "도시목록 조회 중…" : "TAGO 도시목록 불러오기"}</button>
                ${tagoCitiesMeta.error ? `<div class="empty-copy">${escapeHtml(tagoCitiesMeta.error)}</div>` : ""}
                ${tagoCitiesMeta.cities.length ? `<label class="field-block compact"><span>도시 선택</span><select class="text-field-input" data-field="live.cityCode"><option value="">도시를 선택하세요</option>${tagoCitiesMeta.cities.map((city) => `<option value="${escapeHtml(city.cityCode)}" ${String(state.live.cityCode) === String(city.cityCode) ? "selected" : ""}>${escapeHtml(city.cityName)} (${escapeHtml(city.cityCode)})</option>`).join("")}</select></label>` : ""}
                <label class="field-block compact">
                  <span>도시코드 (직접 입력 가능)</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.cityCode)}" data-field="live.cityCode" />
                </label>
                <label class="field-block compact"><span>정류장 이름 또는 안내판 번호</span><input class="text-field-input" type="text" placeholder="예: 더샵광교레이크시티" value="${escapeHtml(state.ui.liveSearchKeyword)}" data-field="ui.liveSearchKeyword" /></label>
                <button class="mini-button" data-action="search-live-stops" ${!state.live.cityCode || state.ui.liveSearchStatus === "loading" ? "disabled" : ""}>${state.ui.liveSearchStatus === "loading" ? "정류장 검색 중…" : "정류장 검색"}</button>
                ${state.ui.liveSearchError ? `<div class="empty-copy">${escapeHtml(state.ui.liveSearchError)}</div>` : ""}
                ${state.ui.liveSearchStatus === "ready" && !state.ui.liveSearchResults.length ? `<div class="empty-copy">검색 결과가 없습니다. 도시를 확인하거나 정류장 이름 일부로 검색해 주세요.</div>` : ""}
                <div class="holiday-list">${state.ui.liveSearchResults.map((item) => `<article class="holiday-item"><div><div class="holiday-date">${escapeHtml(item.stationName)}</div><div class="holiday-copy">${escapeHtml([item.stationNumber, item.stationId].filter(Boolean).join(" · "))}</div></div><button class="mini-button" data-action="select-live-stop" data-station-id="${escapeHtml(item.stationId)}" data-station-name="${escapeHtml(item.stationName)}">이 정류장 선택</button></article>`).join("")}</div>
                <div class="field-help">같은 이름의 반대편 정류장이 있을 수 있습니다. 정류장 번호와 위치를 확인한 뒤 선택하세요.</div>
                <button class="mini-button" data-action="load-live-routes" ${!state.live.nodeId || state.ui.liveRouteSearchStatus === "loading" ? "disabled" : ""}>경유노선 다시 조회</button>
                ${state.ui.liveRouteSearchStatus === "loading" ? `<div class="empty-copy">경유노선 조회 중…</div>` : ""}
                ${state.ui.liveRouteSearchError ? `<div class="empty-copy">${escapeHtml(state.ui.liveRouteSearchError)}</div>` : ""}
                ${state.ui.liveRouteSearchStatus === "ready" && !state.ui.liveRouteSearchResults.length ? `<div class="empty-copy">조회된 경유노선이 없습니다.</div>` : ""}
                <div class="holiday-list">${state.ui.liveRouteSearchResults.map((item) => `<article class="holiday-item"><div><div class="holiday-date">${escapeHtml(item.routeNumber)}</div><div class="holiday-copy">${escapeHtml([item.startStationName, item.destinationName, item.routeId].filter(Boolean).join(" · "))}</div></div><button class="mini-button" data-action="select-live-route" data-route-id="${escapeHtml(item.routeId)}" data-route-number="${escapeHtml(item.routeNumber)}">이 버스 선택</button></article>`).join("")}</div>
                <div class="field-help">기점·종점은 노선 정보이며 현재 운행 방향을 확정하는 정보는 아닙니다.</div>
                <label class="field-block compact">
                  <span>Node ID</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.nodeId)}" data-field="live.nodeId" />
                </label>
                <label class="field-block compact">
                  <span>노선 고유번호 (routeId, 권장)</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.routeId)}" data-field="live.routeId" />
                </label>
                <label class="field-block compact">
                  <span>Route number</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.routeNumber)}" data-field="live.routeNumber" />
                </label>
              `
              : ""
          }
        </div>
      </section>
      ${!isLiveConfigured(state) ? `
      <section class="panel">
        <div class="panel-title">Where do you board? (Demo)</div>
        ${
          recommendedStops.length
            ? `
              <div class="field-help">집 좌표 기준으로 가까운 정류장을 먼저 추천합니다.</div>
              <div class="holiday-list">
                ${recommendedStops
                  .map(
                    (item) => `
                      <article class="holiday-item">
                        <div>
                          <div class="holiday-date">${escapeHtml(item.name)}</div>
                          <div class="holiday-copy">${escapeHtml(`${item.distanceM}m · ${item.stopCode} · ${item.subtitle}`)}</div>
                        </div>
                        <button class="mini-button" data-action="pick-stop" data-stop-id="${item.id}">
                          ${item.id === stop.id ? "Selected" : "Use"}
                        </button>
                      </article>
                    `,
                  )
                  .join("")}
              </div>
            `
            : `<div class="field-help">집 주소를 먼저 고르면 가까운 정류장 추천이 여기에 나타납니다.</div>`
        }
        <div class="search-box">
          <span class="material-symbols-outlined">search</span>
          <input type="text" placeholder="Search stop name or stop ID" value="${escapeHtml(state.ui.routeSearch)}" data-field="ui.routeSearch" />
          <button class="pill-button" type="button" data-action="pick-stop" data-stop-id="${nearestStop ? nearestStop.id : "GWANGHWAMUN"}">${nearestStop ? "Use nearest" : "Near me"}</button>
        </div>
        <div class="stop-list">
          ${filteredStops
            .map(
              (item) => `
                <button class="stop-item ${item.id === stop.id ? "selected" : ""}" data-action="pick-stop" data-stop-id="${item.id}">
                  <div>
                    <div class="stop-name">${escapeHtml(item.name)}</div>
                    <div class="stop-subtitle">${escapeHtml(item.subtitle)} · ${escapeHtml(item.stopCode)}</div>
                  </div>
                  <span class="material-symbols-outlined">${item.id === stop.id ? "check_circle" : "location_on"}</span>
                </button>
              `,
            )
            .join("")}
        </div>
      </section>
      <section class="map-card">
        <div class="map-label">${escapeHtml(stop.name)}</div>
        <div class="map-canvas"><div class="map-pin"></div></div>
        <div class="map-footnote">The interactive Kakao map above shows the saved home, stop, and work markers when its JavaScript key is configured.</div>
      </section>
      <section class="panel">
        <div class="panel-title">Select routes passing here</div>
        <div class="route-list">
          ${stop.lines
            .map((line) => {
              const checked = state.commute.selectedLineIds.includes(line.id);
              const primary = state.commute.primaryLineId === line.id;
              return `
                <label class="route-row ${checked ? "checked" : ""}">
                  <div class="route-row-main">
                    <div class="route-badge">${escapeHtml(line.number)}</div>
                    <div>
                      <div class="route-title">${escapeHtml(line.label)}</div>
                      <div class="route-subtitle">To: ${escapeHtml(line.destination)}</div>
                    </div>
                  </div>
                  <div class="route-actions">
                    ${
                      checked
                        ? `<button type="button" class="mini-button ${primary ? "selected" : ""}" data-action="set-primary-line" data-line-id="${line.id}">
                             ${primary ? "Primary line" : "Set primary"}
                           </button>`
                        : ""
                    }
                    <input type="checkbox" ${checked ? "checked" : ""} data-action="toggle-line" data-line-id="${line.id}" />
                  </div>
                </label>
              `;
            })
            .join("")}
        </div>
      </section>
      ` : `<section class="panel"><div class="panel-title">선택한 실시간 교통편</div><p>${escapeHtml(state.live.stationName || "정류장 선택 필요")}</p><p>${escapeHtml(state.live.routeNumber ? `${state.live.routeNumber}번 · ${state.live.routeId || "노선 고유번호 미입력"}` : "이용할 버스 선택 필요")}</p></section>`}
      <footer class="action-bar action-bar-static">
        <button class="secondary-button" data-action="goto" data-screen="home">Back</button>
        <button class="primary-button" data-action="goto" data-screen="schedule">
          Continue
          <span class="material-symbols-outlined">arrow_forward</span>
        </button>
      </footer>
    </main>
  `;
}

function renderSchedule(screen, model) {
  return `
    <main class="screen screen-form with-bottom-nav">
      <section class="headline-block">
        <h1>Schedule Settings</h1>
        <p>Adjust the start time, repeat interval, weekday rules, and holiday skips here.</p>
      </section>
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">schedule</span>Time Window</div>
        <div class="field-grid">
          <label class="field-block"><span>Start Alarm</span><input type="time" value="${state.schedule.startTime}" data-field="schedule.startTime" /></label>
          <label class="field-block"><span>End Alarm</span><input type="time" value="${state.schedule.endTime}" data-field="schedule.endTime" /></label>
        </div>
      </section>
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">update</span>Alert Frequency</div>
        <div class="choice-grid">
          ${[1, 2, 3, 5, 10]
            .map(
              (minute) => `
                <button class="choice-chip ${state.schedule.repeatIntervalMin === minute ? "selected" : ""}" data-action="set-interval" data-value="${minute}">
                  ${minute}m
                </button>
              `,
            )
            .join("")}
        </div>
      </section>
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">calendar_month</span>Repeat</div>
        <div class="option-list">
          ${REPEAT_PRESETS.map(
            (preset) => `
              <button class="preset-row ${state.schedule.repeatPreset === preset.id ? "selected" : ""}" data-action="set-repeat-preset" data-value="${preset.id}">
                <div>
                  <div class="preset-title">${escapeHtml(preset.label)}</div>
                  <div class="preset-detail">${escapeHtml(preset.description)}</div>
                </div>
                <span class="material-symbols-outlined">${state.schedule.repeatPreset === preset.id ? "check_circle" : "radio_button_unchecked"}</span>
              </button>
            `,
          ).join("")}
        </div>
        ${
          state.schedule.repeatPreset === "CUSTOM"
            ? `<div class="weekday-grid">
                ${DAY_OPTIONS.map(
                  (day) => `
                    <button class="weekday-chip ${state.schedule.daysOfWeek.includes(day.value) ? "selected" : ""}" data-action="toggle-day" data-value="${day.value}">
                      ${day.label}
                    </button>
                  `,
                ).join("")}
              </div>`
            : ""
        }
      </section>
      <section class="stack-panel">
        <div class="toggle-row">
          <div>
            <div class="stack-title no-margin"><span class="material-symbols-outlined">beach_access</span>Holiday Skip</div>
          </div>
          <button class="toggle ${state.schedule.skipHolidays ? "on" : ""}" data-action="toggle-field" data-field="schedule.skipHolidays"><span></span></button>
        </div>
        <p class="field-help">When this stays on, the scheduler skips both official Korean public holidays and any extra manual skip dates you add below.</p>
        <div class="live-sync-grid">
          <article class="live-sync-card">
            <div class="live-sync-label">Official API</div>
            <div class="live-sync-value">${model.holidayApiConfigured ? "READY" : "KEY MISSING"}</div>
            <div class="live-sync-copy">
              ${
                state.holidaySync.status === "loading"
                  ? "Loading the official holiday calendar now."
                  : state.holidaySync.lastError
                    ? escapeHtml(state.holidaySync.lastError)
                    : model.holidayApiConfigured
                      ? "The Korea Astronomy and Space Science Institute holiday feed can be synced on demand."
                      : "Add HOLIDAY_API_SERVICE_KEY to enable official holiday sync."
              }
            </div>
          </article>
          <article class="live-sync-card">
            <div class="live-sync-label">Loaded</div>
            <div class="live-sync-value">${state.officialHolidays.length} dates</div>
            <div class="live-sync-copy">
              Years: ${escapeHtml(state.holidaySync.loadedYears.length ? state.holidaySync.loadedYears.join(", ") : "none")}
              <br />
              Last sync: ${escapeHtml(formatSyncStamp(state.holidaySync.lastSyncedAt))}
            </div>
          </article>
        </div>
        <div class="holiday-form">
          <input
            class="text-field-input"
            type="number"
            min="2024"
            max="2100"
            step="1"
            value="${escapeHtml(state.ui.holidaySyncYear)}"
            data-field="ui.holidaySyncYear"
            placeholder="2026"
          />
          <button class="mini-button add-button" data-action="sync-official-holidays">${state.holidaySync.status === "loading" ? "Syncing..." : "Sync"}</button>
        </div>
        <div class="holiday-list">
          ${
            model.upcomingOfficialHolidays.length
              ? model.upcomingOfficialHolidays
                  .map(
                    (holiday) => `
                      <article class="holiday-item">
                        <div>
                          <div class="holiday-date">${escapeHtml(holiday.date)}</div>
                          <div class="holiday-copy">${escapeHtml(holiday.name || "Official public holiday")}</div>
                        </div>
                        <div class="holiday-copy">Official</div>
                      </article>
                    `,
                  )
                  .join("")
              : `<div class="empty-copy">No official holidays have been loaded for the upcoming schedule yet.</div>`
          }
        </div>
      </section>
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">event</span>Manual extra skip dates</div>
        <div class="holiday-form">
          <input class="text-field-input" type="date" value="${escapeHtml(state.ui.holidayDraft)}" data-field="ui.holidayDraft" />
          <button class="mini-button add-button" data-action="add-holiday">Add</button>
        </div>
        <div class="holiday-list">
          ${
            state.holidayDates.length
              ? state.holidayDates
                  .map(
                    (holiday) => `
                      <article class="holiday-item">
                        <div>
                          <div class="holiday-date">${escapeHtml(holiday)}</div>
                          <div class="holiday-copy">This extra date will be skipped together with the official holiday feed.</div>
                        </div>
                        <button class="icon-button soft" data-action="remove-holiday" data-value="${holiday}" aria-label="Remove holiday ${escapeHtml(holiday)}">
                          <span class="material-symbols-outlined">close</span>
                        </button>
                      </article>
                    `,
                  )
                  .join("")
              : `<div class="empty-copy">No extra manual skip dates added yet.</div>`
          }
        </div>
      </section>
      <section class="preview-card">
        <div class="preview-label">${escapeHtml(model.scheduleState.badge)}</div>
        <div class="preview-title">${escapeHtml(model.scheduleState.detail)}</div>
        <div class="preview-meta">Local device time: ${escapeHtml(formatLongDate(model.now))}</div>
      </section>
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">view_week</span>Next 7 days preview</div>
        <div class="forecast-grid">
          ${model.forecast
            .map(
              (item) => `
                <article class="forecast-item ${item.firing ? "on" : "off"}">
                  <div class="forecast-date">${escapeHtml(formatShortDate(item.date))}</div>
                  <div class="forecast-badge">${escapeHtml(item.badge)}</div>
                  <div class="forecast-copy">${escapeHtml(item.detail)}</div>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>
      <button class="footer-cta" data-action="save-schedule">Save Settings</button>
    </main>
    ${renderBottomNav(screen)}
  `;
}

function renderSettings(screen, model) {
  const currentSound = SOUND_PRESETS.find((preset) => preset.id === state.notification.soundPresetId) || SOUND_PRESETS[0];
  return `
    <main class="screen screen-form with-bottom-nav">
      ${renderAccountPanel()}
      ${renderDeviceDeliveryPanel()}
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">volume_up</span>Sound Alert</div>
        <div class="option-list">
          ${SOUND_PRESETS.map(
            (preset) => `
              <div class="sound-row ${currentSound.id === preset.id ? "selected" : ""}">
                <button class="sound-main" data-action="set-sound" data-value="${preset.id}">
                  <span class="sound-radio">${currentSound.id === preset.id ? "[x]" : "[ ]"}</span>
                  <span>
                    <strong>${escapeHtml(preset.name)}</strong>
                    <small>${escapeHtml(preset.detail)}</small>
                  </span>
                </button>
                <button class="icon-button soft" data-action="preview-sound" data-value="${preset.id}" aria-label="${escapeHtml(preset.name)} 誘몃━?ｊ린">
                  <span class="material-symbols-outlined">play_arrow</span>
                </button>
              </div>
            `,
          ).join("")}
        </div>
      </section>
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">vibration</span>Vibration</div>
        <div class="slider-row">
          <div class="slider-header">
            <span>Vibration Strength</span>
            <strong>${state.notification.vibrationStrength >= 70 ? "Heavy" : state.notification.vibrationStrength >= 40 ? "Medium" : "Light"}</strong>
          </div>
          <input class="range-input" type="range" min="0" max="100" value="${state.notification.vibrationStrength}" data-field="notification.vibrationStrength" />
          <div class="slider-scale"><span>Light</span><span>Medium</span><span>Heavy</span></div>
        </div>
        <div class="toggle-row inset">
          <div>
            <div class="toggle-title">Escalation Mode</div>
            <p class="field-help">15초, 30초 무응답 시 단계적으로 진동과 소리를 더 강하게 올립니다.</p>
          </div>
          <button class="toggle ${state.notification.escalationEnabled ? "on" : ""}" data-action="toggle-field" data-field="notification.escalationEnabled"><span></span></button>
        </div>
      </section>
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">record_voice_over</span>Voice Guidance (TTS)</div>
        <div class="choice-grid two-cols">
          ${TTS_VOICES.map(
            (voice) => `
              <button class="choice-chip ${state.notification.ttsVoiceId === voice.id ? "selected" : ""}" data-action="set-tts-voice" data-value="${voice.id}">
                ${escapeHtml(voice.label)}
              </button>
            `,
          ).join("")}
        </div>
        <div class="slider-row">
          <div class="slider-header"><span>Speaking Speed</span><strong>${state.notification.ttsSpeed.toFixed(1)}x</strong></div>
          <input class="range-input" type="range" min="0.8" max="1.3" step="0.1" value="${state.notification.ttsSpeed}" data-field="notification.ttsSpeed" />
          <div class="slider-scale"><span>0.8x</span><span>Normal</span><span>1.3x</span></div>
        </div>
        <button class="soft-button wide" data-action="preview-tts">Listen to Sample</button>
        <div class="sample-copy">${escapeHtml(model.notificationSpec.spokenText)}</div>
      </section>
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">crisis_alert</span>Escalation Preview</div>
        <div class="forecast-grid">
          ${model.notificationTimeline
            .map(
              (item) => `
                <article class="forecast-item ${item.stage === 2 ? "off" : "on"}">
                  <div class="forecast-date">${escapeHtml(item.escalationLabel)} · +${item.secondsSinceTrigger}s</div>
                  <div class="forecast-badge">${escapeHtml(item.riskLevel)} · ${escapeHtml(item.volumePercent.toString())}% volume</div>
                  <div class="forecast-copy">
                    Vibrate ${escapeHtml(item.vibrationPattern.join("-"))} x ${escapeHtml(String(item.vibrationRepeats))}
                    <br />
                    ${escapeHtml(item.fullScreen ? "Full-screen alert enabled." : "Standard heads-up alert.")}
                    <br />
                    ${escapeHtml(item.criticalBypass ? "DND bypass requested." : "No DND bypass requested.")}
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
        <div class="sample-copy">${escapeHtml(model.notificationSpec.title)} · ${escapeHtml(model.notificationSpec.body)}</div>
      </section>
      <section class="warning-panel">
        <div class="warning-head"><span class="material-symbols-outlined">warning</span>Critical Alert Bypass</div>
        <p>These web controls save your alert preference. The Android app requests exact-alarm, full-screen, and DND permissions; iPhone support remains subject to Apple notification policy.</p>
        <button class="toggle ${state.notification.dndBypass ? "on" : ""}" data-action="toggle-field" data-field="notification.dndBypass"><span></span></button>
      </section>
    </main>
    ${renderBottomNav(screen)}
  `;
}

function render() {
  if (!isAuthenticated()) {
    app.innerHTML = renderAuthScreen();
    return;
  }

  const screen = routeToScreen(window.location.hash);
  const model = getDashboardModel();
  const content =
    screen === "home"
      ? renderHome(screen, model)
      : screen === "schedule"
        ? renderSchedule(screen, model)
        : screen === "settings"
          ? renderSettings(screen, model)
          : renderOnboarding();

  app.innerHTML = `<div class="app-shell">${renderTopBar(screen, model)}${content}</div>`;
  flushPendingPanelFocus();
  if (screen === "onboarding") {
    const stop = getSelectedStop();
    const stopLocation = getSelectedStopLocation(stop);
    window.requestAnimationFrame(() => {
      void mountKakaoCommuteMap(document.querySelector("#commute-map"), {
        appKey: placeApiConfig.maps?.kakao?.javascriptKey || "",
        home: state.user.homeLocation,
        stop: stopLocation,
        work: state.user.workLocation,
      });
    });
  }
}

function setNestedValue(target, path, value) {
  const segments = path.split(".");
  let cursor = target;
  for (let index = 0; index < segments.length - 1; index += 1) cursor = cursor[segments[index]];
  cursor[segments[segments.length - 1]] = value;
}

function toggleLine(lineId) {
  const stop = getSelectedStop();
  const validLineIds = stop.lines.map((line) => line.id);
  if (!validLineIds.includes(lineId)) return;

  const hasLine = state.commute.selectedLineIds.includes(lineId);
  if (hasLine && state.commute.selectedLineIds.length === 1) return;

  state.commute.selectedLineIds = hasLine
    ? state.commute.selectedLineIds.filter((id) => id !== lineId)
    : [...state.commute.selectedLineIds, lineId];

  if (!state.commute.selectedLineIds.includes(state.commute.primaryLineId)) {
    state.commute.primaryLineId = state.commute.selectedLineIds[0];
  }

  persist();
  render();
}

function toggleDay(dayValue) {
  const day = Number(dayValue);
  const exists = state.schedule.daysOfWeek.includes(day);
  state.schedule.daysOfWeek = exists
    ? state.schedule.daysOfWeek.filter((value) => value !== day)
    : [...state.schedule.daysOfWeek, day].sort((a, b) => a - b);
  persist();
  render();
}

function playSoundPreset(presetId, options = {}) {
  const preset = SOUND_PRESETS.find((item) => item.id === presetId);
  if (!preset || !window.AudioContext) return;
  if (!audioContext) audioContext = new window.AudioContext();

  const now = audioContext.currentTime;
  const loopCount = Math.max((Number(preset.loopCount) || 1) + Math.max(Number(options.extraLoops) || 0, 0), 1);
  const loopGap = Math.max(Number(preset.loopGap) || 0, 0);
  const cycleDuration = preset.pattern.reduce(
    (maxDuration, tone) => Math.max(maxDuration, Number(tone.offset || 0) + Number(tone.duration || 0)),
    0,
  );

  for (let loopIndex = 0; loopIndex < loopCount; loopIndex += 1) {
    const loopBase = now + loopIndex * (cycleDuration + loopGap);
    preset.pattern.forEach((tone) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.type = tone.type || "sine";
      oscillator.frequency.value = tone.frequency;
      gainNode.gain.setValueAtTime(0.0001, loopBase + tone.offset);
      gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, tone.gain * Math.min(100, Math.max(0, Number(options.volumePercent ?? 100))) / 100), loopBase + tone.offset + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, loopBase + tone.offset + tone.duration);
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start(loopBase + tone.offset);
      oscillator.stop(loopBase + tone.offset + tone.duration + 0.03);
    });
  }
}

function previewTts() {
  if (!("speechSynthesis" in window)) {
    window.alert("This browser does not support SpeechSynthesis.");
    return;
  }

  const model = getDashboardModel();
  const utterance = new SpeechSynthesisUtterance(model.notificationSpec.spokenText);
  utterance.lang = "ko-KR";
  utterance.rate = Number(model.notificationSpec.speechRate || state.notification.ttsSpeed);
  utterance.volume = Number(model.notificationSpec.speechVolume || 1);
  const voices = window.speechSynthesis.getVoices();
  const koreanVoice = resolvePreferredKoreanVoice(voices);
  if (koreanVoice) utterance.voice = koreanVoice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

app.addEventListener("click", (event) => {
  void primeAlarmPlayback();
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;

  if (action === "logout") {
    void signOutWorkspace();
    return;
  }
  if (action === "start-social-auth") {
    void beginSocialAuth(target.dataset.provider || "");
    return;
  }
  if (action === "save-account-profile") {
    void submitAccountProfileUpdate();
    return;
  }

  if (!isAuthenticated()) return;

  if (action === "goto") return goTo(target.dataset.screen);
  if (action === "focus-panel") {
    focusPanel(
      target.dataset.screen || "home",
      target.dataset.panel || "",
      target.dataset.panelItemId || "",
      target.dataset.panelKind || "",
      target.dataset.panelKey || "",
    );
    return;
  }
  if (action === "toggle-today-snooze") {
    const today = dateOnlyKey(new Date());
    const turningOff = state.schedule.snoozeDate !== today;
    state.schedule.snoozeDate = turningOff ? today : null;
    pushHistory(turningOff ? "Today alarms off" : "Today alarms restored", "Home dashboard quick action toggled.");
    return render();
  }
  if (action === "ack-active-alarm") {
    runAlarmDeliveryAction(
      "ACK_DEPARTED",
      "Departed",
      "The active server alarm was acknowledged and the rest of today's alerts were stopped.",
    );
    return;
  }
  if (action === "snooze-active-alarm") {
    runAlarmDeliveryAction(
      "SNOOZE_1M",
      "Alarm snoozed",
      "The active server alarm was snoozed for one minute.",
    );
    return;
  }
  if (action === "departed") {
    if (alarmRuntimeMeta.delivery?.currentAlert) {
      runAlarmDeliveryAction(
        "ACK_DEPARTED",
        "Departed",
        "The active server alarm was acknowledged and the rest of today's alerts were stopped.",
      );
      return;
    }

    state.schedule.snoozeDate = dateOnlyKey(new Date());
    pushHistory("Departed", "The user marked the morning route as completed.", "INFO", "APP_ACTION", {
      includeLiveEtaContext: true,
    });
    return render();
  }
  if (action === "set-interval") {
    state.schedule.repeatIntervalMin = Number(target.dataset.value);
    persist();
    return render();
  }
  if (action === "set-repeat-preset") {
    state.schedule.repeatPreset = target.dataset.value;
    if (state.schedule.repeatPreset === "WEEKDAYS") state.schedule.daysOfWeek = [1, 2, 3, 4, 5];
    persist();
    return render();
  }
  if (action === "toggle-day") return toggleDay(target.dataset.value);
  if (action === "toggle-field") {
    const path = target.dataset.field;
    const current = path.split(".").reduce((memo, key) => memo[key], state);
    setNestedValue(state, path, !current);
    persist();
    return render();
  }
  if (action === "set-sound") {
    state.notification.soundPresetId = target.dataset.value;
    persist();
    return render();
  }
  if (action === "preview-sound") {
    pushHistory("Sound preview", `${target.dataset.value} preset preview played.`);
    playSoundPreset(target.dataset.value);
    return render();
  }
  if (action === "set-tts-voice") {
    state.notification.ttsVoiceId = target.dataset.value;
    persist();
    return render();
  }
  if (action === "preview-tts") {
    pushHistory("TTS preview", "Voice guidance sample played.");
    previewTts();
    return render();
  }
  if (action === "run-push-gateway") {
    if (!deviceMeta.dispatchBundles.length) {
      deviceMeta.pushGatewayDispatchStatus = "error";
      deviceMeta.pushGatewayDispatchError = "There is no active dispatch bundle to hand off yet.";
      return render();
    }
    if (
      deviceMeta.pushGatewayConfig?.mode === "execute" &&
      !window.confirm("The push gateway is in execute mode and may send a real notification. Continue?")
    ) {
      return;
    }
    runPushGatewayCurrentBundle();
    return;
  }
  if (action === "run-test-push-gateway") {
    runPushGatewayTestBundle();
    return;
  }
  if (action === "seed-push-retry-simulation") {
    runPushGatewayRetrySimulationAction("seed-retryable-failure");
    return;
  }
  if (action === "run-push-retry-simulation") {
    runPushGatewayRetrySimulationAction("run-due-retry", "success");
    return;
  }
  if (action === "run-push-retry-hard-failure") {
    runPushGatewayRetrySimulationAction("run-due-retry", "hard-failure");
    return;
  }
  if (action === "run-push-retry-retryable-failure") {
    runPushGatewayRetrySimulationAction("run-due-retry", "retryable-failure");
    return;
  }
  if (action === "clear-push-retry-simulation") {
    runPushGatewayRetrySimulationAction("clear-simulation", "cleared");
    return;
  }
  if (action === "register-device-token") {
    deviceMeta.tokenRegisterStatus = "sending";
    deviceMeta.tokenRegisterError = "";
    render();
    registerDevicePushToken(state.device)
      .then((payload) => {
        state.device = payload.profile || state.device;
        saveState(state);
        deviceMeta.source = "server";
        deviceMeta.syncStatus = "synced";
        deviceMeta.lastSyncedAt = payload.savedAt || new Date().toISOString();
        deviceMeta.lastError = "";
        deviceMeta.tokenHealth = payload.tokenHealth || null;
        deviceMeta.tokenHealthLoadedAt = payload.savedAt || new Date().toISOString();
        deviceMeta.tokenHealthError = "";
        deviceMeta.tokenRegisterStatus = "sent";
        deviceMeta.tokenRegisterError = "";
        pushHistory(
          "Device token registered",
          payload.tokenHealth?.reason || "The device push token was normalized and saved on the server.",
        );
        queueAlarmRuntimeRefresh(0);
        render();
      })
      .catch((error) => {
        deviceMeta.tokenRegisterStatus = "error";
        deviceMeta.tokenRegisterError = error instanceof Error ? error.message : "Unknown device token registration error.";
        render();
      });
    return;
  }
  if (action === "subscribe-web-push") {
    deviceMeta.tokenRegisterStatus = "sending";
    deviceMeta.tokenRegisterError = "";
    render();
    subscribeCurrentBrowserToPush()
      .then((subscriptionPatch) => registerDevicePushToken({ ...state.device, ...subscriptionPatch }))
      .then((payload) => {
        state.device = payload.profile || state.device;
        saveState(state);
        deviceMeta.source = "server";
        deviceMeta.syncStatus = "synced";
        deviceMeta.lastSyncedAt = payload.savedAt || new Date().toISOString();
        deviceMeta.tokenHealth = payload.tokenHealth || null;
        deviceMeta.tokenHealthLoadedAt = payload.savedAt || new Date().toISOString();
        deviceMeta.tokenHealthError = "";
        deviceMeta.tokenRegisterStatus = "sent";
        deviceMeta.tokenRegisterError = "";
        pushHistory("Browser push subscribed", payload.tokenHealth?.reason || "A complete Web Push subscription was saved on the server.");
        queueAlarmRuntimeRefresh(0);
        render();
      })
      .catch((error) => {
        deviceMeta.tokenRegisterStatus = "error";
        deviceMeta.tokenRegisterError = error instanceof Error ? error.message : "Could not subscribe this browser to Web Push.";
        render();
      });
    return;
  }
  if (action === "search-home-address") {
    runAddressSearch("home");
    return;
  }
  if (action === "search-work-address") {
    runAddressSearch("work");
    return;
  }
  if (action === "select-home-address") {
    const item = state.ui.homeAddressSearchResults[Number(target.dataset.index)];
    if (!item) {
      return;
    }
    applyAddressResult("home", item);
    persist();
    render();
    refreshCommuteEstimate({ announce: true });
    return;
  }
  if (action === "select-work-address") {
    const item = state.ui.workAddressSearchResults[Number(target.dataset.index)];
    if (!item) {
      return;
    }
    applyAddressResult("work", item);
    persist();
    render();
    refreshCommuteEstimate({ announce: true });
    return;
  }
  if (action === "select-transit-route") {
    const route = commuteEstimateMeta.snapshot?.routes?.find((item) => item.id === target.dataset.routeId);
    if (!route?.compatible || route.queryKey !== transitQueryKey(transitQueryForState(state))) return;
    state.commute.transitJourney = { ...route, boardingConfirmed: true };
    persist();
    return render();
  }
  if (action === "refresh-commute-estimate") {
    refreshCommuteEstimate({ announce: true });
    return;
  }
  if (action === "probe-bus-accuracy") {
    void probeBusAccuracyProviders();
    return;
  }
  if (action === "record-actual-arrival") {
    void recordCurrentBusArrival();
    return;
  }
  if (action === "search-live-stops") {
    if (!state.ui.liveSearchKeyword.trim()) {
      state.ui.liveSearchStatus = "error";
      state.ui.liveSearchError = "Enter a stop name or stop number first.";
      persist();
      return render();
    }

    state.ui.liveSearchStatus = "loading";
    state.ui.liveSearchError = "";
    state.ui.liveSearchResults = [];
    resetLiveRouteSearchState();
    persist();
    render();
    const requestId = ++liveStationRequest;
    const binding = getLiveSearchBinding();
    const isCurrent = () => requestId === liveStationRequest && JSON.stringify(binding) === JSON.stringify(getLiveSearchBinding());
    searchLiveStations(binding)
      .then((payload) => {
        if (!isCurrent()) return;
        state.ui.liveSearchStatus = "ready";
        state.ui.liveSearchError = "";
        state.ui.liveSearchResults = Array.isArray(payload.stations) ? payload.stations : [];
        pushHistory("Official stops loaded", `${state.ui.liveSearchResults.length} ${payload.provider} stop candidates were returned.`);
        render();
      })
      .catch((error) => {
        if (!isCurrent()) return;
        state.ui.liveSearchStatus = "error";
        state.ui.liveSearchResults = [];
        state.ui.liveSearchError = error instanceof Error ? error.message : "Unknown stop search error.";
        pushHistory("Official stop search failed", state.ui.liveSearchError, "ERROR");
        render();
      });
    return;
  }
  if (action === "load-tago-cities") {
    tagoCitiesMeta.status = "loading";
    tagoCitiesMeta.error = "";
    render();
    fetchTagoCityList().then((payload) => {
      tagoCitiesMeta.cities = Array.isArray(payload.cities) ? payload.cities : [];
      tagoCitiesMeta.status = "ready";
      if (!tagoCitiesMeta.cities.length) tagoCitiesMeta.error = "조회된 도시가 없습니다.";
      render();
    }).catch((error) => {
      tagoCitiesMeta.status = "error";
      tagoCitiesMeta.error = error instanceof Error ? error.message : "도시목록 조회 실패";
      render();
    });
    return;
  }
  if (action === "load-live-routes") {
    loadLiveRoutesForSelectedStop();
    return;
  }
  if (action === "apply-bus-accuracy-recommendation") {
    const recommendedProvider = getAccuracyRecommendedProvider();
    if (!recommendedProvider || recommendedProvider === state.live.provider) {
      return;
    }

    switchLiveProvider(state.live, recommendedProvider);
    state.live.snapshot = null;
    state.live.lastError = "";
    resetLiveSearchState();
    resetLiveRouteSearchState();
    syncLiveBindingState();
    pushHistory(
      "Provider switched",
      `The live binding was moved to ${getLiveProviderLabel(recommendedProvider)} because it is the current ETA recommendation for this route.`,
    );
    persist();
    return render();
  }
  if (action === "select-live-stop") {
    const candidate = state.ui.liveSearchResults.find((item) => String(item.stationId) === target.dataset.stationId);
    if (!candidate) return;
    const location = { lat: candidate?.posY ?? candidate?.lat, lng: candidate?.posX ?? candidate?.lng };
    state.commute.stopLocation = isValidLocation(location)
      ? { lat: Number(location.lat), lng: Number(location.lng) } : null;
    state.commute.selectedStopId = target.dataset.stationId || "";
    commuteEstimateMeta.snapshot = null;
    state.commute.transitJourney = null;
    state.live.stationId = target.dataset.stationId || "";
    state.live.stationName = target.dataset.stationName || "";
    if (state.live.provider === "tago") {
      state.live.nodeId = candidate.nodeId || candidate.stationId;
      state.live.cityCode = candidate.cityCode || state.live.cityCode;
    }
    state.live.arsId = target.dataset.arsId || "";
    state.live.routeId = "";
    if (state.live.provider !== "gyeonggi") {
      state.live.routeNumber = "";
    }
    state.live.order = "";
    state.live.snapshot = null;
    state.live.lastError = "";
    state.ui.liveSearchStatus = "ready";
    state.ui.liveSearchError = "";
    resetLiveRouteSearchState();
    syncLiveBindingState();
    pushHistory("Official stop selected", `${state.live.stationName || state.live.stationId} was linked to ${state.live.provider} live sync.`);
    persist();
    if (
      (state.live.provider === "seoul" && state.live.arsId) ||
      (state.live.provider === "gyeonggi" && state.live.stationId) ||
      (state.live.provider === "tago" && state.live.cityCode && state.live.nodeId)
    ) {
      loadLiveRoutesForSelectedStop();
      return;
    }

    return render();
  }
  if (action === "select-live-route") {
    state.live.routeId = target.dataset.routeId || "";
    state.live.routeNumber = target.dataset.routeNumber || "";
    state.live.order = target.dataset.order || "";
    state.live.snapshot = null;
    state.live.lastError = "";
    syncLiveBindingState();
    state.commute.transitJourney = null;
    commuteEstimateMeta.snapshot = null;
    persist();
    pushHistory("Official route selected", `${state.live.routeNumber || state.live.routeId} was linked to the live route binding.`);
    return render();
  }
  if (action === "sync-live-arrivals") {
    state.live.status = "loading";
    state.live.lastError = "";
    render();
    fetchLiveArrivals(getLiveBinding())
      .then((payload) => {
        state.live.status = "ready";
        state.live.snapshot = payload;
        state.live.stationName = payload.stopName || state.live.stationName;
        state.live.lastSyncedAt = payload.servedAt || payload.fetchedAt || new Date().toISOString();
        state.live.lastError =
          payload.cacheStatus === "stale-fallback"
            ? payload.fallbackError || "Latest live request failed, so the app is showing the last successful provider response."
            : "";
        syncLiveBindingState();
        const modeLabel =
          payload.cacheStatus === "stale-fallback"
            ? "stale fallback"
            : payload.cacheStatus === "cache-hit"
              ? "cache hit"
              : "fresh live";
        pushHistory(
          "Live arrivals synced",
          `${payload.provider} provider returned ${payload.arrivalsMin.join(", ")} minute arrivals (${modeLabel}).`,
        );
        void refreshBusAccuracySummary();
        void runAutoBusAccuracyProbeCycle();
        render();
      })
      .catch((error) => {
        state.live.status = "error";
        state.live.snapshot = null;
        state.live.lastError = error instanceof Error ? error.message : "Unknown live sync error.";
        pushHistory("Live sync failed", state.live.lastError, "ERROR");
        render();
      });
    return;
  }
  if (action === "set-primary-line") {
    state.commute.primaryLineId = target.dataset.lineId;
    if (!state.commute.selectedLineIds.includes(state.commute.primaryLineId)) {
      state.commute.selectedLineIds.push(state.commute.primaryLineId);
    }
    syncHomeToStopWalkEstimate();
    state.live.snapshot = null;
    pushHistory("Primary route updated", `Route ${target.dataset.lineId} is now the main alert route.`);
    refreshCommuteEstimate();
    return render();
  }
  if (action === "pick-stop") {
    state.commute.selectedStopId = target.dataset.stopId;
    const stop = getSelectedStop();
    state.commute.selectedLineIds = stop.lines.slice(0, 2).map((line) => line.id);
    state.commute.primaryLineId = stop.lines[0].id;
    syncHomeToStopWalkEstimate(stop, stop.lines[0]);
    state.live.snapshot = null;
    pushHistory("Stop updated", `Boarding stop changed to ${stop.name}.`);
    refreshCommuteEstimate();
    return render();
  }
  if (action === "sync-official-holidays") {
    const year = String(state.ui.holidaySyncYear || "").trim();
    if (!/^\d{4}$/.test(year)) {
      state.holidaySync.status = "error";
      state.holidaySync.lastError = "Enter a four-digit year first.";
      pushHistory("Holiday sync blocked", state.holidaySync.lastError, "ERROR");
      return render();
    }

    state.holidaySync.status = "loading";
    state.holidaySync.lastError = "";
    render();
    fetchOfficialHolidays(year)
      .then((payload) => {
        const holidays = Array.isArray(payload.holidays) ? payload.holidays : [];
        replaceOfficialHolidaysForYear(year, holidays);
        state.holidaySync.status = "ready";
        state.holidaySync.lastSyncedAt = payload.fetchedAt || new Date().toISOString();
        state.holidaySync.lastError = "";
        state.holidaySync.loadedYears = [...new Set([...state.holidaySync.loadedYears, year])].sort();
        pushHistory("Official holidays synced", `${year} calendar loaded with ${holidays.length} official skip dates.`);
        render();
      })
      .catch((error) => {
        state.holidaySync.status = "error";
        state.holidaySync.lastError = error instanceof Error ? error.message : "Unknown holiday sync error.";
        pushHistory("Official holiday sync failed", state.holidaySync.lastError, "ERROR");
        render();
      });
    return;
  }
  if (action === "add-holiday") {
    if (!state.ui.holidayDraft) return;
    if (!state.holidayDates.includes(state.ui.holidayDraft)) {
      state.holidayDates = [...state.holidayDates, state.ui.holidayDraft].sort();
      pushHistory("Manual skip date added", `${state.ui.holidayDraft} will now be skipped together with the official holiday feed.`);
    }
    state.ui.holidayDraft = "";
    persist();
    return render();
  }
  if (action === "remove-holiday") {
    state.holidayDates = state.holidayDates.filter((holiday) => holiday !== target.dataset.value);
    pushHistory("Manual skip date removed", `${target.dataset.value} was removed from the extra skip list.`);
    return render();
  }
  if (action === "save-schedule") {
    pushHistory("Schedule saved", `${state.schedule.startTime}-${state.schedule.endTime}, every ${state.schedule.repeatIntervalMin} minutes.`);
    goTo("home");
    return render();
  }
});

app.addEventListener("input", (event) => {
  const target = event.target;
  const authField = target.dataset.authField;
  if (authField) {
    authDraft[authField] = target.value;
    authMeta.submitError = "";
    authMeta.submitStatus = "idle";
    return;
  }
  const accountField = target.dataset.accountField;
  if (accountField) {
    accountDraft[accountField] = target.value;
    if (accountField === "name") {
      accountMeta.profileStatus = "idle";
      accountMeta.profileError = "";
    } else {
      accountMeta.passwordStatus = "idle";
      accountMeta.passwordError = "";
    }
    return;
  }

  if (!isAuthenticated()) return;
  const path = target.dataset.field;
  if (!path) return;

  const value = target.type === "range" ? Number(target.value) : target.value;
  if (path === "live.provider") {
    switchLiveProvider(state.live, value);
  } else {
    setNestedValue(state, path, value);
  }
  if (path === "live.provider") {
    resetLiveSearchState();
    resetLiveRouteSearchState();
  }
  if (path.startsWith("live.")) {
    invalidateTagoStopSelection(path);
    state.live.snapshot = null;
    state.live.lastError = "";
    syncLiveBindingState();
  }
  if (path === "live.arsId" || path === "live.stationId") {
    resetLiveRouteSearchState();
  }
  if (path === "ui.homeAddressKeyword") {
    state.ui.homeAddressSearchStatus = "idle";
    state.ui.homeAddressSearchError = "";
    state.ui.homeAddressSearchResults = [];
  }
  if (path === "ui.workAddressKeyword") {
    state.ui.workAddressSearchStatus = "idle";
    state.ui.workAddressSearchError = "";
    state.ui.workAddressSearchResults = [];
  }
  if (path === "user.homeAddress") {
    state.user.homeLocation = {
      lat: null,
      lng: null,
      source: "manual",
      label: state.user.homeAddress,
    };
    commuteEstimateMeta.snapshot = null;
    resetAddressSearchState("home");
  }
  if (path === "user.workAddress") {
    state.user.workLocation = {
      lat: null,
      lng: null,
      source: "manual",
      label: state.user.workAddress,
    };
    commuteEstimateMeta.snapshot = null;
    resetAddressSearchState("work");
  }
  if (path === "ui.liveSearchKeyword") {
    state.ui.liveSearchStatus = "idle";
    state.ui.liveSearchError = "";
    state.ui.liveSearchResults = [];
    resetLiveRouteSearchState();
  }
  if (path === "commute.alightToWorkWalkMin") {
    state.commute.alightToWorkWalkMin = Math.max(1, Number(state.commute.alightToWorkWalkMin) || 1);
  }
  persist();
  if (target.type === "range") {
    render();
  }
  if (path === "commute.alightToWorkWalkMin") {
    refreshCommuteEstimate();
  }
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (!isAuthenticated()) return;
  if (target.dataset.action === "toggle-line") {
    toggleLine(target.dataset.lineId);
    return;
  }

  const path = target.dataset.field;
  if (!path) return;

  const value = target.type === "range" ? Number(target.value) : target.value;
  if (path === "live.provider") {
    switchLiveProvider(state.live, value);
  } else {
    setNestedValue(state, path, value);
  }
  if (path === "live.provider") {
    resetLiveSearchState();
    resetLiveRouteSearchState();
  }
  if (path.startsWith("live.")) {
    invalidateTagoStopSelection(path);
    state.live.snapshot = null;
    state.live.lastError = "";
    syncLiveBindingState();
  }
  if (path === "live.arsId" || path === "live.stationId") {
    resetLiveRouteSearchState();
  }
  if (path === "ui.homeAddressKeyword") {
    state.ui.homeAddressSearchStatus = "idle";
    state.ui.homeAddressSearchError = "";
    state.ui.homeAddressSearchResults = [];
  }
  if (path === "ui.workAddressKeyword") {
    state.ui.workAddressSearchStatus = "idle";
    state.ui.workAddressSearchError = "";
    state.ui.workAddressSearchResults = [];
  }
  if (path === "user.homeAddress") {
    state.user.homeLocation = {
      lat: null,
      lng: null,
      source: "manual",
      label: state.user.homeAddress,
    };
    commuteEstimateMeta.snapshot = null;
    resetAddressSearchState("home");
  }
  if (path === "user.workAddress") {
    state.user.workLocation = {
      lat: null,
      lng: null,
      source: "manual",
      label: state.user.workAddress,
    };
    commuteEstimateMeta.snapshot = null;
    resetAddressSearchState("work");
  }
  if (path === "ui.liveSearchKeyword") {
    state.ui.liveSearchStatus = "idle";
    state.ui.liveSearchError = "";
    state.ui.liveSearchResults = [];
    resetLiveRouteSearchState();
  }
  if (path === "commute.alightToWorkWalkMin") {
    state.commute.alightToWorkWalkMin = Math.max(1, Number(state.commute.alightToWorkWalkMin) || 1);
  }
  persist();
  render();
  if (path === "commute.alightToWorkWalkMin") {
    refreshCommuteEstimate();
  }
});

window.addEventListener("hashchange", render);
window.addEventListener("pointerdown", () => {
  void primeAlarmPlayback();
});
window.addEventListener("visibilitychange", () => {
  if (!isAuthenticated()) {
    return;
  }
  if (document.visibilityState === "visible") {
    void refreshVisibleTransit();
    queueAlarmPlanRefresh(0);
    queueAlarmRuntimeRefresh(0);
    void runAutoBusAccuracyProbeCycle();
    render();
  }
});
window.setInterval(() => {
  if (!isAuthenticated()) {
    return;
  }
  if (document.visibilityState !== "visible") {
    return;
  }

  queueAlarmPlanRefresh(0);
  queueAlarmRuntimeRefresh(0);
  void runAutoBusAccuracyProbeCycle();
  if (routeToScreen(window.location.hash) === "home") render();
  if (routeToScreen(window.location.hash) === "home") void refreshVisibleTransit();
}, 15_000);
window.addEventListener("keydown", (event) => {
  void primeAlarmPlayback();
  if (event.key.toLowerCase() === "r" && event.altKey) {
    state = resetState();
    ensureDemoHistory();
    render();
  }
});

if (!window.location.hash) {
  window.location.hash = "#/home";
}

async function bootstrap() {
  const searchParams = new URL(window.location.href).searchParams;
  if (searchParams.has("login_error")) {
    authMeta.submitError = "로그인을 완료하지 못했습니다. 같은 브라우저에서 다시 시도해 주세요.";
    window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
  }

  const authenticated = await hydrateAuthSession();
  await Promise.all([refreshBusApiConfig(), refreshPlaceApiConfig(), refreshCommuteApiConfig(), refreshHolidayApiConfig(), hydrateAuthProviders()]);
  if (authenticated) {
    await hydrateAuthenticatedWorkspace();
  }
  render();
}

bootstrap();




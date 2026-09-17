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
import { formatUiLabel, formatUiMessage, localizeDisplayFields, userErrorMessage } from "./locale-ko.js";
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
      "지역별 실제 도착시간 정확도를 비교해 정보 제공처를 선택합니다.",
    observations: {
      gyeonggi:
        "경기 지역은 다른 제공처가 더 정확하다고 확인되기 전까지 TAGO를 우선 사용합니다.",
    },
  },
  providers: {
    seoul: {
      configured: false,
      label: "서울시 버스정보",
      role: "regional-candidate",
      note: "서울 정류장은 다른 제공처가 더 정확하다고 확인되기 전까지 서울시 정보를 우선 사용합니다.",
    },
    gyeonggi: {
      configured: false,
      label: "경기도 버스정보(정확도 비교용)",
      role: "regional-candidate",
      note: "경기도 정보는 비교용으로 사용하며, TAGO보다 정확하다고 확인되면 우선 사용합니다.",
    },
    tago: {
      configured: false,
      label: "국토교통부 TAGO",
      role: "national-candidate",
      note: "경기 지역과 전국 버스정보의 기본 제공처로 TAGO를 사용합니다.",
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
    authMeta.submitError = userErrorMessage(error, "로그인 상태 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
    authMeta.submitError = userErrorMessage(error, "로그인 제공처 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
    accountMeta.lastError = userErrorMessage(error, "계정 정보 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
    authMeta.submitError = userErrorMessage(error, "소셜 로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
    authMeta.submitError = userErrorMessage(error, "로그아웃 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
    accountMeta.profileError = userErrorMessage(error, "프로필 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
        persistenceMeta.lastError = userErrorMessage(error, "서버 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
        domainMeta.lastError = userErrorMessage(error, "계정 설정 동기화 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
        deviceMeta.lastError = userErrorMessage(error, "기기 설정 동기화 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
    return `제공처별 예측이 ${context.accuracySpreadMin}분 차이 나므로 안전 여유시간 ${context.accuracyRiskBufferMin}분을 적용합니다.`;
  }

  return `제공처별 도착 예측에 차이가 있어 안전 여유시간 ${context.accuracyRiskBufferMin}분을 적용합니다.`;
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

  const parts = [`안전 여유시간 ${context.accuracyRiskBufferMin}분`];
  if (Number.isFinite(Number(context.accuracySpreadMin))) {
    parts.push(`예측 차이 ${context.accuracySpreadMin}분`);
  }
  if (context.liveEtaGuardMode) {
    parts.push(`판단 모드 ${formatUiLabel(String(context.liveEtaGuardMode))}`);
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
      ? ["첫 알림 강화 전송", "도착정보 변동이 큰 노선"]
      : priorityClass === "precheck"
        ? ["사전 점검 알림 전송", "주의 노선 사전 확인"]
        : [`전송 우선순위 ${priorityClass}`];

  if (context?.deliveryPriorityReason) {
    parts.push(formatUiLabel(context.deliveryPriorityReason));
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
    parts.push(`${Math.round(volumePercent)}% 음량`);
  }
  if (Number.isFinite(vibrationRepeats) && vibrationRepeats > 0) {
    parts.push(`진동 ${Math.round(vibrationRepeats)}회`);
  }
  if (Number.isFinite(mechanicalLoopBoost) && mechanicalLoopBoost > 0) {
    parts.push(`경고음 ${Math.round(mechanicalLoopBoost)}회 추가`);
  }
  if (Number.isFinite(speechRepeatCount) && speechRepeatCount > 1) {
    parts.push(`음성 안내 ${Math.round(speechRepeatCount)}회`);
  }

  if (!parts.length) {
    return "";
  }

  return `<div class="${className}">${escapeHtml(parts.join(" · "))}</div>`;
}

function getConservativeReliabilityReport() {
  return localizeDisplayFields(
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
  return localizeDisplayFields(
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
  pushHistory("예시 준비 완료", "최근 이용 기록을 저장해 알람 처리 흐름을 확인할 수 있습니다.");
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
        alarmPlanMeta.lastError = userErrorMessage(error, "알람 계획 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
        alarmRuntimeMeta.lastError = userErrorMessage(error, "알람 상태 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
      browserPlaybackMeta.lastError = userErrorMessage(error, "브라우저의 자동 소리 재생이 차단되어 있습니다.");
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
    return "브라우저에서 알람 소리를 재생하고 있습니다.";
  }
  if (browserPlaybackMeta.status === "played") {
    return browserPlaybackMeta.lastPlayedAt
      ? `${formatClock(new Date(browserPlaybackMeta.lastPlayedAt))}에 알람 소리를 재생했습니다.`
      : "브라우저에서 알람 소리를 재생했습니다.";
  }
  if (browserPlaybackMeta.status === "partial") {
    return browserPlaybackMeta.lastError || "브라우저에서 일부 알림 재생이 차단되었습니다.";
  }
  if (browserPlaybackMeta.status === "blocked") {
    return browserPlaybackMeta.lastError || "소리 자동 재생을 위해 먼저 화면의 재생 버튼을 눌러 주세요.";
  }
  if (browserPlaybackMeta.status === "muted") {
    return "이 기기의 소리와 음성 안내가 모두 꺼져 있습니다.";
  }
  return browserPlaybackMeta.lastError || "다음 알람 단계를 기다리고 있습니다.";
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
        browserPlaybackMeta.lastError = "브라우저에서 소리와 음성 안내를 자동 재생할 수 없습니다.";
      } else if (!playback.playedSound && playback.playedTts) {
        browserPlaybackMeta.status = "partial";
        browserPlaybackMeta.lastError = state.device.soundEnabled
          ? "브라우저 자동 재생이 제한되어 있습니다. 버튼을 눌러 알람 소리를 재생하세요."
          : "";
      } else {
        browserPlaybackMeta.status = "played";
        browserPlaybackMeta.lastError = "";
      }
      render();
    })
    .catch((error) => {
      browserPlaybackMeta.status = "blocked";
      browserPlaybackMeta.lastError = userErrorMessage(error, "브라우저 자동 재생에 실패했습니다.");
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
      alarmRuntimeMeta.eventSyncError = userErrorMessage(error, "알람 기록 동기화 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
      alarmRuntimeMeta.actionError = userErrorMessage(error, "알람 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
          "지역별 실제 도착시간 정확도를 비교해 정보 제공처를 선택합니다.",
      },
      providers: {
        seoul: { configured: false, label: "서울시 버스정보", role: "regional-candidate" },
        gyeonggi: { configured: false, label: "경기도 버스정보(정확도 비교용)", role: "regional-candidate" },
        tago: { configured: false, label: "국토교통부 TAGO", role: "national-candidate" },
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
    persistenceMeta.lastError = userErrorMessage(error, "서버 정보 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
    domainMeta.lastError = userErrorMessage(error, "계정 설정 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
    deviceMeta.lastError = userErrorMessage(error, "기기 설정 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
    return "예시 정보";
  }

  return formatUiLabel(getLiveProviderMeta(provider)?.label || provider || "예시 정보");
}

function getLiveProviderPolicyCopy(provider = state.live.provider) {
  if (provider === "gyeonggi") {
    return "같은 경기도 정류장·노선에서 TAGO보다 정확한 경우에 선택하세요.";
  }

  if (provider === "seoul") {
    return "서울 정류장은 실제 비교 결과 더 정확한 제공처가 없다면 서울시 정보를 유지하세요.";
  }

  if (provider === "tago") {
    return "경기 지역 우선 제공처이자 전국 버스정보의 기본 제공처입니다.";
  }

  return busApiConfig.policy?.guidance || "해당 지역에서 도착시간이 가장 정확한 제공처를 선택하세요.";
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

  return `<button class="mini-button" data-action="apply-bus-accuracy-recommendation">추천 제공처로 변경: ${escapeHtml(
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
    accuracyMeta.lastError = userErrorMessage(error, "버스 정확도 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
      userErrorMessage(error, "버스 정확도 순위 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    render();
    return null;
  }
}

async function probeBusAccuracyProviders() {
  const candidates = getAccuracyProbeCandidates();
  if (!candidates.length) {
    accuracyMeta.probeStatus = "error";
    accuracyMeta.probeError = "도착시간을 비교하려면 먼저 실시간 정보 제공처를 하나 이상 연결하세요.";
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
      "도착시간 비교 완료",
      `이 노선의 제공처 ${accuracyMeta.lastProbeComparisons.length}곳을 비교했습니다.${
        Number.isFinite(Number(comparisonSummary.etaSpreadMin))
          ? ` 도착시간 차이는 ${comparisonSummary.etaSpreadMin}분입니다.`
          : ""
      }`,
      "INFO",
      "APP_ACTION",
      { includeLiveEtaContext: true },
    );
    if (payload.autoResolved?.autoDetected) {
      pushHistory(
        "실제 도착 자동 감지",
        `제공처별 예측이 모여 도착 기록 ${payload.autoResolved.resolvedSamples.length}건을 자동 평가했습니다.`,
        "INFO",
        "APP_ACTION",
        { includeLiveEtaContext: true },
      );
    }
    void refreshBusAccuracyLeaderboard();
    render();
  } catch (error) {
    accuracyMeta.probeStatus = "error";
    accuracyMeta.probeError = userErrorMessage(error, "도착시간 비교 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    render();
  }
}

async function recordCurrentBusArrival() {
  const filter = getAccuracyFilter();
  if (!filter.routeNumber || !filter.stopName) {
    accuracyMeta.actualStatus = "error";
    accuracyMeta.actualError = "실제 도착을 기록하려면 버스 번호와 정류장 이름이 필요합니다.";
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
      "실제 도착 기록 완료",
      `실제 도착 시각과 비교해 예측 ${payload.resolvedSamples?.length || 0}건을 평가했습니다.`,
      "INFO",
      "APP_ACTION",
      { includeLiveEtaContext: true },
    );
    void refreshBusAccuracyLeaderboard();
    render();
  } catch (error) {
    accuracyMeta.actualStatus = "error";
    accuracyMeta.actualError = userErrorMessage(error, "실제 도착 기록 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
        "실제 도착 자동 감지",
        `자동 도착정보 조회로 ${payload.autoResolved.resolvedSamples.length}건을 평가했습니다.`,
        "INFO",
        "APP_ACTION",
        { includeLiveEtaContext: true },
      );
    }
    if (Number.isFinite(Number(comparisonSummary.etaSpreadMin)) && comparisonSummary.disagreementLevel === "diverged") {
      pushHistory(
        "도착시간 예측 차이 증가",
        `제공처별 예측이 ${comparisonSummary.etaSpreadMin}분 차이 나므로 주의해서 확인하세요.`,
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
    accuracyMeta.autoProbeError = userErrorMessage(error, "자동 도착시간 비교 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    accuracyMeta.autoProbeNextEligibleAt = null;
    render();
    return null;
  }
}

function describeAutoProbeReason(reason, nextEligibleAt = null) {
  const normalizedReason = String(reason || "").trim();

  if (reason === "schedule-disabled-today") {
    return "오늘은 알람이 꺼져 있어 자동 도착시간 비교를 쉬고 있습니다.";
  }

  if (reason === "before-probe-window-history-high") {
    return "도착정보 변동이 큰 주의 노선이므로 알람 시간대 30분 전부터 비교 조회합니다.";
  }

  if (reason === "before-probe-window-history-elevated") {
    return "최근 도착정보 변동이 있어 알람 시간대 20분 전부터 비교 조회합니다.";
  }

  if (reason === "before-probe-window") {
    return "아직 알람 시간대 전이므로 자동 비교 조회를 기다리고 있습니다.";
  }

  if (reason === "after-probe-window") {
    return "알람 시간대가 끝나 자동 비교 조회를 쉬고 있습니다.";
  }

  if (normalizedReason.startsWith("precheck-warmup")) {
    return "도착정보 변동이 큰 주의 노선이므로 알람 시작 10분 전부터 더 자주 비교 조회합니다.";
  }

  if (reason === "eta-disagreement-diverged") {
    return "제공처별 도착시간 차이가 커서 일시적으로 더 자주 확인합니다.";
  }

  if (reason === "eta-disagreement-watch") {
    return "제공처별 도착시간 차이가 있어 다음 차량 정보를 더 자주 확인합니다.";
  }

  if (reason === "not-enough-candidates") {
    return "자동 정확도 비교에는 연결된 제공처가 두 곳 이상 필요합니다.";
  }

  if (reason === "cooldown" || reason === "auto-resolve-cooldown") {
    return nextEligibleAt
      ? `${formatClock(new Date(nextEligibleAt))}까지 다음 도착정보 비교를 기다립니다.`
      : "다음 도착정보 비교 조회를 기다리고 있습니다.";
  }

  if (reason === "critical-imminence") {
    return "버스가 가까워져 가장 짧은 간격으로 확인합니다.";
  }

  if (reason === "imminent-arrival") {
    return "버스가 가까워져 평소보다 자주 확인합니다.";
  }

  if (reason === "near-arrival") {
    return "버스가 접근 중이어서 조회 간격을 줄였습니다.";
  }

  if (reason === "steady-window") {
    return "알람 시간대의 기본 간격으로 도착정보를 확인합니다.";
  }

  if (normalizedReason.startsWith("steady-window+")) {
    return "최근 도착정보 변동을 고려해 기본 간격보다 조금 자주 확인합니다.";
  }

  if (normalizedReason.startsWith("eta-watch-history-high")) {
    return "현재 예측 차이는 작지만 최근 변동이 큰 노선이라 보수적으로 확인합니다.";
  }

  if (normalizedReason.startsWith("eta-disagreement-watch+")) {
    return "현재 예측 차이와 최근 변동을 고려해 주의 단계보다 더 자주 확인합니다.";
  }

  return accuracyMeta.autoProbeError || "아직 자동 도착정보 비교를 실행하지 않았습니다.";
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
        "공식 노선 조회 완료",
        `선택한 정류장의 ${payload.provider} 노선 ${state.ui.liveRouteSearchResults.length}개를 조회했습니다.`,
      );
      render();
    })
    .catch((error) => {
      state.ui.liveRouteSearchStatus = "error";
      state.ui.liveRouteSearchResults = [];
      state.ui.liveRouteSearchError = userErrorMessage(error, "경유 노선 검색 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      pushHistory("공식 노선 조회 실패", state.ui.liveRouteSearchError, "ERROR");
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
      state.ui[`${safeTarget}AddressSearchError`] = userErrorMessage(error, "주소 검색 중 알 수 없는 오류가 발생했습니다.");
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
    commuteEstimateMeta.lastError = userErrorMessage(error, "대중교통 경로 조회 실패");
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
    state.live.lastError = userErrorMessage(error, "실시간 도착정보 조회 실패");
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
    return "기록 없음";
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
      label: formatUiLabel("IDLE"),
      detail: "아직 실시간 버스 정보를 불러오지 않았습니다.",
    };
  }

  if (snapshot.cacheStatus === "stale-fallback") {
    return {
      cacheStatus: "stale-fallback",
      label: formatUiLabel("STALE"),
      detail: snapshot.fallbackError
        ? `최근 조회에 실패해 마지막으로 확인한 정보를 표시합니다. ${snapshot.fallbackError}`
        : "최근 조회에 실패해 마지막으로 확인한 정보를 표시합니다.",
    };
  }

  if (snapshot.cacheStatus === "cache-hit") {
    return {
      cacheStatus: "cache-hit",
      label: formatUiLabel("CACHE"),
      detail: "중복 조회를 줄이기 위해 최근 확인한 정보를 사용했습니다.",
    };
  }

  return {
    cacheStatus: "live",
    label: formatUiLabel("FRESH"),
    detail: "공식 제공처에서 새로 조회한 정보입니다.",
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

function escapeUiMessage(text) {
  return escapeHtml(formatUiMessage(text));
}

function describeAccuracyFreshness(provider, recentWindowDays = 7) {
  if (!provider || provider.activeFreshnessState === "none") {
    return `최근 ${recentWindowDays}일의 도착 평가 기록이 없습니다.`;
  }

  if (provider.activeFreshnessState === "fresh") {
    return `최근 ${recentWindowDays}일의 평가 기록을 사용합니다.`;
  }

  if (provider.activeLatestSampleAgeDays !== null && provider.activeLatestSampleAgeDays !== undefined) {
    return `가장 최근 평가가 ${provider.activeLatestSampleAgeDays}일 전이어서 이 기록만으로 추천을 변경하지 않습니다.`;
  }

  return `평가 기록은 있지만 최근 ${recentWindowDays}일 이내 기록이 없습니다.`;
}

function describeAccuracyDisagreement(runtime) {
  const comparableCount = Number(runtime?.lastObservedComparableProviderCount) || 0;
  const spread = runtime?.lastObservedEtaSpreadMin;
  const source = formatUiLabel(String(runtime?.lastObservedProbeSource || "none").trim());
  const providerCopy = Array.isArray(runtime?.lastObservedComparableProviders)
    ? runtime.lastObservedComparableProviders.map((item) => formatUiLabel(String(item || "").trim())).filter(Boolean).join(", ")
    : "";

  if (!comparableCount) {
    return {
      badge: formatUiLabel("NO DATA"),
      copy: "아직 제공처별 도착시간 비교 기록이 없습니다.",
    };
  }

  if (runtime?.lastObservedDisagreementLevel === "single-provider") {
    return {
      badge: formatUiLabel("SINGLE"),
      copy: `${source} 조회에서 비교 가능한 제공처가 한 곳뿐이어서 예측 차이를 계산하지 못했습니다.`,
    };
  }

  if (runtime?.lastObservedDisagreementLevel === "aligned") {
    return {
      badge: `${spread ?? "-"}분`,
      copy: `${source} 조회 결과 ${providerCopy || "제공처"}의 도착 예측이 비슷합니다.`,
    };
  }

  if (runtime?.lastObservedDisagreementLevel === "watch") {
    return {
      badge: `${spread ?? "-"}분`,
      copy: `${source} 조회 결과 ${providerCopy || "제공처"}의 예측에 차이가 있습니다. 제공처를 바꾸기 전에 더 확인하세요.`,
    };
  }

  if (runtime?.lastObservedDisagreementLevel === "diverged") {
    return {
      badge: `${spread ?? "-"}분`,
      copy: `${source} 조회 결과 ${providerCopy || "제공처"}의 예측 차이가 큽니다. 차이가 줄기 전까지 현재 도착정보에 주의하세요.`,
    };
  }

  return {
    badge: formatUiLabel("UNKNOWN"),
    copy: "아직 제공처 간 도착시간 차이를 평가하지 않았습니다.",
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
        <div class="brandmark">스마트 메트로</div>
        <button class="icon-button" data-action="logout" aria-label="로그아웃">
          <span class="material-symbols-outlined">logout</span>
        </button>
      </header>
    `;
  }

  const titles = {
    onboarding: "이동 경로 등록",
    schedule: "알람 일정",
    settings: "알림 설정",
  };

  return `
    <header class="topbar">
      <div class="topbar-side">
        <button class="icon-button" data-action="goto" data-screen="home" aria-label="뒤로">
          <span class="material-symbols-outlined">arrow_back</span>
        </button>
        <div>
          <div class="topbar-title">${titles[screen]}</div>
          ${
            screen === "schedule"
              ? `<div class="topbar-subtitle">${model.scheduleState.badge}</div>`
              : screen === "settings"
                ? `<div class="topbar-subtitle">웹에서는 알림 설정을 저장합니다. 휴대폰 권한은 앱에서 별도로 허용해야 합니다.</div>`
                : `<div class="topbar-subtitle">탑승 정류장과 노선을 등록하세요</div>`
          }
        </div>
      </div>
      ${
        screen === "onboarding"
          ? `<div class="avatar avatar-small">${escapeHtml(userInitial)}</div>`
          : `<button class="icon-button" data-action="logout" aria-label="로그아웃">
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
    <section class="headline-block"><h1>늦지 않게, 스마트 메트로</h1>
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
        ? `현재 예측 차이는 약 ${liveEtaGuard.spreadMin ?? "-"}분이지만 최근 변동이 큰 노선입니다. 안전 여유시간 ${liveEtaGuard.recommendedRiskBufferMin}분을 고려하세요.`
        : `제공처별 예측 차이가 약 ${liveEtaGuard.spreadMin ?? "-"}분입니다. 더 늦은 예측만 믿고 기다리지 말고 안전 여유시간 ${liveEtaGuard.recommendedRiskBufferMin}분을 고려하세요.`
      : liveEtaGuard.mode === "watch"
        ? liveEtaGuard.reasonCode === "eta-watch-history-elevated"
          ? `제공처별 예측에 차이가 있고 최근 변동도 있는 노선입니다. 현재 제공처를 유지하며 도착정보를 다시 확인하세요.`
          : `제공처별 예측 차이가 약 ${liveEtaGuard.spreadMin ?? "-"}분입니다. 더 기다리기 전에 도착정보를 다시 확인하세요.`
        : model.dataSource === "LIVE"
      ? snapshotState.cacheStatus === "stale-fallback"
        ? "현재 조회가 지연되어 마지막으로 확인한 버스 정보를 표시합니다."
        : snapshotState.cacheStatus === "cache-hit"
          ? "최근 조회한 공식 버스 정보를 표시합니다."
          : "공식 버스 도착정보를 표시하고 있습니다."
      : "실시간 정류장·노선을 연결하기 전에는 예시 정보가 표시됩니다. 실제 도착정보가 아닙니다.";
  const stateBadgeClass = model.scheduleState.firing ? "status-dot success" : "status-dot paused";
  const buttonLabel = state.schedule.snoozeDate === dateOnlyKey(model.now) ? "오늘 알람 다시 켜기" : "오늘 알람 끄기";
  const heroWatchlistMarkup = highlightedWatchEntry
    ? `
      <div class="hero-watchlist ${highlightedWatchEntry.severityLevel === "high" ? "high" : "elevated"}">
        <div class="hero-watchlist-head">
          <span class="material-symbols-outlined">warning</span>
          <span>${escapeHtml(
            watchlistHighlight.isCurrentRouteHighlighted
              ? `${highlightedWatchEntry.severityLabel} 주의 · 내 이동 경로`
              : `${highlightedWatchEntry.severityLabel} 주의 · 오늘 우선 확인`,
          )}</span>
        </div>
        <div class="hero-watchlist-title">${escapeHtml(`${highlightedWatchEntry.routeNumber || "노선"} · ${highlightedWatchEntry.stopName || "정류장"}`)}</div>
        <div class="hero-watchlist-copy">${escapeHtml(
          watchlistHighlight.isCurrentRouteHighlighted
            ? `최근 보수적 판단 ${highlightedWatchEntry.count}건, ${watchWindowLabel} 시간대 ${highlightedWatchEntry.inWindowCount}건, 평균 예측 차이 ${highlightedWatchEntry.averageSpreadMin ?? "-"}분.`
            : `최근 변동이 가장 큰 조합입니다. 기록 ${highlightedWatchEntry.count}건, ${watchWindowLabel} 시간대 ${highlightedWatchEntry.inWindowCount}건, 평균 예측 차이 ${highlightedWatchEntry.averageSpreadMin ?? "-"}분.`,
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
                ? "강화 확인 중"
                : nextTriggerPriorityClass === "boosted"
                  ? "첫 알림 강화 설정됨"
                  : "주의 노선 보호 설정",
            )}</span>
          </div>
          <div class="hero-watchlist-title">${escapeHtml(
            alarmPlan?.nextTrigger?.triggerKind === "stability-precheck"
              ? "이 노선의 사전 점검이 진행 중입니다"
              : nextTriggerPriorityClass === "boosted"
                ? "첫 알람에 강화 전송 설정을 적용합니다"
                : "오늘 이 노선의 도착정보를 더 자주 확인합니다",
          )}</div>
          <div class="hero-watchlist-copy">${escapeHtml(
            alarmPlan?.nextTrigger?.triggerKind === "stability-precheck"
              ? `주의 노선이므로 알람 시간대 ${stabilityWatch.precheckLeadMin || 0}분 전에 사전 점검합니다. 첫 알람은 강화 전송하며 10초·30초·90초 간격으로 재시도합니다.`
              : nextTriggerPriorityClass === "boosted"
                ? "다음 첫 알람은 강화 전송으로 설정되어 있으며, 재시도 가능한 푸시 오류는 10초·30초·90초 간격으로 다시 시도합니다."
                : "최근 아침 도착정보의 변동이 커서 조회를 강화하고 보수적인 알림 기준을 유지합니다.",
          )}</div>
        </div>
      `
      : "";
  return `
    <section class="hero-card">
      <div class="hero-card-glow"></div>
      <div class="hero-meta">오늘 · ${escapeHtml(formatLongDate(model.now))}</div>
      <div class="hero-status-row">
        <div class="${stateBadgeClass}"></div>
        <div class="hero-status">${model.scheduleState.firing ? "알람 켜짐" : "알람 꺼짐"}</div>
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
  const lateText = result.deltaMinutes >= 0 ? `${result.deltaMinutes}분 일찍 도착` : `${Math.abs(result.deltaMinutes)}분 지각 예상`;
  const riskCopy =
    result.etaRiskBufferMin > 0
      ? `${lateText} · 안전 여유시간 ${result.etaRiskBufferMin}분 포함`
      : lateText;
  return `
    <article class="bus-card ${tone}">
      <div class="bus-card-left">
        <div class="bus-chip ${tone}">
          ${
            title === "this"
              ? result.catchable
                ? result.risk.chip
                : "놓칠 위험"
              : result.level === "RED"
                ? "지각 예상"
                : "다음 차량"
          }
        </div>
        <div class="bus-minutes-row">
          <div class="bus-minutes">${Math.ceil(result.arrivalMinutes)}</div>
          <div class="bus-minutes-unit">분</div>
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
      <div class="stack-title"><span class="material-symbols-outlined">history</span>최근 알람 기록</div>
      <div class="history-list">
        ${items
          .map(
            (item) => `
              <article class="history-item">
                <div class="history-main">
                  <div class="history-title">${escapeUiMessage(item.title)}</div>
                  <div class="history-detail">${escapeUiMessage(item.detail)}</div>
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
      ? "새로고침 중…"
      : model.dataSource === "LIVE"
        ? "실시간 정보 새로고침"
        : "실시간 정보 조회";
  const configuredCopy =
    state.live.provider === "none"
      ? "경로 등록에서 정보 제공처와 정류장·노선을 선택하세요."
      : model.liveProviderConfigured
        ? `${providerLabel} 연결 키가 서버에 설정되어 있습니다.`
        : `${providerLabel} 연결 키가 아직 서버에 설정되지 않았습니다.`;
  const recommendedProvider = getAccuracyRecommendedProvider();
  const providerRoleCopy =
    state.live.provider === "none"
      ? getLiveProviderPolicyCopy("none")
      : state.live.provider === recommendedProvider
        ? `${providerLabel}는 현재 이 노선의 추천 정보 제공처입니다.`
        : `${providerLabel}는 정확도를 비교할 수 있는 제공처입니다.`;
  const snapshotState = describeLiveSnapshot(model.liveSnapshot);
  const fetchedCopy =
    model.liveSnapshot?.fetchedAt && model.liveSnapshot.cacheStatus !== "live"
      ? `정보 조회 시각: ${escapeHtml(formatClock(new Date(model.liveSnapshot.fetchedAt)))}`
      : state.live.lastError || snapshotState.detail;

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">sync</span>실시간 도착정보</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">정보 출처</div>
          <div class="live-sync-value">${formatUiLabel(model.dataSource)}</div>
          <div class="live-sync-copy">${escapeHtml(configuredCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">정보 제공처 기준</div>
          <div class="live-sync-value">${escapeHtml(providerLabel)}</div>
          <div class="live-sync-copy">${escapeHtml(providerRoleCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">조회 상태</div>
          <div class="live-sync-value">${escapeHtml(snapshotState.label)}</div>
          <div class="live-sync-copy">${escapeHtml(snapshotState.detail)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">마지막 갱신</div>
          <div class="live-sync-value">${state.live.lastSyncedAt ? escapeHtml(formatClock(new Date(state.live.lastSyncedAt))) : "-"}</div>
          <div class="live-sync-copy">${escapeHtml(fetchedCopy || "갱신 오류가 없습니다.")}</div>
        </article>
      </div>
      <div class="field-help">${escapeUiMessage(getLiveProviderPolicyCopy())}</div>
      <button class="soft-button wide" data-action="sync-live-arrivals" ${state.live.status === "loading" ? "disabled" : ""}>${syncLabel}</button>
    </section>
  `;
}

function renderBusAccuracyPanel() {
  const summary = localizeDisplayFields(accuracyMeta.summary);
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
        ? `${weekdayScopeLabel} 평가 기록이 충분해 이 기록을 우선 반영합니다.`
        : summary?.recommendationScope === "schedule-window"
          ? `${timeSlice.label} 기록은 충분하지만 같은 요일의 기록은 부족해 전체 알람 시간대 기록을 사용합니다.`
          : `${timeSlice.label} 평가 기록이 아직 부족해 전체 평가 기록을 사용합니다.`
      : "적용할 알람 시간대가 없어 전체 도착 기록을 기준으로 추천합니다.";
  const basisCopy =
    summary?.recommendationBasis === "measured-accuracy"
      ? `도착 예측 오차가 안정적이며, 최근 기록에 더 높은 비중을 두어 추천합니다.`
      : summary?.recommendationReason === "measured-samples-stale"
        ? `최근 ${recentWindowDays}일의 비교 평가 기록이 부족해 기본 추천 제공처를 유지합니다.`
        : summary?.recommendationReason === "not-enough-recent-compared-providers"
          ? `최근 ${recentWindowDays}일 기록은 있으나 충분한 평가 기록을 가진 제공처가 ${policy.minProvidersForMeasuredRecommendation ?? 2}곳 미만이어서 기본 추천을 유지합니다.`
      : summary?.recommendationReason === "measured-gap-too-small"
        ? `최근 기록을 우선 반영해도 정확도 차이가 작습니다. 차이가 ${policy.minWinningGapMin ?? 0.5}분을 넘기 전까지 기본 추천을 유지합니다.`
        : summary?.recommendationReason === "not-enough-compared-providers"
          ? `추천을 바꾸려면 제공처 ${policy.minProvidersForMeasuredRecommendation ?? 2}곳 이상에서 각각 ${policy.minSamplesPerProvider ?? 2}건 이상의 평가 기록이 필요합니다.`
          : `제공처별 평가 기록이 아직 부족해 기본 추천을 유지합니다.`;
  const confidenceCopy =
    summary?.recommendationBasis === "measured-accuracy"
      ? `${formatUiLabel(String(summary?.recommendationConfidence || "medium"))} 신뢰도 · 최근 기록을 우선 반영한 오차가 다음 제공처보다 ${summary?.measuredLeaderGapMin ?? "-"}분 적습니다.`
      : `${formatUiLabel(String(summary?.recommendationConfidence || "low"))} 신뢰도 · 기본 제공처를 변경하기 전에 평가 기록을 더 모아 주세요.`;
  const probeCopy =
    accuracyMeta.probeStatus === "loading"
      ? "제공처별 도착시간을 비교하고 있습니다…"
      : accuracyMeta.probeStatus === "error"
        ? accuracyMeta.probeError || "도착시간 비교에 실패했습니다."
        : accuracyMeta.lastProbeComparisons.length
          ? `최근 조회에서 제공처 ${accuracyMeta.lastProbeComparisons.length}곳을 비교했습니다.`
          : "연결된 제공처의 현재 도착시간을 함께 비교합니다.";
  const actualCopy =
    accuracyMeta.actualStatus === "loading"
      ? "실제 도착 시각을 기록하고 있습니다…"
      : accuracyMeta.actualStatus === "error"
        ? accuracyMeta.actualError || "실제 도착 시각을 기록하지 못했습니다."
        : "버스가 실제로 도착했을 때 아래 버튼을 누르면 예측 정확도를 평가할 수 있습니다.";
  const cadenceCopy =
    runtime?.lastCadence && runtime?.lastIntervalMs
      ? `${formatUiLabel(String(runtime.lastCadence))} 조회 간격 · ${Math.round(Number(runtime.lastIntervalMs) / 1000)}초마다`
      : "";
  const disagreementState = describeAccuracyDisagreement(runtime);
  const autoCopy =
    accuracyMeta.autoProbeStatus === "loading"
      ? "자동 도착시간 비교 중…"
      : runtime?.lastAutoProbeAt
        ? `마지막 자동 비교 ${formatClock(new Date(runtime.lastAutoProbeAt))} · ${runtime.lastComparisonCount}건 비교 · ${runtime.lastStatus}${
            cadenceCopy ? ` · ${cadenceCopy}` : ""
          }${
            runtime?.lastAutoResolvedAt
              ? ` · 자동 도착 감지 ${runtime.autoResolvedArrivalCount || 0}회 (최근 ${formatClock(new Date(runtime.lastAutoResolvedAt))})`
              : ""
          }`
        : describeAutoProbeReason(accuracyMeta.autoProbePlan?.reason || accuracyMeta.autoProbeError, accuracyMeta.autoProbeNextEligibleAt);
  const historicalBiasCopy =
    runtime?.lastHistoricalBiasLevel && runtime.lastHistoricalBiasLevel !== "none"
      ? `이전 기록의 보수적 판단 수준 ${formatUiLabel(String(runtime.lastHistoricalBiasLevel))} · 노선 기록 ${runtime.lastHistoricalBiasRouteTraceCount || 0} · 요일·시간대 기록 ${runtime.lastHistoricalBiasWeekdayTraceCount || 0}.`
      : "";
  const recommendationGuardCopy =
    liveEtaGuard.shouldHoldProviderSwitch
      ? liveEtaGuard.reasonCode === "eta-watch-history-elevated"
        ? "현재 차이는 작지만 최근 변동이 있어 제공처를 바로 바꾸지 않고 조금 더 확인합니다."
        : "제공처별 예측 차이가 커서 현재 제공처를 유지하며 확인합니다."
      : liveEtaGuard.mode === "watch"
        ? "제공처별 예측에 차이가 있어 더 확인한 뒤 변경을 추천합니다."
        : "";

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">analytics</span>도착시간 정확도 확인</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">현재 추천 제공처</div>
          <div class="live-sync-value">${escapeHtml(formatUiLabel(String(topProvider)))}</div>
          <div class="live-sync-copy">${escapeHtml(basisCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">신뢰도</div>
          <div class="live-sync-value">${escapeHtml(formatUiLabel(String(summary?.recommendationConfidence || "low")))}</div>
          <div class="live-sync-copy">${escapeHtml(confidenceCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">평가 범위</div>
          <div class="live-sync-value">${escapeHtml(summary?.recommendationScope === "schedule-window-weekday" ? "요일·시간대" : summary?.recommendationScope === "schedule-window" ? "알람 시간대" : "하루 전체")}</div>
          <div class="live-sync-copy">${escapeHtml(scopeCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">평가 완료 기록</div>
          <div class="live-sync-value">${escapeHtml(String(summary?.sampleCount || 0))}</div>
          <div class="live-sync-copy">
            ${escapeHtml(
              summary?.lastActualArrivalAt
                ? `마지막 실제 도착 기록: ${formatClock(new Date(summary.lastActualArrivalAt))}.`
                : "아직 실제 도착 기록이 없습니다.",
            )}
          </div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">평가 대기 예측</div>
          <div class="live-sync-value">${escapeHtml(String(summary?.pendingCount || 0))}</div>
          <div class="live-sync-copy">${escapeHtml("실제 버스 도착을 기록하면 대기 중인 예측의 정확도를 평가합니다.")}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">연결된 제공처</div>
          <div class="live-sync-value">${escapeHtml(String(configuredCandidates.length))}</div>
          <div class="live-sync-copy">${escapeHtml(configuredCandidates.map((item) => formatUiLabel(item.provider)).join(", ") || "연결된 제공처가 없습니다.")}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">제공처 간 도착시간 차이</div>
          <div class="live-sync-value">${escapeHtml(disagreementState.badge)}</div>
          <div class="live-sync-copy">${escapeHtml(disagreementState.copy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">자동 비교 조회</div>
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
                        <div class="history-title">${escapeHtml(formatUiLabel(provider.provider))}</div>
                        <div class="history-detail">${escapeHtml(
                          timeSlice?.mode === "schedule-window"
                            ? summary?.recommendationScope === "schedule-window-weekday"
                              ? `${weekdayScopeLabel} 가중 평균 오차 ${provider.weekdayTimeSliceWeightedMeanAbsoluteErrorMin ?? "-"}분 · ${provider.weekdayTimeSliceRecentSampleCount}건 최근 / ${provider.weekdayTimeSliceSampleCount}건 같은 요일·시간대 · 전체 시간대 오차 ${provider.timeSliceWeightedMeanAbsoluteErrorMin ?? "-"}분 · 종일 오차 ${provider.weightedMeanAbsoluteErrorMin ?? "-"}분 · ${provider.meetsRecommendationThreshold ? "평가 가능" : "기록 수집 중"} · ${describeAccuracyFreshness(provider, recentWindowDays)}`
                              : `${timeSlice.label} 가중 평균 오차 ${provider.timeSliceWeightedMeanAbsoluteErrorMin ?? "-"}분 · ${provider.timeSliceRecentSampleCount}건 최근 / ${provider.timeSliceSampleCount}건 시간대 · 종일 오차 ${provider.weightedMeanAbsoluteErrorMin ?? "-"}분 · ${provider.sampleCount}건 전체 · ${provider.meetsRecommendationThreshold ? "평가 가능" : "기록 수집 중"} · ${describeAccuracyFreshness(provider, recentWindowDays)}`
                            : `최근 가중 평균 오차 ${provider.weightedMeanAbsoluteErrorMin ?? "-"}분 · 단순 평균 ${provider.meanAbsoluteErrorMin ?? "-"}분 · ${provider.recentSampleCount}건 최근 / ${provider.sampleCount}건 전체 · ${provider.meetsRecommendationThreshold ? "평가 가능" : "기록 수집 중"} · ${describeAccuracyFreshness(provider, recentWindowDays)}`,
                        )}</div>
                      </div>
                      <div class="history-time">${escapeHtml(provider.activeLatestActualArrivalAt ? formatClock(new Date(provider.activeLatestActualArrivalAt)) : "-")}</div>
                    </article>
                  `,
                )
                .join("")
            : `<div class="empty-copy">${escapeHtml(accuracyMeta.lastError || "아직 제공처별 정확도 평가가 없습니다.")}</div>`
        }
      </div>
      <div class="quick-actions">
        <button class="secondary-button" data-action="probe-bus-accuracy" ${accuracyMeta.probeStatus === "loading" ? "disabled" : ""}>${accuracyMeta.probeStatus === "loading" ? "비교 조회 중…" : "연결된 제공처 비교"}</button>
        <button class="primary-cta" data-action="record-actual-arrival" ${accuracyMeta.actualStatus === "loading" ? "disabled" : ""}>
          <span>${accuracyMeta.actualStatus === "loading" ? "기록 중…" : "지금 실제 도착 기록"}</span>
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
  const leaderboard = localizeDisplayFields(accuracyMeta.leaderboard);
  const entries = Array.isArray(leaderboard?.entries) ? leaderboard.entries : [];
  const regionLabel = leaderboard?.region ? formatUiLabel(String(leaderboard.region)) : "ALL";
  const timeSlice = leaderboard?.timeSlice || null;
  const weekdayScopeLabel =
    timeSlice?.weekdayLabel && timeSlice?.label ? `${timeSlice.weekdayLabel} ${timeSlice.label}` : timeSlice?.label || "";
  const scopeCopy =
    timeSlice?.mode === "schedule-window"
      ? timeSlice?.usedWeekdayForRecommendation
        ? `기록이 충분하면 ${weekdayScopeLabel} 평가 기록을 우선 사용합니다.`
        : `기록이 충분하면 ${timeSlice.label} 평가 기록을 우선 사용합니다.`
      : "전체 도착 평가 기록을 기준으로 순위를 표시합니다.";
  const statusCopy =
    accuracyMeta.leaderboardStatus === "loading"
      ? "노선·정류장별 정확도 순위를 계산하고 있습니다…"
      : accuracyMeta.leaderboardStatus === "error"
        ? accuracyMeta.leaderboardError || "정확도 순위를 불러오지 못했습니다."
        : leaderboard?.generatedAt
          ? `${formatClock(new Date(leaderboard.generatedAt))} 기준 도착 평가 기록으로 집계했습니다.`
          : "아직 노선별 정확도 순위가 없습니다.";

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">leaderboard</span>도착시간 정확도 순위</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">지역</div>
          <div class="live-sync-value">${escapeUiMessage(regionLabel)}</div>
          <div class="live-sync-copy">${escapeUiMessage(statusCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">확인 중인 노선·정류장</div>
          <div class="live-sync-value">${escapeHtml(String(leaderboard?.totalRoutes || 0))}</div>
          <div class="live-sync-copy">${escapeHtml("평가할 기록이 충분한 노선·정류장 조합을 표시합니다.")}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">순위 기준</div>
          <div class="live-sync-value">${escapeHtml(timeSlice?.usedWeekdayForRecommendation ? "요일·시간대" : timeSlice?.mode === "schedule-window" ? "알람 시간대" : "하루 전체")}</div>
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
                        <div class="history-detail">${escapeHtml(`추천 제공처 ${formatUiLabel(String(entry.recommendedProvider || "-"))} · ${formatUiLabel(String(entry.recommendationConfidence || "low"))} 신뢰도 · ${entry.recommendationScope === "schedule-window-weekday" ? `${entry.timeSlice?.weekdayLabel || ""} ${entry.timeSlice?.label || "요일·시간대"}`.trim() : entry.recommendationScope === "schedule-window" ? entry.timeSlice?.label || "알람 시간대" : "하루 전체"} · 오차 차이 ${entry.measuredLeaderGapMin ?? "-"}분 · 최근 유효 기록 ${entry.activeRecentSampleCount ?? entry.recentSampleCount} / 전체 ${entry.sampleCount}`)}</div>
                      </div>
                      <div class="history-time">${escapeHtml(entry.lastActualArrivalAt ? formatClock(new Date(entry.lastActualArrivalAt)) : "-")}</div>
                    </article>
                  `,
                )
                .join("")
            : `<div class="empty-copy">${escapeHtml(accuracyMeta.leaderboardError || "아직 평가 기록이 부족합니다. 도착시간 비교와 실제 도착 기록을 더 모아 주세요.")}</div>`
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
    ? `${report.latestSignal.sourceLabel}의 마지막 보수적 판단 기록: ${formatClock(new Date(report.latestSignal.createdAt))}.`
    : "아직 보수적 도착시간 판단 기록이 없습니다.";
  const deepestCopy = report.deepestTrace
    ? `${report.deepestTrace.routeNumber || "노선"} · ${report.deepestTrace.stopName || "정류장"}: 현재 조회 기간에서 ${report.deepestTrace.sourceCount}단계까지 처리했습니다.`
    : "아직 보수적 판단으로 처리한 노선·정류장 기록이 없습니다.";
  const weekdayCopy = weekdayWindow.topWeekday
    ? `${weekdayWindow.windowLabel || "알람"} 시간대에 ${weekdayWindow.topWeekday.weekdayLabel}의 보수적 판단 기록이 가장 많습니다.`
    : "아직 요일별 추세가 없습니다.";
  const watchlistCopy = watchlist.topEntry
    ? `${watchlist.topEntry.routeNumber || "노선"} · ${watchlist.topEntry.stopName || "정류장"}: 최근 최우선 주의 대상으로, 알람 시간대의 보수적 판단 기록이 ${watchlist.topEntry.inWindowCount}건입니다.`
    : "최근 주의 기준에 해당하는 노선·정류장이 없습니다.";
  const rollingCopy =
    report.rollingDays && report.windowStartAt && report.windowEndAt
      ? `서버 집계 기간: 최근 ${report.rollingDays}일, 종료 시각 ${formatClock(new Date(report.windowEndAt))}.`
      : "현재 화면에 불러온 기록을 기준으로 집계합니다.";

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">shield_with_heart</span>보수적 도착시간 판단 기록</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">불러온 기록</div>
          <div class="live-sync-value">${escapeHtml(String(report.totalSignals))}</div>
          <div class="live-sync-copy">${escapeHtml(`${rollingCopy} ${latestCopy}`)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">노선·정류장 조합</div>
          <div class="live-sync-value">${escapeHtml(String(report.distinctRouteStopCount))}</div>
          <div class="live-sync-copy">${escapeHtml("최근 보수적 판단이 적용된 서로 다른 노선·정류장 조합의 수입니다.")}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">안전 여유시간 범위</div>
          <div class="live-sync-value">${escapeHtml(`${report.averageRiskBufferMin || 0} / ${report.maxRiskBufferMin || 0}`)}</div>
          <div class="live-sync-copy">${escapeHtml(`안전 여유시간의 평균 / 최댓값(분). 평균 예측 차이: ${report.averageSpreadMin ?? "-"}분.`)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">최종 처리 단계</div>
          <div class="live-sync-value">${escapeHtml(report.deepestTrace ? `${report.deepestTrace.sourceCount}/5` : "0/5")}</div>
          <div class="live-sync-copy">${escapeHtml(deepestCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">알람 시간대 기록</div>
          <div class="live-sync-value">${escapeHtml(`${weekdayWindow.inWindowCount || 0} / ${report.totalSignals || 0}`)}</div>
          <div class="live-sync-copy">${escapeHtml(`알람 시간대 ${weekdayWindow.windowLabel || `${state.schedule.startTime} - ${state.schedule.endTime}`}: ${weekdayWindow.inWindowCount || 0}건, 시간대 밖: ${weekdayWindow.outOfWindowCount || 0}.`)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">주의가 많은 요일</div>
          <div class="live-sync-value">${escapeHtml(weekdayWindow.topWeekday?.weekdayLabel || "-")}</div>
          <div class="live-sync-copy">${escapeHtml(weekdayCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">주의 노선 목록</div>
          <div class="live-sync-value">${escapeHtml(`${watchlist.highCount || 0}건 높은 주의 / ${watchlist.elevatedCount || 0}건 주의`)}</div>
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
                        <div class="history-title">${escapeHtml(`${entry.severityLabel} · ${entry.routeNumber || "노선"} · ${entry.stopName || "정류장"}`)}</div>
                        <div class="history-detail">${escapeHtml(`${entry.count}건 전체 기록 · ${entry.inWindowCount}건 해당 시간대 ${weekdayWindow.windowLabel || "알람 시간대"} · 평균 여유시간 ${entry.averageRiskBufferMin}분`)}</div>
                        <div class="history-detail">${escapeHtml(`평균 예측 차이 ${entry.averageSpreadMin ?? "-"}분 · 최대 여유시간 ${entry.maxRiskBufferMin}분 · 출처 ${entry.sourceLabels.join(", ")}`)}</div>
                      </div>
                      <div class="history-time">${escapeHtml(entry.latestAt ? formatClock(new Date(entry.latestAt)) : "-")}</div>
                    </article>
                  `,
                )
                .join("")
            : `<div class="empty-copy">최근 반복된 주의 기록이 기준을 넘은 노선·정류장이 없습니다.</div>`
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
                        <div class="history-title">${escapeHtml(`${entry.routeNumber || "노선"} · ${entry.stopName || "정류장"}`)}</div>
                        <div class="history-detail">${escapeHtml(`${entry.count} traces · 평균 여유시간 ${entry.averageRiskBufferMin}분 · 최대 ${entry.maxRiskBufferMin}분 · 평균 예측 차이 ${entry.averageSpreadMin ?? "-"}분`)}</div>
                        <div class="history-detail">${escapeHtml(`출처: ${entry.sourceLabels.join(", ")} · 최근 출처 ${entry.latestSource}`)}</div>
                      </div>
                      <div class="history-time">${escapeHtml(entry.latestAt ? formatClock(new Date(entry.latestAt)) : "-")}</div>
                    </article>
                  `,
                )
                .join("")
            : `<div class="empty-copy">보수적 판단 기록이 없습니다. 제공처별 예측 차이로 안전 여유시간이 적용되면 발생 지점과 알림 처리 단계를 표시합니다.</div>`
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
                        <div class="history-detail">${escapeHtml(`${entry.inWindowCount}건 해당 시간대 ${weekdayWindow.windowLabel || "알람 시간대"} · ${entry.outOfWindowCount}건 시간대 밖`)}</div>
                        <div class="history-detail">${escapeHtml(`평균 여유시간 ${entry.averageRiskBufferMin}분 · 평균 예측 차이 ${entry.averageSpreadMin ?? "-"}분`)}</div>
                      </div>
                      <div class="history-time">${escapeHtml(entry.latestAt ? formatClock(new Date(entry.latestAt)) : "-")}</div>
                    </article>
                  `,
                )
                .join("")
            : ""
        }
      </div>
      <div class="quick-actions-copy">서버에 저장된 최근 기간의 기록을 집계한 것으로, 전체 장기 통계는 아닙니다.</div>
    </section>
  `;
}

function renderStateSyncPanel() {
  const sourceCopy =
    persistenceMeta.source === "server" ? "설정을 계정별 서버 저장소에 저장합니다." : "현재 이 브라우저에만 저장된 설정을 사용합니다.";
  const statusCopy =
    persistenceMeta.saveStatus === "pending"
      ? "변경한 설정을 저장할 예정입니다."
      : persistenceMeta.saveStatus === "saving"
      ? "저장 중…"
      : persistenceMeta.saveStatus === "saved"
        ? persistenceMeta.lastSavedAt
          ? `저장 시각 ${escapeHtml(formatClock(new Date(persistenceMeta.lastSavedAt)))}`
          : "저장됨"
        : persistenceMeta.saveStatus === "error"
          ? persistenceMeta.lastError || "서버에 저장하지 못했습니다."
          : "변경 사항을 기다리고 있습니다.";
  const domainSourceCopy =
    domainMeta.source === "server"
      ? "프로필, 이동 경로, 일정과 알림 설정을 계정별 저장소에 동기화합니다."
      : "계정 설정을 아직 불러오지 않았습니다.";
  const domainStatusCopy =
    domainMeta.syncStatus === "pending"
      ? "계정 설정 동기화를 기다리고 있습니다."
      : domainMeta.syncStatus === "syncing"
      ? "프로필, 경로, 일정과 알림 설정을 저장하고 있습니다."
      : domainMeta.syncStatus === "synced"
        ? domainMeta.lastSyncedAt
          ? `동기화 시각 ${escapeHtml(formatClock(new Date(domainMeta.lastSyncedAt)))}`
          : "동기화됨"
        : domainMeta.syncStatus === "error"
          ? domainMeta.lastError || "계정 설정을 동기화하지 못했습니다."
          : "변경 사항을 기다리고 있습니다.";

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">cloud_sync</span>설정 저장 상태</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">저장 위치</div>
          <div class="live-sync-value">${persistenceMeta.source === "server" ? "계정별 서버" : "이 브라우저"}</div>
          <div class="live-sync-copy">${escapeUiMessage(sourceCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">저장 상태</div>
          <div class="live-sync-value">${escapeHtml(formatUiLabel(persistenceMeta.saveStatus))}</div>
          <div class="live-sync-copy">${escapeUiMessage(statusCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">계정 설정 동기화</div>
          <div class="live-sync-value">${escapeHtml(formatUiLabel(domainMeta.syncStatus))}</div>
          <div class="live-sync-copy">${escapeUiMessage(domainSourceCopy)} ${escapeUiMessage(domainStatusCopy)}</div>
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
      label: deviceMeta.tokenRegisterStatus === "sending" ? "토큰 등록 중…" : quickAction.buttonLabel,
      disabled,
      copy: disabled
        ? "먼저 기기 토큰을 입력한 뒤 다시 등록하세요."
        : "서버에서 기기 토큰 형식과 전송 준비 상태를 다시 확인합니다.",
    };
  }

  if (quickAction.action === "run-push-gateway") {
    const disabled = deviceMeta.pushGatewayDispatchStatus === "sending" || !deviceMeta.dispatchBundles.length;
    const executeMode = deviceMeta.pushGatewayConfig?.mode === "execute";
    return {
      action: quickAction.action,
      label: deviceMeta.pushGatewayDispatchStatus === "sending"
        ? executeMode
          ? "알림 전송 중…"
          : "전송 요청 준비 중…"
        : executeMode
          ? "알림 전송"
          : "전송 요청 미리보기",
      disabled,
      copy: disabled
        ? "이 전송 과정을 다시 실행하려면 현재 알림 전송 묶음이 필요합니다."
        : executeMode
          ? "실제 전송 모드입니다. 실행하면 실제 알림이 전송될 수 있습니다."
          : "미리보기 모드입니다. 실제 전송 없이 요청 내용만 준비하고 기록합니다.",
    };
  }

  if (quickAction.action === "run-push-retry-simulation") {
    const disabled = deviceMeta.pushGatewayDispatchStatus === "sending" || !deviceMeta.pushGatewayRetryPending;
    return {
      action: quickAction.action,
      label: deviceMeta.pushGatewayDispatchStatus === "sending" ? "재시도 시험 중…" : quickAction.buttonLabel,
      disabled,
      copy: disabled
        ? "재시도 대기열이 비어 있어 실행할 항목이 없습니다."
        : "시험 기능: 저장된 재시도 절차를 모의 실행합니다.",
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
    ? `${report.topSignal.sourceLabel}에서 ${formatClock(new Date(report.topSignal.createdAt))}에 가장 강한 알림 설정을 기록했습니다.`
    : "오늘 알림 강도가 기록된 알림이 없습니다.";
  const routeCopy = report.topRouteStop
    ? `${report.topRouteStop.routeNumber || "노선"} · ${report.topRouteStop.stopName || "정류장"}: 가장 강한 알림 기록이 있으며 오늘 재생 기록은 ${report.topRouteStop.count}건입니다.`
    : "집계할 알림 재생 기록이 충분한 노선·정류장이 없습니다.";
  const deliveryCopy = topAlert
    ? topAlert.deliveryOutcomeCopy
    : "알림 강도 기록이 있어야 전송 결과를 집계할 수 있습니다.";
  const averageCopy = report.totalSignals
    ? `오늘 기록된 설정 강도의 평균 점수는 ${report.averageScore}입니다.`
    : "점수는 설정된 알림 강도이며, 휴대폰에서 실제 소리가 났는지를 의미하지 않습니다.";
  const deliveryHealthCopy = outcomeBreakdown.pushVisibleCount
    ? `오늘 푸시 전송 결과가 기록된 알림은 ${outcomeBreakdown.pushVisibleCount}건이며, 그중 ${outcomeBreakdown.deliveredRatePercent}%가 전달 완료로 기록됐습니다.`
    : "오늘 실제 푸시 전송이 확인된 알림이 없습니다.";
  const attentionCopy = outcomeBreakdown.needsAttentionCount
    ? `강한 알림 ${outcomeBreakdown.needsAttentionCount}건이 재시도 대기·실패·차단 상태여서 확인이 필요합니다.`
    : "재시도 중이거나 실패·차단된 강한 알림이 없습니다.";
  const topIssueCopy = topAttentionCause
    ? `${topAttentionCause.label}: 노선·정류장 ${topAttentionCause.routeStopCount}개 조합에서 ${topAttentionCause.count}건 발생했습니다. 가장 심각한 결과는 ${topAttentionCause.highestOutcomeLabel || "확인 불가"}입니다.`
    : "오늘 반복된 문제 원인이 기록되지 않았습니다.";
  const topIssueActionCopy = topAttentionCause
    ? `${topAttentionCause.attentionActionLabel}: ${topAttentionCause.attentionActionCopy}`
    : "";
  const topAttentionCopy = topAttentionAlert
    ? `${topAttentionAlert.routeNumber ? `노선 ${topAttentionAlert.routeNumber}` : "이 알림"}${topAttentionAlert.stopName ? ` · ${topAttentionAlert.stopName}` : ""}: 강도 ${topAttentionAlert.maxScore}점, ${topAttentionAlert.deliveryOutcomeLabel} 상태로 우선 확인이 필요합니다. ${topAttentionAlert.attentionActionLabel}: ${topAttentionAlert.attentionActionCopy}`
    : "현재 추가 조치가 필요한 실패·차단·재시도 대기 알림이 없습니다.";
  const topAttentionButton = topAttentionAlert?.attentionTarget
    ? `<button class="mini-button" data-action="focus-panel" data-screen="${escapeHtml(topAttentionAlert.attentionTarget.screen)}" data-panel="${escapeHtml(topAttentionAlert.attentionTarget.panelId)}" data-panel-item-id="${escapeHtml(topAttentionAlert.attentionTarget.panelItemId || "")}" data-panel-kind="${escapeHtml(topAttentionAlert.attentionTarget.panelItemKind || "")}" data-panel-key="${escapeHtml(topAttentionAlert.attentionTarget.panelItemKey || "")}">${escapeHtml(topAttentionAlert.attentionTarget.buttonLabel)}</button>`
    : "";
  const topAttentionQuickAction = getTopAttentionQuickActionState(topAttentionAlert);
  const topAttentionQuickActionButton = topAttentionQuickAction
    ? `<button class="mini-button" data-action="${escapeHtml(topAttentionQuickAction.action)}" ${topAttentionQuickAction.disabled ? "disabled" : ""}>${escapeHtml(topAttentionQuickAction.label)}</button>`
    : "";
  const topAttentionCauseCopy = topAttentionAlert?.attentionCause
    ? `원인: ${topAttentionAlert.attentionCause.label}. ${topAttentionAlert.attentionCause.copy}`
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
              <span class="channel-badge ready">${escapeHtml(`${item.routeNumber || "노선"} · ${item.stopName || "정류장"} ${item.count}`)}</span>
            `,
          )
          .join("")
      : "";
  const topIssueMoreRoutesCopy =
    Array.isArray(topAttentionCause?.topRouteStops) && topAttentionCause.topRouteStops.length > 3
      ? `오늘 다른 노선·정류장 ${topAttentionCause.topRouteStops.length - 3}개 조합에서도 같은 문제가 있습니다.`
      : "";

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">graphic_eq</span>오늘 가장 강한 알림</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">확인된 기록</div>
          <div class="live-sync-value">${escapeHtml(String(report.totalSignals))}</div>
          <div class="live-sync-copy">${escapeHtml(`기준일 ${report.dateKey || "-"}. ${strongestCopy}`)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">최대 알림 강도</div>
          <div class="live-sync-value">${escapeHtml(String(report.maxScore || 0))}</div>
          <div class="live-sync-copy">${escapeHtml(averageCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">강화 알림 기록</div>
          <div class="live-sync-value">${escapeHtml(String(report.boostedCount || 0))}</div>
          <div class="live-sync-copy">${escapeHtml("첫 알림 강화 전송 대상으로 표시된 기록입니다.")}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">주요 노선·정류장</div>
          <div class="live-sync-value">${escapeHtml(report.topRouteStop ? `${report.topRouteStop.routeNumber || "노선"}` : "-")}</div>
          <div class="live-sync-copy">${escapeHtml(routeCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">전송 결과</div>
          <div class="live-sync-value">${escapeHtml(topAlert?.deliveryOutcomeLabel || "-")}</div>
          <div class="live-sync-copy">${escapeUiMessage(deliveryCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">푸시 전송 확인 알림</div>
          <div class="live-sync-value">${escapeHtml(String(outcomeBreakdown.pushVisibleCount || 0))}</div>
          <div class="live-sync-copy">${escapeHtml(deliveryHealthCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">확인 필요</div>
          <div class="live-sync-value">${escapeHtml(String(outcomeBreakdown.needsAttentionCount || 0))}</div>
          <div class="live-sync-copy">${escapeHtml(attentionCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">우선 확인 알림</div>
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
          <div class="live-sync-label">주요 문제</div>
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
          <div class="live-sync-label">서버 처리만 확인</div>
          <div class="live-sync-value">${escapeHtml(String(outcomeBreakdown.upstreamOnlyCount || 0))}</div>
          <div class="live-sync-copy">${escapeHtml("서버 처리나 모의 실행 기록만 확인된 알림이며, 실제 푸시 전송 결과는 확인되지 않았습니다.")}</div>
        </article>
      </div>
      ${
        report.sourceBreakdown.length
          ? `
            <div class="channel-badge-row">
              ${report.sourceBreakdown
                .map(
                  (item) => `
                    <span class="channel-badge ready">${escapeHtml(`${item.sourceLabel} ${item.count} · 최대 ${item.maxScore}`)}</span>
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
      <div class="field-help">이 순위는 설정된 알림 강도만 비교합니다. 휴대폰에서 실제로 소리나 진동이 발생했다는 뜻은 아닙니다.</div>
      <div class="history-list">
        ${
          report.alertLeaders.length
            ? report.alertLeaders
                .slice(0, 4)
                .map(
                  (alert) => `
                    <article class="history-item">
                      <div class="history-main">
                        <div class="history-title">${escapeHtml(`${alert.deliveryOutcomeLabel} · ${alert.title || alert.routeNumber || "알림 처리 기록"}`)}</div>
                        <div class="history-detail">${escapeHtml(
                          [
                            alert.routeNumber ? `노선 ${alert.routeNumber}` : "",
                            alert.stopName || "",
                            alert.riskLevel || "",
                            `강도 점수 ${alert.maxScore}`,
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
            : `<div class="empty-copy">오늘 알림 강도 기록이 없습니다.</div>`
        }
      </div>
    </section>
  `;
}

function renderAlarmPlanPanel() {
  if (alarmPlanMeta.status === "loading" && !alarmPlanMeta.plan) {
    return `
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">event_upcoming</span>오늘의 알람 계획</div>
        <div class="empty-copy">오늘 남은 알람을 계산하고 있습니다.</div>
      </section>
    `;
  }

  if (alarmPlanMeta.status === "error" && !alarmPlanMeta.plan) {
    return `
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">event_upcoming</span>오늘의 알람 계획</div>
        <div class="empty-copy">${escapeHtml(alarmPlanMeta.lastError || "알람 계획을 불러오지 못했습니다.")}</div>
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
      ? "최신 설정으로 갱신하고 있습니다…"
      : alarmPlanMeta.lastLoadedAt
        ? `갱신 시각 ${escapeHtml(formatClock(new Date(alarmPlanMeta.lastLoadedAt)))}`
        : "준비됨";
  const precheckCopy =
    alarmPlanMeta.plan.precheckTriggerCount && stabilityWatch.precheckTriggerAt
      ? `주의 노선: 알람 시간대 ${stabilityWatch.precheckLeadMin || 0}분 전에 사전 점검합니다.`
      : stabilityWatch.level === "high"
        ? "주의 노선이지만 알람 시간대가 이미 시작되어 추가 사전 점검은 생략합니다."
        : "추가 사전 점검이 예정되어 있지 않습니다.";

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">event_upcoming</span>오늘의 알람 계획</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">남은 알람</div>
          <div class="live-sync-value">${escapeHtml(String(alarmPlanMeta.plan.remainingTriggers))}</div>
          <div class="live-sync-copy">${escapeHtml(alarmPlanMeta.plan.todayStatus.detail)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">다음 알람</div>
          <div class="live-sync-value">${nextTrigger ? escapeHtml(formatClock(new Date(nextTrigger.triggerAt))) : "-"}</div>
          <div class="live-sync-copy">${escapeUiMessage(statusCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">도착정보 사전 점검</div>
          <div class="live-sync-value">${alarmPlanMeta.plan.precheckTriggerCount ? `+${escapeHtml(String(alarmPlanMeta.plan.precheckTriggerCount))}` : "꺼짐"}</div>
          <div class="live-sync-copy">${escapeHtml(precheckCopy)}</div>
        </article>
      </div>
      <div class="history-list">
        ${
          alarmPlanMeta.plan.triggers.length
            ? alarmPlanMeta.plan.triggers.slice(0, 4).map(
                (trigger) => `
                  <article class="history-item" data-focus-kind="alarm-trigger" data-focus-key="${escapeHtml(trigger.triggerAt || "")}">
                    <div class="history-main">
                      <div class="history-title">${escapeHtml(formatClock(new Date(trigger.triggerAt)))} · ${escapeUiMessage(trigger.triggerKind === "stability-precheck" ? "PRECHECK" : trigger.notificationSpec.riskLevel)}</div>
                      <div class="history-detail">${escapeHtml(trigger.notificationSpec.body)}</div>
                      ${renderDeliveryPriorityLine(trigger)}
                      ${renderPlaybackIntensityLine(trigger)}
                    </div>
                    <div class="history-time">${escapeHtml(trigger.arrivalsMin.join("/"))}m</div>
                  </article>
                `,
              ).join("")
            : `<div class="empty-copy">오늘 남은 알람이 없습니다.</div>`
        }
      </div>
    </section>
  `;
}

function renderBottomNav(screen) {
  const items = [
    { id: "home", label: "홈", icon: "dashboard" },
    { id: "schedule", label: "일정", icon: "event_repeat" },
    { id: "settings", label: "설정", icon: "tune" },
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
        <div class="stack-title"><span class="material-symbols-outlined">memory</span>서버 알람 처리 상태</div>
        <div class="empty-copy">서버에서 현재 울릴 알람이 있는지 확인하고 있습니다.</div>
      </section>
    `;
  }

  if (alarmRuntimeMeta.status === "error" && !alarmRuntimeMeta.runtime) {
    return `
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">memory</span>서버 알람 처리 상태</div>
        <div class="empty-copy">${escapeHtml(alarmRuntimeMeta.lastError || "알람 처리 상태를 불러오지 못했습니다.")}</div>
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
      ? "알람 처리 상태를 갱신하고 있습니다…"
      : alarmRuntimeMeta.lastLoadedAt
        ? `갱신 시각 ${escapeHtml(formatClock(new Date(alarmRuntimeMeta.lastLoadedAt)))}`
        : "준비됨";
  const nextTriggerCopy = runtime.nextTriggerAt ? escapeHtml(formatClock(new Date(runtime.nextTriggerAt))) : "-";
  const eventSyncCopy =
    alarmRuntimeMeta.eventSyncStatus === "sending"
      ? "최근 앱 이용 기록을 서버에 저장하고 있습니다."
      : alarmRuntimeMeta.eventSyncStatus === "error"
        ? alarmRuntimeMeta.eventSyncError || "서버 기록 저장에 실패했습니다."
        : alarmRuntimeMeta.eventSyncStatus === "sent"
          ? "최근 앱 이용 기록을 서버에 저장했습니다."
          : "앱 이용 기록을 서버에 저장합니다.";

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">memory</span>서버 알람 처리 상태</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">처리 상태</div>
          <div class="live-sync-value">${escapeHtml(formatUiLabel(String(runtime.status || "idle")))}</div>
          <div class="live-sync-copy">${plan ? escapeHtml(plan.todayStatus.detail) : "진행 중인 알람 계획이 없습니다."}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">다음 알람</div>
          <div class="live-sync-value">${nextTriggerCopy}</div>
          <div class="live-sync-copy">${escapeUiMessage(statusCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">오늘 발생한 알람</div>
          <div class="live-sync-value">${escapeHtml(String(runtime.firedCountToday || 0))}</div>
          <div class="live-sync-copy">${escapeUiMessage(eventSyncCopy)}</div>
        </article>
      </div>
      ${
        runtime.lastEvent
          ? `
            <div class="sample-copy">
              최근 서버 알람: ${escapeUiMessage(runtime.lastEvent.title)} · ${escapeHtml(formatClock(new Date(runtime.lastEvent.createdAt)))}
            </div>
          `
          : `<div class="sample-copy">오늘 서버에서 발생한 알람이 없습니다.</div>`
      }
    </section>
  `;
}

function renderActiveAlarmPanel() {
  const delivery = alarmRuntimeMeta.delivery;
  if (!delivery?.currentAlert) {
    return `
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">notifications_active</span>응답 대기 알람</div>
        <div class="empty-copy">현재 응답을 기다리는 서버 알람이 없습니다.</div>
      </section>
    `;
  }

  const alert = delivery.currentAlert;
  const statusCopy =
    alert.status === "SNOOZED" && alert.snoozedUntil
      ? `다시 울릴 시각 ${escapeHtml(formatClock(new Date(alert.snoozedUntil)))}`
      : "서버에서 이 알람에 대한 응답을 기다리고 있습니다.";
  const actionCopy =
    alarmRuntimeMeta.actionStatus === "sending"
      ? "서버에 요청을 보내고 있습니다…"
      : alarmRuntimeMeta.actionStatus === "error"
        ? alarmRuntimeMeta.actionError || "알람 요청을 처리하지 못했습니다."
        : "출발했는지, 1분 뒤 다시 알림을 받을지 선택하세요.";
  const playbackCopy = getPlaybackStatusCopy();

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">notifications_active</span>응답 대기 알람</div>
      <div class="preview-card delivery-card">
        <div class="preview-label">${escapeUiMessage(alert.riskLevel || "INFO")} · ${escapeUiMessage(alert.status || "ACTIVE")}</div>
        <div class="preview-title">${escapeHtml(alert.title || "현재 알람")}</div>
        <div class="support-copy">${escapeHtml(alert.detail || "진행 중인 알람 정보가 없습니다.")}</div>
        ${renderDeliveryPriorityLine(alert, "sample-copy")}
        ${renderPlaybackIntensityLine(alert, "sample-copy")}
        ${renderConservativeContextLine(alert, "sample-copy")}
        <div class="sample-copy">
          알람 발생 시각 ${escapeHtml(formatClock(new Date(alert.createdAt)))} · ${escapeUiMessage(statusCopy)}
        </div>
        <div class="quick-actions delivery-actions">
          <button class="primary-cta" data-action="ack-active-alarm">
            <span>출발했어요</span>
            <span class="material-symbols-outlined">directions_bus</span>
          </button>
          <button class="secondary-button" data-action="snooze-active-alarm">1분 뒤 다시 알림</button>
        </div>
        <div class="quick-actions-copy">${escapeUiMessage(actionCopy)}</div>
        <div class="sample-copy">${escapeUiMessage(playbackCopy)}</div>
      </div>
    </section>
  `;
}

function renderDispatchQueuePanel() {
  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">send_to_mobile</span>알림 전송 대기열</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">전송 묶음</div>
          <div class="live-sync-value">${escapeHtml(String(deviceMeta.dispatchTotal || 0))}</div>
          <div class="live-sync-copy">
            ${
              deviceMeta.dispatchLastLoadedAt
                ? `갱신 시각 ${escapeHtml(formatClock(new Date(deviceMeta.dispatchLastLoadedAt)))}`
                : "아직 알림 전송 묶음을 불러오지 않았습니다."
            }
          </div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">기기</div>
          <div class="live-sync-value">${escapeHtml(formatUiLabel(String(state.device.platform || "android")))}</div>
          <div class="live-sync-copy">${escapeUiMessage(state.device.deviceName || "기본 휴대폰")}</div>
        </article>
      </div>
      <div class="history-list">
        ${
          deviceMeta.dispatchBundles.length
            ? deviceMeta.dispatchBundles.map(
                (bundle) => `
                  <article class="history-item">
                    <div class="history-main">
                      <div class="history-title">${escapeHtml(bundle.title || "알림 전송 묶음")} · ${escapeUiMessage(bundle.riskLevel || "INFO")}</div>
                      <div class="history-detail">
                        ${escapeHtml(`${bundle.summary?.queued || 0}건 대기 / ${bundle.summary?.blocked || 0}건 차단 / ${bundle.summary?.disabled || 0}건 꺼짐`)}
                      </div>
                      <div class="channel-badge-row">
                        ${(Array.isArray(bundle.channels) ? bundle.channels : [])
                          .slice(0, 6)
                          .map(
                            (channel) => `
                              <span class="channel-badge ${String(channel.status || "").toLowerCase()}">${escapeUiMessage(channel.label)} · ${escapeUiMessage(channel.status || "UNKNOWN")}</span>
                            `,
                          )
                          .join("")}
                      </div>
                    </div>
                    <div class="history-time">${escapeHtml(formatClock(new Date(bundle.createdAt)))}</div>
                  </article>
                `,
              ).join("")
            : `<div class="empty-copy">${escapeHtml(deviceMeta.dispatchError || "생성된 알림 전송 묶음이 없습니다.")}</div>`
        }
      </div>
    </section>
  `;
}

function renderDispatchExecutionPanel() {
  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">sms</span>알림 전송 처리</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">시도 횟수</div>
          <div class="live-sync-value">${escapeHtml(String(deviceMeta.dispatchExecutionTotal || 0))}</div>
          <div class="live-sync-copy">
            ${
              deviceMeta.dispatchExecutionLastLoadedAt
                ? `실행 시각 ${escapeHtml(formatClock(new Date(deviceMeta.dispatchExecutionLastLoadedAt)))}`
                : "기록된 전송 처리 결과가 없습니다."
            }
          </div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">최근 결과</div>
          <div class="live-sync-value">${escapeUiMessage(deviceMeta.dispatchExecutions[0]?.riskLevel || "IDLE")}</div>
          <div class="live-sync-copy">
            ${
              deviceMeta.dispatchExecutions[0]
                ? escapeHtml(deviceMeta.dispatchExecutions[0].title || "알림 전송 처리가 준비됐습니다.")
                : escapeHtml(deviceMeta.dispatchExecutionError || "첫 알림 전송 묶음을 기다리고 있습니다.")
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
                      <div class="history-title">${escapeHtml(attempt.title || "알림 전송 처리")} · ${escapeUiMessage(attempt.riskLevel || "INFO")}</div>
                      <div class="history-detail">
                        ${escapeHtml(`${attempt.summary?.simulated_sent || 0}건 모의 전송 / ${attempt.summary?.failed || 0}건 실패 / ${attempt.summary?.skipped || 0}건 생략`)}
                      </div>
                      <div class="channel-badge-row">
                        ${(Array.isArray(attempt.channels) ? attempt.channels : [])
                          .slice(0, 6)
                          .map(
                            (channel) => `
                              <span class="channel-badge ${String(channel.executionStatus || "").toLowerCase()}">${escapeUiMessage(channel.label)} · ${escapeUiMessage(channel.executionStatus || "UNKNOWN")}</span>
                            `,
                          )
                          .join("")}
                      </div>
                    </div>
                    <div class="history-time">${escapeHtml(formatClock(new Date(attempt.executedAt)))}</div>
                  </article>
                `,
              ).join("")
            : `<div class="empty-copy">${escapeHtml(deviceMeta.dispatchExecutionError || "모의 실행한 알림 전송이 없습니다.")}</div>`
        }
      </div>
    </section>
  `;
}

function renderDispatchQueuePanelStageAware() {
  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">send_to_mobile</span>알림 전송 대기열</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">전송 묶음</div>
          <div class="live-sync-value">${escapeHtml(String(deviceMeta.dispatchTotal || 0))}</div>
          <div class="live-sync-copy">
            ${
              deviceMeta.dispatchLastLoadedAt
                ? `갱신 시각 ${escapeHtml(formatClock(new Date(deviceMeta.dispatchLastLoadedAt)))}`
                : "아직 알림 전송 묶음을 불러오지 않았습니다."
            }
          </div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">기기</div>
          <div class="live-sync-value">${escapeHtml(formatUiLabel(String(state.device.platform || "android")))}</div>
          <div class="live-sync-copy">${escapeUiMessage(state.device.deviceName || "기본 휴대폰")}</div>
        </article>
      </div>
      <div class="history-list">
        ${
          deviceMeta.dispatchBundles.length
            ? deviceMeta.dispatchBundles.map(
                (bundle) => `
                  <article class="history-item">
                    <div class="history-main">
                      <div class="history-title">${escapeHtml(bundle.title || "알림 전송 묶음")} · ${escapeUiMessage(bundle.riskLevel || "INFO")} · ${escapeHtml(bundle.escalationLabel || "첫 알림")}</div>
                      <div class="history-detail">
                        ${escapeHtml(`${bundle.summary?.queued || 0}건 대기 / ${bundle.summary?.blocked || 0}건 차단 / ${bundle.summary?.disabled || 0}건 꺼짐 / +${bundle.secondsSinceTrigger || 0}초`)}
                      </div>
                      ${renderDeliveryPriorityLine(bundle)}
                      ${renderPlaybackIntensityLine(bundle)}
                      ${renderConservativeContextLine(bundle)}
                      <div class="channel-badge-row">
                        ${(Array.isArray(bundle.channels) ? bundle.channels : [])
                          .slice(0, 6)
                          .map(
                            (channel) => `
                              <span class="channel-badge ${String(channel.status || "").toLowerCase()}">${escapeUiMessage(channel.label)} · ${escapeUiMessage(channel.status || "UNKNOWN")}</span>
                            `,
                          )
                          .join("")}
                      </div>
                    </div>
                    <div class="history-time">${escapeHtml(formatClock(new Date(bundle.createdAt)))}</div>
                  </article>
                `,
              ).join("")
            : `<div class="empty-copy">${escapeHtml(deviceMeta.dispatchError || "생성된 알림 전송 묶음이 없습니다.")}</div>`
        }
      </div>
    </section>
  `;
}

function renderDispatchExecutionPanelStageAware() {
  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">sms</span>알림 전송 처리</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">시도 횟수</div>
          <div class="live-sync-value">${escapeHtml(String(deviceMeta.dispatchExecutionTotal || 0))}</div>
          <div class="live-sync-copy">
            ${
              deviceMeta.dispatchExecutionLastLoadedAt
                ? `실행 시각 ${escapeHtml(formatClock(new Date(deviceMeta.dispatchExecutionLastLoadedAt)))}`
                : "기록된 전송 처리 결과가 없습니다."
            }
          </div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">최근 결과</div>
          <div class="live-sync-value">${escapeUiMessage(deviceMeta.dispatchExecutions[0]?.riskLevel || "IDLE")}</div>
          <div class="live-sync-copy">
            ${
              deviceMeta.dispatchExecutions[0]
                ? escapeHtml(deviceMeta.dispatchExecutions[0].title || "알림 전송 처리가 준비됐습니다.")
                : escapeHtml(deviceMeta.dispatchExecutionError || "첫 알림 전송 묶음을 기다리고 있습니다.")
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
                      <div class="history-title">${escapeHtml(attempt.title || "알림 전송 처리")} · ${escapeUiMessage(attempt.riskLevel || "INFO")} · ${escapeHtml(attempt.escalationLabel || "첫 알림")}</div>
                      <div class="history-detail">
                        ${escapeHtml(`${attempt.summary?.simulated_sent || 0}건 모의 전송 / ${attempt.summary?.failed || 0}건 실패 / ${attempt.summary?.skipped || 0}건 생략 / +${attempt.secondsSinceTrigger || 0}초`)}
                      </div>
                      ${renderDeliveryPriorityLine(attempt)}
                      ${renderPlaybackIntensityLine(attempt)}
                      ${renderConservativeContextLine(attempt)}
                      <div class="channel-badge-row">
                        ${(Array.isArray(attempt.channels) ? attempt.channels : [])
                          .slice(0, 6)
                          .map(
                            (channel) => `
                              <span class="channel-badge ${String(channel.executionStatus || "").toLowerCase()}">${escapeUiMessage(channel.label)} · ${escapeUiMessage(channel.executionStatus || "UNKNOWN")}</span>
                            `,
                          )
                          .join("")}
                      </div>
                    </div>
                    <div class="history-time">${escapeHtml(formatClock(new Date(attempt.executedAt)))}</div>
                  </article>
                `,
              ).join("")
            : `<div class="empty-copy">${escapeHtml(deviceMeta.dispatchExecutionError || "모의 실행한 알림 전송이 없습니다.")}</div>`
        }
      </div>
    </section>
  `;
}

function renderPushAdapterPreviewPanel() {
  const preview = deviceMeta.pushPreview;
  const statusLabel = formatUiLabel(String(preview?.status || "idle"));
  const adapterLabel = formatUiLabel(String(preview?.adapter || "fcm"));
  const envelopeJson = preview?.envelope ? JSON.stringify(preview.envelope, null, 2) : "";
  const detailCopy =
    preview?.reason ||
    deviceMeta.pushPreviewError ||
    "서버에서 아직 푸시 전송 요청을 준비하지 않았습니다.";

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">quickreply</span>푸시 요청 미리보기</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">상태</div>
          <div class="live-sync-value">${escapeHtml(statusLabel)}</div>
          <div class="live-sync-copy">${escapeUiMessage(detailCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">전송 방식</div>
          <div class="live-sync-value">${escapeHtml(adapterLabel)}</div>
          <div class="live-sync-copy">
            ${
              preview?.target?.tokenMasked
                ? `토큰 ${escapeHtml(preview.target.tokenMasked)}`
                : "등록된 토큰이 없습니다."
            }
          </div>
        </article>
      </div>
      <div class="sample-copy">
        ${
          deviceMeta.pushPreviewLoadedAt
            ? `갱신 시각 ${escapeHtml(formatClock(new Date(deviceMeta.pushPreviewLoadedAt)))}`
            : "첫 전송 미리보기를 기다리고 있습니다."
        }
      </div>
      ${
        envelopeJson
          ? `<pre class="payload-preview">${escapeHtml(envelopeJson)}</pre>`
          : `<div class="empty-copy">${escapeUiMessage(detailCopy)}</div>`
      }
    </section>
  `;
}

function renderFcmAuthPanel() {
  const auth = deviceMeta.fcmAuthStatus;
  const strategy = formatUiLabel(String(auth?.authStrategy || "none"));
  const tokenStatus = formatUiLabel(String(auth?.accessTokenStatus || "idle"));
  const detailCopy =
    auth?.reason ||
    deviceMeta.fcmAuthStatusError ||
    (auth?.accessTokenStatus === "ready"
      ? auth?.accessTokenExpiresAt
        ? `인증 토큰 유효 시각: ${formatClock(new Date(auth.accessTokenExpiresAt))}.`
        : "직접 입력한 인증 토큰이 준비됐습니다."
      : "구글 푸시 인증 상태를 아직 확인하지 않았습니다.");

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">verified_user</span>구글 푸시(FCM) 인증 상태</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">인증 방식</div>
          <div class="live-sync-value">${escapeHtml(strategy)}</div>
          <div class="live-sync-copy">${escapeHtml(auth?.serviceAccountEmail || auth?.serviceAccountFilePath || "서비스 계정이 설정되지 않았습니다.")}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">인증 토큰</div>
          <div class="live-sync-value">${escapeHtml(tokenStatus)}</div>
          <div class="live-sync-copy">${escapeUiMessage(detailCopy)}</div>
        </article>
      </div>
      <div class="sample-copy">
        ${
          auth?.projectId
            ? `프로젝트 ${escapeHtml(auth.projectId)} · ${escapeHtml(formatUiLabel(String(auth.accessTokenCacheStatus || "none")))}`
            : "구글 푸시 프로젝트가 아직 설정되지 않았습니다."
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
      pushHistory("푸시 전송 확인", payload?.attempt?.reason || "제공처로 보낸 전송 요청을 기록했습니다.");
      queueAlarmRuntimeRefresh(0);
      render();
    })
    .catch((error) => {
      deviceMeta.pushGatewayDispatchStatus = "error";
      deviceMeta.pushGatewayDispatchError = userErrorMessage(error, "푸시 전송 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      render();
    });
}

function runPushGatewayTestBundle() {
  deviceMeta.pushGatewayDispatchStatus = "sending";
  deviceMeta.pushGatewayDispatchError = "";
  render();

  runPushGatewayTestDispatch({
    routeNumber: state.live.routeNumber || state.live.routeId || state.commute.primaryLineId || "1002",
    stopName: state.live.stationName || state.commute.selectedStopId || "등록된 정류장",
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
      pushHistory("시험 알림 확인", payload?.attempt?.reason || "시험 알림 전송 요청을 기록했습니다.");
      queueAlarmRuntimeRefresh(0);
      render();
    })
    .catch((error) => {
      deviceMeta.pushGatewayDispatchStatus = "error";
      deviceMeta.pushGatewayDispatchError = userErrorMessage(error, "시험 알림 전송 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
    stopName: state.live.stationName || state.commute.selectedStopId || "등록된 정류장",
    riskLevel: "RED",
  })
    .then((payload) => {
      deviceMeta.pushGatewayDispatchStatus = "sent";
      deviceMeta.pushGatewayDispatchError = "";
      applyPushGatewaySummary(payload?.pushGateway || {}, payload?.savedAt || new Date().toISOString());
      const historyTitle =
        action === "seed-retryable-failure"
          ? "재시도 시험 준비 완료"
          : action === "clear-simulation"
            ? "재시도 시험 기록 초기화"
            : outcome === "hard-failure"
              ? "재시도를 영구 실패로 모의 실행"
              : outcome === "retryable-failure"
                ? "재시도를 일시 실패로 모의 실행"
                : "재시도를 성공으로 모의 실행";
      pushHistory(historyTitle, payload?.attempt?.reason || "재시도 모의 실행을 완료했습니다.");
      queueAlarmRuntimeRefresh(0);
      render();
    })
    .catch((error) => {
      deviceMeta.pushGatewayDispatchStatus = "error";
      deviceMeta.pushGatewayDispatchError = userErrorMessage(error, "재시도 모의 실행 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      render();
    });
}

function renderPushGatewayPanel() {
  const config = deviceMeta.pushGatewayConfig;
  const activeAdapter = String(deviceMeta.pushPreview?.adapter || "fcm");
  const adapterConfig = config?.adapters?.[activeAdapter] || null;
  const adapterStrategy =
    activeAdapter === "fcm" ? formatUiLabel(String(adapterConfig?.authStrategy || "none")) : "DRY_RUN";
  const nextRetryPriorityClass = String(deviceMeta.pushGatewayNextRetryDeliveryPriorityClass || "").trim().toLowerCase();
  const standardBackoff = Array.isArray(deviceMeta.pushGatewayPriorityBackoffSeconds?.standard)
    ? deviceMeta.pushGatewayPriorityBackoffSeconds.standard
    : deviceMeta.pushGatewayRetryBackoffSeconds;
  const boostedBackoff = Array.isArray(deviceMeta.pushGatewayPriorityBackoffSeconds?.boosted)
    ? deviceMeta.pushGatewayPriorityBackoffSeconds.boosted
    : [];
  const statusCopy =
    deviceMeta.pushGatewayDispatchStatus === "sending"
      ? "전송 요청을 보내거나 기록하고 있습니다…"
      : deviceMeta.pushGatewayDispatchStatus === "error"
        ? deviceMeta.pushGatewayDispatchError || "푸시 전송 요청을 처리하지 못했습니다."
          : deviceMeta.pushGatewayDispatchStatus === "sent"
            ? deviceMeta.pushGatewayLastAttemptAt
              ? `마지막 확인 ${escapeHtml(formatClock(new Date(deviceMeta.pushGatewayLastAttemptAt)))}`
              : "최근 푸시 전송 시도를 기록했습니다."
          : "새 알림 전송 묶음은 자동 처리됩니다. 직접 모의 실행하거나 시험 알림을 보낼 수도 있습니다.";

  return `
    <section class="stack-panel" id="push-gateway-panel">
      <div class="stack-title"><span class="material-symbols-outlined">outgoing_mail</span>푸시 전송</div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">동작 모드</div>
          <div class="live-sync-value">${escapeHtml(formatUiLabel(String(config?.mode || "preview")))}</div>
          <div class="live-sync-copy">${escapeUiMessage(statusCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">사용 중인 전송 방식</div>
          <div class="live-sync-value">${escapeHtml(formatUiLabel(activeAdapter))}</div>
          <div class="live-sync-copy">
            ${escapeHtml(
              adapterConfig?.configured
                ? adapterConfig.executeSupported
                  ? `${adapterStrategy} 방식의 인증 정보가 설정되어 있습니다.`
                  : adapterConfig.limitation || "이 전송 방식은 현재 미리보기만 지원합니다."
                : deviceMeta.pushGatewayConfigError || "이 전송 방식에 필요한 인증 정보가 없습니다.",
            )}
          </div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">자동 처리</div>
          <div class="live-sync-value">${escapeHtml(String(deviceMeta.pushGatewayHandledDispatchKeys || 0))}</div>
          <div class="live-sync-copy">
            ${
              deviceMeta.pushGatewayDateKey
                ? `${escapeHtml(deviceMeta.pushGatewayDateKey)}에 자동 처리한 전송 항목입니다.`
                : "오늘 자동 푸시 전송 기록이 없습니다."
            }
          </div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">재시도 대기열</div>
          <div class="live-sync-value">${escapeHtml(String(deviceMeta.pushGatewayRetryPending || 0))}</div>
          <div class="live-sync-copy">
            ${
              deviceMeta.pushGatewayNextRetryAt
                ? `${
                    nextRetryPriorityClass === "boosted" ? "다음 첫 알림 강화 전송 재시도" : "다음 재시도"
                  } at ${escapeHtml(formatClock(new Date(deviceMeta.pushGatewayNextRetryAt)))}.`
                : "전송에 실패한 요청만 재시도하며, 현재 대기 중인 항목은 없습니다."
            }
          </div>
        </article>
      </div>
      <div class="sample-copy">
        자동 재시도는 네트워크 오류, 요청 한도 초과(429), 서버 오류(5xx) 같은 일시 오류에만 실행됩니다.
        ${
          standardBackoff.length
            ? ` 기본 재시도: ${escapeHtml(standardBackoff.join("s / "))}s.`
            : ""
        }
        ${
          boostedBackoff.length
            ? ` 첫 알림 강화 재시도: ${escapeHtml(boostedBackoff.join("s / "))}s.`
            : ""
        }
      </div>
      ${
        deviceMeta.pushGatewayBoostedRetryPending
          ? `<div class="quick-actions-copy">${escapeHtml(`변동이 큰 노선의 재시도 ${deviceMeta.pushGatewayBoostedRetryPending}건에 첫 알림 강화 기준을 적용합니다.`)}</div>`
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
                        <div class="retry-queue-title">${escapeHtml(item.title || `${item.routeNumber || "노선"} 재시도`)}</div>
                        <div class="retry-queue-copy">
                          ${escapeHtml(
                            [
                              item.routeNumber ? `노선 ${item.routeNumber}` : "",
                              item.stopName || "",
                              item.escalationLabel || "",
                              Number(item.retryAttempt) ? `시도 ${item.retryAttempt}` : "",
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
                ? "현재 알림 전송"
                : "현재 전송 요청 미리보기"
              : "전송할 알림 없음"
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
          ${deviceMeta.pushGatewayDispatchStatus === "sending" ? "시험 알림 전송 중…" : "시험 알림 보내기"}
        </button>
      </div>
      <div class="quick-actions">
        ${
          state.device.platform === "web"
            ? `<button class="soft-button wide" data-action="subscribe-web-push" ${deviceMeta.tokenRegisterStatus === "sending" ? "disabled" : ""}>
                 ${deviceMeta.tokenRegisterStatus === "sending" ? "브라우저 알림 등록 중…" : "브라우저 푸시 알림 켜기"}
               </button>`
            : ""
        }
        <button
          class="soft-button wide"
          data-action="seed-push-retry-simulation"
          ${deviceMeta.pushGatewayDispatchStatus === "sending" ? "disabled" : ""}
        >
          ${deviceMeta.pushGatewayDispatchStatus === "sending" ? "재시도 시험 준비 중…" : "일시 실패 모의 실행"}
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
          ${deviceMeta.pushGatewayDispatchStatus === "sending" ? "대기 중인 재시도 실행 중…" : "대기 중인 재시도 실행"}
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
          ${deviceMeta.pushGatewayDispatchStatus === "sending" ? "영구 실패 시험 중…" : "재시도 시험: 요청 오류(400)"}
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
          ${deviceMeta.pushGatewayDispatchStatus === "sending" ? "서버 오류 시험 중…" : "재시도 시험: 서버 오류(503)"}
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
          ${deviceMeta.pushGatewayDispatchStatus === "sending" ? "시험 기록 초기화 중…" : "모의 실행 기록 초기화"}
        </button>
      </div>
      <div class="history-list">
        ${
          deviceMeta.pushGatewayAttempts.length
            ? deviceMeta.pushGatewayAttempts.map(
                (attempt) => `
                  <article class="history-item">
                    <div class="history-main">
                      <div class="history-title">${escapeHtml(attempt.title || "푸시 전송 시도")} · ${escapeUiMessage(attempt.status || "UNKNOWN")}</div>
                      <div class="history-detail">
                        ${escapeUiMessage(attempt.reason || "상세 정보가 없습니다.")}
                        ${
                          attempt.routeNumber || attempt.stopName
                            ? `<br /><span>${escapeHtml(
                                [attempt.routeNumber ? `노선 ${attempt.routeNumber}` : "", attempt.stopName || ""]
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
                        <span class="channel-badge ${String(attempt.adapter || "").toLowerCase()}">${escapeHtml(formatUiLabel(String(attempt.adapter || "adapter")))}</span>
                        <span class="channel-badge ${String(attempt.mode || "").toLowerCase()}">${escapeHtml(formatUiLabel(String(attempt.mode || "preview")))}</span>
                        <span class="channel-badge ${String(attempt.origin || "").toLowerCase()}">${escapeHtml(formatUiLabel(String(attempt.origin || "manual")))}</span>
                        ${
                          Number(attempt.retryAttempt) > 0
                            ? `<span class="channel-badge test">재시도 ${escapeHtml(String(attempt.retryAttempt))}회</span>`
                            : ""
                        }
                        ${
                          attempt.response?.authSource
                            ? `<span class="channel-badge ready">${escapeHtml(formatUiLabel(String(attempt.response.authSource)))}</span>`
                            : ""
                        }
                      </div>
                    </div>
                    <div class="history-time">${escapeHtml(formatClock(new Date(attempt.createdAt)))}</div>
                  </article>
                `,
              ).join("")
            : `<div class="empty-copy">${escapeHtml(deviceMeta.pushGatewayAttemptsError || "푸시 전송 시도 기록이 없습니다.")}</div>`
        }
      </div>
    </section>
  `;
}

function renderDeviceDeliveryPanel() {
  const tokenHealth = deviceMeta.tokenHealth;
  const deviceStatusCopy =
    deviceMeta.syncStatus === "pending"
      ? "기기 설정 동기화를 기다리고 있습니다."
      : deviceMeta.syncStatus === "syncing"
        ? "기기 알림 설정을 저장하고 있습니다."
        : deviceMeta.syncStatus === "synced"
          ? deviceMeta.lastSyncedAt
            ? `동기화 시각 ${escapeHtml(formatClock(new Date(deviceMeta.lastSyncedAt)))}`
            : "동기화됨"
          : deviceMeta.syncStatus === "error"
            ? deviceMeta.lastError || "기기 설정을 저장하지 못했습니다."
            : "변경 사항을 기다리고 있습니다.";
  const tokenStatusCopy =
    deviceMeta.tokenRegisterStatus === "sending"
      ? "토큰 형식을 확인하고 서버에 등록하고 있습니다."
      : deviceMeta.tokenRegisterStatus === "error"
        ? deviceMeta.tokenRegisterError || "기기 토큰을 등록하지 못했습니다."
        : tokenHealth?.reason || deviceMeta.tokenHealthError || "기기 토큰을 등록하면 해당 기기에서 사용할 수 있는 형식인지 확인합니다.";
  const tokenActionCopy =
    tokenHealth?.recommendedAction || "실제 기기에서 발급받은 토큰을 입력한 뒤 등록하세요.";

  return `
    <section class="stack-panel" id="device-delivery-panel">
      <div class="stack-title"><span class="material-symbols-outlined">smartphone</span>기기 알림 설정</div>
      <div class="field-grid">
        <label class="field-block">
          <span>기기 이름</span>
          <input type="text" value="${escapeUiMessage(state.device.deviceName)}" data-field="device.deviceName" />
        </label>
        <label class="field-block">
          <span>기기 종류</span>
          <select data-field="device.platform">
            ${["android", "ios", "web"]
              .map(
                (platform) => `
                  <option value="${platform}" ${state.device.platform === platform ? "selected" : ""}>${formatUiLabel(platform)}</option>
                `,
              )
              .join("")}
          </select>
        </label>
      </div>
      <label class="field-block">
        <span>푸시 토큰</span>
        <input
          id="device-push-token-input"
          type="text"
          value="${escapeHtml(state.device.pushToken)}"
          data-field="device.pushToken"
          placeholder="휴대폰의 FCM 또는 APNs 푸시 토큰"
        />
      </label>
      <div class="quick-actions">
        <button
          class="soft-button wide"
          data-action="register-device-token"
          ${!state.device.pushToken.trim() || deviceMeta.tokenRegisterStatus === "sending" ? "disabled" : ""}
        >
          ${deviceMeta.tokenRegisterStatus === "sending" ? "토큰 등록 중…" : "기기 토큰 등록"}
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
          ${deviceMeta.pushGatewayDispatchStatus === "sending" ? "시험 알림 전송 중…" : "시험 알림 보내기"}
        </button>
      </div>
      <div class="sample-copy">${escapeUiMessage(tokenActionCopy)}</div>
      <div class="toggle-row inset">
        <div>
          <div class="toggle-title">푸시 알림</div>
          <p class="field-help">켜 두면 서버가 푸시 알림 전송을 먼저 시도합니다.</p>
        </div>
        <button class="toggle ${state.device.pushEnabled ? "on" : ""}" data-action="toggle-field" data-field="device.pushEnabled"><span></span></button>
      </div>
      <div class="toggle-row inset">
        <div>
          <div class="toggle-title">전체 화면 알림 권한</div>
          <p class="field-help">긴급 알림을 전체 화면으로 표시하려면 휴대폰에서 권한을 허용해야 합니다.</p>
        </div>
        <button class="toggle ${state.device.fullScreenEnabled ? "on" : ""}" data-action="toggle-field" data-field="device.fullScreenEnabled"><span></span></button>
      </div>
      <div class="toggle-row inset">
        <div>
          <div class="toggle-title">방해금지 우회 권한</div>
          <p class="field-help">휴대폰에서 긴급 알림의 방해금지 우회 권한을 허용했는지 설정합니다.</p>
        </div>
        <button class="toggle ${state.device.dndOverrideGranted ? "on" : ""}" data-action="toggle-field" data-field="device.dndOverrideGranted"><span></span></button>
      </div>
      <div class="toggle-row inset">
        <div>
          <div class="toggle-title">배터리 최적화 제외</div>
          <p class="field-help">휴대폰에서 배터리 최적화를 제외하면 기기 내 예비 알람의 실행에 도움이 됩니다.</p>
        </div>
        <button class="toggle ${state.device.batteryOptimizationIgnored ? "on" : ""}" data-action="toggle-field" data-field="device.batteryOptimizationIgnored"><span></span></button>
      </div>
      <div class="toggle-grid">
        <button class="choice-chip ${state.device.localBackupEnabled ? "selected" : ""}" data-action="toggle-field" data-field="device.localBackupEnabled">기기 내 예비 알람</button>
        <button class="choice-chip ${state.device.soundEnabled ? "selected" : ""}" data-action="toggle-field" data-field="device.soundEnabled">소리</button>
        <button class="choice-chip ${state.device.vibrationEnabled ? "selected" : ""}" data-action="toggle-field" data-field="device.vibrationEnabled">진동</button>
        <button class="choice-chip ${state.device.ttsEnabled ? "selected" : ""}" data-action="toggle-field" data-field="device.ttsEnabled">음성 안내</button>
      </div>
      <div class="live-sync-grid">
        <article class="live-sync-card">
          <div class="live-sync-label">기기 설정</div>
          <div class="live-sync-value">${escapeHtml(formatUiLabel(deviceMeta.syncStatus))}</div>
          <div class="live-sync-copy">${escapeUiMessage(deviceStatusCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">토큰 상태</div>
          <div class="live-sync-value">${escapeHtml(formatUiLabel(String(tokenHealth?.deliveryReadiness || "unknown")))}</div>
          <div class="live-sync-copy">${escapeUiMessage(tokenStatusCopy)}</div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">전송 방식</div>
          <div class="live-sync-value">${escapeHtml(formatUiLabel(String(tokenHealth?.adapter || state.device.platform || "fcm")))}</div>
          <div class="live-sync-copy">
            ${escapeHtml(tokenHealth?.tokenMasked || "등록된 토큰이 없습니다.")}
            ${
              tokenHealth?.tokenKind
                ? `<br /><span>${escapeHtml(formatUiLabel(String(tokenHealth.tokenKind)))}</span>`
                : ""
            }
          </div>
        </article>
        <article class="live-sync-card">
          <div class="live-sync-label">알림 전송 대기열</div>
          <div class="live-sync-value">${escapeHtml(String(deviceMeta.dispatchTotal || 0))}</div>
          <div class="live-sync-copy">
            ${
              deviceMeta.dispatchBundles[0]
                ? escapeHtml(deviceMeta.dispatchBundles[0].title || "최근 알림 전송 묶음이 준비됐습니다.")
                : escapeHtml(deviceMeta.dispatchError || "알림 전송 묶음이 없습니다.")
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
        <div class="stack-title"><span class="material-symbols-outlined">list_alt</span>서버 알람 기록</div>
        <div class="empty-copy">최근 서버 알람 기록을 불러오고 있습니다.</div>
      </section>
    `;
  }

  if (alarmRuntimeMeta.status === "error" && !alarmRuntimeMeta.events.length) {
    return `
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">list_alt</span>서버 알람 기록</div>
        <div class="empty-copy">${escapeHtml(alarmRuntimeMeta.lastError || "서버 알람 기록을 불러오지 못했습니다.")}</div>
      </section>
    `;
  }

  return `
    <section class="stack-panel">
      <div class="stack-title"><span class="material-symbols-outlined">list_alt</span>서버 알람 기록</div>
      <div class="history-list">
        ${
          alarmRuntimeMeta.events.length
            ? alarmRuntimeMeta.events.map(
                (item) => `
                  <article class="history-item">
                    <div class="history-main">
                      <div class="history-title">${escapeHtml(item.title || item.kind || "알람 기록")}</div>
                      <div class="history-detail">${escapeHtml(item.detail || "상세 정보가 없습니다.")}</div>
                      ${renderDeliveryPriorityLine(item)}
                      ${renderPlaybackIntensityLine(item)}
                      ${renderConservativeContextLine(item)}
                    </div>
                    <div class="history-time">${escapeHtml(formatClock(new Date(item.createdAt)))}</div>
                  </article>
                `,
              ).join("")
            : `<div class="empty-copy">아직 서버 알람 기록이 없습니다.</div>`
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
            <div class="section-title">다음 버스 · 노선 ${escapeHtml(model.primaryLine.number)}</div>
            <div class="section-caption">${escapeHtml(model.stop.name)} 탑승 정류장</div>
          </div>
          <button class="ghost-link" data-action="goto" data-screen="onboarding">경로 수정</button>
        </div>
        ${model.risk.results.map((result, index) => renderBusCard(result, index === model.risk.targetResult.index ? "this" : "next", model.primaryLine, model.risk.lastChanceConfirmed && index === model.risk.targetResult.index ? "orange" : "")).join("")}
      </section>
      <section class="message-panel">
        <div class="message-icon"><span class="material-symbols-outlined">tips_and_updates</span></div>
        <div>
          <div class="message-title">지각 위험 안내</div>
          <div class="message-body">${escapeHtml(model.risk.message)}</div>
        </div>
      </section>
      ${renderHistoryPanel()}
      ${renderServerEventPanel()}
      <section class="quick-actions">
        <button class="primary-cta" data-action="departed">
          <span>출발했어요</span>
          <span class="material-symbols-outlined">arrow_forward</span>
        </button>
        <div class="quick-actions-copy">출발 버튼을 누르면 오늘 남은 알람을 중지합니다.</div>
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
  const placeProviderLabel = placeApiConfig.providers?.kakao?.configured ? "카카오 장소 검색" : "예시 주소 목록";
  const filteredStops = STOP_LIBRARY.filter((item) => {
    if (!search) return true;
    return `${item.name} ${item.subtitle} ${item.stopCode}`.toLowerCase().includes(search);
  });

  return `
    <main class="screen screen-form">
      <section class="progress-shell">
        <div class="progress-meta"><span>탑승 지점 설정</span><span>정류장과 노선</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:60%"></div></div>
      </section>
      <section class="panel">
        <div class="panel-title">이동 정보</div>
        <div class="field-help">주소 검색은 현재 ${escapeHtml(placeProviderLabel)} 기준으로 동작합니다. 선택한 좌표는 지도와 목적지 경로 조회에 사용합니다. 집에서 정류장까지의 시간은 지각 계산에서 제외합니다.</div>
        <div class="field-stack">
          <div class="holiday-form">
            <input class="text-field-input" type="text" placeholder="집 주소나 건물명 검색" value="${escapeHtml(state.ui.homeAddressKeyword)}" data-field="ui.homeAddressKeyword" />
            <button class="mini-button add-button" data-action="search-home-address" ${state.ui.homeAddressSearchStatus === "loading" ? "disabled" : ""}>
              ${state.ui.homeAddressSearchStatus === "loading" ? "검색 중…" : "검색"}
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
                          <button class="mini-button" data-action="select-home-address" data-index="${index}">선택</button>
                        </article>
                      `,
                    )
                    .join("")}
                </div>
              `
              : ""
          }
          <label class="field-block compact">
            <span>집 주소</span>
            <input class="text-field-input" type="text" value="${escapeHtml(state.user.homeAddress)}" data-field="user.homeAddress" />
          </label>
          <div class="holiday-form">
            <input class="text-field-input" type="text" placeholder="회사 주소나 건물명 검색" value="${escapeHtml(state.ui.workAddressKeyword)}" data-field="ui.workAddressKeyword" />
            <button class="mini-button add-button" data-action="search-work-address" ${state.ui.workAddressSearchStatus === "loading" ? "disabled" : ""}>
              ${state.ui.workAddressSearchStatus === "loading" ? "검색 중…" : "검색"}
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
                          <button class="mini-button" data-action="select-work-address" data-index="${index}">선택</button>
                        </article>
                      `,
                    )
                    .join("")}
                </div>
              `
              : ""
          }
          <label class="field-block compact">
            <span>목적지 주소</span>
            <input class="text-field-input" type="text" value="${escapeHtml(state.user.workAddress)}" data-field="user.workAddress" />
          </label>
          <label class="field-block compact">
            <span>목적지 도착 목표 시간</span>
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
        <div class="stack-title"><span class="material-symbols-outlined">map</span>이동 경로 지도</div>
        <div class="field-help">
          ${escapeHtml(
            placeApiConfig.maps?.kakao?.configured
              ? "집, 탑승 정류장과 목적지 위치를 카카오 지도에 표시합니다."
              : placeApiConfig.maps?.kakao?.reason || "아직 카카오 지도 연결이 설정되지 않았습니다.",
          )}
        </div>
        <div id="commute-map" class="commute-map" aria-label="집·정류장·목적지 지도"></div>
      </section>
      <section class="panel">
        <div class="panel-title">실시간 교통정보 연결</div>
        <div class="field-stack">
          <label class="field-block compact">
            <span>정보 제공처</span>
            <select class="text-field-input" data-field="live.provider">
              <option value="none" ${state.live.provider === "none" ? "selected" : ""}>예시 정보</option>
              <option value="seoul" ${state.live.provider === "seoul" ? "selected" : ""}>서울시 버스정보</option>
              <option value="gyeonggi" ${state.live.provider === "gyeonggi" ? "selected" : ""}>경기도 버스정보(정확도 비교용)</option>
              <option value="tago" ${state.live.provider === "tago" ? "selected" : ""}>국토교통부 TAGO(경기 지역 우선 추천)</option>
            </select>
          </label>
          <div class="field-help">${escapeUiMessage(getLiveProviderPolicyCopy())}</div>
          ${
            state.live.provider === "seoul"
              ? `
                <div class="field-help">서울시 정류장을 검색하고 노선을 선택하면 노선 번호와 정류장 순서가 자동 입력됩니다.</div>
                <div class="holiday-form">
                  <input class="text-field-input" type="text" placeholder="서울 정류장 이름" value="${escapeHtml(state.ui.liveSearchKeyword)}" data-field="ui.liveSearchKeyword" />
                  <button class="mini-button add-button" data-action="search-live-stops" ${state.ui.liveSearchStatus === "loading" ? "disabled" : ""}>
                    ${state.ui.liveSearchStatus === "loading" ? "검색 중…" : "검색"}
                  </button>
                </div>
                ${
                  state.live.stationName
                    ? `<div class="field-help">선택한 공식 정류장: ${escapeHtml(state.live.stationName)} (${escapeHtml(state.live.arsId || state.live.stationId)})</div>`
                    : ""
                }
                ${
                  state.ui.liveSearchError
                    ? `<div class="empty-copy">${escapeHtml(state.ui.liveSearchError)}</div>`
                    : !state.ui.liveSearchResults.length && state.ui.liveSearchStatus === "ready"
                      ? `<div class="empty-copy">일치하는 서울시 정류장이 없습니다.</div>`
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
                      ? `<div class="empty-copy">이 정류장의 서울시 노선 정보를 찾지 못했습니다.</div>`
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
                                    [item.direction, item.order ? `순서 ${item.order}` : "", item.routeId].filter(Boolean).join(" · "),
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
                      ? `<div class="empty-copy">정류장을 지나는 서울시 노선을 조회하고 있습니다…</div>`
                      : ""
                }
                <label class="field-block compact">
                  <span>정류장 고유번호(stId)</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.stationId)}" data-field="live.stationId" />
                </label>
                <label class="field-block compact">
                  <span>정류장 안내 번호(ARS)</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.arsId)}" data-field="live.arsId" />
                </label>
                <label class="field-block compact">
                  <span>노선 고유번호(busRouteId)</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.routeId)}" data-field="live.routeId" />
                </label>
                <label class="field-block compact">
                  <span>버스 번호</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.routeNumber)}" data-field="live.routeNumber" />
                </label>
                <label class="field-block compact">
                  <span>노선 내 정류장 순서(ord)</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.order)}" data-field="live.order" />
                </label>
              `
              : ""
          }
          ${
            state.live.provider === "gyeonggi"
              ? `
                <div class="field-help">경기도 정류장을 검색하세요. 같은 노선의 도착정보 정확도를 다른 제공처와 비교할 수 있습니다.</div>
                ${getAccuracyRecommendationButtonMarkup()}
                <div class="holiday-form">
                  <input class="text-field-input" type="text" placeholder="정류장 이름 또는 번호" value="${escapeHtml(state.ui.liveSearchKeyword)}" data-field="ui.liveSearchKeyword" />
                  <button class="mini-button add-button" data-action="search-live-stops" ${state.ui.liveSearchStatus === "loading" ? "disabled" : ""}>
                    ${state.ui.liveSearchStatus === "loading" ? "검색 중…" : "검색"}
                  </button>
                </div>
                ${
                  state.live.stationName
                    ? `<div class="field-help">선택한 공식 정류장: ${escapeHtml(state.live.stationName)} (${escapeHtml(state.live.stationId)})</div>`
                    : ""
                }
                ${
                  state.ui.liveSearchError
                    ? `<div class="empty-copy">${escapeHtml(state.ui.liveSearchError)}</div>`
                    : !state.ui.liveSearchResults.length && state.ui.liveSearchStatus === "ready"
                      ? `<div class="empty-copy">일치하는 경기도 정류장이 없습니다.</div>`
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
                      ? `<div class="empty-copy">이 정류장의 경기도 노선 정보를 찾지 못했습니다.</div>`
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
                                    [item.destinationName, item.order ? `순서 ${item.order}` : "", item.routeId].filter(Boolean).join(" · "),
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
                      ? `<div class="empty-copy">정류장을 지나는 경기도 노선을 조회하고 있습니다…</div>`
                      : ""
                }
                <label class="field-block compact">
                  <span>정류장 고유번호(stationId)</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.stationId)}" data-field="live.stationId" />
                </label>
                <label class="field-block compact">
                  <span>노선 고유번호(routeId)</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.routeId)}" data-field="live.routeId" />
                </label>
                <label class="field-block compact">
                  <span>버스 번호(routeName)</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.routeNumber)}" data-field="live.routeNumber" />
                </label>
                <label class="field-block compact">
                  <span>노선 내 정류장 순서(staOrder)</span>
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
                  <span>정류장 고유번호(nodeId)</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.nodeId)}" data-field="live.nodeId" />
                </label>
                <label class="field-block compact">
                  <span>노선 고유번호 (routeId, 권장)</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.routeId)}" data-field="live.routeId" />
                </label>
                <label class="field-block compact">
                  <span>버스 번호</span>
                  <input class="text-field-input" type="text" value="${escapeHtml(state.live.routeNumber)}" data-field="live.routeNumber" />
                </label>
              `
              : ""
          }
        </div>
      </section>
      ${!isLiveConfigured(state) ? `
      <section class="panel">
        <div class="panel-title">탑승 정류장 선택(예시)</div>
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
                          ${item.id === stop.id ? "선택됨" : "선택"}
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
          <input type="text" placeholder="정류장 이름 또는 번호 검색" value="${escapeHtml(state.ui.routeSearch)}" data-field="ui.routeSearch" />
          <button class="pill-button" type="button" data-action="pick-stop" data-stop-id="${nearestStop ? nearestStop.id : "GWANGHWAMUN"}">${nearestStop ? "가까운 정류장 선택" : "내 주변"}</button>
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
        <div class="map-footnote">카카오 지도 연결을 설정하면 위 지도에 저장한 집, 정류장과 목적지 위치가 표시됩니다.</div>
      </section>
      <section class="panel">
        <div class="panel-title">이 정류장을 지나는 노선 선택</div>
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
                      <div class="route-subtitle">방면: ${escapeHtml(line.destination)}</div>
                    </div>
                  </div>
                  <div class="route-actions">
                    ${
                      checked
                        ? `<button type="button" class="mini-button ${primary ? "selected" : ""}" data-action="set-primary-line" data-line-id="${line.id}">
                             ${primary ? "주 이용 노선" : "주 이용 노선으로 선택"}
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
        <button class="secondary-button" data-action="goto" data-screen="home">뒤로</button>
        <button class="primary-button" data-action="goto" data-screen="schedule">
          다음
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
        <h1>알람 일정</h1>
        <p>알람 시작·종료 시간, 반복 간격과 요일, 쉬는 날을 설정하세요.</p>
      </section>
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">schedule</span>알람 시간대</div>
        <div class="field-grid">
          <label class="field-block"><span>알람 시작</span><input type="time" value="${state.schedule.startTime}" data-field="schedule.startTime" /></label>
          <label class="field-block"><span>알람 종료</span><input type="time" value="${state.schedule.endTime}" data-field="schedule.endTime" /></label>
        </div>
      </section>
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">update</span>알람 반복 간격</div>
        <div class="choice-grid">
          ${[1, 2, 3, 5, 10]
            .map(
              (minute) => `
                <button class="choice-chip ${state.schedule.repeatIntervalMin === minute ? "selected" : ""}" data-action="set-interval" data-value="${minute}">
                  ${minute}분
                </button>
              `,
            )
            .join("")}
        </div>
      </section>
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">calendar_month</span>반복 요일</div>
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
            <div class="stack-title no-margin"><span class="material-symbols-outlined">beach_access</span>공휴일에는 알람 쉬기</div>
          </div>
          <button class="toggle ${state.schedule.skipHolidays ? "on" : ""}" data-action="toggle-field" data-field="schedule.skipHolidays"><span></span></button>
        </div>
        <p class="field-help">켜 두면 대한민국 공휴일과 아래에서 직접 추가한 날짜에는 알람이 울리지 않습니다.</p>
        <div class="live-sync-grid">
          <article class="live-sync-card">
            <div class="live-sync-label">공휴일 정보 연결</div>
            <div class="live-sync-value">${model.holidayApiConfigured ? "연결됨" : "연결 키 없음"}</div>
            <div class="live-sync-copy">
              ${
                state.holidaySync.status === "loading"
                  ? "공휴일 정보를 불러오고 있습니다."
                  : state.holidaySync.lastError
                    ? escapeHtml(state.holidaySync.lastError)
                    : model.holidayApiConfigured
                      ? "한국천문연구원의 공식 공휴일 정보를 불러올 수 있습니다."
                      : "공휴일 자동 조회를 사용하려면 운영 서버에 공휴일 API 키를 설정해야 합니다."
              }
            </div>
          </article>
          <article class="live-sync-card">
            <div class="live-sync-label">불러온 공휴일</div>
            <div class="live-sync-value">${state.officialHolidays.length}일</div>
            <div class="live-sync-copy">
              연도: ${escapeHtml(state.holidaySync.loadedYears.length ? state.holidaySync.loadedYears.join(", ") : "없음")}
              <br />
              마지막 갱신: ${escapeHtml(formatSyncStamp(state.holidaySync.lastSyncedAt))}
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
          <button class="mini-button add-button" data-action="sync-official-holidays">${state.holidaySync.status === "loading" ? "동기화 중…" : "동기화"}</button>
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
                          <div class="holiday-copy">${escapeHtml(holiday.name || "공휴일")}</div>
                        </div>
                        <div class="holiday-copy">공휴일</div>
                      </article>
                    `,
                  )
                  .join("")
              : `<div class="empty-copy">앞으로의 일정에 적용할 공휴일을 아직 불러오지 않았습니다.</div>`
          }
        </div>
      </section>
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">event</span>알람을 쉴 날짜 추가</div>
        <div class="holiday-form">
          <input class="text-field-input" type="date" value="${escapeHtml(state.ui.holidayDraft)}" data-field="ui.holidayDraft" />
          <button class="mini-button add-button" data-action="add-holiday">추가</button>
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
                          <div class="holiday-copy">이 날짜에는 공휴일과 마찬가지로 알람이 울리지 않습니다.</div>
                        </div>
                        <button class="icon-button soft" data-action="remove-holiday" data-value="${holiday}" aria-label="알람 쉴 날짜 삭제 ${escapeHtml(holiday)}">
                          <span class="material-symbols-outlined">close</span>
                        </button>
                      </article>
                    `,
                  )
                  .join("")
              : `<div class="empty-copy">추가한 날짜가 없습니다.</div>`
          }
        </div>
      </section>
      <section class="preview-card">
        <div class="preview-label">${escapeHtml(model.scheduleState.badge)}</div>
        <div class="preview-title">${escapeHtml(model.scheduleState.detail)}</div>
        <div class="preview-meta">현재 날짜: ${escapeHtml(formatLongDate(model.now))}</div>
      </section>
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">view_week</span>앞으로 7일 알람 일정</div>
        <div class="forecast-grid">
          ${model.forecast
            .map(
              (item) => `
                <article class="forecast-item ${item.firing ? "on" : "off"}">
                  <div class="forecast-date">${escapeHtml(formatShortDate(item.date))}</div>
                  <div class="forecast-badge">${escapeHtml(item.badge)}</div>
                  <div class="forecast-copy">${escapeUiMessage(item.detail)}</div>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>
      <button class="footer-cta" data-action="save-schedule">설정 저장</button>
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
        <div class="stack-title"><span class="material-symbols-outlined">volume_up</span>알람 소리</div>
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
                <button class="icon-button soft" data-action="preview-sound" data-value="${preset.id}" aria-label="${escapeHtml(preset.name)} 미리 듣기">
                  <span class="material-symbols-outlined">play_arrow</span>
                </button>
              </div>
            `,
          ).join("")}
        </div>
      </section>
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">vibration</span>진동</div>
        <div class="slider-row">
          <div class="slider-header">
            <span>진동 세기</span>
            <strong>${state.notification.vibrationStrength >= 70 ? "강하게" : state.notification.vibrationStrength >= 40 ? "보통" : "약하게"}</strong>
          </div>
          <input class="range-input" type="range" min="0" max="100" value="${state.notification.vibrationStrength}" data-field="notification.vibrationStrength" />
          <div class="slider-scale"><span>약하게</span><span>보통</span><span>강하게</span></div>
        </div>
        <div class="toggle-row inset">
          <div>
            <div class="toggle-title">알람을 점점 강하게</div>
            <p class="field-help">15초, 30초 무응답 시 단계적으로 진동과 소리를 더 강하게 올립니다.</p>
          </div>
          <button class="toggle ${state.notification.escalationEnabled ? "on" : ""}" data-action="toggle-field" data-field="notification.escalationEnabled"><span></span></button>
        </div>
      </section>
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">record_voice_over</span>음성 안내</div>
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
          <div class="slider-header"><span>말하기 속도</span><strong>${state.notification.ttsSpeed.toFixed(1)}배</strong></div>
          <input class="range-input" type="range" min="0.8" max="1.3" step="0.1" value="${state.notification.ttsSpeed}" data-field="notification.ttsSpeed" />
          <div class="slider-scale"><span>0.8배</span><span>보통</span><span>1.3배</span></div>
        </div>
        <button class="soft-button wide" data-action="preview-tts">미리 듣기</button>
        <div class="sample-copy">${escapeHtml(model.notificationSpec.spokenText)}</div>
      </section>
      <section class="stack-panel">
        <div class="stack-title"><span class="material-symbols-outlined">crisis_alert</span>단계별 알림 미리보기</div>
        <div class="forecast-grid">
          ${model.notificationTimeline
            .map(
              (item) => `
                <article class="forecast-item ${item.stage === 2 ? "off" : "on"}">
                  <div class="forecast-date">${escapeHtml(item.escalationLabel)} · +${item.secondsSinceTrigger}초</div>
                  <div class="forecast-badge">${escapeUiMessage(item.riskLevel)} · ${escapeHtml(item.volumePercent.toString())}% 음량</div>
                  <div class="forecast-copy">
                    진동 ${escapeHtml(item.vibrationPattern.join("-"))} x ${escapeHtml(String(item.vibrationRepeats))}
                    <br />
                    ${escapeHtml(item.fullScreen ? "전체 화면 알림 설정 켜짐." : "일반 배너 알림.")}
                    <br />
                    ${escapeHtml(item.criticalBypass ? "방해금지 우회 요청." : "방해금지 우회를 요청하지 않습니다.")}
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
        <div class="sample-copy">${escapeHtml(model.notificationSpec.title)} · ${escapeHtml(model.notificationSpec.body)}</div>
      </section>
      <section class="warning-panel">
        <div class="warning-head"><span class="material-symbols-outlined">warning</span>긴급 알림의 방해금지 우회</div>
        <p>여기서는 원하는 알림 방식을 저장합니다. 실제 권한은 안드로이드 앱에서 별도로 허용해야 하며, 아이폰은 애플의 알림 정책에 따라 지원 범위가 제한됩니다.</p>
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
    window.alert("이 브라우저는 음성 안내를 지원하지 않습니다.");
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
    pushHistory(turningOff ? "오늘 알람 중지" : "오늘 알람 다시 켜짐", "홈 화면에서 오늘 알람 설정을 변경했습니다.");
    return render();
  }
  if (action === "ack-active-alarm") {
    runAlarmDeliveryAction(
      "ACK_DEPARTED",
      "출발 완료",
      "현재 알람을 확인하고 오늘 남은 알람을 중지했습니다.",
    );
    return;
  }
  if (action === "snooze-active-alarm") {
    runAlarmDeliveryAction(
      "SNOOZE_1M",
      "알람 잠시 미룸",
      "현재 알람을 1분 뒤로 미뤘습니다.",
    );
    return;
  }
  if (action === "departed") {
    if (alarmRuntimeMeta.delivery?.currentAlert) {
      runAlarmDeliveryAction(
        "ACK_DEPARTED",
        "출발 완료",
        "현재 알람을 확인하고 오늘 남은 알람을 중지했습니다.",
      );
      return;
    }

    state.schedule.snoozeDate = dateOnlyKey(new Date());
    pushHistory("출발 완료", "출발 완료로 표시했습니다.", "INFO", "APP_ACTION", {
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
    pushHistory("알람 소리 미리 듣기", `${SOUND_PRESETS.find((item) => item.id === target.dataset.value)?.name || "알람 소리"}를 미리 재생했습니다.`);
    playSoundPreset(target.dataset.value);
    return render();
  }
  if (action === "set-tts-voice") {
    state.notification.ttsVoiceId = target.dataset.value;
    persist();
    return render();
  }
  if (action === "preview-tts") {
    pushHistory("TTS preview", "음성 안내를 미리 재생했습니다.");
    previewTts();
    return render();
  }
  if (action === "run-push-gateway") {
    if (!deviceMeta.dispatchBundles.length) {
      deviceMeta.pushGatewayDispatchStatus = "error";
      deviceMeta.pushGatewayDispatchError = "현재 전송할 알림이 없습니다.";
      return render();
    }
    if (
      deviceMeta.pushGatewayConfig?.mode === "execute" &&
      !window.confirm("실제 전송 모드이므로 휴대폰에 알림이 전송될 수 있습니다. 계속할까요?")
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
          "기기 토큰 등록 완료",
          payload.tokenHealth?.reason || "기기 푸시 토큰의 형식을 확인하고 서버에 저장했습니다.",
        );
        queueAlarmRuntimeRefresh(0);
        render();
      })
      .catch((error) => {
        deviceMeta.tokenRegisterStatus = "error";
        deviceMeta.tokenRegisterError = userErrorMessage(error, "기기 토큰 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
        pushHistory("브라우저 알림 등록 완료", payload.tokenHealth?.reason || "브라우저 푸시 알림 구독 정보를 서버에 저장했습니다.");
        queueAlarmRuntimeRefresh(0);
        render();
      })
      .catch((error) => {
        deviceMeta.tokenRegisterStatus = "error";
        deviceMeta.tokenRegisterError = userErrorMessage(error, "이 브라우저의 푸시 알림을 등록하지 못했습니다.");
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
      state.ui.liveSearchError = "먼저 정류장 이름 또는 번호를 입력하세요.";
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
        pushHistory("공식 정류장 조회 완료", `${payload.provider} 정류장 ${state.ui.liveSearchResults.length}개를 조회했습니다.`);
        render();
      })
      .catch((error) => {
        if (!isCurrent()) return;
        state.ui.liveSearchStatus = "error";
        state.ui.liveSearchResults = [];
        state.ui.liveSearchError = userErrorMessage(error, "정류장 검색 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
        pushHistory("공식 정류장 조회 실패", state.ui.liveSearchError, "ERROR");
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
      tagoCitiesMeta.error = userErrorMessage(error, "도시목록 조회 실패");
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
      "정보 제공처 변경",
      `현재 추천 제공처인 ${getLiveProviderLabel(recommendedProvider)}로 실시간 연결을 변경했습니다.`,
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
    pushHistory("공식 정류장 선택", `${state.live.stationName || state.live.stationId}을(를) ${state.live.provider} 실시간 정보에 연결했습니다.`);
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
    pushHistory("공식 노선 선택", `${state.live.routeNumber || state.live.routeId} 노선을 실시간 정보에 연결했습니다.`);
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
            ? payload.fallbackError || "최근 실시간 조회에 실패해 마지막으로 확인한 정보를 표시합니다."
            : "";
        syncLiveBindingState();
        const modeLabel =
          payload.cacheStatus === "stale-fallback"
            ? "stale fallback"
            : payload.cacheStatus === "cache-hit"
              ? "cache hit"
              : "fresh live";
        pushHistory(
          "실시간 도착정보 갱신 완료",
          `${payload.provider} 도착 예정: ${payload.arrivalsMin.join(", ")}분 (${modeLabel}).`,
        );
        void refreshBusAccuracySummary();
        void runAutoBusAccuracyProbeCycle();
        render();
      })
      .catch((error) => {
        state.live.status = "error";
        state.live.snapshot = null;
        state.live.lastError = userErrorMessage(error, "실시간 정보 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
        pushHistory("실시간 정보 갱신 실패", state.live.lastError, "ERROR");
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
    pushHistory("주 이용 노선 변경", `${target.dataset.lineId}번을 주 이용 알람 노선으로 설정했습니다.`);
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
    pushHistory("정류장 변경", `탑승 정류장을 ${stop.name}(으)로 변경했습니다.`);
    refreshCommuteEstimate();
    return render();
  }
  if (action === "sync-official-holidays") {
    const year = String(state.ui.holidaySyncYear || "").trim();
    if (!/^\d{4}$/.test(year)) {
      state.holidaySync.status = "error";
      state.holidaySync.lastError = "연도를 네 자리 숫자로 입력하세요.";
      pushHistory("공휴일 조회 불가", state.holidaySync.lastError, "ERROR");
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
        pushHistory("공휴일 정보 갱신 완료", `${year}년 공휴일 ${holidays.length}개를 불러왔습니다.`);
        render();
      })
      .catch((error) => {
        state.holidaySync.status = "error";
        state.holidaySync.lastError = userErrorMessage(error, "공휴일 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
        pushHistory("공휴일 정보 갱신 실패", state.holidaySync.lastError, "ERROR");
        render();
      });
    return;
  }
  if (action === "add-holiday") {
    if (!state.ui.holidayDraft) return;
    if (!state.holidayDates.includes(state.ui.holidayDraft)) {
      state.holidayDates = [...state.holidayDates, state.ui.holidayDraft].sort();
      pushHistory("알람을 쉴 날짜 추가", `${state.ui.holidayDraft}에는 공휴일과 마찬가지로 알람이 울리지 않습니다.`);
    }
    state.ui.holidayDraft = "";
    persist();
    return render();
  }
  if (action === "remove-holiday") {
    state.holidayDates = state.holidayDates.filter((holiday) => holiday !== target.dataset.value);
    pushHistory("알람을 쉴 날짜 삭제", `${target.dataset.value}을(를) 알람 쉴 날짜에서 삭제했습니다.`);
    return render();
  }
  if (action === "save-schedule") {
    pushHistory("알람 일정 저장 완료", `${state.schedule.startTime}~${state.schedule.endTime}, ${state.schedule.repeatIntervalMin}분마다 반복합니다.`);
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




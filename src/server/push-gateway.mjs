import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { connect as connectHttp2 } from "node:http2";

import webPush from "web-push";

import { getFcmAuthConfig, resolveFcmAccessToken } from "./fcm-auth.mjs";
import { fetchWithTimeout } from "./upstream-fetch.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeMode(value) {
  const safe = String(value || "").trim().toLowerCase();
  return safe === "execute" ? "execute" : "preview";
}

function redactValue(value) {
  const safe = String(value || "").trim();
  if (!safe) {
    return "";
  }
  if (safe.length <= 10) {
    return `${safe.slice(0, 2)}...${safe.slice(-2)}`;
  }
  return `${safe.slice(0, 4)}...${safe.slice(-4)}`;
}

function base64UrlEncode(value) {
  const input = Buffer.isBuffer(value) ? value : typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizePrivateKey(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function buildFcmConfig(env) {
  const authConfig = getFcmAuthConfig(env);
  return {
    configured: Boolean(authConfig.projectId && (authConfig.manualTokenConfigured || authConfig.serviceAccountConfigured)),
    executeSupported: true,
    projectId: authConfig.projectId,
    authStrategy: authConfig.authStrategy,
    credentialSource: authConfig.manualTokenConfigured
      ? "env.FCM_ACCESS_TOKEN"
      : authConfig.serviceAccountFileConfigured
        ? "service-account-file"
        : authConfig.serviceAccountInlineConfigured
          ? "service-account-inline"
          : "",
    serviceAccountEmail: authConfig.serviceAccountEmail,
    tokenEndpoint: authConfig.tokenEndpoint,
  };
}

function buildApnsConfig(env) {
  const environment = String(env.APNS_ENV || "production").trim().toLowerCase() === "development" ? "development" : "production";
  const manualToken = String(env.APNS_AUTH_TOKEN || "").trim();
  const teamId = String(env.APNS_TEAM_ID || "").trim();
  const keyId = String(env.APNS_KEY_ID || "").trim();
  const privateKey = normalizePrivateKey(env.APNS_PRIVATE_KEY);
  const automaticTokenConfigured = Boolean(teamId && keyId && privateKey);
  return {
    configured: Boolean(env.APNS_BUNDLE_ID && (manualToken || automaticTokenConfigured)),
    executeSupported: true,
    bundleId: String(env.APNS_BUNDLE_ID || "").trim(),
    environment,
    credentialSource: manualToken
      ? "env.APNS_AUTH_TOKEN"
      : automaticTokenConfigured
        ? "env.APNS_TEAM_ID + env.APNS_KEY_ID + env.APNS_PRIVATE_KEY"
        : "",
    limitation: "APNs requires an APNs-enabled physical-device token and either a current bearer token or its .p8 signing key.",
  };
}

let apnsTokenCache = null;

function getApnsTokenCacheKey(env) {
  return [String(env.APNS_TEAM_ID || "").trim(), String(env.APNS_KEY_ID || "").trim(), normalizePrivateKey(env.APNS_PRIVATE_KEY)].join("\u0000");
}

export function createApnsAuthToken(env = process.env, now = new Date()) {
  const manualToken = String(env.APNS_AUTH_TOKEN || "").trim();
  if (manualToken) {
    return manualToken;
  }

  const teamId = String(env.APNS_TEAM_ID || "").trim();
  const keyId = String(env.APNS_KEY_ID || "").trim();
  const privateKey = normalizePrivateKey(env.APNS_PRIVATE_KEY);
  if (!teamId || !keyId || !privateKey) {
    throw new Error("APNs authentication requires APNS_AUTH_TOKEN or APNS_TEAM_ID, APNS_KEY_ID, and APNS_PRIVATE_KEY.");
  }

  const cacheKey = getApnsTokenCacheKey(env);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (apnsTokenCache && apnsTokenCache.cacheKey === cacheKey && nowSeconds - apnsTokenCache.issuedAt < 45 * 60) {
    return apnsTokenCache.token;
  }

  let signingKey;
  try {
    signingKey = createPrivateKey(privateKey);
  } catch {
    throw new Error("APNS_PRIVATE_KEY is not a valid Apple .p8 private key.");
  }
  const header = { alg: "ES256", kid: keyId };
  const payload = { iss: teamId, iat: nowSeconds };
  const signingInput = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}`;
  const signature = sign("sha256", Buffer.from(signingInput), { key: signingKey, dsaEncoding: "ieee-p1363" });
  const token = `${signingInput}.${base64UrlEncode(signature)}`;
  apnsTokenCache = { cacheKey, issuedAt: nowSeconds, token };
  return token;
}

function invalidateCachedApnsToken() {
  apnsTokenCache = null;
}

function buildWebPushConfig(env) {
  const subject = String(env.WEB_PUSH_VAPID_SUBJECT || "").trim();
  const publicKey = String(env.WEB_PUSH_VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(env.WEB_PUSH_VAPID_PRIVATE_KEY || "").trim();
  return {
    configured: Boolean(subject && publicKey && privateKey),
    executeSupported: true,
    publicKey,
    credentialSource: privateKey ? "env.WEB_PUSH_VAPID_PRIVATE_KEY" : "",
    limitation: "Web Push needs a browser subscription with endpoint, p256dh key, and auth key.",
  };
}

export function getPushGatewayConfig(env = process.env) {
  return {
    mode: normalizeMode(env.PUSH_GATEWAY_MODE),
    adapters: {
      fcm: buildFcmConfig(env),
      apns: buildApnsConfig(env),
      "web-push": buildWebPushConfig(env),
    },
  };
}

function buildFcmRequest(preview, gatewayConfig, authorizationToken) {
  const envelope = preview?.envelope || {};
  const message = envelope.message || {};
  const data = message.data || {};
  const projectId = gatewayConfig.adapters.fcm.projectId;
  return {
    adapter: "fcm",
    method: "POST",
    url: `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    headers: {
      Authorization: `Bearer ${authorizationToken || ""}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: {
      message: {
        token: envelope.targetToken,
        notification: {
          title: String(message.title || ""),
          body: String(message.body || ""),
        },
        data: {
          dispatchKey: String(data.dispatchKey || ""),
          alertTriggerKey: String(data.alertTriggerKey || ""),
          routeNumber: String(data.routeNumber || ""),
          stopName: String(data.stopName || ""),
          riskLevel: String(data.riskLevel || ""),
          stage: String(data.stage || ""),
          escalationLabel: String(data.escalationLabel || ""),
          liveEtaGuardMode: String(data.liveEtaGuardMode || ""),
          deliveryPriorityClass: String(data.deliveryPriorityClass || ""),
          deliveryPriorityReason: String(data.deliveryPriorityReason || ""),
          accuracyRiskBufferMin: String(data.accuracyRiskBufferMin || ""),
          accuracySpreadMin: String(data.accuracySpreadMin || ""),
          mechanicalLoopBoost: String(data.mechanicalLoopBoost || ""),
          speechRepeatCount: String(data.speechRepeatCount || ""),
          spokenText: String(message.speech?.text || ""),
        },
        android: {
          priority: envelope.platformHints?.priority === "max" ? "HIGH" : "NORMAL",
          notification: {
            channel_id: String(envelope.platformHints?.channelId || "buswakeup-morning"),
            sound: message.sound?.mechanicalTone ? "mechanical_alarm" : "default",
          },
        },
        apns: {
          headers: {
            "apns-push-type": "alert",
            "apns-priority": "10",
          },
          payload: {
            aps: {
              sound: message.sound?.mechanicalTone ? "mechanical_alarm.wav" : "default",
              "interruption-level": envelope.platformHints?.interruptionLevel || "active",
            },
          },
        },
      },
    },
  };
}

function buildApnsRequest(preview, gatewayConfig, authorizationToken = "") {
  const envelope = preview?.envelope || {};
  const message = envelope.message || {};
  const apnsConfig = gatewayConfig.adapters.apns;
  const host =
    apnsConfig.environment === "development"
      ? "https://api.development.push.apple.com"
      : "https://api.push.apple.com";
  return {
    adapter: "apns",
    method: "POST",
    url: `${host}/3/device/${encodeURIComponent(envelope.targetToken || "")}`,
    headers: {
      authorization: `bearer ${authorizationToken}`,
      "apns-topic": apnsConfig.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-request-id": randomUUID(),
    },
    body: {
      aps: {
        alert: {
          title: String(message.title || ""),
          body: String(message.body || ""),
        },
        sound: message.sound?.mechanicalTone ? "mechanical_alarm.wav" : "default",
        "interruption-level": envelope.platformHints?.interruptionLevel || "active",
      },
      commute: clone(message.data || {}),
      speech: clone(message.speech || {}),
    },
  };
}

function getWebPushSubscription(targetProfile) {
  const subscription = targetProfile?.webPushSubscription;
  if (!subscription || typeof subscription !== "object" || !/^https:\/\/.+/i.test(String(subscription.endpoint || ""))) {
    return null;
  }
  if (!subscription.keys?.p256dh || !subscription.keys?.auth) {
    return null;
  }
  return {
    endpoint: String(subscription.endpoint).trim(),
    expirationTime: Number.isFinite(Number(subscription.expirationTime)) ? Number(subscription.expirationTime) : null,
    keys: {
      p256dh: String(subscription.keys.p256dh).trim(),
      auth: String(subscription.keys.auth).trim(),
    },
  };
}

function buildWebPushPayload(preview) {
  const envelope = preview?.envelope || {};
  const message = envelope.message || {};
  return {
    title: String(message.title || preview?.title || "Commute alarm"),
    body: String(message.body || ""),
    tag: String(preview?.dispatchKey || "buswakeup-alarm"),
    requireInteraction: Boolean(envelope.platformHints?.requireInteraction),
    renotify: Boolean(envelope.platformHints?.renotify),
    data: {
      ...(message.data && typeof message.data === "object" ? message.data : {}),
      url: "/#/home",
    },
  };
}

function getWebPushVapidDetails(env) {
  return {
    subject: String(env.WEB_PUSH_VAPID_SUBJECT || "").trim(),
    publicKey: String(env.WEB_PUSH_VAPID_PUBLIC_KEY || "").trim(),
    privateKey: String(env.WEB_PUSH_VAPID_PRIVATE_KEY || "").trim(),
  };
}

function buildWebPushRequest(preview, gatewayConfig, targetProfile, env = process.env) {
  const subscription = getWebPushSubscription(targetProfile);
  if (!subscription) {
    return null;
  }
  const payload = buildWebPushPayload(preview);
  const vapidDetails = getWebPushVapidDetails(env);
  const details = webPush.generateRequestDetails(subscription, JSON.stringify(payload), {
    TTL: 120,
    urgency: "high",
    vapidDetails,
  });
  return {
    adapter: "web-push",
    method: details.method,
    url: details.endpoint,
    headers: details.headers,
    body: payload,
    subscription,
    payload: JSON.stringify(payload),
    options: {
      TTL: 120,
      urgency: "high",
      vapidDetails,
    },
  };
}

function buildRequestPreview(rawRequest) {
  if (!rawRequest) {
    return null;
  }

  const headers = {};
  for (const [key, value] of Object.entries(rawRequest.headers || {})) {
    headers[key] = /authorization|crypto-key|encryption/i.test(key) ? redactValue(value) : value;
  }

  return {
    adapter: rawRequest.adapter,
    method: rawRequest.method,
    url: rawRequest.url,
    headers,
    body: clone(rawRequest.body || null),
  };
}

function parseFcmErrorPayload(bodyText) {
  try {
    const payload = JSON.parse(String(bodyText || ""));
    const error = payload && typeof payload.error === "object" ? payload.error : {};
    const details = Array.isArray(error.details) ? error.details : [];
    const fcmDetail = details.find(
      (detail) =>
        detail &&
        typeof detail === "object" &&
        String(detail["@type"] || "").includes("google.firebase.fcm.v1.FcmError"),
    );
    return {
      status: String(error.status || "").trim(),
      message: String(error.message || "").trim(),
      fcmErrorCode: String(fcmDetail?.errorCode || "").trim(),
    };
  } catch {
    return {
      status: "",
      message: "",
      fcmErrorCode: "",
    };
  }
}

export function classifyFcmProviderResponse(statusCode, bodyText = "") {
  const safeStatusCode = Number(statusCode || 0);
  const payload = parseFcmErrorPayload(bodyText);
  const providerErrorCode = payload.fcmErrorCode || payload.status;
  const searchableText = `${payload.message} ${bodyText}`.toLowerCase();

  if (safeStatusCode >= 200 && safeStatusCode < 300) {
    return {
      category: "ACCEPTED",
      providerErrorCode: "",
      retryable: false,
      tokenAction: "NONE",
      reason: "FCM accepted the provider request.",
    };
  }

  if (providerErrorCode === "UNREGISTERED") {
    return {
      category: "TOKEN_UNREGISTERED",
      providerErrorCode,
      retryable: false,
      tokenAction: "RE_REGISTER",
      reason: "FCM reported that this device token is no longer registered. Open BusWakeUp on that phone and register the refreshed FCM token again.",
    };
  }

  if (
    providerErrorCode === "INVALID_ARGUMENT" &&
    /(registration token|message\.token|invalid token|token.*invalid)/i.test(searchableText)
  ) {
    return {
      category: "TOKEN_INVALID",
      providerErrorCode,
      retryable: false,
      tokenAction: "RE_REGISTER",
      reason: "FCM rejected this device registration token. Open BusWakeUp on that phone and register the current FCM token again.",
    };
  }

  if (safeStatusCode === 429 || safeStatusCode >= 500 || providerErrorCode === "UNAVAILABLE") {
    return {
      category: "TRANSIENT_PROVIDER_FAILURE",
      providerErrorCode,
      retryable: true,
      tokenAction: "NONE",
      reason: `FCM returned a temporary provider failure${providerErrorCode ? ` (${providerErrorCode})` : ""}.`,
    };
  }

  return {
    category: "REQUEST_REJECTED",
    providerErrorCode,
    retryable: false,
    tokenAction: "CHECK_CONFIGURATION",
    reason: `FCM rejected the provider request with HTTP ${safeStatusCode || "unknown"}${providerErrorCode ? ` (${providerErrorCode})` : ""}.`,
  };
}

export function buildPushGatewayPlan(preview, gatewayConfig = getPushGatewayConfig(), env = process.env, targetProfile = null) {
  const adapter = String(preview?.adapter || "").trim();
  if (!preview || preview.status !== "ready") {
    return {
      status: preview?.status || "idle",
      reason: preview?.reason || "No push preview is ready yet.",
      adapter: adapter || "fcm",
      request: null,
      executeSupported: false,
      configured: false,
    };
  }

  if (adapter === "fcm") {
    const configured = gatewayConfig.adapters.fcm.configured;
    const rawRequest = configured ? buildFcmRequest(preview, gatewayConfig, "<minted-at-send-time>") : null;
    return {
      status: configured ? "ready" : "blocked",
      reason: configured
        ? String(gatewayConfig.adapters.fcm.authStrategy || "").startsWith("service-account")
          ? "FCM provider request is ready and the bearer token will be minted from the service account at send time."
          : "FCM provider request is ready."
        : "FCM project id or authentication credentials are missing.",
      adapter,
      request: buildRequestPreview(rawRequest),
      executeSupported: gatewayConfig.adapters.fcm.executeSupported,
      configured,
    };
  }

  if (adapter === "apns") {
    const configured = gatewayConfig.adapters.apns.configured;
    const rawRequest = configured ? buildApnsRequest(preview, gatewayConfig, "<generated-at-send-time>") : null;
    return {
      status: configured ? "ready" : "blocked",
      reason: configured
        ? "APNs provider request is ready."
        : "APNs bundle id and its bearer token or .p8 signing-key settings are missing.",
      adapter,
      request: buildRequestPreview(rawRequest),
      executeSupported: gatewayConfig.adapters.apns.executeSupported,
      configured,
    };
  }

  if (adapter === "web-push") {
    const configured = gatewayConfig.adapters["web-push"].configured;
    const subscription = getWebPushSubscription(targetProfile);
    const rawRequest = configured && subscription ? buildWebPushRequest(preview, gatewayConfig, targetProfile, env) : null;
    return {
      status: configured && subscription ? "ready" : "blocked",
      reason: !configured
        ? "Web Push VAPID subject or key material is missing."
        : !subscription
          ? gatewayConfig.adapters["web-push"].limitation
          : "Web Push provider request is ready.",
      adapter,
      request: buildRequestPreview(rawRequest),
      executeSupported: gatewayConfig.adapters["web-push"].executeSupported,
      configured: configured && Boolean(subscription),
    };
  }

  return {
    status: "unsupported",
    reason: "The selected push adapter is not supported.",
    adapter: adapter || "web-push",
    request: null,
    executeSupported: false,
    configured: false,
  };
}

async function executeFcmRequest(rawRequest) {
  const response = await fetchWithTimeout(rawRequest.url, {
    method: rawRequest.method,
    headers: rawRequest.headers,
    body: JSON.stringify(rawRequest.body),
  });
  const bodyText = await response.text();
  const classification = classifyFcmProviderResponse(response.status, bodyText);
  return {
    ok: response.ok,
    statusCode: response.status,
    bodyExcerpt: bodyText.slice(0, 600),
    failureCategory: classification.category,
    providerErrorCode: classification.providerErrorCode,
    retryable: classification.retryable,
    tokenAction: classification.tokenAction,
    reason: classification.reason,
  };
}

export function classifyApnsProviderResponse(statusCode, bodyText = "") {
  const safeStatusCode = Number(statusCode || 0);
  let reason = "";
  try {
    reason = String(JSON.parse(String(bodyText || ""))?.reason || "").trim();
  } catch {
    reason = "";
  }

  if (safeStatusCode >= 200 && safeStatusCode < 300) {
    return { category: "ACCEPTED", providerErrorCode: "", retryable: false, tokenAction: "NONE", reason: "APNs accepted the provider request." };
  }
  if (safeStatusCode === 410 || ["Unregistered", "BadDeviceToken", "DeviceTokenNotForTopic"].includes(reason)) {
    return {
      category: "TOKEN_UNREGISTERED",
      providerErrorCode: reason || "Unregistered",
      retryable: false,
      tokenAction: "RE_REGISTER",
      reason: "APNs reported that this device token is no longer valid. Open BusWakeUp on that iPhone and register its current token again.",
    };
  }
  if (safeStatusCode === 429 || safeStatusCode >= 500) {
    return {
      category: "TRANSIENT_PROVIDER_FAILURE",
      providerErrorCode: reason,
      retryable: true,
      tokenAction: "NONE",
      reason: `APNs returned a temporary provider failure${reason ? ` (${reason})` : ""}.`,
    };
  }
  return {
    category: "REQUEST_REJECTED",
    providerErrorCode: reason,
    retryable: false,
    tokenAction: "CHECK_CONFIGURATION",
    reason: `APNs rejected the provider request with HTTP ${safeStatusCode || "unknown"}${reason ? ` (${reason})` : ""}.`,
  };
}

async function executeApnsRequest(rawRequest) {
  const target = new URL(rawRequest.url);
  return new Promise((resolve, reject) => {
    const client = connectHttp2(target.origin);
    let request = null;
    let settled = false;
    let statusCode = 0;
    let responseHeaders = {};
    let bodyText = "";
    const close = () => {
      try {
        client.close();
      } catch {
        // The connection may already be closed after a transport error.
      }
    };
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      close();
      callback();
    };
    const timeout = setTimeout(() => {
      try {
        request?.close();
      } catch {
        // Ignore a stream that has already ended.
      }
      finish(() => reject(new Error("APNs provider request timed out after 8 seconds.")));
    }, 8_000);
    const clear = () => clearTimeout(timeout);

    client.once("error", (error) => {
      clear();
      finish(() => reject(error));
    });

    try {
      request = client.request({
        ":method": rawRequest.method,
        ":path": `${target.pathname}${target.search}`,
        ...rawRequest.headers,
        "content-type": "application/json; charset=utf-8",
      });
      request.setEncoding("utf8");
      request.on("response", (headers) => {
        responseHeaders = headers;
        statusCode = Number(headers[":status"] || 0);
      });
      request.on("data", (chunk) => {
        bodyText += String(chunk);
      });
      request.once("error", (error) => {
        clear();
        finish(() => reject(error));
      });
      request.once("end", () => {
        clear();
        const classification = classifyApnsProviderResponse(statusCode, bodyText);
        finish(() =>
          resolve({
            ok: statusCode >= 200 && statusCode < 300,
            statusCode,
            bodyExcerpt: bodyText.slice(0, 600),
            apnsId: String(responseHeaders["apns-id"] || ""),
            failureCategory: classification.category,
            providerErrorCode: classification.providerErrorCode,
            retryable: classification.retryable,
            tokenAction: classification.tokenAction,
            reason: classification.reason,
          }),
        );
      });
      request.end(JSON.stringify(rawRequest.body));
    } catch (error) {
      clear();
      finish(() => reject(error));
    }
  });
}

export function classifyWebPushProviderResponse(statusCode, bodyText = "") {
  const safeStatusCode = Number(statusCode || 0);
  if (safeStatusCode >= 200 && safeStatusCode < 300) {
    return { category: "ACCEPTED", providerErrorCode: "", retryable: false, tokenAction: "NONE", reason: "Web Push provider accepted the request." };
  }
  if ([404, 410].includes(safeStatusCode)) {
    return {
      category: "TOKEN_UNREGISTERED",
      providerErrorCode: String(safeStatusCode),
      retryable: false,
      tokenAction: "RE_REGISTER",
      reason: "The browser subscription has expired or was removed. Open BusWakeUp in that browser and subscribe again.",
    };
  }
  if (safeStatusCode === 429 || safeStatusCode >= 500) {
    return {
      category: "TRANSIENT_PROVIDER_FAILURE",
      providerErrorCode: String(safeStatusCode),
      retryable: true,
      tokenAction: "NONE",
      reason: "The Web Push provider returned a temporary failure.",
    };
  }
  return {
    category: "REQUEST_REJECTED",
    providerErrorCode: String(safeStatusCode || ""),
    retryable: false,
    tokenAction: "CHECK_CONFIGURATION",
    reason: `Web Push provider rejected the request with HTTP ${safeStatusCode || "unknown"}. ${String(bodyText || "").slice(0, 160)}`.trim(),
  };
}

async function executeWebPushRequest(rawRequest) {
  try {
    const response = await webPush.sendNotification(rawRequest.subscription, rawRequest.payload, rawRequest.options);
    const statusCode = Number(response.statusCode || 0);
    const bodyText = String(response.body || "");
    const classification = classifyWebPushProviderResponse(statusCode, bodyText);
    return {
      ok: statusCode >= 200 && statusCode < 300,
      statusCode,
      bodyExcerpt: bodyText.slice(0, 600),
      failureCategory: classification.category,
      providerErrorCode: classification.providerErrorCode,
      retryable: classification.retryable,
      tokenAction: classification.tokenAction,
      reason: classification.reason,
    };
  } catch (error) {
    const statusCode = Number(error?.statusCode || 0);
    const bodyText = String(error?.body || error?.message || "");
    const classification = classifyWebPushProviderResponse(statusCode, bodyText);
    return {
      ok: false,
      statusCode,
      bodyExcerpt: bodyText.slice(0, 600),
      failureCategory: classification.category,
      providerErrorCode: classification.providerErrorCode,
      retryable: classification.retryable || !statusCode,
      tokenAction: classification.tokenAction,
      reason: classification.reason || (error instanceof Error ? error.message : "Web Push execution failed."),
    };
  }
}

export async function runPushGatewayDispatch(preview, gatewayConfig = getPushGatewayConfig(), now = new Date(), env = process.env, targetProfile = null) {
  const currentNow = now instanceof Date ? now : new Date(now);
  const messageData = preview?.envelope?.message?.data || {};
  const plan = buildPushGatewayPlan(preview, gatewayConfig, env, targetProfile);
  const baseAttempt = {
    id: randomUUID(),
    createdAt: currentNow.toISOString(),
    adapter: plan.adapter,
    previewStatus: preview?.status || "idle",
    dispatchKey: String(preview?.dispatchKey || ""),
    title: String(preview?.title || ""),
    stage: Number(preview?.stage ?? 0),
    escalationLabel: String(preview?.escalationLabel || ""),
    riskLevel: String(preview?.riskLevel || ""),
    routeNumber: String(messageData.routeNumber || preview?.routeNumber || ""),
    stopName: String(messageData.stopName || preview?.stopName || ""),
    liveEtaGuardMode: String(messageData.liveEtaGuardMode || preview?.liveEtaGuardMode || ""),
    deliveryPriorityClass: String(messageData.deliveryPriorityClass || preview?.deliveryPriorityClass || "normal"),
    deliveryPriorityReason: String(messageData.deliveryPriorityReason || preview?.deliveryPriorityReason || ""),
    volumePercent: Number.isFinite(Number(preview?.volumePercent ?? preview?.envelope?.message?.sound?.volumePercent))
      ? Number(preview?.volumePercent ?? preview?.envelope?.message?.sound?.volumePercent)
      : 0,
    vibrationRepeats: Number.isFinite(Number(preview?.vibrationRepeats ?? preview?.envelope?.message?.interruption?.vibrationRepeats))
      ? Number(preview?.vibrationRepeats ?? preview?.envelope?.message?.interruption?.vibrationRepeats)
      : 0,
    mechanicalLoopBoost: Number.isFinite(Number(preview?.mechanicalLoopBoost ?? messageData.mechanicalLoopBoost ?? preview?.envelope?.message?.sound?.loopBoost))
      ? Number(preview?.mechanicalLoopBoost ?? messageData.mechanicalLoopBoost ?? preview?.envelope?.message?.sound?.loopBoost)
      : 0,
    speechRepeatCount: Number.isFinite(Number(preview?.speechRepeatCount ?? messageData.speechRepeatCount ?? preview?.envelope?.message?.speech?.repeatCount))
      ? Number(preview?.speechRepeatCount ?? messageData.speechRepeatCount ?? preview?.envelope?.message?.speech?.repeatCount)
      : 1,
    accuracyRiskBufferMin: Number.isFinite(Number(messageData.accuracyRiskBufferMin ?? preview?.accuracyRiskBufferMin))
      ? Math.max(0, Number(messageData.accuracyRiskBufferMin ?? preview?.accuracyRiskBufferMin))
      : 0,
    accuracySpreadMin: Number.isFinite(Number(messageData.accuracySpreadMin ?? preview?.accuracySpreadMin))
      ? Math.max(0, Number(messageData.accuracySpreadMin ?? preview?.accuracySpreadMin))
      : null,
    targetReadiness: String(preview?.targetHealth?.deliveryReadiness || ""),
    mode: gatewayConfig.mode,
    request: plan.request,
  };

  if (!preview) {
    return {
      ...baseAttempt,
      status: "IDLE",
      reason: plan.reason,
      response: null,
    };
  }

  if (preview.status === "blocked") {
    return {
      ...baseAttempt,
      status: "BLOCKED",
      reason: plan.reason,
      response: null,
    };
  }

  if (preview.status !== "ready") {
    return {
      ...baseAttempt,
      status: "IDLE",
      reason: plan.reason,
      response: null,
    };
  }

  if (plan.status === "blocked") {
    return {
      ...baseAttempt,
      status: "BLOCKED",
      reason: plan.reason,
      response: null,
    };
  }

  if (plan.status === "unsupported") {
    return {
      ...baseAttempt,
      status: "UNSUPPORTED",
      reason: plan.reason,
      response: null,
    };
  }

  if (gatewayConfig.mode !== "execute") {
    return {
      ...baseAttempt,
      status: "DRY_RUN_READY",
      reason: "Push gateway is in preview mode, so the provider request was prepared but not sent.",
      response: null,
    };
  }

  try {
    if (plan.adapter === "fcm") {
      const tokenResolution = await resolveFcmAccessToken(env, currentNow);
      if (tokenResolution.status !== "ready") {
        return {
          ...baseAttempt,
          status: "BLOCKED",
          reason: tokenResolution.reason || "FCM authentication is not ready.",
          response: null,
        };
      }

      const response = await executeFcmRequest(buildFcmRequest(preview, gatewayConfig, tokenResolution.accessToken));
      return {
        ...baseAttempt,
        status: response.ok ? "SENT" : "FAILED",
        reason: response.ok ? "FCM accepted the provider request." : response.reason,
        response: {
          ...response,
          authSource: tokenResolution.source,
          tokenExpiresAt: tokenResolution.expiresAt,
        },
      };
    }

    if (plan.adapter === "apns") {
      const authorizationToken = createApnsAuthToken(env, currentNow);
      const response = await executeApnsRequest(buildApnsRequest(preview, gatewayConfig, authorizationToken));
      if (["ExpiredProviderToken", "InvalidProviderToken"].includes(response.providerErrorCode)) {
        invalidateCachedApnsToken();
      }
      return {
        ...baseAttempt,
        status: response.ok ? "SENT" : "FAILED",
        reason: response.ok ? "APNs accepted the provider request." : response.reason,
        response,
      };
    }

    if (plan.adapter === "web-push") {
      const rawRequest = buildWebPushRequest(preview, gatewayConfig, targetProfile, env);
      if (!rawRequest) {
        return {
          ...baseAttempt,
          status: "BLOCKED",
          reason: "The browser Web Push subscription is missing or incomplete.",
          response: null,
        };
      }
      const response = await executeWebPushRequest(rawRequest);
      return {
        ...baseAttempt,
        status: response.ok ? "SENT" : "FAILED",
        reason: response.ok ? "Web Push provider accepted the request." : response.reason,
        response,
      };
    }

    return {
      ...baseAttempt,
      status: "UNSUPPORTED",
      reason: "The selected push adapter is not supported.",
      response: null,
    };
  } catch (error) {
    return {
      ...baseAttempt,
      status: "FAILED",
      reason: error instanceof Error ? error.message : "Unknown push gateway execution error.",
      response: null,
    };
  }
}

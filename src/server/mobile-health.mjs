import { getBusApiConfig } from "./bus-providers.mjs";
import { readFcmAuthStatus } from "./fcm-auth.mjs";
import { getPushGatewayConfig } from "./push-gateway.mjs";

/**
 * Builds the unauthenticated readiness response used by real Android and iPhone testers.
 * Keep this free of user runtime state so a platform health probe can safely call it.
 */
export async function buildMobileHealthPayload(env = process.env, now = new Date()) {
  const busConfig = getBusApiConfig();
  const pushGatewayConfig = getPushGatewayConfig(env);
  const fcmAuthStatus = await readFcmAuthStatus(env, now);
  const fcmConfig = pushGatewayConfig.adapters.fcm;
  const apnsConfig = pushGatewayConfig.adapters.apns;
  const fcmConfigured = Boolean(fcmConfig.configured);
  const apnsConfigured = Boolean(apnsConfig.configured);

  return {
    ok: true,
    product: "BusWakeUp",
    mobileShellReady: true,
    serverTime: now.toISOString(),
    launchFocus: ["seoul", "gyeonggi"],
    sessionProbePath: "/api/auth/session",
    busPolicy: {
      objective: busConfig.objective,
      recommendedProviderOrder: busConfig.recommendedProviderOrder,
    },
    pushGateway: {
      mode: pushGatewayConfig.mode,
      adapter: fcmConfigured ? "fcm" : apnsConfigured ? "apns-dry-run" : "preview",
      executeSupported: fcmConfigured && Boolean(fcmConfig.executeSupported),
      authStrategy: fcmAuthStatus.authStrategy,
      accessTokenStatus: fcmAuthStatus.accessTokenStatus,
    },
  };
}

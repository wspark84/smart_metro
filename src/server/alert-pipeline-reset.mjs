import { createDispatchQueueState } from "./dispatch-engine.mjs";
import { createPushGatewayState } from "./push-gateway-store.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function matchesTriggerStageKey(value, alertTriggerKey) {
  const safeValue = String(value || "").trim();
  const safeTriggerKey = String(alertTriggerKey || "").trim();
  if (!safeValue || !safeTriggerKey) {
    return false;
  }

  return safeValue === safeTriggerKey || safeValue.startsWith(`${safeTriggerKey}:stage-`);
}

export function resetDispatchQueueForAlert(queueState, alertTriggerKey) {
  const next = {
    ...createDispatchQueueState(),
    ...(queueState && typeof queueState === "object" ? clone(queueState) : {}),
    bundles: Array.isArray(queueState?.bundles) ? [...queueState.bundles] : [],
    handledDispatchKeys: Array.isArray(queueState?.handledDispatchKeys)
      ? [...queueState.handledDispatchKeys]
      : [],
  };
  const beforeCount = next.bundles.length;

  next.bundles = next.bundles.filter(
    (bundle) =>
      !matchesTriggerStageKey(bundle?.dispatchKey, alertTriggerKey) &&
      String(bundle?.alertTriggerKey || "").trim() !== String(alertTriggerKey || "").trim(),
  );
  next.handledDispatchKeys = next.handledDispatchKeys.filter(
    (dispatchKey) => !matchesTriggerStageKey(dispatchKey, alertTriggerKey),
  );

  if (beforeCount !== next.bundles.length && !next.bundles.length) {
    next.lastGeneratedAt = null;
  }

  return next;
}

export function resetPushGatewayHandledKeysForAlert(gatewayState, alertTriggerKey) {
  const next = {
    ...createPushGatewayState(),
    ...(gatewayState && typeof gatewayState === "object" ? clone(gatewayState) : {}),
    attempts: Array.isArray(gatewayState?.attempts) ? [...gatewayState.attempts] : [],
    handledDispatchKeys: Array.isArray(gatewayState?.handledDispatchKeys)
      ? [...gatewayState.handledDispatchKeys]
      : [],
  };

  next.handledDispatchKeys = next.handledDispatchKeys.filter(
    (dispatchKey) => !matchesTriggerStageKey(dispatchKey, alertTriggerKey),
  );

  return next;
}

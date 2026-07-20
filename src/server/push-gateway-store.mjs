import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const DEFAULT_PUSH_GATEWAY_ATTEMPTS_FILE = join(process.cwd(), "data", "push-gateway-attempts.json");

function validatePushGatewayState(gatewayState) {
  if (!gatewayState || typeof gatewayState !== "object" || Array.isArray(gatewayState)) {
    throw new Error("Push gateway state must be a JSON object.");
  }

  return {
    dateKey: gatewayState.dateKey ? String(gatewayState.dateKey) : null,
    attempts: Array.isArray(gatewayState.attempts) ? gatewayState.attempts : [],
    handledDispatchKeys: Array.isArray(gatewayState.handledDispatchKeys)
      ? [...new Set(gatewayState.handledDispatchKeys.map((value) => String(value || "").trim()).filter(Boolean))]
      : [],
    retryQueue: Array.isArray(gatewayState.retryQueue) ? gatewayState.retryQueue : [],
    lastAttemptAt: gatewayState.lastAttemptAt ? String(gatewayState.lastAttemptAt) : null,
  };
}

export function createPushGatewayState() {
  return {
    dateKey: null,
    attempts: [],
    handledDispatchKeys: [],
    retryQueue: [],
    lastAttemptAt: null,
  };
}

export async function readPushGatewayState(filePath = DEFAULT_PUSH_GATEWAY_ATTEMPTS_FILE) {
  try {
    const raw = await readFile(filePath, "utf8");
    return validatePushGatewayState(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writePushGatewayState(gatewayState, filePath = DEFAULT_PUSH_GATEWAY_ATTEMPTS_FILE) {
  const safeGatewayState = validatePushGatewayState(gatewayState);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(safeGatewayState, null, 2)}\n`, "utf8");
  return safeGatewayState;
}

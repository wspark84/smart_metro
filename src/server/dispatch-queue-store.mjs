import { mkdir, readFile, writeFile } from "./document-storage.mjs";
import { dirname, join } from "node:path";

export const DEFAULT_DISPATCH_QUEUE_FILE = join(process.cwd(), "data", "dispatch-queue.json");

function validateDispatchQueueState(queueState) {
  if (!queueState || typeof queueState !== "object" || Array.isArray(queueState)) {
    throw new Error("Dispatch queue state must be a JSON object.");
  }

  return {
    dateKey: queueState.dateKey ? String(queueState.dateKey) : null,
    bundles: Array.isArray(queueState.bundles) ? queueState.bundles : [],
    handledDispatchKeys: Array.isArray(queueState.handledDispatchKeys)
      ? queueState.handledDispatchKeys
      : Array.isArray(queueState.handledAlertKeys)
        ? queueState.handledAlertKeys
        : [],
    lastGeneratedAt: queueState.lastGeneratedAt ? String(queueState.lastGeneratedAt) : null,
  };
}

export async function readDispatchQueueState(filePath = DEFAULT_DISPATCH_QUEUE_FILE) {
  try {
    const raw = await readFile(filePath, "utf8");
    return validateDispatchQueueState(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writeDispatchQueueState(queueState, filePath = DEFAULT_DISPATCH_QUEUE_FILE) {
  const safeQueueState = validateDispatchQueueState(queueState);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(safeQueueState, null, 2)}\n`, "utf8");
  return safeQueueState;
}

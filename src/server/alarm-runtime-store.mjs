import { mkdir, readFile, writeFile } from "./document-storage.mjs";
import { dirname, join } from "node:path";

export const DEFAULT_ALARM_RUNTIME_FILE = join(process.cwd(), "data", "alarm-runtime.json");

function validateRuntimeState(runtimeState) {
  if (!runtimeState || typeof runtimeState !== "object" || Array.isArray(runtimeState)) {
    throw new Error("Alarm runtime state must be a JSON object.");
  }

  return runtimeState;
}

export async function readAlarmRuntimeState(filePath = DEFAULT_ALARM_RUNTIME_FILE) {
  try {
    const raw = await readFile(filePath, "utf8");
    return validateRuntimeState(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writeAlarmRuntimeState(runtimeState, filePath = DEFAULT_ALARM_RUNTIME_FILE) {
  const safeRuntimeState = validateRuntimeState(runtimeState);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(safeRuntimeState, null, 2)}\n`, "utf8");
  return safeRuntimeState;
}

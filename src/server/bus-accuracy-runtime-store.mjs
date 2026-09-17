import { mkdir, readFile, writeFile } from "./document-storage.mjs";
import { dirname, join } from "node:path";

import { createBusAccuracyRuntimeState, normalizeBusAccuracyRuntimeState } from "./bus-accuracy-runtime.mjs";

export const DEFAULT_BUS_ACCURACY_RUNTIME_FILE = join(process.cwd(), "data", "bus-accuracy-runtime.json");

export async function readBusAccuracyRuntimeState(filePath = DEFAULT_BUS_ACCURACY_RUNTIME_FILE) {
  try {
    const raw = await readFile(filePath, "utf8");
    return normalizeBusAccuracyRuntimeState(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return createBusAccuracyRuntimeState();
    }

    throw error;
  }
}

export async function writeBusAccuracyRuntimeState(state, filePath = DEFAULT_BUS_ACCURACY_RUNTIME_FILE) {
  const safeState = normalizeBusAccuracyRuntimeState(state);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(safeState, null, 2)}\n`, "utf8");
  return safeState;
}

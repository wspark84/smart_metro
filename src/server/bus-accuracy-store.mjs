import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createBusAccuracyState, normalizeBusAccuracyState } from "./bus-accuracy.mjs";

export const DEFAULT_BUS_ACCURACY_FILE = join(process.cwd(), "data", "bus-accuracy.json");

export async function readBusAccuracyState(filePath = DEFAULT_BUS_ACCURACY_FILE) {
  try {
    const raw = await readFile(filePath, "utf8");
    return normalizeBusAccuracyState(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return createBusAccuracyState();
    }

    throw error;
  }
}

export async function writeBusAccuracyState(state, filePath = DEFAULT_BUS_ACCURACY_FILE) {
  const safeState = normalizeBusAccuracyState(state);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(safeState, null, 2)}\n`, "utf8");
  return safeState;
}

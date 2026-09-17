import { mkdir, readFile, writeFile } from "./document-storage.mjs";
import { dirname, join } from "node:path";

export const DEFAULT_APP_STATE_FILE = join(process.cwd(), "data", "app-state.json");

function validateStateShape(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("Persisted app state must be a JSON object.");
  }

  return state;
}

export async function readAppState(filePath = DEFAULT_APP_STATE_FILE) {
  try {
    const raw = await readFile(filePath, "utf8");
    return validateStateShape(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writeAppState(state, filePath = DEFAULT_APP_STATE_FILE) {
  const safeState = validateStateShape(state);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(safeState, null, 2)}\n`, "utf8");
  return safeState;
}

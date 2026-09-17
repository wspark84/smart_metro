import { mkdir, readFile, writeFile } from "./document-storage.mjs";
import { dirname, join } from "node:path";

export const DEFAULT_DISPATCH_EXECUTION_FILE = join(process.cwd(), "data", "dispatch-executions.json");

function validateDispatchExecutionState(executionState) {
  if (!executionState || typeof executionState !== "object" || Array.isArray(executionState)) {
    throw new Error("Dispatch execution state must be a JSON object.");
  }

  return {
    dateKey: executionState.dateKey ? String(executionState.dateKey) : null,
    attempts: Array.isArray(executionState.attempts) ? executionState.attempts : [],
    handledBundleIds: Array.isArray(executionState.handledBundleIds) ? executionState.handledBundleIds : [],
    lastExecutedAt: executionState.lastExecutedAt ? String(executionState.lastExecutedAt) : null,
  };
}

export async function readDispatchExecutionState(filePath = DEFAULT_DISPATCH_EXECUTION_FILE) {
  try {
    const raw = await readFile(filePath, "utf8");
    return validateDispatchExecutionState(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writeDispatchExecutionState(executionState, filePath = DEFAULT_DISPATCH_EXECUTION_FILE) {
  const safeExecutionState = validateDispatchExecutionState(executionState);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(safeExecutionState, null, 2)}\n`, "utf8");
  return safeExecutionState;
}

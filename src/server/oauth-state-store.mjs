import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const DEFAULT_OAUTH_STATE_FILE = join(process.cwd(), "data", "auth", "oauth-states.json");

function normalizeOAuthStateRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("OAuth state record must be a JSON object.");
  }

  return {
    id: String(record.id || "").trim(),
    provider: String(record.provider || "").trim(),
    state: String(record.state || "").trim(),
    nonce: String(record.nonce || "").trim(),
    redirectAfterAuth: String(record.redirectAfterAuth || "/").trim() || "/",
    createdAt: String(record.createdAt || ""),
    expiresAt: String(record.expiresAt || ""),
  };
}

function normalizeOAuthStateRecords(records) {
  if (!Array.isArray(records)) {
    throw new Error("OAuth state payload must be stored as an array.");
  }

  return records.map(normalizeOAuthStateRecord);
}

export async function readOAuthStates(filePath = DEFAULT_OAUTH_STATE_FILE) {
  try {
    const raw = await readFile(filePath, "utf8");
    return normalizeOAuthStateRecords(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function writeOAuthStates(records, filePath = DEFAULT_OAUTH_STATE_FILE) {
  const safeRecords = normalizeOAuthStateRecords(records);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(safeRecords, null, 2)}\n`, "utf8");
  return safeRecords;
}

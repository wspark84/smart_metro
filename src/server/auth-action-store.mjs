import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const DEFAULT_AUTH_ACTION_FILE = join(process.cwd(), "data", "auth", "action-tokens.json");
export const AUTH_ACTION_TTL_MINUTES = Object.freeze({
  "verify-email": 60 * 24,
  "reset-password": 30,
});

function normalizePurpose(value) {
  const purpose = String(value || "").trim();
  if (!Object.hasOwn(AUTH_ACTION_TTL_MINUTES, purpose)) {
    throw new Error("Unknown account action token purpose.");
  }
  return purpose;
}

function hashToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Account action token record must be a JSON object.");
  }

  return {
    id: String(record.id || "").trim(),
    purpose: normalizePurpose(record.purpose),
    userId: String(record.userId || "").trim(),
    tokenHash: String(record.tokenHash || "").trim(),
    createdAt: String(record.createdAt || ""),
    expiresAt: String(record.expiresAt || ""),
    consumedAt: record.consumedAt ? String(record.consumedAt) : null,
  };
}

function normalizeRecords(records) {
  if (!Array.isArray(records)) {
    throw new Error("Account action tokens must be stored as an array.");
  }
  return records.map(normalizeRecord);
}

export async function readAuthActionTokens(filePath = DEFAULT_AUTH_ACTION_FILE) {
  try {
    return normalizeRecords(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function writeAuthActionTokens(records, filePath = DEFAULT_AUTH_ACTION_FILE) {
  const safeRecords = normalizeRecords(records);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(safeRecords, null, 2)}\n`, "utf8");
  return safeRecords;
}

export function pruneAuthActionTokens(records, now = new Date()) {
  const nowTime = now.getTime();
  return (Array.isArray(records) ? records : []).filter((record) => {
    const expiresAt = Date.parse(record?.expiresAt || "");
    return Number.isFinite(expiresAt) && expiresAt > nowTime && !record?.consumedAt;
  });
}

export function createAuthActionToken(purpose, userId, now = new Date()) {
  const safePurpose = normalizePurpose(purpose);
  const safeUserId = String(userId || "").trim();
  if (!safeUserId) {
    throw new Error("An account action token requires a user id.");
  }

  const token = randomBytes(32).toString("base64url");
  const createdAt = now.toISOString();
  const ttlMinutes = AUTH_ACTION_TTL_MINUTES[safePurpose];
  return {
    token,
    record: {
      id: randomUUID(),
      purpose: safePurpose,
      userId: safeUserId,
      tokenHash: hashToken(token),
      createdAt,
      expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
      consumedAt: null,
    },
  };
}

export function consumeAuthActionToken(records, purpose, token, now = new Date()) {
  const safePurpose = normalizePurpose(purpose);
  const safeTokenHash = hashToken(token);
  const safeRecords = Array.isArray(records) ? records.map(normalizeRecord) : [];
  const nowTime = now.getTime();
  let consumed = null;
  const nextRecords = safeRecords.map((record) => {
    const expiresAt = Date.parse(record.expiresAt);
    const isUsable =
      !record.consumedAt &&
      record.purpose === safePurpose &&
      Number.isFinite(expiresAt) &&
      expiresAt > nowTime &&
      record.tokenHash === safeTokenHash;
    if (!isUsable || consumed) {
      return record;
    }
    consumed = { ...record, consumedAt: now.toISOString() };
    return consumed;
  });

  return { record: consumed, records: nextRecords };
}

export function replacePendingAuthActionToken(records, pendingRecord) {
  const safePending = normalizeRecord(pendingRecord);
  return (Array.isArray(records) ? records.map(normalizeRecord) : [])
    .filter(
      (record) =>
        record.consumedAt || record.userId !== safePending.userId || record.purpose !== safePending.purpose,
    )
    .concat(safePending);
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const DEFAULT_AUTH_USERS_FILE = join(process.cwd(), "data", "auth", "users.json");
export const DEFAULT_AUTH_SESSIONS_FILE = join(process.cwd(), "data", "auth", "sessions.json");

function normalizeUserRecord(user) {
  if (!user || typeof user !== "object" || Array.isArray(user)) {
    throw new Error("Auth user record must be a JSON object.");
  }

  return {
    id: String(user.id || "").trim(),
    email: String(user.email || "").trim().toLowerCase(),
    emailVerified: user.emailVerified === true,
    name: String(user.name || "").trim(),
    passwordHash: String(user.passwordHash || "").trim(),
    passwordSalt: String(user.passwordSalt || "").trim(),
    providers:
      user.providers && typeof user.providers === "object" && !Array.isArray(user.providers)
        ? Object.fromEntries(
            Object.entries(user.providers).map(([providerName, providerValue]) => [
              String(providerName || "").trim().toLowerCase(),
              {
                subject: String(providerValue?.subject || "").trim(),
                email: String(providerValue?.email || "").trim().toLowerCase(),
                linkedAt: String(providerValue?.linkedAt || ""),
              },
            ]),
          )
        : {},
    createdAt: String(user.createdAt || ""),
    updatedAt: String(user.updatedAt || ""),
  };
}

function normalizeSessionRecord(session) {
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    throw new Error("Auth session record must be a JSON object.");
  }

  return {
    id: String(session.id || "").trim(),
    userId: String(session.userId || "").trim(),
    createdAt: String(session.createdAt || ""),
    updatedAt: String(session.updatedAt || ""),
    expiresAt: String(session.expiresAt || ""),
  };
}

function normalizeCollection(records, itemNormalizer, label) {
  if (!Array.isArray(records)) {
    throw new Error(`${label} must be stored as an array.`);
  }

  return records.map(itemNormalizer);
}

export async function readAuthUsers(filePath = DEFAULT_AUTH_USERS_FILE) {
  try {
    const raw = await readFile(filePath, "utf8");
    return normalizeCollection(JSON.parse(raw), normalizeUserRecord, "Auth users");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function writeAuthUsers(users, filePath = DEFAULT_AUTH_USERS_FILE) {
  const safeUsers = normalizeCollection(users, normalizeUserRecord, "Auth users");
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(safeUsers, null, 2)}\n`, "utf8");
  return safeUsers;
}

export async function readAuthSessions(filePath = DEFAULT_AUTH_SESSIONS_FILE) {
  try {
    const raw = await readFile(filePath, "utf8");
    return normalizeCollection(JSON.parse(raw), normalizeSessionRecord, "Auth sessions");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function writeAuthSessions(sessions, filePath = DEFAULT_AUTH_SESSIONS_FILE) {
  const safeSessions = normalizeCollection(sessions, normalizeSessionRecord, "Auth sessions");
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(safeSessions, null, 2)}\n`, "utf8");
  return safeSessions;
}

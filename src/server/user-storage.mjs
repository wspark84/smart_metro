import { join } from "node:path";

const USERS_ROOT = join(process.cwd(), "data", "users");

export function sanitizeUserStorageKey(userId) {
  const normalized = String(userId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized) {
    throw new Error("A valid user id is required for user-scoped storage.");
  }

  return normalized;
}

export function buildUserDataRoot(userId) {
  return join(USERS_ROOT, sanitizeUserStorageKey(userId));
}

export function buildUserDataFilePath(userId, fileName) {
  const safeFileName = String(fileName || "").trim();
  if (!safeFileName) {
    throw new Error("A file name is required for user-scoped storage.");
  }

  return join(buildUserDataRoot(userId), safeFileName);
}

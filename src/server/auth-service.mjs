import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export const AUTH_SESSION_COOKIE = "buswakeup_session";
export const AUTH_SESSION_TTL_DAYS = 30;

function invalidAuthInput(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function sanitizeAuthUser(user) {
  return {
    id: String(user?.id || "").trim(),
    email: normalizeEmail(user?.email),
    emailVerified: user?.emailVerified === true,
    name: String(user?.name || "").trim(),
    providers:
      user?.providers && typeof user.providers === "object" && !Array.isArray(user.providers)
        ? Object.keys(user.providers)
            .map((providerName) => String(providerName || "").trim().toLowerCase())
            .filter(Boolean)
            .sort()
        : [],
    createdAt: String(user?.createdAt || ""),
    updatedAt: String(user?.updatedAt || ""),
  };
}

export async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const plain = String(password || "");
  if (plain.length < 8) {
    throw invalidAuthInput("Password must be at least 8 characters long.");
  }

  const derived = await scrypt(plain, salt, 64);
  return {
    passwordSalt: salt,
    passwordHash: derived.toString("hex"),
  };
}

export async function verifyPassword(password, passwordSalt, passwordHash) {
  const derived = await scrypt(String(password || ""), String(passwordSalt || ""), 64);
  const expected = Buffer.from(String(passwordHash || ""), "hex");
  if (!expected.length || expected.length !== derived.length) {
    return false;
  }

  return timingSafeEqual(expected, derived);
}

export async function registerAuthUser(existingUsers, payload, now = new Date()) {
  const email = normalizeEmail(payload?.email);
  const name = String(payload?.name || "").trim();
  const password = String(payload?.password || "");

  if (!email || !email.includes("@")) {
    throw invalidAuthInput("A valid email address is required.");
  }

  if (!name) {
    throw invalidAuthInput("A display name is required.");
  }

  if (existingUsers.some((user) => normalizeEmail(user.email) === email)) {
    const error = new Error("That email address is already registered.");
    error.statusCode = 409;
    throw error;
  }

  const passwordMaterial = await hashPassword(password);
  const createdAt = now.toISOString();
  return {
    id: randomUUID(),
    email,
    emailVerified: false,
    name,
    ...passwordMaterial,
    providers: {},
    createdAt,
    updatedAt: createdAt,
  };
}

export async function authenticateAuthUser(existingUsers, payload) {
  const email = normalizeEmail(payload?.email);
  const password = String(payload?.password || "");
  const user = existingUsers.find((item) => normalizeEmail(item.email) === email) || null;
  if (!user) {
    return null;
  }

  const matched = await verifyPassword(password, user.passwordSalt, user.passwordHash);
  return matched ? user : null;
}

export function ensureSocialAuthUser(existingUsers, provider, profile, now = new Date()) {
  const safeUsers = Array.isArray(existingUsers) ? existingUsers : [];
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const subject = String(profile?.subject || "").trim();
  const email = normalizeEmail(profile?.email);
  const name = String(profile?.name || profile?.email || `${normalizedProvider} user`).trim();

  if (!normalizedProvider || !subject) {
    throw invalidAuthInput("A provider name and provider subject are required.");
  }

  const matchedByProvider =
    safeUsers.find((user) => String(user?.providers?.[normalizedProvider]?.subject || "").trim() === subject) || null;
  const matchedByEmail = email
    ? safeUsers.find((user) => normalizeEmail(user?.email) === email) || null
    : null;

  // An unverified provider claim must never be allowed to attach a new social
  // identity to an existing local account that happens to use the same email.
  if (!matchedByProvider && matchedByEmail && !profile?.emailVerified) {
    throw invalidAuthInput("The social provider did not verify ownership of this email address.");
  }

  const matchedUser = matchedByProvider || matchedByEmail;

  if (!matchedUser) {
    const createdAt = now.toISOString();
    matchedUser = {
      id: randomUUID(),
      email,
      emailVerified: Boolean(profile?.emailVerified),
      name,
      passwordHash: "",
      passwordSalt: "",
      providers: {
        [normalizedProvider]: {
          subject,
          email,
          linkedAt: createdAt,
        },
      },
      createdAt,
      updatedAt: createdAt,
    };
    return {
      users: [...safeUsers, matchedUser],
      user: matchedUser,
      created: true,
    };
  }

  const mayReplaceEmail = Boolean(profile?.emailVerified);
  const resolvedEmail = mayReplaceEmail ? email || matchedUser.email : matchedUser.email;
  const updatedUser = {
    ...matchedUser,
    email: resolvedEmail,
    emailVerified: Boolean(matchedUser.emailVerified || profile?.emailVerified),
    name: name || matchedUser.name,
    providers: {
      ...(matchedUser.providers || {}),
      [normalizedProvider]: {
        subject,
        email: mayReplaceEmail ? email || matchedUser.email : matchedUser.providers?.[normalizedProvider]?.email || matchedUser.email,
        linkedAt: matchedUser.providers?.[normalizedProvider]?.linkedAt || now.toISOString(),
      },
    },
    updatedAt: now.toISOString(),
  };

  return {
    users: safeUsers.map((user) => (user.id === updatedUser.id ? updatedUser : user)),
    user: updatedUser,
    created: false,
  };
}

export function updateAuthUserProfile(existingUsers, userId, payload, now = new Date()) {
  const safeUsers = Array.isArray(existingUsers) ? existingUsers : [];
  const targetUserId = String(userId || "").trim();
  const nextName = String(payload?.name || "").trim();

  if (!targetUserId) {
    throw invalidAuthInput("A valid user id is required.");
  }

  if (!nextName) {
    throw invalidAuthInput("A display name is required.");
  }

  let updatedUser = null;
  const nextUsers = safeUsers.map((user) => {
    if (String(user?.id || "") !== targetUserId) {
      return user;
    }

    updatedUser = {
      ...user,
      name: nextName,
      updatedAt: now.toISOString(),
    };
    return updatedUser;
  });

  if (!updatedUser) {
    const error = new Error("The requested account could not be found.");
    error.statusCode = 404;
    throw error;
  }

  return {
    users: nextUsers,
    user: updatedUser,
  };
}

export async function changeAuthUserPassword(existingUsers, userId, payload, now = new Date()) {
  const safeUsers = Array.isArray(existingUsers) ? existingUsers : [];
  const targetUserId = String(userId || "").trim();
  const currentPassword = String(payload?.currentPassword || "");
  const newPassword = String(payload?.newPassword || "");

  if (!targetUserId) {
    throw invalidAuthInput("A valid user id is required.");
  }

  const currentUser = safeUsers.find((user) => String(user?.id || "") === targetUserId) || null;
  if (!currentUser) {
    const error = new Error("The requested account could not be found.");
    error.statusCode = 404;
    throw error;
  }

  const matched = await verifyPassword(currentPassword, currentUser.passwordSalt, currentUser.passwordHash);
  if (!matched) {
    const error = new Error("The current password did not match.");
    error.statusCode = 401;
    throw error;
  }

  const nextPassword = await hashPassword(newPassword);
  const updatedUser = {
    ...currentUser,
    ...nextPassword,
    updatedAt: now.toISOString(),
  };

  return {
    users: safeUsers.map((user) => (String(user?.id || "") === targetUserId ? updatedUser : user)),
    user: updatedUser,
  };
}

export function markAuthUserEmailVerified(existingUsers, userId, now = new Date()) {
  const safeUsers = Array.isArray(existingUsers) ? existingUsers : [];
  const targetUserId = String(userId || "").trim();
  let user = null;
  const users = safeUsers.map((item) => {
    if (String(item?.id || "") !== targetUserId) {
      return item;
    }
    user = {
      ...item,
      emailVerified: true,
      updatedAt: now.toISOString(),
    };
    return user;
  });

  if (!user) {
    const error = new Error("The requested account could not be found.");
    error.statusCode = 404;
    throw error;
  }

  return { users, user };
}

export async function resetAuthUserPassword(existingUsers, userId, newPassword, now = new Date()) {
  const safeUsers = Array.isArray(existingUsers) ? existingUsers : [];
  const targetUserId = String(userId || "").trim();
  const currentUser = safeUsers.find((user) => String(user?.id || "") === targetUserId) || null;
  if (!currentUser) {
    const error = new Error("The requested account could not be found.");
    error.statusCode = 404;
    throw error;
  }

  const nextPassword = await hashPassword(newPassword);
  const user = {
    ...currentUser,
    ...nextPassword,
    updatedAt: now.toISOString(),
  };
  return {
    users: safeUsers.map((item) => (String(item?.id || "") === targetUserId ? user : item)),
    user,
  };
}

export function issueAuthSession(userId, now = new Date(), ttlDays = AUTH_SESSION_TTL_DAYS) {
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  return {
    id: randomBytes(24).toString("hex"),
    userId: String(userId || "").trim(),
    createdAt,
    updatedAt: createdAt,
    expiresAt,
  };
}

export function pruneExpiredAuthSessions(sessions, now = new Date()) {
  const nowTime = now.getTime();
  return Array.isArray(sessions)
    ? sessions.filter((session) => {
        const expiresTime = Date.parse(session?.expiresAt || "");
        return Number.isFinite(expiresTime) && expiresTime > nowTime;
      })
    : [];
}

export function findAuthSession(sessions, sessionId, now = new Date()) {
  const trimmedId = String(sessionId || "").trim();
  if (!trimmedId) {
    return null;
  }

  const nowTime = now.getTime();
  return (
    sessions.find((session) => {
      if (String(session?.id || "") !== trimmedId) {
        return false;
      }

      const expiresTime = Date.parse(session?.expiresAt || "");
      return Number.isFinite(expiresTime) && expiresTime > nowTime;
    }) || null
  );
}

export function touchAuthSession(session, now = new Date()) {
  return {
    ...session,
    updatedAt: now.toISOString(),
  };
}

export function parseCookieHeader(cookieHeader) {
  const header = String(cookieHeader || "");
  if (!header) {
    return {};
  }

  return header.split(";").reduce((accumulator, part) => {
    const [rawName, ...rawValue] = part.split("=");
    const name = String(rawName || "").trim();
    if (!name) {
      return accumulator;
    }

    accumulator[name] = decodeURIComponent(rawValue.join("=").trim());
    return accumulator;
  }, {});
}

export function createSessionCookieValue(sessionId, options = {}) {
  const config = typeof options === "number" ? { ttlDays: options } : options;
  const ttlDays = config?.ttlDays ?? AUTH_SESSION_TTL_DAYS;
  const maxAge = Math.max(1, Math.round(ttlDays * 24 * 60 * 60));
  const secureAttribute = config?.secure ? "; Secure" : "";
  return `${AUTH_SESSION_COOKIE}=${encodeURIComponent(String(sessionId || "").trim())}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secureAttribute}`;
}

export function createClearedSessionCookieValue({ secure = false } = {}) {
  const secureAttribute = secure ? "; Secure" : "";
  return `${AUTH_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secureAttribute}`;
}

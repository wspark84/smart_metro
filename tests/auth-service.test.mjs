import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTH_SESSION_COOKIE,
  authenticateAuthUser,
  changeAuthUserPassword,
  createClearedSessionCookieValue,
  createSessionCookieValue,
  ensureSocialAuthUser,
  findAuthSession,
  issueAuthSession,
  parseCookieHeader,
  pruneExpiredAuthSessions,
  registerAuthUser,
  sanitizeAuthUser,
  markAuthUserEmailVerified,
  resetAuthUserPassword,
  touchAuthSession,
  updateAuthUserProfile,
  verifyPassword,
} from "../src/server/auth-service.mjs";

test("registerAuthUser creates a normalized user and hashes the password", async () => {
  const user = await registerAuthUser([], {
    email: " Founder@Example.com ",
    name: "Founder",
    password: "supersecret",
  });

  assert.match(user.id, /[a-f0-9-]{10,}/);
  assert.equal(user.email, "founder@example.com");
  assert.equal(user.name, "Founder");
  assert.ok(user.passwordHash);
  assert.ok(user.passwordSalt);
  assert.equal(await verifyPassword("supersecret", user.passwordSalt, user.passwordHash), true);
});

test("authenticateAuthUser returns the matching user only when the password is correct", async () => {
  const user = await registerAuthUser([], {
    email: "cto@example.com",
    name: "CTO",
    password: "password-123",
  });

  assert.equal(await authenticateAuthUser([user], { email: "cto@example.com", password: "password-123" }), user);
  assert.equal(await authenticateAuthUser([user], { email: "cto@example.com", password: "wrong-pass" }), null);
});

test("session helpers manage expiry, cookies, and public user projection", () => {
  const now = new Date("2026-05-13T00:00:00.000Z");
  const session = issueAuthSession("user-1", now, 1);
  const stale = {
    ...session,
    id: "expired-session",
    expiresAt: "2026-05-12T23:59:59.000Z",
  };
  const pruned = pruneExpiredAuthSessions([stale, session], now);

  assert.equal(pruned.length, 1);
  assert.equal(findAuthSession(pruned, session.id, now)?.userId, "user-1");
  assert.equal(touchAuthSession(session, new Date("2026-05-13T01:00:00.000Z")).updatedAt, "2026-05-13T01:00:00.000Z");
  assert.deepEqual(parseCookieHeader(`${AUTH_SESSION_COOKIE}=abc123; theme=dark`), {
    [AUTH_SESSION_COOKIE]: "abc123",
    theme: "dark",
  });
  assert.match(createSessionCookieValue("abc123"), /buswakeup_session=abc123/);
  assert.match(createSessionCookieValue("abc123", { secure: true }), /Secure/);
  assert.match(createClearedSessionCookieValue(), /Max-Age=0/);
  assert.deepEqual(
    sanitizeAuthUser({
      id: "user-1",
      email: "User@Example.com",
      name: "Representative",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
      passwordHash: "secret",
    }),
    {
      id: "user-1",
      email: "user@example.com",
      emailVerified: false,
      name: "Representative",
      providers: [],
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
    },
  );
});

test("email verification and password reset update only the selected account", async () => {
  const owner = await registerAuthUser([], {
    email: "owner@example.com",
    name: "Owner",
    password: "password-123",
  });
  const second = await registerAuthUser([owner], {
    email: "second@example.com",
    name: "Second",
    password: "password-456",
  });

  const verified = markAuthUserEmailVerified([owner, second], owner.id, new Date("2026-05-13T02:00:00.000Z"));
  assert.equal(verified.user.emailVerified, true);
  assert.equal(verified.users[1].emailVerified, false);

  const reset = await resetAuthUserPassword(
    verified.users,
    owner.id,
    "new-password-789",
    new Date("2026-05-13T03:00:00.000Z"),
  );
  assert.equal(await verifyPassword("new-password-789", reset.user.passwordSalt, reset.user.passwordHash), true);
  assert.equal(await verifyPassword("password-123", reset.user.passwordSalt, reset.user.passwordHash), false);
  assert.equal(await verifyPassword("password-456", reset.users[1].passwordSalt, reset.users[1].passwordHash), true);
});

test("updateAuthUserProfile renames only the requested user", async () => {
  const firstUser = await registerAuthUser([], {
    email: "owner@example.com",
    name: "Owner",
    password: "password-123",
  });
  const secondUser = await registerAuthUser([firstUser], {
    email: "cto@example.com",
    name: "CTO",
    password: "password-123",
  });

  const updated = updateAuthUserProfile([firstUser, secondUser], secondUser.id, { name: "Chief Tech Officer" });
  assert.equal(updated.user.name, "Chief Tech Officer");
  assert.equal(updated.users[0].name, "Owner");
});

test("changeAuthUserPassword requires the current password and replaces the stored hash", async () => {
  const firstUser = await registerAuthUser([], {
    email: "owner@example.com",
    name: "Owner",
    password: "password-123",
  });

  const updated = await changeAuthUserPassword([firstUser], firstUser.id, {
    currentPassword: "password-123",
    newPassword: "better-password-456",
  });

  assert.equal(await verifyPassword("better-password-456", updated.user.passwordSalt, updated.user.passwordHash), true);
  assert.equal(await verifyPassword("password-123", updated.user.passwordSalt, updated.user.passwordHash), false);
});

test("ensureSocialAuthUser links a provider by email and preserves one user record", async () => {
  const owner = await registerAuthUser([], {
    email: "owner@example.com",
    name: "Owner",
    password: "password-123",
  });

  const linked = ensureSocialAuthUser([owner], "google", {
    subject: "google-subject-1",
    email: "owner@example.com",
    emailVerified: true,
    name: "Owner From Google",
  });

  assert.equal(linked.users.length, 1);
  assert.equal(linked.user.providers.google.subject, "google-subject-1");
  assert.equal(linked.user.name, "Owner From Google");
});

test("ensureSocialAuthUser creates a new account for a verified social identity", () => {
  const created = ensureSocialAuthUser(
    [],
    "google",
    {
      subject: "google-new-subject-1",
      email: "new-google-user@example.com",
      emailVerified: true,
      name: "New Google User",
    },
    new Date("2026-07-20T00:00:00.000Z"),
  );

  assert.equal(created.created, true);
  assert.equal(created.users.length, 1);
  assert.equal(created.user.email, "new-google-user@example.com");
  assert.equal(created.user.providers.google.subject, "google-new-subject-1");
});

test("ensureSocialAuthUser rejects an unverified social email before linking it to a local account", async () => {
  const owner = await registerAuthUser([], {
    email: "owner@example.com",
    name: "Owner",
    password: "password-123",
  });

  assert.throws(
    () =>
      ensureSocialAuthUser([owner], "google", {
        subject: "unverified-google-subject",
        email: "owner@example.com",
        emailVerified: false,
      }),
    /did not verify ownership/i,
  );
});

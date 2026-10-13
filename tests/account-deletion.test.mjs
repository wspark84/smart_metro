import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { deleteAccount, expiredAuthCookies, DELETE_CONFIRMATION } from "../src/server/account-deletion.mjs";
import { billingAccountId } from "../src/server/play-subscription.mjs";

const inactive = async () => ({ active: false });

test("account deletion requires the typed confirmation", async () => {
  let deleted = 0;
  await assert.rejects(deleteAccount({ userId: "u1", input: {}, deleteUser: async () => deleted++, subscriptionStatus: inactive }), { code: "CONFIRMATION_REQUIRED" });
  await assert.rejects(deleteAccount({ userId: "", input: { confirm: DELETE_CONFIRMATION }, deleteUser: async () => deleted++, subscriptionStatus: inactive }), { code: "LOGIN_REQUIRED" });
  assert.equal(deleted, 0);
  const result = await deleteAccount({ userId: "u1", input: { confirm: " 탈퇴 " }, deleteUser: async (id) => { assert.equal(id, "u1"); deleted++; }, subscriptionStatus: inactive });
  assert.equal(result.ok, true);
  assert.equal(deleted, 1);
});

test("active or unknown subscriptions must be acknowledged before deletion", async () => {
  let deleted = 0;
  const deleteUser = async () => deleted++;
  await assert.rejects(deleteAccount({ userId: "u1", input: { confirm: "탈퇴" }, deleteUser, subscriptionStatus: async () => ({ active: true }) }), { code: "SUBSCRIPTION_ACTIVE", statusCode: 409 });
  await assert.rejects(deleteAccount({ userId: "u1", input: { confirm: "탈퇴" }, deleteUser, subscriptionStatus: async () => { throw new Error("play down"); } }), { code: "SUBSCRIPTION_ACTIVE" });
  assert.equal(deleted, 0);
  await deleteAccount({ userId: "u1", input: { confirm: "탈퇴", acknowledgeSubscription: true }, deleteUser, subscriptionStatus: async () => ({ active: true }) });
  assert.equal(deleted, 1);
});

test("missing service role fails closed with a clear message", async () => {
  await assert.rejects(deleteAccount({ userId: "u1", input: { confirm: "탈퇴" }, deleteUser: null, subscriptionStatus: inactive }), { code: "DELETE_NOT_CONFIGURED", statusCode: 503 });
});

test("all Supabase auth cookies are expired after deletion", () => {
  const cookies = expiredAuthCookies("smart-metro-auth.0=a; smart-metro-auth.1=b; other=c; smart-metro-auth-code-verifier=x", true);
  assert.equal(cookies.length, 3);
  assert.ok(cookies.every((cookie) => /Max-Age=0; HttpOnly; SameSite=Lax; Secure$/.test(cookie)));
  assert.ok(!cookies.some((cookie) => cookie.startsWith("other=")));
});

test("deleting the auth user cascades data and keeps only a de-identified purchase ledger", async () => {
  const db = new PGlite();
  const a = "11111111-1111-4111-8111-111111111111";
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
      create table auth.users(id uuid primary key);insert into auth.users values('${a}');
      create table public.smart_metro_documents(user_id uuid references auth.users(id) on delete cascade,document_key text,payload jsonb);`);
    await db.exec(await readFile(new URL("../supabase/migrations/202610040001_paid_schedules.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/migrations/202610130001_account_deletion_ledger.sql", import.meta.url), "utf8"));
    await db.query("insert into public.smart_metro_documents values($1,'app-state',$2)", [a, { home: "서울시 어딘가" }]);
    await db.query("select public.inochi_save_play_subscription($1)", [{ token_hash: "th1", user_id: a, purchase_token: "raw-secret-token",
      product_id: "inochi_schedule_monthly", state: "SUBSCRIPTION_STATE_ACTIVE", expires_at: "2099-01-01T00:00:00Z", auto_renew: true, verified_at: new Date().toISOString() }]);
    await db.exec(`delete from auth.users where id='${a}'`);
    assert.equal((await db.query("select count(*)::int n from public.smart_metro_documents")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from public.inochi_play_subscriptions")).rows[0].n, 0);
    const ledger = (await db.query("select * from smart_metro_private.inochi_purchase_ledger")).rows;
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].billing_account_hash, billingAccountId(a));
    assert.doesNotMatch(JSON.stringify(ledger), new RegExp(`${a}|raw-secret-token`));
    assert.ok(new Date(ledger[0].retain_until) > new Date(Date.now() + 4.9 * 365 * 86400000));
    await db.exec("update smart_metro_private.inochi_purchase_ledger set retain_until=now()-interval '1 day'");
    assert.equal((await db.query("select smart_metro_private.inochi_purge_purchase_ledger() n")).rows[0].n, 1);
  } finally { await db.close(); }
});

test("delete route requires trusted origin, login and deletes only the caller", async () => {
  const { handleSocialLoginRoute } = await import("../src/server/social-login-routes.mjs");
  const env = { APP_BASE_URL: "https://app.example.com", SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: "pk" };
  const run = async ({ origin = "https://app.example.com", user = { user: { id: "me" } }, body = { confirm: "탈퇴" } } = {}) => {
    const deleted = []; let status, payload; const headers = {};
    const response = { setHeader: (k, v) => { headers[k] = v; }, getHeader: (k) => headers[k],
      writeHead: (s) => { status = s; }, end: (b) => { payload = JSON.parse(b); } };
    await handleSocialLoginRoute({ url: "/api/account/delete", method: "POST", headers: { origin, cookie: "smart-metro-auth.0=a" } }, response,
      async () => body, { env, createAuth: () => ({ resolve: async () => user }), deleteUser: async (id) => deleted.push(id),
        subscriptionStatus: async () => ({ active: false }) });
    return { status, payload, deleted, headers };
  };
  assert.equal((await run({ origin: "https://evil.example" })).status, 403);
  assert.equal((await run({ user: null })).status, 401);
  assert.equal((await run({ body: {} })).status, 400);
  const ok = await run();
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.deleted, ["me"]);
  assert.match(String(ok.headers["Set-Cookie"]), /smart-metro-auth\.0=; Path=\/; Max-Age=0/);
});

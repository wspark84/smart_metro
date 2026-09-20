import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const migration = await readFile(new URL("../supabase/migrations/202609160001_smart_metro_documents.sql", import.meta.url), "utf8");
const batchMigration = await readFile(new URL("../supabase/migrations/202609160002_atomic_document_batch.sql", import.meta.url), "utf8");
const conflictMigration = await readFile(new URL("../supabase/migrations/202609200001_non_retryable_document_conflict.sql", import.meta.url), "utf8");

test("Supabase migration enforces ownership, anonymous denial, and stale-write protection in PostgreSQL", async () => {
  const db = new PGlite();
  try {
    // Model the managed Supabase auth schema locally; no real account or key is used.
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      insert into auth.users values ('${userA}'), ('${userB}');
    `);
    await db.exec(migration);
    await db.exec(migration); // Rerunning setup must be safe.
    await db.exec(batchMigration);
    await db.exec(batchMigration);
    await db.exec(conflictMigration);
    await db.exec(conflictMigration); // Safe to rerun, without replacing any data.
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${userA}';`);
    const save = (key, payload, version) => db.query(
      "select * from public.save_smart_metro_document($1, $2::jsonb, $3::bigint)", [key, JSON.stringify(payload), version]);
    assert.equal((await save("app-state", { owner: "A" }, 0)).rows[0].revision, 1);
    assert.equal((await save("app-state", { owner: "A", changed: true }, 1)).rows[0].revision, 2);
    await assert.rejects(save("app-state", { stale: true }, 1), { code: "PT409" });
    await assert.rejects(save("app-state", {}, 0), { code: "23505" });
    await assert.rejects(save("unapproved-key", {}, 0), { code: "23514" });
    await assert.rejects(db.query("insert into public.smart_metro_documents(user_id, document_key, payload) values ($1, 'domain-store', '{}')", [userB]), { code: "42501" });

    await db.exec(`set request.jwt.claim.sub = '${userB}';`);
    assert.equal((await db.query("select * from public.smart_metro_documents")).rows.length, 0);
    assert.equal((await db.query("update public.smart_metro_documents set payload = '{}' where user_id = $1 returning *", [userA])).rows.length, 0);
    assert.equal((await save("app-state", { owner: "B" }, 0)).rows[0].revision, 1);
    await assert.rejects(db.query("update public.smart_metro_documents set user_id = $1", [userA]), { code: "42501" });
    await assert.rejects(db.query("delete from public.smart_metro_documents"), { code: "42501" });

    await db.exec("reset role; set role anon; set request.jwt.claim.sub = '';");
    await assert.rejects(db.query("select * from public.smart_metro_documents"), { code: "42501" });
    await assert.rejects(save("app-state", {}, 0), { code: "42501" });
    await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${userA}';`);
    const records = (await db.query("select * from public.smart_metro_documents")).rows;
    assert.equal(records.length, 1);
    assert.deepEqual(records[0].payload, { owner: "A", changed: true });
    const batch = (documents) => db.query("select * from public.save_smart_metro_documents($1::jsonb)", [JSON.stringify(documents)]);
    await batch([
      { document_key: "app-state", payload: { batch: true }, expected_revision: 2 },
      { document_key: "domain-store", payload: { route: 1 }, expected_revision: 0 },
    ]);
    await assert.rejects(batch([
      { document_key: "app-state", payload: { mustRollback: true }, expected_revision: 3 },
      { document_key: "domain-store", payload: {}, expected_revision: 7 },
    ]), { code: "PT409" });
    assert.deepEqual((await db.query("select payload from public.smart_metro_documents where document_key='app-state'")).rows[0].payload, { batch: true });
    await assert.rejects(batch([
      { document_key: "app-state", payload: {}, expected_revision: 3 },
      { document_key: "app-state", payload: {}, expected_revision: 3 },
    ]), { code: "22023" });
    await db.exec("reset role; set role anon; set request.jwt.claim.sub = '';");
    await assert.rejects(batch([{ document_key: "app-state", payload: {}, expected_revision: 0 }]), { code: "42501" });
  } finally { await db.close(); }
});

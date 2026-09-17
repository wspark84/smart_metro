import test from "node:test";
import assert from "node:assert/strict";
import { runWithDocumentStorage, readFile, writeFile, mkdir, bufferedResponse } from "../src/server/document-storage.mjs";
import { buildUserDataFilePath, buildUserDataRoot } from "../src/server/user-storage.mjs";

const auth = { user: { id: "user-a" }, accessToken: "jwt-a" };
const path = buildUserDataFilePath("user-a", "app-state.json");

test("document storage stages changes and commits one atomic batch with original revisions", async () => {
  let reads = 0;
  const commits = [];
  const gateway = {
    async readDocument(token) { assert.equal(token, "jwt-a"); reads++; return { payload: { old: true }, revision: 2 }; },
    async saveDocuments(token, documents) { assert.equal(token, "jwt-a"); commits.push(documents); },
  };
  await runWithDocumentStorage(auth, gateway, async () => {
    await mkdir(buildUserDataRoot("user-a"), { recursive: true });
    assert.deepEqual(JSON.parse(await readFile(path)), { old: true });
    await writeFile(path, JSON.stringify({ changed: true }));
    assert.deepEqual(JSON.parse(await readFile(path)), { changed: true });
    assert.equal(commits.length, 0);
    return { commit: true };
  });
  assert.equal(reads, 1);
  assert.deepEqual(commits, [[{ document_key: "app-state", payload: { changed: true }, expected_revision: 2 }]]);
});

test("document storage rejects cross-user paths and does not commit failed handlers", async () => {
  const gateway = { readDocument: async () => null, saveDocuments: () => assert.fail("must not commit") };
  await runWithDocumentStorage(auth, gateway, async () => {
    await assert.rejects(readFile(buildUserDataFilePath("user-b", "app-state.json")), { statusCode: 401 });
    await assert.rejects(writeFile(buildUserDataFilePath("user-a", "auth-users.json"), "{}"), { statusCode: 401 });
    await writeFile(path, "{}");
    return { commit: false };
  });
  await assert.rejects(runWithDocumentStorage(auth, gateway, async () => {
    await writeFile(path, "{}");
    throw new Error("handler failed");
  }), /handler failed/);
});

test("concurrent document contexts never mix owners or tokens", async () => {
  const saved = [];
  const gateway = { readDocument: async () => null, saveDocuments: async (token, documents) => saved.push([token, documents[0].payload]) };
  await Promise.all(["a", "b"].map((id) => runWithDocumentStorage({ user: { id }, accessToken: id }, gateway, async () => {
    await writeFile(buildUserDataFilePath(id, "app-state.json"), JSON.stringify({ owner: id }));
    return {};
  })));
  assert.deepEqual(saved.sort(), [["a", { owner: "a" }], ["b", { owner: "b" }]]);
});

test("database conflicts reject before a buffered success can be flushed", async () => {
  const buffered = bufferedResponse();
  buffered.writeHead(200, { "Content-Type": "application/json" });
  buffered.end('{"ok":true}');
  await assert.rejects(runWithDocumentStorage(auth, {
    readDocument: async () => null,
    saveDocuments: async () => { throw Object.assign(new Error("conflict"), { statusCode: 409 }); },
  }, async () => { await writeFile(path, "{}"); return buffered; }), { statusCode: 409 });
  assert.equal(buffered.commit, true);
});

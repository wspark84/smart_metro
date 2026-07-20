import assert from "node:assert/strict";
import test from "node:test";

import { isAssetPath, resolvePublicStaticFile } from "../src/server/static-assets.mjs";

const ROOT = "C:/buswakeup";

test("static asset policy serves only browser entry and browser source files", () => {
  assert.equal(resolvePublicStaticFile(ROOT, "/index.html"), "C:\\buswakeup\\index.html");
  assert.equal(resolvePublicStaticFile(ROOT, "/sw.js"), "C:\\buswakeup\\sw.js");
  assert.equal(resolvePublicStaticFile(ROOT, "/src/app.js"), "C:\\buswakeup\\src\\app.js");
  assert.equal(resolvePublicStaticFile(ROOT, "/src/styles.css"), "C:\\buswakeup\\src\\styles.css");
});

test("static asset policy blocks private data, server code, and traversal attempts", () => {
  assert.equal(resolvePublicStaticFile(ROOT, "/data/auth/users.json"), null);
  assert.equal(resolvePublicStaticFile(ROOT, "/data/auth/sessions.json"), null);
  assert.equal(resolvePublicStaticFile(ROOT, "/src/server/auth-store.mjs"), null);
  assert.equal(resolvePublicStaticFile(ROOT, "/%2e%2e/data/auth/users.json"), null);
  assert.equal(resolvePublicStaticFile(ROOT, "/server.mjs"), null);
});

test("isAssetPath distinguishes missing SPA routes from denied file requests", () => {
  assert.equal(isAssetPath("/setup"), false);
  assert.equal(isAssetPath("/data/auth/users.json"), true);
});

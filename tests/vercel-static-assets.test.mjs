import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Vercel bundles the browser entry and module assets needed by the Node server", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(
    config.functions?.["server.mjs"]?.includeFiles,
    "{index.html,sw.js,src/**/*.js,src/**/*.css}",
  );
});

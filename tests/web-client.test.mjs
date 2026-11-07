import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolvePublicStaticFile } from "../src/server/static-assets.mjs";

// The service address shows the same screens as the Android app (C안).
test("the web entry loads the app-design client from public source files", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<title>이노치 - 이거 놓치면 지각<\/title>/);
  for (const file of ["src/web/app.js", "src/web/app.css", "src/web/brand.css", "src/web/theme-boot.js"]) {
    assert.ok(html.includes(`./${file}`), file);
    assert.ok(resolvePublicStaticFile("/srv", `/${file}`), `${file} is served`);
  }
  assert.ok(html.indexOf("src/theme-init.js") < html.indexOf('rel="stylesheet"'));
  assert.ok(html.indexOf("src/web/theme-boot.js") < html.indexOf('rel="stylesheet"'));
});

test("the web client uses the same server API as the app", async () => {
  const source = await readFile(new URL("../src/web/app.js", import.meta.url), "utf8");
  for (const path of ["/api/mobile/home", "/api/mobile/setup", "/api/mobile/today", "/api/mobile/refresh", "/api/mobile/stops/nearby", "/api/mobile/stops/describe", "/api/auth/oauth/start"]) {
    assert.ok(source.includes(path), path);
  }
  assert.match(source, /credentials: "same-origin"/);
  const css = await readFile(new URL("../src/web/app.css", import.meta.url), "utf8");
  for (const color of ["#9FD9B4", "#F4C14F", "#F49A82", "#0F2A1E", "#8FE0B0", "#B00018", "#FF8A80"]) assert.ok(css.includes(color), color);
});

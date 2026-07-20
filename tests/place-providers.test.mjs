import test from "node:test";
import assert from "node:assert/strict";

import { getPlaceApiConfig, searchAddressPlaces, searchDemoAddressPlaces } from "../src/server/place-providers.mjs";

test("getPlaceApiConfig reports Kakao as disabled when no key is present", () => {
  const config = getPlaceApiConfig({});

  assert.equal(config.providers.kakao.configured, false);
  assert.equal(config.providers.demo.configured, true);
  assert.equal(config.maps.kakao.configured, false);
});

test("getPlaceApiConfig exposes only the public Kakao Maps JavaScript key", () => {
  const config = getPlaceApiConfig({
    KAKAO_JAVASCRIPT_KEY: "public-javascript-key",
    KAKAO_LOCAL_REST_API_KEY: "secret-rest-key",
  });

  assert.equal(config.maps.kakao.configured, true);
  assert.equal(config.maps.kakao.javascriptKey, "public-javascript-key");
  assert.equal(JSON.stringify(config).includes("secret-rest-key"), false);
});

test("searchDemoAddressPlaces returns built-in address matches", () => {
  const results = searchDemoAddressPlaces("판교");

  assert.ok(results.length >= 1);
  assert.match(results[0].label, /판교/);
  assert.equal(results[0].provider, "demo");
});

test("searchAddressPlaces falls back to demo results when Kakao key is missing", async () => {
  const results = await searchAddressPlaces("광화문", {});

  assert.ok(results.length >= 1);
  assert.match(results[0].label, /광화문|세종대로/);
});

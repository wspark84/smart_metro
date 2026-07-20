import test from "node:test";
import assert from "node:assert/strict";

import { estimateCommuteRoute, estimateWalkRoute, getRouteApiConfig } from "../src/server/route-providers.mjs";

test("getRouteApiConfig reports Kakao walking as disabled when no key exists", () => {
  const config = getRouteApiConfig({});

  assert.equal(config.providers.kakaoWalking.configured, false);
  assert.equal(config.providers.straightLine.configured, true);
});

test("estimateWalkRoute falls back to straight-line when no Kakao key exists", async () => {
  const result = await estimateWalkRoute(
    {
      origin: { lat: 37.5725, lng: 126.9769 },
      destination: { lat: 37.5717, lng: 126.9769 },
    },
    {},
  );

  assert.equal(result.provider, "straight-line");
  assert.equal(result.fallback, true);
  assert.ok(result.walkMinutes >= 1);
});

test("estimateWalkRoute parses Kakao walking summary when a key is present", async () => {
  const result = await estimateWalkRoute(
    {
      origin: { lat: 37.5725, lng: 126.9769 },
      destination: { lat: 37.5717, lng: 126.9769 },
    },
    { KAKAO_MOBILITY_REST_API_KEY: "demo-key" },
    async () => ({
      ok: true,
      async json() {
        return {
          routes: [
            {
              result_code: 0,
              summary: {
                distance: 410,
                duration: 360,
              },
            },
          ],
        };
      },
    }),
  );

  assert.equal(result.provider, "kakao-walking");
  assert.equal(result.fallback, false);
  assert.equal(result.distanceM, 410);
  assert.equal(result.walkMinutes, 6);
});

test("estimateCommuteRoute falls back gracefully when Kakao request fails", async () => {
  const result = await estimateCommuteRoute(
    {
      homeLocation: { lat: 37.5725, lng: 126.9769 },
      workLocation: { lat: 37.3951, lng: 127.1107 },
      stopLocation: { lat: 37.5717, lng: 126.9769 },
      busRideMin: 43,
      alightToWorkWalkMin: 7,
    },
    { KAKAO_MOBILITY_REST_API_KEY: "demo-key" },
    async () => ({
      ok: false,
      status: 503,
      async json() {
        return {
          message: "Temporary upstream failure",
        };
      },
    }),
  );

  assert.equal(result.fallback, true);
  assert.equal(result.provider, "straight-line-fallback");
  assert.ok(result.homeToStop.walkMinutes >= 1);
  assert.equal(result.totalCommuteMin, result.homeToStop.walkMinutes + 50);
});

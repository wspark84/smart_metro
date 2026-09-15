import test from "node:test";
import assert from "node:assert/strict";

import {
  createDefaultLiveBindings,
  ensureLiveBindingState,
  switchLiveProvider,
  syncActiveLiveBinding,
} from "../src/logic/live-bindings.js";

test("ensureLiveBindingState seeds provider bindings from legacy top-level live fields", () => {
  const liveState = ensureLiveBindingState({
    provider: "gyeonggi",
    stationId: "200000118",
    stationName: "수내역",
    arsId: "",
    routeId: "241005300",
    order: "17",
    cityCode: "",
    nodeId: "",
    routeNumber: "8109",
    bindings: createDefaultLiveBindings(),
  });

  assert.equal(liveState.bindings.gyeonggi.stationId, "200000118");
  assert.equal(liveState.bindings.gyeonggi.routeNumber, "8109");
  assert.equal(liveState.stationName, "수내역");
});

test("switchLiveProvider preserves each provider binding and restores it when toggling back", () => {
  const liveState = ensureLiveBindingState({
    provider: "gyeonggi",
    stationId: "200000118",
    stationName: "수내역",
    arsId: "",
    routeId: "241005300",
    order: "17",
    cityCode: "",
    nodeId: "",
    routeNumber: "8109",
    bindings: createDefaultLiveBindings(),
  });

  switchLiveProvider(liveState, "tago");
  liveState.cityCode = "31020";
  liveState.nodeId = "GGB218000118";
  liveState.routeNumber = "8109";
  syncActiveLiveBinding(liveState);

  switchLiveProvider(liveState, "gyeonggi");
  assert.equal(liveState.stationId, "200000118");
  assert.equal(liveState.routeId, "241005300");
  assert.equal(liveState.routeNumber, "8109");

  switchLiveProvider(liveState, "tago");
  assert.equal(liveState.cityCode, "31020");
  assert.equal(liveState.nodeId, "GGB218000118");
  assert.equal(liveState.routeNumber, "8109");
});

test("cleared active route and stop fields never reappear from older saved bindings", () => {
  const state = ensureLiveBindingState({ provider: "tago", cityCode: "25", nodeId: "OLD", routeId: "OLD_ROUTE", routeNumber: "5" });
  state.nodeId = "NEW";
  state.routeId = "";
  state.routeNumber = "";
  syncActiveLiveBinding(state);
  ensureLiveBindingState(state);
  assert.equal(state.routeId, "");
  assert.equal(state.routeNumber, "");
  assert.equal(state.nodeId, "NEW");
  switchLiveProvider(state, "seoul");
  switchLiveProvider(state, "tago");
  assert.equal(state.routeId, "");
  assert.equal(state.nodeId, "NEW");
});

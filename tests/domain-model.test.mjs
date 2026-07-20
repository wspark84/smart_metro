import test from "node:test";
import assert from "node:assert/strict";

import { applyDomainSnapshotToState, projectDomainSnapshot, updateDomainEntity } from "../src/domain-model.js";
import { DEFAULT_STATE } from "../src/state.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("projectDomainSnapshot maps the current prototype state into domain entities", () => {
  const state = clone(DEFAULT_STATE);
  state.user.name = "Kim";
  state.user.requiredArrivalTime = "08:40";
  state.user.homeLocation = { lat: 37.57, lng: 126.97, source: "demo", label: "Home pin" };
  state.user.workLocation = { lat: 37.39, lng: 127.11, source: "demo", label: "Work pin" };
  state.commute.selectedStopId = "CITY_HALL";
  state.commute.selectedLineIds = ["500"];
  state.commute.primaryLineId = "500";
  state.commute.busRideMin = 39;
  state.live.provider = "gyeonggi";
  state.live.stationId = "200000118";
  state.live.routeId = "241007520";
  state.schedule.startTime = "06:50";
  state.notification.ttsSpeed = 0.9;

  const snapshot = projectDomainSnapshot(state);

  assert.equal(snapshot.user.name, "Kim");
  assert.equal(snapshot.user.requiredArrivalTime, "08:40");
  assert.equal(snapshot.user.homeLocation.lat, 37.57);
  assert.equal(snapshot.user.workLocation.lng, 127.11);
  assert.equal(snapshot.route.selectedStopId, "CITY_HALL");
  assert.deepEqual(snapshot.route.selectedLineIds, ["500"]);
  assert.equal(snapshot.route.busRideMin, 39);
  assert.equal(snapshot.route.liveBinding.provider, "gyeonggi");
  assert.equal(snapshot.route.liveBinding.stationId, "200000118");
  assert.equal(snapshot.schedule.startTime, "06:50");
  assert.equal(snapshot.notificationSettings.ttsSpeed, 0.9);
  assert.match(snapshot.meta.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("applyDomainSnapshotToState overlays domain entities and preserves unrelated prototype state", () => {
  const baseState = clone(DEFAULT_STATE);
  baseState.user.id = "legacy-user-id";
  baseState.notification.id = "legacy-notification-id";
  baseState.history = [{ id: "history-1", title: "Existing history" }];
  baseState.ui.liveSearchKeyword = "old";

  const snapshot = {
    user: {
      name: "Lee",
      homeAddress: "Seoul Home",
      workAddress: "Seoul Work",
      requiredArrivalTime: "08:30",
      homeLocation: { lat: 37.5, lng: 126.9, source: "kakao", label: "Seoul Home pin" },
      workLocation: { lat: 37.4, lng: 127.1, source: "kakao", label: "Seoul Work pin" },
    },
    route: {
      selectedStopId: "CITY_HALL",
      selectedLineIds: ["500", "103"],
      primaryLineId: "103",
      busRideMin: 41,
      homeToStopWalkMin: 8,
      alightToWorkWalkMin: 4,
      liveBinding: {
        provider: "seoul",
        arsId: "01001",
        stationId: "12345",
        routeId: "222000",
        order: "7",
      },
    },
    schedule: {
      startTime: "06:45",
      endTime: "07:30",
      repeatIntervalMin: 5,
      repeatPreset: "DAILY",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      skipHolidays: false,
      holidayDates: ["2026-05-05"],
      officialHolidays: [{ date: "2026-01-01", name: "New Year", isHoliday: true }],
      holidaySync: {
        status: "ready",
        lastSyncedAt: "2026-04-22T00:00:00.000Z",
        lastError: "",
        loadedYears: ["2026"],
      },
    },
    notificationSettings: {
      soundPresetId: "strong",
      vibrationStrength: 95,
      escalationEnabled: false,
      ttsVoiceId: "ko-male",
      ttsSpeed: 1.2,
      dndBypass: true,
    },
  };

  const merged = applyDomainSnapshotToState(snapshot, baseState);

  assert.equal(merged.user.name, "Lee");
  assert.equal(merged.user.homeLocation.lat, 37.5);
  assert.equal(merged.user.workLocation.source, "kakao");
  assert.equal(merged.commute.selectedStopId, "CITY_HALL");
  assert.deepEqual(merged.commute.selectedLineIds, ["500", "103"]);
  assert.equal(merged.commute.primaryLineId, "103");
  assert.equal(merged.commute.busRideMin, 41);
  assert.equal(merged.live.provider, "seoul");
  assert.equal(merged.live.arsId, "01001");
  assert.equal(merged.schedule.repeatIntervalMin, 5);
  assert.equal(merged.notification.dndBypass, true);
  assert.deepEqual(merged.holidayDates, ["2026-05-05"]);
  assert.equal("id" in merged.user, false);
  assert.equal("id" in merged.notification, false);
  assert.equal(merged.history.length, 1);
  assert.equal(merged.ui.liveSearchKeyword, "old");
});

test("updateDomainEntity merges nested route live binding fields without dropping existing values", () => {
  const snapshot = projectDomainSnapshot(DEFAULT_STATE);
  snapshot.meta.updatedAt = "2026-04-22T00:00:00.000Z";

  const updated = updateDomainEntity(snapshot, "route", {
    selectedStopId: "CITY_HALL",
    liveBinding: {
      provider: "gyeonggi",
      stationId: "200000118",
    },
  });

  assert.equal(updated.route.selectedStopId, "CITY_HALL");
  assert.equal(updated.route.liveBinding.provider, "gyeonggi");
  assert.equal(updated.route.liveBinding.stationId, "200000118");
  assert.equal(updated.route.liveBinding.routeId, snapshot.route.liveBinding.routeId);
  assert.match(updated.meta.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.notEqual(updated.meta.updatedAt, snapshot.meta.updatedAt);
});

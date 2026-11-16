import test from "node:test";
import assert from "node:assert/strict";
import { watchWhileOff } from "../src/server/automatic-journeys.mjs";

// 대표 승인 2026-11-16: after "출발했어요" (alarms off today) the told bus is
// still checked about once a minute until it has passed, for the record.
const binding = { provider: "gyeonggi", stationId: "203000426", routeId: "241201006" };
const options = { watchBinding: binding, watchUntil: "2026-11-16T05:10:00Z", departureAt: "2026-11-16T04:56:00Z" };

test("alarms off: the told bus is checked until it has passed, about once a minute", async () => {
  const calls = [];
  const loadArrival = async (b) => { calls.push(b); return { value: {} }; };
  const first = await watchWhileOff(options, { loadArrival, now: new Date("2026-11-16T05:00:00Z") });
  assert.deepEqual(calls, [binding]);
  assert.equal(first.watchedAt, "2026-11-16T05:00:00.000Z");
  assert.equal(first.departureAt, options.departureAt, "plan unchanged");
  const soon = await watchWhileOff(first, { loadArrival, now: new Date("2026-11-16T05:00:30Z") });
  assert.equal(calls.length, 1, "not twice within a minute");
  await watchWhileOff(soon, { loadArrival, now: new Date("2026-11-16T05:01:00Z") });
  assert.equal(calls.length, 2);
  const after = await watchWhileOff(soon, { loadArrival, now: new Date("2026-11-16T05:10:00Z") });
  assert.equal(calls.length, 2, "stops once the bus has passed");
  assert.equal(after, soon);
});

test("a failed check does not break the tick", async () => {
  const result = await watchWhileOff(options, { loadArrival: async () => { throw new Error("down"); }, now: new Date("2026-11-16T05:00:00Z") });
  assert.equal(result.watchedAt, "2026-11-16T05:00:00.000Z");
});

import test from "node:test";
import assert from "node:assert/strict";

import { mergeHolidayDates } from "../src/logic/commute.js";

test("mergeHolidayDates deduplicates manual and official holiday sources", () => {
  const merged = mergeHolidayDates(["2026-05-05", "2026-06-06"], ["2026-05-05"], ["2026-08-15"]);

  assert.deepEqual(merged, ["2026-05-05", "2026-06-06", "2026-08-15"]);
});

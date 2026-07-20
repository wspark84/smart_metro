import assert from "node:assert/strict";
import test from "node:test";

import { fetchWithTimeout } from "../src/server/upstream-fetch.mjs";

test("fetchWithTimeout forwards the request and attaches an abort signal", async () => {
  let receivedSignal = null;
  const response = await fetchWithTimeout(
    "https://example.test/arrival",
    { headers: { accept: "application/json" } },
    {
      fetchImpl: async (_url, init) => {
        receivedSignal = init.signal;
        return { ok: true };
      },
      timeoutMs: 50,
    },
  );

  assert.equal(response.ok, true);
  assert.ok(receivedSignal instanceof AbortSignal);
  assert.equal(receivedSignal.aborted, false);
});

test("fetchWithTimeout rejects stalled provider calls with a bounded timeout", async () => {
  await assert.rejects(
    fetchWithTimeout(
      "https://example.test/arrival",
      {},
      {
        fetchImpl: () => new Promise(() => {}),
        timeoutMs: 10,
      },
    ),
    (error) => error?.code === "UPSTREAM_TIMEOUT",
  );
});

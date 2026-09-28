import assert from "node:assert/strict";
import test from "node:test";

import { fetchWithTimeout } from "../src/server/upstream-fetch.mjs";

test('upstream deadline also covers a stalled response body',async()=>{
  const response=await fetchWithTimeout('https://example.test/arrival',{}, {
    fetchImpl:async()=>({ok:true,json:()=>new Promise(()=>{})}),timeoutMs:10});
  let timer;
  try {
    await assert.rejects(Promise.race([response.json(),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('BODY_TIMEOUT_NOT_ENFORCED')),100);
    })]),error=>error.code==='UPSTREAM_TIMEOUT');
  } finally {clearTimeout(timer);}
});

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

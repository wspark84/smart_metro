import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchGyeonggiArrival} from '../src/server/bus-providers.mjs';

test('station-wide arrivals share one request across simultaneous bus candidates',async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;return {ok:true,json:async()=>({response:{msgBody:{busArrivalList:[
    {routeId:'r1',routeName:'15',predictTime1:5},
    {routeId:'r2',routeName:'17-1',predictTime1:8},
  ]}}})};};
  const query={serviceKey:'test',stationId:'s1',fetchImpl};
  const [a,b]=await Promise.all(['r1','r2'].map(routeId=>fetchGyeonggiArrival({...query,routeId})));
  assert.equal(calls,1);assert.equal(a.lineNumber,'15');assert.equal(b.lineNumber,'17-1');
  assert.ok(a.arrivalsMin[0]<=5 && a.arrivalsMin[0]>4.9);
  assert.ok(b.arrivalsMin[0]<=8 && b.arrivalsMin[0]>7.9);
  await fetchGyeonggiArrival({...query,routeId:'r1'});assert.equal(calls,1);
});

test('429 preserves Retry-After for durable backoff without exposing credentials',async()=>{
  await assert.rejects(fetchGyeonggiArrival({serviceKey:'private-key',stationId:'s1',
    fetchImpl:async()=>({ok:false,status:429,headers:{get:()=> '900'}})}),error=>{
      assert.equal(error.statusCode,429);assert.equal(error.retryAfterMs,900000);
      assert.doesNotMatch(error.message,/private-key/);return true;
    });
});

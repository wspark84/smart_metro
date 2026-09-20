import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { searchTagoStations, fetchTagoCities, fetchTagoArrivalRows } from '../src/server/tago-api.mjs';

const binding = {serviceKey:'test-secret',cityCode:'31010',keyword:'광교'};
const station = {nodeid:'STOP1',nodenm:'광교역',gpslati:37.3,gpslong:127.1};
const reply = (item, code='00') => ({ok:true,status:200,text:async()=>JSON.stringify({response:{header:{resultCode:code},body:{items:{item},pageNo:1,numOfRows:100,totalCount:1}}})});

test('station search retries a transient TAGO 99 once then succeeds',async()=>{
  let calls=0;
  const rows=await searchTagoStations({...binding,fetchImpl:async()=>++calls===1?reply(null,'99'):reply(station)});
  assert.equal(calls,2); assert.equal(rows[0].stationId,'STOP1');
});
test('station search caches success and coalesces concurrent identical requests',async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;return reply(station);};
  const a=await Promise.all([searchTagoStations({...binding,fetchImpl}),searchTagoStations({...binding,fetchImpl})]);
  a[0][0].stationName='mutated';
  const b=await searchTagoStations({...binding,fetchImpl});
  assert.equal(calls,1); assert.equal(b[0].stationName,'광교역');
});
test('cache separates city, keyword and credentials',async()=>{
  let calls=0; const fetchImpl=async()=>{calls++;return reply(station);};
  await searchTagoStations({...binding,fetchImpl});
  await searchTagoStations({...binding,cityCode:'25',fetchImpl});
  await searchTagoStations({...binding,keyword:'판교',fetchImpl});
  await searchTagoStations({...binding,serviceKey:'other-key',fetchImpl});
  assert.equal(calls,4);
});
test('authentication and quota errors are not retried or cached',async()=>{
  for(const code of ['20','22','30','31','32']) {
    let calls=0; const fetchImpl=async()=>{calls++;return reply(null,code);};
    await assert.rejects(searchTagoStations({...binding,fetchImpl}),/TAGO API/);
    assert.equal(calls,1);
  }
});
test('transient retry is bounded and errors never enter cache',async()=>{
  let calls=0; const fetchImpl=async()=>{calls++;return calls<=2?reply(null,'99'):reply(station);};
  await assert.rejects(searchTagoStations({...binding,fetchImpl}),/99/);
  assert.equal(calls,2);
  assert.equal((await searchTagoStations({...binding,fetchImpl})).length,1);
  assert.equal(calls,3);
});
test('city metadata is cached but live arrival rows are always refreshed',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;return reply({citycode:31010,cityname:'수원시',...station});};
  await fetchTagoCities({...binding,service:'stops',fetchImpl});
  await fetchTagoCities({...binding,service:'stops',fetchImpl});
  assert.equal(calls,1);
  await fetchTagoArrivalRows({...binding,nodeId:'STOP1',fetchImpl});
  await fetchTagoArrivalRows({...binding,nodeId:'STOP1',fetchImpl});
  assert.equal(calls,3);
});
test('station cache expires after five minutes without stale fallback',async(t)=>{
  t.mock.timers.enable({apis:['Date'],now:1000000});
  let calls=0;const fetchImpl=async()=>{calls++;return reply(station);};
  await searchTagoStations({...binding,fetchImpl});
  await searchTagoStations({...binding,fetchImpl});
  assert.equal(calls,1);
  t.mock.timers.tick(300001);
  await searchTagoStations({...binding,fetchImpl});
  assert.equal(calls,2);
});

test('transport failures retry without exposing URLs or credentials',async()=>{
  let calls=0;
  const fetchImpl=async url=>{calls++;throw new Error(String(url));};
  await assert.rejects(searchTagoStations({...binding,fetchImpl}),error=>{
    assert.doesNotMatch(error.message,/test-secret|serviceKey|https/);return true;
  });
  assert.equal(calls,2);
});
test('a stalled station attempt is aborted and retried within the existing request budget',async()=>{
  let calls=0;let firstSignal;
  const fetchImpl=async(url,{signal})=>{
    if(++calls>1) return reply(station);
    firstSignal=signal;
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  };
  const rows=await searchTagoStations({...binding,fetchImpl});
  assert.equal(calls,2);assert.equal(firstSignal.aborted,true);assert.equal(rows.length,1);
});
test('HTTP 503 retries, HTTP 429 does not retry',async()=>{
  for(const [status,expected] of [[503,2],[429,1]]) {
    let calls=0;const fetchImpl=async()=>{calls++;return {ok:false,status,text:async()=>''};};
    await assert.rejects(searchTagoStations({...binding,fetchImpl}));
    assert.equal(calls,expected);
  }
});
test('bounded metadata cache evicts older completed entries',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;return reply(station);};
  for(let i=0;i<129;i++) await searchTagoStations({...binding,keyword:`역${i}`,fetchImpl});
  await searchTagoStations({...binding,keyword:'역0',fetchImpl});
  assert.equal(calls,130);
});
test('live arrivals retain fail-fast behavior and are not automatically retried',async()=>{
  let calls=0;
  await assert.rejects(fetchTagoArrivalRows({...binding,nodeId:'STOP1',fetchImpl:async()=>{calls++;return reply(null,'99');}}));
  assert.equal(calls,1);
});

// Execute the actual browser click-handler branch with a small deterministic harness.
async function searchHarness() {
  const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
  const start=source.indexOf('  if (action === "search-live-stops") {');
  const end=source.indexOf('  if (action === "load-tago-cities") {',start);
  assert.ok(start>=0 && end>start);
  const context=vm.createContext({action:'search-live-stops',
    boardingArea:{mode:'name'},
    state:{ui:{liveSearchKeyword:'광교',liveSearchResults:[]}},
    liveStationRequest:0,liveSearchResultKey:'',binding:{provider:'tago',cityCode:'31010',keyword:'광교'},
    resetBoardingPreview(){},resetLiveRouteSearchState(){},persist(){},render(){},pushHistory(){},
    userErrorMessage:error=>error.message,
  });
  context.getLiveSearchBinding=()=>({...context.binding});
  const run=async()=>{
    vm.runInContext(`(()=>{${source.slice(start,end)}})()`,context);
    await new Promise(resolve=>setImmediate(resolve));
  };
  return {context,run};
}
test('UI retains same-query results on failure and labels them as previous results',async()=>{
  const {context:c,run}=await searchHarness();
  c.searchLiveStations=async()=>({provider:'tago',stations:[station]});await run();
  c.searchLiveStations=async()=>{throw new Error('일시 오류');};await run();
  assert.equal(c.state.ui.liveSearchResults.length,1);
  assert.match(c.state.ui.liveSearchError,/이전에 조회한 같은 검색 조건/);
  c.binding.cityCode='25';await run();
  assert.equal(c.state.ui.liveSearchResults.length,0);
  assert.doesNotMatch(c.state.ui.liveSearchError,/이전에 조회/);
});
test('UI changed search words do not retain unrelated results or late responses',async()=>{
  const {context:c,run}=await searchHarness();
  c.searchLiveStations=async()=>({provider:'tago',stations:[station]});await run();
  c.binding.keyword='판교';c.state.ui.liveSearchKeyword='판교';
  let resolveSearch;
  c.searchLiveStations=()=>new Promise(resolve=>{resolveSearch=resolve;});await run();
  assert.equal(c.state.ui.liveSearchResults.length,0);
  c.binding.keyword='수원';
  resolveSearch({provider:'tago',stations:[station]});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(c.state.ui.liveSearchResults.length,0);
});

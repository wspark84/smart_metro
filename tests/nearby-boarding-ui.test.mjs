import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {isValidLocation} from '../src/logic/commute.js';

const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
function harness(overrides={}) {
  const context=vm.createContext({
    state:{live:{provider:'tago',cityCode:'31010'},ui:{liveSearchResults:[]},commute:{stopLocation:{lat:37.28,lng:127.06}},user:{}},
    authMeta:{user:{id:'u1'}},liveStationRequest:0,liveSearchResultKey:'',
    document:{querySelector:()=>({dataset:{mapStatus:'ready'}})},
    isValidLocation,render(){},resetBoardingPreview(){},resetLiveRouteSearchState(){},
    userErrorMessage:(error,fallback)=>error?.message||fallback,
    searchNearbyStations:async()=>({stations:[]}),searchAddressPlaces:async()=>({results:[]}),...overrides
  });
  vm.runInContext(source.slice(source.indexOf('let homeEditor ='),source.indexOf('function renderBoardingAreaSearch()')),context);
  return context;
}

test('nearby search uses map center but leaves saved departure and provider binding unchanged',async()=>{
  let requested;
  const c=harness({searchNearbyStations:async value=>{requested={...value};return {stations:[{stationId:'official',cityCode:'31020'}]};}});
  const before=JSON.stringify({live:c.state.live,commute:c.state.commute});
  vm.runInContext('boardingArea.center={lat:37.3,lng:127.1}',c);
  await vm.runInContext('findNearbyBoardingStops()',c);
  assert.deepEqual(requested,{lat:37.3,lng:127.1});
  assert.equal(c.state.ui.liveSearchResults[0].stationId,'official');
  assert.equal(JSON.stringify({live:c.state.live,commute:c.state.commute}),before);
});

test('late nearby responses cannot replace newer search, provider or account results',async()=>{
  for (const invalidate of [c=>c.liveStationRequest++,c=>c.state.live.provider='subway',c=>c.authMeta.user={id:'u2'}]) {
    let resolve;
    const c=harness({searchNearbyStations:()=>new Promise(done=>{resolve=done;})});
    const pending=vm.runInContext('findNearbyBoardingStops()',c);
    invalidate(c);c.state.ui.liveSearchResults=[{stationId:'newer'}];
    resolve({stations:[{stationId:'stale'}]});await pending;
    assert.equal(c.state.ui.liveSearchResults[0].stationId,'newer');
  }
});

test('map not ready prevents nearby calls and tells the user why',async()=>{
  const c=harness({document:{querySelector:()=>({dataset:{mapStatus:'error'}})},searchNearbyStations:()=>assert.fail('must wait for valid map')});
  await vm.runInContext('findNearbyBoardingStops()',c);
  assert.match(c.state.ui.liveSearchError,/지도 표시가 완료/);
});

test('area search excludes demo places and ignores stale results after editing query',async()=>{
  const c=harness({searchAddressPlaces:async()=>({results:[{provider:'demo',lat:37,lng:127},{provider:'kakao',lat:37.3,lng:127.1},{provider:'kakao',lat:null,lng:null}]})});
  vm.runInContext('boardingArea.keyword="광교"',c);
  await vm.runInContext('findBoardingArea()',c);
  assert.equal(vm.runInContext('boardingArea.results.length',c),1);
  let resolve;c.searchAddressPlaces=()=>new Promise(done=>{resolve=done;});
  const pending=vm.runInContext('findBoardingArea()',c);
  vm.runInContext('boardingArea.request++;boardingArea.results=[]',c);
  resolve({results:[{provider:'kakao',lat:37.5,lng:127.5}]});await pending;
  assert.equal(vm.runInContext('boardingArea.results.length',c),0);
});

test('choosing a place moves only the search map, not the saved trip',()=>{
  const c=harness();
  vm.runInContext('boardingArea.results=[{lat:37.3,lng:127.1}]',c);
  const before=JSON.stringify({live:c.state.live,commute:c.state.commute});
  const start=source.indexOf('  if (action === "select-boarding-area")');
  const end=source.indexOf('  if (action === "preview-boarding-route")',start);
  vm.runInContext(`(function(action,target){${source.slice(start,end)}})("select-boarding-area",{dataset:{index:"0"}})`,c);
  assert.equal(vm.runInContext('boardingArea.center.lat',c),37.3);
  assert.equal(JSON.stringify({live:c.state.live,commute:c.state.commute}),before);
});

test('typing a station name invalidates pending nearby requests in both input handlers',()=>{
  const matches=[...source.matchAll(/if \(path === "ui.liveSearchKeyword"\) \{([\s\S]*?)\n  \}/g)];
  assert.equal(matches.length,2);
  for(const [,body] of matches) {
    const c=harness();c.liveStationRequest=5;
    vm.runInContext(body,c);
    assert.equal(c.liveStationRequest,6);
    assert.equal(vm.runInContext('boardingArea.mode',c),'name');
  }
});

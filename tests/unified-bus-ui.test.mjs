import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stationSelectionKey} from '../src/logic/station-search.js';
import {isValidLocation} from '../src/logic/commute.js';
import {switchLiveProvider,syncActiveLiveBinding} from '../src/logic/live-bindings.js';
import {cityDisplayName,searchCityCandidates} from '../src/logic/city-search.js';
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');

test('home does not claim server save succeeded while pending or failed',()=>{
  const c=vm.createContext({persistenceMeta:{saveStatus:'saving'},domainMeta:{syncStatus:'syncing'}});
  vm.runInContext(source.slice(source.indexOf('function renderHomeStorageStatus()'),source.indexOf('function renderHome(screen')),c);
  assert.match(vm.runInContext('renderHomeStorageStatus()',c),/아직 저장이 완료되지/);
  c.persistenceMeta.saveStatus='error';
  assert.match(vm.runInContext('renderHomeStorageStatus()',c),/role="alert"/);
  assert.doesNotMatch(vm.runInContext('renderHomeStorageStatus()',c),/설정 저장 완료/);
  c.persistenceMeta.saveStatus='saved';c.domainMeta.syncStatus='synced';
  assert.match(vm.runInContext('renderHomeStorageStatus()',c),/계정에 설정 저장 완료/);
});

test('saving a stop without routes clears previous route and ETA without starting live calculations',()=>{
  let saved=0;
  const c=vm.createContext({state:{live:{provider:'tago',routeId:'old',routeNumber:'99',snapshot:{arrivalsMin:[5]}},ui:{},commute:{transitJourney:{old:true}}},
    boardingPreview:{status:'ready',routes:[],route:null,candidate:{provider:'tago',stationId:'GGB203000426',nodeId:'GGB203000426',cityCode:'31010',stationName:'더샵광교레이크시티.광교호반베르디움',posX:'127.06',posY:'37.28'}},
    document:{querySelector:()=>({dataset:{mapStatus:'ready'}})},isValidLocation,switchLiveProvider,
    busCitiesMeta:{cities:[]},cityDisplayName,commuteEstimateMeta:{snapshot:{old:true}},render(){},persist(){saved++;},resetBoardingPreview(){},
    refreshCommuteEstimate(){throw Error('must not request a route without a bus');},refreshVisibleTransit(){throw Error('must not use old arrivals');}});
  c.syncLiveBindingState=()=>syncActiveLiveBinding(c.state.live);
  const start=source.indexOf('  if (action === "confirm-boarding")');
  const end=source.indexOf('  if (action === "goto")',start);
  vm.runInContext(`(function(action){${source.slice(start,end)}})("confirm-boarding")`,c);
  assert.equal(saved,1);
  assert.equal(c.state.live.stationId,'GGB203000426');
  assert.equal(c.state.live.routeId,'');assert.equal(c.state.live.routeNumber,'');
  assert.equal(c.state.live.snapshot,null);assert.equal(c.state.commute.transitJourney,null);
  assert.equal(c.state.live.bindings.tago.routeId,'');
});

test('empty route preview offers stop-only save above the result list, but loading and subway do not',()=>{
  const c=vm.createContext({boardingPreview:{candidate:{stationId:'S',stationName:'정류장',posX:127,posY:37},route:null,routes:[],status:'ready',error:''},
    state:{live:{provider:'tago'},ui:{liveSearchResults:[]}},busApiConfig:{providers:{}},boardingArea:{mode:'name'},
    renderBoardingAreaSearch:()=>'',stationSelectionKey,isValidLocation,escapeHtml:String});
  vm.runInContext(source.slice(source.indexOf('function renderBoardingPreview()'),source.indexOf('function renderCitySearchResults()')),c);
  let html=vm.runInContext('renderBoardingPreview()',c);
  assert.match(html,/이 정류장을 출발지로 저장 \(노선 미연결\)/);
  assert.doesNotMatch(html,/data-action="confirm-boarding" disabled/);
  assert.match(html,/실시간 도착시간·출발 알림을 제공하지 않습니다/);
  c.boardingPreview.status='loading';
  assert.match(vm.runInContext('renderBoardingPreview()',c),/data-action="confirm-boarding" disabled/);
  c.boardingPreview.status='ready';c.state.live.provider='subway';
  assert.match(vm.runInContext('renderBoardingPreview()',c),/data-action="confirm-boarding" disabled/);
});

test('city loading is automatic, single flight, restores stored official city, and ignores signed-out responses',async()=>{
  let resolve,calls=0;
  const c=vm.createContext({isAuthenticated:()=>true,authMeta:{user:{id:'user'}},render(){},state:{ui:{busCityId:''},live:{provider:'tago',cityCode:'31010'}},
    fetchBusCityList:()=>{calls++;return new Promise(done=>{resolve=done;});},userErrorMessage:error=>error.message});
  vm.runInContext(source.slice(source.indexOf('const busCitiesMeta ='),source.indexOf('let liveStationRequest =')),c);
  const pending=vm.runInContext('loadBusCities()',c);await vm.runInContext('loadBusCities()',c);
  assert.equal(calls,1);
  resolve({cities:[{id:'gg:수원시',cityCode:'31010'}]});await pending;
  assert.equal(c.state.ui.busCityId,'gg:수원시');
  const next=vm.runInContext('loadBusCities()',c);
  c.authMeta.user=null;resolve({cities:[{id:'stale'}]});await next;
  assert.equal(vm.runInContext('busCitiesMeta.cities[0].id',c),'gg:수원시');
  c.authMeta.user={id:'user'};c.state.ui.busCityId='';c.state.ui.busCityQuery='성남';
  const typing=vm.runInContext('loadBusCities()',c);
  resolve({cities:[{id:'gg:수원시',cityCode:'31010'}]});await typing;
  assert.equal(c.state.ui.busCityId,'','loading completion must not restore old city over a newly typed query');
  const workspace=source.slice(source.indexOf('async function hydrateAuthenticatedWorkspace()'),source.indexOf('async function hydrateAccountSummary()'));
  assert.match(workspace,/void loadBusCities\(\)/);
  assert.doesNotMatch(workspace,/await loadBusCities\(\)/,'city lookup must not block login');
});

test('home editor exposes city search with no long dropdown or provider selector',()=>{
  const c=vm.createContext({state:{live:{provider:'tago'},ui:{busCityId:'gg:수원시',liveSearchResults:[],liveSearchKeyword:'',liveSearchStatus:'idle'}},
    busCitiesMeta:{status:'ready',error:'',cities:[{id:'gg:수원시',cityName:'경기 수원시',available:true},{id:'seoul',cityName:'서울특별시',available:false}]},
    cityDisplayName,searchCityCandidates,escapeHtml:String,renderBoardingPreview:()=>'',boardingArea:{mode:'name'}});
  vm.runInContext(source.slice(source.indexOf('function renderCitySearchResults()'),source.indexOf('function renderHomeDestinationEditor()')),c);
  const html=vm.runInContext('renderHomeDepartureEditor()',c);
  assert.match(html,/placeholder="도시를 검색하세요"/);
  assert.match(html,/value="경기도 수원시"/);
  assert.doesNotMatch(html,/<select|서울특별시/);
  assert.doesNotMatch(html,/data-field="live.provider"|버스 정보 지역|load-tago-cities/);
});

test('preview selects provider-specific identity while saved provider stays unchanged',async()=>{
  let requested;
  const candidate={stationId:'123',selectionId:'gyeonggi:123',provider:'gyeonggi',stationName:'광교',cityCode:'31010'};
  const c=vm.createContext({state:{live:{provider:'tago'},ui:{liveSearchResults:[{...candidate,provider:'tago',selectionId:'tago:123'},candidate]}},
    boardingPreview:{request:0},authMeta:{user:{id:'user'}},stationSelectionKey,render(){},
    searchLiveStationRoutes:async binding=>{requested=binding;return {routes:[{routeId:'route'}]};},userErrorMessage:error=>error.message});
  c.resetBoardingPreview=()=>{c.boardingPreview={request:c.boardingPreview.request+1};};
  vm.runInContext(source.slice(source.indexOf('async function previewBoardingStop('),source.indexOf('function renderBoardingPreview()')),c);
  await vm.runInContext('previewBoardingStop("gyeonggi:123")',c);
  assert.equal(requested.provider,'gyeonggi');assert.equal(requested.stationId,'123');
  assert.equal(c.state.live.provider,'tago');
  assert.equal(c.boardingPreview.candidate.provider,'gyeonggi');
});

test('confirmation switches provider once and persists exact regional station and route, clearing old TAGO binding fields',()=>{
  let saved=0;
  const c=vm.createContext({state:{live:{provider:'tago',nodeId:'old',cityCode:'25',routeId:'old-route'},ui:{},commute:{}},
    boardingPreview:{candidate:{provider:'gyeonggi',selectionId:'gyeonggi:123',stationId:'123',cityId:'gg:수원시',cityCode:'31010',stationName:'광교',posX:'127.06',posY:'37.28'},route:{routeId:'regional-route',routeNumber:'1'}},
    document:{querySelector:()=>({dataset:{mapStatus:'ready'}})},isValidLocation,switchLiveProvider,
    busCitiesMeta:{cities:[]},cityDisplayName,commuteEstimateMeta:{},render(){},persist(){saved++;},resetBoardingPreview(){},refreshCommuteEstimate(){},refreshVisibleTransit(){}});
  c.syncLiveBindingState=()=>syncActiveLiveBinding(c.state.live);
  const start=source.indexOf('  if (action === "confirm-boarding")');
  const end=source.indexOf('  if (action === "goto")',start);
  vm.runInContext(`(function(action){${source.slice(start,end)}})("confirm-boarding")`,c);
  assert.equal(saved,1);assert.equal(c.state.live.provider,'gyeonggi');
  assert.equal(c.state.live.stationId,'123');assert.equal(c.state.live.routeId,'regional-route');assert.equal(c.state.live.nodeId,'');
  assert.equal(c.state.ui.busCityId,'gg:수원시');
});

test('changing the city clears transient searches, not the active alarm route',()=>{
  const clauses=[...source.matchAll(/if \(path === "ui.busCityId"\) \{([^}]+)\}/g)];
  assert.equal(clauses.length,2);
  for(const [,body] of clauses) {
    let invalidated=0;
    vm.runInNewContext(body,{resetLiveSearchState(){invalidated++;},resetLiveRouteSearchState(){invalidated++;}});
    assert.equal(invalidated,2);
    assert.doesNotMatch(body,/state\.live|switchLiveProvider/);
  }
});

test('opening the city selector or tapping the current bus mode does not silently change the saved provider',()=>{
  const c=vm.createContext({state:{live:{provider:'gyeonggi'}},homeEditor:'',busCitiesMeta:{status:'ready'},render(){},
    switchLiveProvider(){assert.fail('must not switch provider until confirmation');}});
  const start=source.indexOf('  if (action === "edit-home-trip")');
  const end=source.indexOf('  if (action === "preview-boarding-stop")',start);
  vm.runInContext(`function click(action,target){${source.slice(start,end)}}`,c);
  vm.runInContext('click("edit-home-trip",{dataset:{editor:"departure"}})',c);
  vm.runInContext('click("set-boarding-mode",{dataset:{mode:"bus"}})',c);
  assert.equal(c.state.live.provider,'gyeonggi');
});

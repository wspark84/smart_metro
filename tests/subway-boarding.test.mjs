import test from 'node:test';
import assert from 'node:assert/strict';
import { subwayDirections, normalizeSubwayArrival, fetchSubwayRows, searchSubwayStations } from '../src/server/subway-providers.mjs';
import { stationSearchQueries, rankStationCandidates } from '../src/logic/station-search.js';
import { normalizeTransitRoutes } from '../src/server/transit-providers.mjs';
import { DEFAULT_STATE } from '../src/state.js';
import { ensureLiveBindingState, switchLiveProvider, syncActiveLiveBinding } from '../src/logic/live-bindings.js';
import { projectDomainSnapshot, applyDomainSnapshotToState } from '../src/domain-model.js';

const now = new Date('2026-09-17T08:00:00+09:00');
const row = {subwayId:'1004',statnId:'1004000426',statnNm:'서울',updnLine:'상행',trainLineNm:'불암산행 - 회현방면',bstatnNm:'불암산',btrainSttus:'일반',barvlDt:'300',recptnDt:'2026-09-17 07:59:30',arvlCd:'5'};
const selected = subwayDirections([row])[0];

test('similar station queries tolerate spaces and shortened names without merging opposite stops',()=>{
  assert.deepEqual(stationSearchQueries('광교 레이크시티'),['광교 레이크시티','광교레이크시티','광교레이']);
  const results = rankStationCandidates([{stationId:'a',stationName:'더샵광교레이크시티.광교호반베르디움'}, {stationId:'b',stationName:'더샵광교레이크시티.광교호반베르디움'}, {stationId:'c',stationName:'다른 정류장'}],'광교레이크시티');
  assert.deepEqual(results.map(r=>r.stationId),['a','b','c']);
});
test('subway directions distinguish opposite platforms, branch termini and express trains',()=>{
  const routes = subwayDirections([row,{...row,updnLine:'하행',trainLineNm:'오이도행 - 숙대입구방면',bstatnNm:'오이도'}, {...row,bstatnNm:'한성대입구'}, {...row,btrainSttus:'급행'}]);
  assert.equal(routes.length,4);
  assert.equal(routes[0].nextStation,'회현');
  assert.match(routes[0].label,/상행.*회현.*불암산.*일반/);
});
test('subway ETA corrects source timestamp and excludes opposite direction and departed trains',()=>{
  const result = normalizeSubwayArrival([row,{...row,barvlDt:'900'}, {...row,updnLine:'하행',barvlDt:'60'}, {...row,arvlCd:'2',barvlDt:'60'}],selected,now);
  assert.deepEqual(result.arrivalsMin,[4.5,14.5]);
  assert.equal(result.vehicleType,'SUBWAY');
  assert.equal(result.fetchedAt,now.toISOString());
});
test('zero, missing, stale, and future source times never become valid catchable trains',()=>{
  for (const patch of [{barvlDt:'0'},{barvlDt:''},{recptnDt:'2026-09-17 07:50:00'},{recptnDt:'2026-09-17 08:01:00'}]) {
    assert.throws(()=>normalizeSubwayArrival([{...row,...patch}],selected,now),/유효한 도착/);
  }
  assert.throws(()=>normalizeSubwayArrival([row],{routeId:'different'},now),/노선·방향/);
});
test('missing subway key fails explicitly and never falls back to demo or TAGO',async()=>{
  let fetched = false;
  await assert.rejects(fetchSubwayRows('광교',{TAGO_SERVICE_KEY:'not-a-subway-key'},()=>{fetched=true;}),/SEOUL_SUBWAY_API_KEY/);
  assert.equal(fetched,false);
});
test('station search is restricted to subway category and retains coordinates and line-specific names',async()=>{
  const results = await searchSubwayStations('광교',{KAKAO_LOCAL_REST_API_KEY:'test'},async(url,init)=>{
    assert.equal(new URL(url).searchParams.get('category_group_code'),'SW8');
    assert.equal(init.headers.Authorization,'KakaoAK test');
    return {ok:true,json:async()=>({documents:[{id:'123',place_name:'광교중앙역 신분당선',category_group_code:'SW8',x:'127.05',y:'37.28',address_name:'수원시'}, {id:'999',place_name:'광교역카페',category_group_code:'CE7',x:'127',y:'37'}]})};
  });
  assert.equal(results.length,1);assert.equal(results[0].stationName,'광교중앙');assert.equal(results[0].posX,'127.05');
});
test('subway boarding choice survives account storage and switching back from bus',()=>{
  const state = structuredClone(DEFAULT_STATE);
  state.live = ensureLiveBindingState({...state.live,provider:'subway',stationId:selected.stationId,stationName:'서울',routeId:selected.routeId,routeNumber:'4호선'});
  syncActiveLiveBinding(state.live);switchLiveProvider(state.live,'tago');switchLiveProvider(state.live,'subway');
  const restored = applyDomainSnapshotToState(projectDomainSnapshot(state));
  assert.equal(restored.live.routeId,selected.routeId);assert.equal(restored.live.stationName,'서울');
});
test('subway journey must match selected line, next station and service type',()=>{
  const query = {provider:'subway',stationName:'서울',stationId:selected.stationId,routeId:selected.routeId,routeNumber:'4호선'};
  const route = next => ({status:'OK',routes:[{steps:[{properties:{type:'SUBWAY',time:600,stops:[{name:'서울역'},{name:next},{name:'명동'}],vehicles:[{name:'4호선',type:'일반'}]}}]}]});
  assert.equal(normalizeTransitRoutes(route('회현'),query).routes[0].compatible,true);
  assert.equal(normalizeTransitRoutes(route('숙대입구'),query).routes[0].compatible,false);
  assert.equal(normalizeTransitRoutes(route('회현'),{...query,routeNumber:'1호선'}).routes[0].compatible,false);
});

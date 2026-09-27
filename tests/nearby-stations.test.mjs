import test from 'node:test';
import assert from 'node:assert/strict';
import {searchNearbyBoardingStations} from '../src/server/nearby-stations.mjs';
const point={lat:37.33,lng:127.09};
test('national API failure falls back to official regional IDs and positions',async()=>{
 const result=await searchNearbyBoardingStations(point,{env:{GYEONGGI_SERVICE_KEY:'test'},tago:async()=>{throw Error('TAGO 99');},fetchImpl:async url=>{
  assert.equal(url.pathname,'/6410000/busstationservice/v2/getBusStationAroundListv2');
  assert.equal(url.searchParams.get('x'),'127.09');
  return {ok:true,json:async()=>({response:{msgHeader:{resultCode:0},msgBody:{busStationList:[{stationId:'228001',stationName:'손곡중학교',mobileNo:'47956',x:127.09,y:37.33},{stationId:'far',stationName:'다른 정류장',x:128,y:37.33}]}}})};
 }});
 assert.equal(result.provider,'gyeonggi');assert.equal(result.stations.length,1);
 assert.equal(result.stations[0].stationNumber,'47956');assert.equal(result.stations[0].selectionId,'gyeonggi:228001');
});
test('valid national results do not call a fallback, invalid coordinates never call providers',async()=>{
 const stations=[{nodeId:'GGB1'}];
 const result=await searchNearbyBoardingStations(point,{tago:async()=>stations,fetchImpl:()=>{throw Error('unexpected');}});
 assert.deepEqual(result,{provider:'tago',stations});
 await assert.rejects(searchNearbyBoardingStations({lat:'',lng:127},{tago:()=>{throw Error('unexpected');}}),/올바르지/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupBoardingRoutes} from '../src/server/boarding-routes.mjs';
const binding={provider:'tago',nodeId:'GGB228002046',cityCode:'31200',stationName:'손곡중학교',posX:127.1,posY:37.3};
const tago={...binding,stationId:binding.nodeId,stationNumber:'47956'};
const regional={stationId:'official-regional-id',stationName:binding.stationName,stationNumber:'47956',posX:127.1,posY:37.3};
const options={env:{TAGO_SERVICE_KEY:'test',GYEONGGI_SERVICE_KEY:'test'},primary:async()=>({routes:[]}),nearby:async()=>[tago],stations:async()=>[regional],routes:async({stationId})=>{assert.equal(stationId,regional.stationId);return [{routeId:'R',routeNumber:'17'}];}};
test('empty TAGO routes resolve exact officially verified regional station and routes',async()=>{
 const result=await lookupBoardingRoutes(binding,options);
 assert.equal(result.provider,'gyeonggi');assert.equal(result.routes[0].routeId,'R');
 assert.equal(result.verifiedStation.stationId,regional.stationId);
 assert.equal(result.verifiedStation.nodeId,'');
});
test('TAGO failure can recover through verified regional route lookup',async()=>{
 assert.equal((await lookupBoardingRoutes(binding,{...options,primary:async()=>{throw Error('upstream');}})).routes.length,1);
});
test('valid primary routes never invoke fallback',async()=>{
 const result=await lookupBoardingRoutes(binding,{...options,primary:async()=>({routes:[{routeId:'original'}]}),nearby:()=>assert.fail()});
 assert.equal(result.routes[0].routeId,'original');
});

test('TAGO numeric stop number keeps its leading zero for regional lookup',async()=>{
 const result=await lookupBoardingRoutes(binding,{...options,
   nearby:async()=>[{...tago,stationNumber:'4413'}],
   stations:async({keyword})=>keyword==='04413'?[{...regional,stationNumber:'04413'}]:
     Array.from({length:10},(_,i)=>({...regional,stationId:`unrelated-${i}`,stationNumber:`14413${i}`})),
 });
 assert.equal(result.verifiedStation.stationId,regional.stationId);
});
test('opposite stop, mismatched identity, missing location and ambiguous stops fail closed',async()=>{
 for(const overrides of [
  {stations:async()=>[{...regional,stationNumber:'47957'}]},
  {stations:async()=>[{...regional,posX:127.2}]},
  {stations:async()=>[regional,{...regional,stationId:'other'}]},
  {nearby:async()=>[{...tago,nodeId:'GGBother'}]},
 ]) await assert.rejects(lookupBoardingRoutes(binding,{...options,...overrides,routes:()=>assert.fail('must not query an unverified stop')}));
 assert.deepEqual(await lookupBoardingRoutes({...binding,posX:undefined},{...options,nearby:()=>assert.fail()}),{routes:[]});
});

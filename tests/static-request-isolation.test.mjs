import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { TRANSIT_LOOKUP_PATHS } from '../src/server/transit-lookups.mjs';

test('public screen files are not held behind a busy account runtime lock', async () => {
  const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  const callbackSource = source.slice(source.indexOf('const server = createServer('), source.indexOf('\nserver.listen('));
  let listener;
  const served = [];
  const queued = [];
  const context = vm.createContext({
    TRANSIT_LOOKUP_PATHS: new Set(),
    createServer(callback) { listener = callback; return {}; },
    parseRequestUrl(request) { return new URL(request.url, 'http://localhost'); },
    runWithRuntimeLock(work) { queued.push(work); return new Promise(() => {}); },
    async handleRequest(request) { served.push(request.url); },
    sendUnhandledServerError() { assert.fail('unexpected static request error'); },
  });
  vm.runInContext(callbackSource, context);
  listener({method:'POST',url:'/api/device-profile'}, {});
  listener({method:'GET',url:'/'}, {});
  listener({method:'GET',url:'/src/locale-ko.js'}, {});
  listener({method:'HEAD',url:'/src/styles.css'}, {});
  await Promise.resolve();
  assert.deepEqual(served, ['/', '/src/locale-ko.js', '/src/styles.css']);
  assert.equal(queued.length, 1, 'mutable alarm-related writes still use the runtime lock');
});

test('atomic settings save bypasses a blocked runtime, checks auth and commits before responding',async()=>{
 const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
 const callback=source.slice(source.indexOf('const server = createServer('),source.indexOf('\nserver.listen('));
 let listener,authenticated=false,trusted=true,committed=false;
 const statuses=[],writes=[];
 const context=vm.createContext({TRANSIT_LOOKUP_PATHS:new Set(),
   createServer(fn){listener=fn;return {};},parseRequestUrl:r=>new URL(r.url,'http://localhost'),
   isTrustedMutation:()=>trusted,createRequestAuth:()=>({resolve:async()=>authenticated?{user:{id:'test'}}:null}),
   sendAuthJson(r,status){if(status===200)assert.equal(committed,true);statuses.push(status);},
   readJsonBody:async()=>({user:{requiredArrivalTime:'15:30'},commute:{boardingAccessMin:3}}),
   buildUserFileMap:id=>({appState:id+'/app-state',domain:id+'/domain'}),createSupabaseGateway:()=>({}),
   runWithDocumentStorage:async(auth,gateway,work)=>{const result=await work();committed=true;return result;},
   projectDomainSnapshot:state=>({user:state.user}),
   writeAppState:async(state,path)=>writes.push(path),writeDomainSnapshot:async(state,path)=>writes.push(path),
   runWithRuntimeLock(){assert.fail('settings must not wait for alarm runtime');},
 });
 vm.runInContext(callback,context);
 const call=async()=>{listener({method:'POST',url:'/api/app-state'},{});await new Promise(r=>setTimeout(r,0));};
 await call();assert.equal(statuses.at(-1),401);assert.equal(writes.length,0);
 authenticated=true;trusted=false;await call();assert.equal(statuses.at(-1),403);assert.equal(writes.length,0);
 trusted=true;await call();assert.equal(statuses.at(-1),200);assert.deepEqual(writes,['test/app-state','test/domain']);
});

test('station lookups bypass busy runtime writes but still require authentication', async () => {
  const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  const callbackSource = source.slice(source.indexOf('const server = createServer('), source.indexOf('\nserver.listen('));
  let listener, authenticated=false;
  const statuses=[],lookups=[];
  const context = vm.createContext({TRANSIT_LOOKUP_PATHS,PUBLIC_API_PATHS:new Set(['/api/bus/config']),
    createServer(callback){listener=callback;return {};},parseRequestUrl(req){return new URL(req.url,'http://localhost');},
    createRequestAuth(){return {resolve:async()=>authenticated ? {user:{id:'test'}} : null};},
    sendAuthJson(response,status){statuses.push(status);},
    transitLookup:async(url)=>{lookups.push(url.pathname);return {stations:[]};},
    runWithRuntimeLock(){assert.fail('search must not join the runtime lock');},
  });
  vm.runInContext(callbackSource,context);
  listener({method:'GET',url:'/api/bus/stations?provider=subway&keyword=서울'},{});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(statuses,[401]);assert.deepEqual(lookups,[]);
  authenticated=true;
  listener({method:'GET',url:'/api/bus/stations?provider=subway&keyword=서울'},{});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(statuses,[401,200]);assert.deepEqual(lookups,['/api/bus/stations']);
  authenticated=false;
  listener({method:'GET',url:'/api/bus/nearby-stations?provider=tago&lat=37.28&lng=127.06'},{});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(statuses.at(-1),401);
  authenticated=true;
  listener({method:'GET',url:'/api/bus/nearby-stations?provider=tago&lat=37.28&lng=127.06'},{});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(statuses.at(-1),200);assert.equal(lookups.at(-1),'/api/bus/nearby-stations');
});

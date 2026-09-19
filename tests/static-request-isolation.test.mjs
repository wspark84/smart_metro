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
  listener({method:'POST',url:'/api/app-state'}, {});
  listener({method:'GET',url:'/'}, {});
  listener({method:'GET',url:'/src/locale-ko.js'}, {});
  listener({method:'HEAD',url:'/src/styles.css'}, {});
  await Promise.resolve();
  assert.deepEqual(served, ['/', '/src/locale-ko.js', '/src/styles.css']);
  assert.equal(queued.length, 1, 'account writes must still use the protected runtime lock');
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
});

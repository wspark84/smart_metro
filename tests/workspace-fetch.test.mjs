import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceFetch} from '../src/services/workspace-fetch.js';

const origin='https://metro.test';
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('parallel settings saves and runtime reads cannot overlap document revisions',async()=>{
  let revision=0,active=0,maxActive=0;
  const client=createWorkspaceFetch(async()=>{
    const expected=revision;active++;maxActive=Math.max(maxActive,active);
    await new Promise(r=>setTimeout(r,2));
    assert.equal(revision,expected,'concurrent writes would cause PT409');
    revision++;active--;return new Response('{}');
  },{origin});
  await Promise.all(['/api/app-state','/api/domain-sync','/api/device-profile','/api/alarm-runtime','/api/dispatch-queue'].map(path=>client(path)));
  assert.equal(maxActive,1);assert.equal(revision,5);
});

test('workspace queue never blocks transit search, auth, static files or other origins',async()=>{
  const wait=defer(),called=[];
  const client=createWorkspaceFetch(async path=>{called.push(path);if(path==='/api/app-state')await wait.promise;return new Response('{}');},{origin});
  const saving=client('/api/app-state',{method:'POST'});
  await Promise.resolve();
  for(const path of ['/api/bus/stations?keyword=04413','/api/auth/session','/src/app.js','https://external.test/api/anything'])await client(path);
  assert.equal(called.length,5);wait.resolve();await saving;
});

test('failed requests release the queue and are not automatically retried',async()=>{
  let calls=0;
  const client=createWorkspaceFetch(async()=>{if(++calls===1)throw Error('network');return new Response('{}');},{origin});
  const first=client('/api/app-state'),second=client('/api/domain-sync');
  await assert.rejects(first,/network/);assert.equal((await second).status,200);assert.equal(calls,2);
});

test('logout cancels queued account writes before they can use a later session',async()=>{
  const wait=defer(),called=[];
  const client=createWorkspaceFetch(async path=>{called.push(path);if(path==='/api/app-state')await wait.promise;return new Response('{}');},{origin});
  const first=client('/api/app-state');await Promise.resolve();
  const queued=client('/api/domain-sync');
  await client('/api/auth/logout',{method:'POST'});wait.resolve();await first;
  await assert.rejects(queued,{name:'AbortError'});assert.deepEqual(called,['/api/app-state','/api/auth/logout']);
});

test('aborted queued requests are not sent; Web Locks coordinates separate clients',async()=>{
  let tail=Promise.resolve(),active=0,max=0;
  const locks={request(name,options,run){assert.equal(name,'smart-metro-workspace');assert.equal(options.mode,'exclusive');const result=tail.then(run);tail=result.catch(()=>{});return result;}};
  const fetchImpl=async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;return new Response('{}');};
  const one=createWorkspaceFetch(fetchImpl,{origin,locks}),two=createWorkspaceFetch(fetchImpl,{origin,locks});
  await Promise.all([one('/api/app-state'),two('/api/alarm-runtime')]);assert.equal(max,1);
  const abort=new AbortController();abort.abort();
  await assert.rejects(one('/api/app-state',{signal:abort.signal}),{name:'AbortError'});
});

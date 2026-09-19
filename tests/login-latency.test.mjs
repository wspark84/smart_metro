import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {handleSocialLoginRoute} from '../src/server/social-login-routes.mjs';
import {TRANSIT_LOOKUP_PATHS} from '../src/server/transit-lookups.mjs';
import {projectDomainSnapshot,applyDomainSnapshotToState} from '../src/domain-model.js';
import {sanitizeDeviceProfile,DEFAULT_DEVICE_PROFILE} from '../src/device-profile.js';

test('login routes respond while another account holds the runtime lock', async () => {
  const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
  const callback=source.slice(source.indexOf('const server = createServer('),source.indexOf('\nserver.listen('));
  let listener;
  const queued=[];
  const context=vm.createContext({
    createServer(fn){listener=fn;return {};},
    parseRequestUrl:r=>new URL(r.url,'http://localhost'),
    TRANSIT_LOOKUP_PATHS,
    runWithRuntimeLock(work){queued.push(work);return new Promise(()=>{});},
    handleSocialLoginRoute:(req,res,read)=>handleSocialLoginRoute(req,res,read,{
      env:{},createAuth:()=>({resolve:async()=>null}),
    }),
    readJsonBody:async()=>({}),
    sendUnhandledServerError(){assert.fail('unexpected route error');},
  });
  vm.runInContext(callback,context);
  listener({method:'GET',url:'/api/alarm-runtime',headers:{}},{});
  for(const path of ['/api/auth/providers','/api/auth/session']){
    let status,body;
    const response={writeHead(s){status=s;},end(b){body=JSON.parse(b);}};
    listener({method:'GET',url:path,headers:{}},response);
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(status,200,`${path} must bypass the busy runtime queue`);
    if(path.endsWith('session'))assert.equal(body.authenticated,false);
  }
  assert.equal(queued.length,1,'account data must remain protected by the mutex');
});

test('workspace loading bypasses the alarm queue with request-local user paths', async () => {
  const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
  const callback=source.slice(source.indexOf('const server = createServer('),source.indexOf('\nserver.listen('));
  let listener; const replies=[];
  const context=vm.createContext({
    createServer(fn){listener=fn;return {};},parseRequestUrl:r=>new URL(r.url,'http://localhost'),TRANSIT_LOOKUP_PATHS,
    runWithRuntimeLock(){assert.fail('workspace reads must not wait behind alarms');},
    createRequestAuth:req=>({resolve:async()=>req.user ? ({user:{id:req.user},accessToken:req.user}) : null}),
    createSupabaseGateway:()=>({}),
    runWithDocumentStorage:async(auth,gateway,work)=>work(),
    readWorkspaceView:async(auth,path)=>({status:200,payload:{user:auth.user.id,path}}),
    sendAuthJson:(res,status,payload)=>replies.push({status,payload}),
    sendUnhandledServerError(){assert.fail('unexpected error');},
  });
  vm.runInContext(callback,context);
  listener({method:'GET',url:'/api/app-state',headers:{},user:'a'},{});
  listener({method:'GET',url:'/api/domain-snapshot',headers:{},user:'b'},{});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(replies.map(x=>x.payload.user),['a','b']);
  listener({method:'GET',url:'/api/device-profile',headers:{}},{});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(replies.at(-1).status,401,'anonymous requests must never read workspace data');
});

test('concurrent workspace views never use shared user globals or load alarm documents', async () => {
  const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('async function readWorkspaceView('),source.indexOf('\nlet activeUserContext'));
  const reads=[];
  const context=vm.createContext({
    buildUserFileMap:id=>({appState:id+'/app',domain:id+'/domain',deviceProfile:id+'/device'}),
    readAppState:async path=>{reads.push(path);return {user:{name:path},device:{}};},
    readDomainSnapshot:async path=>{reads.push(path);return {owner:path};},
    readDeviceProfile:async path=>{reads.push(path);return {owner:path};},
    analyzeDevicePushTarget:()=>({}),sanitizeDeviceProfile,DEFAULT_DEVICE_PROFILE,
    projectDomainSnapshot,applyDomainSnapshotToState,
    writeAppState(){assert.fail('existing workspace must not be reseeded');},
    writeDomainSnapshot(){assert.fail('existing workspace must not be reseeded');},
  });
  vm.runInContext(fn,context);
  const results=await Promise.all([
    vm.runInContext('readWorkspaceView({user:{id:"a"}},"/api/app-state")',context),
    vm.runInContext('readWorkspaceView({user:{id:"b"}},"/api/device-profile")',context),
  ]);
  assert.equal(results[0].payload.user.name,'a/app');
  assert.equal(results[1].payload.profile.owner,'b/device');
  assert.deepEqual(reads,['a/app','a/domain','b/app','b/domain','b/device']);
});

test('first workspace view seeds the same account-scoped state before returning it', async () => {
  const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('async function readWorkspaceView('),source.indexOf('\nlet activeUserContext'));
  const writes=[];
  const context=vm.createContext({
    buildUserFileMap:id=>({appState:id+'/app',domain:id+'/domain'}),
    readAppState:async()=>null,readDomainSnapshot:async()=>null,
    projectDomainSnapshot,applyDomainSnapshotToState,
    writeAppState:async(value,path)=>writes.push({value,path}),
    writeDomainSnapshot:async(value,path)=>writes.push({value,path}),
  });
  vm.runInContext(fn,context);
  const result=await vm.runInContext('readWorkspaceView({user:{id:"new",name:"새 사용자",email:"new@example.com"}},"/api/app-state")',context);
  assert.equal(result.status,200);
  assert.equal(result.payload.user.name,'새 사용자');
  assert.deepEqual(writes.map(x=>x.path),['new/app','new/domain']);
});

test('request-scoped auth mutations keep origin validation outside the runtime lock', async () => {
  const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
  const callback=source.slice(source.indexOf('const server = createServer('),source.indexOf('\nserver.listen('));
  let listener;
  const statuses=[];
  const context=vm.createContext({
    createServer(fn){listener=fn;return {};},parseRequestUrl:r=>new URL(r.url,'http://localhost'),
    TRANSIT_LOOKUP_PATHS,
    runWithRuntimeLock(){assert.fail('auth must not wait for alarm storage');},
    handleSocialLoginRoute:(req,res,read)=>handleSocialLoginRoute(req,res,read,{env:{APP_BASE_URL:'https://metro.example'}}),
    readJsonBody:async()=>({}),sendUnhandledServerError(){assert.fail('unexpected error');},
  });
  vm.runInContext(callback,context);
  for(const path of ['/api/auth/oauth/start','/api/auth/logout','/api/account/profile']) {
    listener({method:path.endsWith('profile')?'PUT':'POST',url:path,headers:{origin:'https://attacker.example'}},
      {writeHead(s){statuses.push(s);},end(){}});
  }
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(statuses,[403,403,403]);
});

test('workspace documents start in parallel while globals are assigned only after all reads finish', async () => {
  const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('async function activateUserContext('),source.indexOf('async function resolveAuthenticatedRequest('));
  const names=['readAlarmRuntimeState','readAlarmDeliveryState','readBusAccuracyState','readBusAccuracyRuntimeState',
    'readDispatchQueueState','readDispatchExecutionState','readPushGatewayState','readEffectiveDeviceProfile'];
  const started=[],complete=[];
  const context=vm.createContext({buildUserFileMap:()=>({}),...Object.fromEntries(names.map(name=>[name,()=>{
    started.push(name);return new Promise(resolve=>complete.push(()=>resolve({name})));
  }]))});
  vm.runInContext('let activeUserContext,alarmRuntimeState,alarmDeliveryState,busAccuracyState,busAccuracyRuntimeState,dispatchQueueState,dispatchExecutionState,pushGatewayState,deviceProfileState;'+fn,context);
  const pending=vm.runInContext('activateUserContext({id:"user-a"})',context);
  assert.equal(started.length,8);
  assert.equal(vm.runInContext('alarmRuntimeState',context),undefined);
  complete.forEach(resolve=>resolve());await pending;
  assert.equal(vm.runInContext('alarmRuntimeState.name',context),'readAlarmRuntimeState');
  assert.equal(vm.runInContext('deviceProfileState.name',context),'readEffectiveDeviceProfile');
});

test('stalled browser authentication is aborted with a Korean retry message', async () => {
  const source=(await readFile(new URL('../src/services/auth.js',import.meta.url),'utf8')).replaceAll('export async function','async function');
  let abort,cleared=false;
  const context=vm.createContext({AbortController,
    setTimeout(fn){abort=fn;return 1;},clearTimeout(){cleared=true;},
    fetch:async(path,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')))),
  });
  vm.runInContext(source,context);
  const pending=vm.runInContext('fetchAuthSession()',context);abort();
  await assert.rejects(pending,/로그인 연결이 지연/);assert.equal(cleared,true);
});

test('anonymous bootstrap loads login providers in parallel and never waits for transport settings', async () => {
  const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('async function bootstrap()'),source.indexOf('\nbootstrap();'));
  const calls=[];let releaseSession;
  const context=vm.createContext({URL,URLSearchParams,window:{location:{href:'https://metro.example/'}},isAuthenticated:()=>false,
    hydrateAuthProviders:async()=>{calls.push('providers');},
    hydrateAuthSession:()=>{calls.push('session');return new Promise(r=>releaseSession=r);},
    refreshBusApiConfig(){assert.fail('login must not await buses');},
    hydrateAuthenticatedWorkspace(){assert.fail('anonymous workspace');},render(){calls.push('render');},
  });
  vm.runInContext(fn,context);const pending=vm.runInContext('bootstrap()',context);
  assert.deepEqual(calls.slice(0,2),['providers','session']);releaseSession(false);await pending;
  assert.equal(calls.at(-1),'render');
});

test('slow alarm refresh does not enqueue another ten requests on each poll', async () => {
  const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
  const start=source.indexOf('function queueAlarmRuntimeRefresh(');
  const end=source.indexOf('\nasync function primeAlarmPlayback',start);
  const fn=source.slice(start,end);
  let count=0;const timers=[];
  const names=['fetchAlarmRuntimeStatus','fetchAlarmDeliveryState','fetchAlarmEvents','fetchDispatchQueue','fetchDispatchExecutions',
    'fetchPushPreview','fetchDeviceTokenHealth','fetchFcmAuthStatus','fetchPushGatewayConfig','fetchPushGatewayAttempts'];
  const context=vm.createContext({isAuthenticated:()=>true,
    alarmRuntimeMeta:{status:'idle'},
    window:{clearTimeout(){},setTimeout(fn){timers.push(fn);return timers.length;}},
    ...Object.fromEntries(names.map(name=>[name,()=>{count++;return new Promise(()=>{});}])),
  });
  vm.runInContext('let alarmRuntimeTimer=null,alarmRuntimeToken=0,alarmRuntimeRefreshInFlight=false;'+fn,context);
  vm.runInContext('queueAlarmRuntimeRefresh(0)',context);timers.shift()();
  vm.runInContext('queueAlarmRuntimeRefresh(0)',context);timers.splice(0).forEach(fn=>fn());
  assert.equal(count,10);
});

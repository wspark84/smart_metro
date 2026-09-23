import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {validateAlarmJob,createAlarmJobGateway,runAlarmWorker} from '../src/server/alarm-worker.mjs';
import {writeFile,checkpointAlarmWorker,isBackgroundAlarmWorker} from '../src/server/document-storage.mjs';
import {buildUserDataFilePath} from '../src/server/user-storage.mjs';

const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const job='33333333-3333-4333-8333-333333333333',token='a'.repeat(64);
test('alarm capabilities isolate users, deny replay/expiry, and preserve settings and revisions in SQL',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated;
      insert into auth.users values('${a}'),('${b}');`);
    for (const file of ['202609160001_smart_metro_documents.sql','202609160002_atomic_document_batch.sql',
      '202609200001_non_retryable_document_conflict.sql','202609230001_alarm_worker.sql']) {
      await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    }
    await db.exec(`insert into public.smart_metro_documents(user_id,document_key,payload)
      values('${a}','app-state','{"user":{"name":"A"},"device":{}}'),('${b}','app-state','{"owner":"B"}');
      update smart_metro_private.alarm_control set enabled=true;
      insert into smart_metro_private.alarm_jobs(user_id,job_id,token_hash,expires_at)
      values('${a}','${job}',sha256(convert_to('${token}','UTF8')),now()+interval '2min');set role anon;`);
    const claim=(t=token)=>db.query('select public.claim_smart_metro_alarm_job($1,$2) as result',[job,t]);
    const commit=docs=>db.query('select public.commit_smart_metro_alarm_job($1,$2,$3::jsonb,false) as result',[job,token,JSON.stringify(docs)]);
    await assert.rejects(db.query('select * from smart_metro_private.alarm_jobs'),{code:'42501'});
    await assert.rejects(claim('b'.repeat(64)),{code:'42501'});
    const leased=(await claim()).rows[0].result;
    assert.equal(leased.userId,a);assert.equal(leased.documents.length,1);
    assert.equal(leased.documents[0].payload.user.name,'A');
    await assert.rejects(claim(),{code:'42501'});
    await assert.rejects(commit([{document_key:'domain-store',payload:{},expected_revision:0}]),{code:'42501'});
    await assert.rejects(commit([{document_key:'app-state',payload:{user:{name:'changed'},device:{}},expected_revision:1}]),{code:'42501'});
    await commit([{document_key:'alarm-runtime',payload:{fired:true},expected_revision:0}]);
    await assert.rejects(commit([{document_key:'alarm-runtime',payload:{stale:true},expected_revision:8}]),{code:'PT409'});
    await db.query('select public.commit_smart_metro_alarm_job($1,$2,\'[]\',true)',[job,token]);
    await assert.rejects(commit([]),{code:'42501'});
    await db.exec(`reset role;update smart_metro_private.alarm_jobs set expires_at=now()-interval '1 sec',claimed=false;set role anon;`);
    await assert.rejects(claim(),{code:'42501'});
    await db.exec(`reset role;update smart_metro_private.alarm_jobs set expires_at=now()+interval '2min',claimed=false,checkpointed=false;
      set role anon;`);
    await claim();
    await db.exec(`reset role;update public.smart_metro_documents set revision=revision+1 where user_id='${a}' and document_key='app-state';set role anon;`);
    await assert.rejects(commit([]),{code:'PT409'});
    await db.exec('reset role;create schema cron;create schema net;');
    await db.exec(`create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
      create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;`);
    const schedule=await readFile(new URL('../supabase/migrations/202609230002_alarm_schedule.sql',import.meta.url),'utf8');
    await db.exec(schedule.replace(/create extension if not exists \w+;/g,''));
    await db.exec('update smart_metro_private.alarm_control set enabled=false');
    assert.equal((await db.query('select smart_metro_private.enqueue_alarm_jobs() as count')).rows[0].count,0);
  } finally {await db.close();}
});

test('worker validates capability before storage and never accepts caller-supplied user identity',()=>{
  for(const bad of [null,{}, {jobId:job,token:'bad'},{jobId:'bad',token}]) assert.throws(()=>validateAlarmJob(bad),{statusCode:401});
  assert.deepEqual(validateAlarmJob({jobId:job,token,userId:b}),{jobId:job,token});
});

test('worker checkpoints the outbox before delivery and completes the single-user lease',async()=>{
  const calls=[];let revision=0;
  const options={env:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'},
    fetchImpl:async(url,opts)=>{
      const name=new URL(url).pathname.split('/').at(-1);const args=JSON.parse(opts.body);calls.push(name);
      assert.equal(args.p_token,token);assert.equal(args.p_job_id,job);
      const data=name==='claim_smart_metro_alarm_job'?{userId:a,documents:[]}:
        args.p_documents.map(doc=>({...doc,revision:++revision}));
      return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
    }};
  const result=await runAlarmWorker({jobId:job,token,userId:b},async user=>{
    assert.equal(user.id,a);assert.equal(isBackgroundAlarmWorker(),true);
    await writeFile(buildUserDataFilePath(a,'alarm-runtime.json'),JSON.stringify({outbox:true}));
    await checkpointAlarmWorker();
    assert.equal(calls.filter(x=>x==='commit_smart_metro_alarm_job').length,1);
    await assert.rejects(writeFile(buildUserDataFilePath(b,'alarm-runtime.json'),'{}'),{statusCode:401});
    await writeFile(buildUserDataFilePath(a,'alarm-runtime.json'),JSON.stringify({sent:true}));
    return {runtime:{status:'running'}};
  },options);
  assert.equal(result.ok,true);assert.equal(calls.length,4);assert.equal(isBackgroundAlarmWorker(),false);
});

test('invalid capability errors never echo tokens or database diagnostics',async()=>{
  await assert.rejects(createAlarmJobGateway({jobId:job,token},{env:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'},
    fetchImpl:async()=>new Response(JSON.stringify({code:'42501',message:'private diagnostics '+token}),{status:401})}),
    error=>error.statusCode===401 && !error.message.includes(token) && !error.message.includes('diagnostics'));
});

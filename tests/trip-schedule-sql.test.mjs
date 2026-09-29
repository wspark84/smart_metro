import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('SQL scheduler selects a commute even with a paused home and rejects invalid times',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create schema smart_metro_private;create schema net;
   create table smart_metro_private.alarm_control(singleton boolean,enabled boolean);insert into smart_metro_private.alarm_control values(true,true);
   create table public.smart_metro_documents(user_id uuid,document_key text,payload jsonb);
   create table smart_metro_private.alarm_jobs(user_id uuid primary key,job_id uuid,token_hash bytea,expires_at timestamptz,claimed boolean,checkpointed boolean,scheduled_at timestamptz,last_status text);
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;`);
  const sql=await readFile(new URL('../supabase/migrations/202609290001_independent_trip_schedules.sql',import.meta.url),'utf8');
  await db.exec(sql.replace(/create extension if not exists \w+;/g,''));
  await db.exec(`insert into public.smart_metro_documents values
   ('11111111-1111-4111-8111-111111111111','app-state',jsonb_build_object('schedule',jsonb_build_object('snoozeDate',to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD')),
    'tripSchedules',jsonb_build_array(jsonb_build_object('enabled',true,'requiredArrivalTime',to_char((now() at time zone 'Asia/Seoul')+interval '1 minute','HH24:MI'),'departure','{"live":{"provider":"gyeonggi"}}'::jsonb)))),
   ('22222222-2222-4222-8222-222222222222','app-state','{"tripSchedules":[{"enabled":true,"requiredArrivalTime":"bad","departure":{"live":{"provider":"gyeonggi"}}}]}');`);
  const result=await db.query('select smart_metro_private.enqueue_alarm_jobs() as count');assert.equal(result.rows[0].count,1);
  assert.equal((await db.query('select user_id from smart_metro_private.alarm_jobs')).rows[0].user_id,'11111111-1111-4111-8111-111111111111');
 }finally{await db.close();}
});

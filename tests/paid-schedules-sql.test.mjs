import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('DB rejects unpaid schedule changes, protects token ownership and preserves free home saves',async()=>{
 const db=new PGlite();
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create table auth.users(id uuid primary key);insert into auth.users values('${a}'),('${b}');
   create table public.smart_metro_documents(user_id uuid,document_key text,payload jsonb);`);
  await db.exec(await readFile(new URL('../supabase/migrations/202610040001_paid_schedules.sql',import.meta.url),'utf8'));
  await db.query("insert into public.smart_metro_documents values($1,'app-state',$2)",[a,{tripSchedules:[],user:{requiredArrivalTime:'09:00'}}]);
  await assert.rejects(db.query("update public.smart_metro_documents set payload=$1",[{tripSchedules:[{id:'a'}]}]),/subscription required/);
  const row={token_hash:'hash',user_id:a,purchase_token:'secret-token',product_id:'inochi_schedule_monthly',state:'SUBSCRIPTION_STATE_ACTIVE',expires_at:'2099-01-01T00:00:00Z',auto_renew:true,verified_at:new Date().toISOString()};
  await db.query('select public.inochi_save_play_subscription($1)',[row]);
  await db.query("update public.smart_metro_documents set payload=$1",[{tripSchedules:[{id:'a'}]}]);
  await assert.rejects(db.query('select public.inochi_save_play_subscription($1)',[{...row,user_id:b}]),/ownership/);
  await db.exec("update public.inochi_play_subscriptions set expires_at=now()-interval '1 second'");
  await db.query("update public.smart_metro_documents set payload=$1",[{tripSchedules:[{id:'a'}],user:{requiredArrivalTime:'10:00'}}]);
  await assert.rejects(db.query("update public.smart_metro_documents set payload=$1",[{tripSchedules:[{id:'b'}]}]),/subscription required/);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from public.inochi_play_subscriptions'),/permission denied/);
 }finally{await db.close();}
});

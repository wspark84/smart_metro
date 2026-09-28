import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {catalogSpec,fetchCatalogPage,runCatalogJob} from '../src/server/transit-catalog.mjs';

test('catalog only accepts public metadata operations and official identities',()=>{
 assert.throws(()=>catalogSpec('arrivals','getSttnNoList',{}));
 assert.throws(()=>catalogSpec('routes','getRouteInfoIem',{cityCode:'31',routeId:'../secret'}));
 assert.deepEqual(catalogSpec('routes','getRouteNoList',{cityCode:31,serviceKey:'secret'}),{service:'routes',operation:'getRouteNoList',params:{cityCode:'31'}});
});
test('one worker call fetches only one page and emits resumable child scopes',async()=>{
 let calls=0;
 const value=await fetchCatalogPage({service:'routes',operation:'getRouteNoList',params:{cityCode:'31'},page:1},
 {env:{TAGO_SERVICE_KEY:'test'},fetchImpl:async()=>{calls++;return {ok:true,text:async()=>JSON.stringify({response:{header:{resultCode:'00'},body:{totalCount:101,pageNo:1,numOfRows:100,items:{item:Array.from({length:100},(_,i)=>({routeid:`GGB${i}`}))}}}})};}});
 assert.equal(calls,1);assert.equal(value.done,false);assert.equal(value.children.length,200);
});
test('invalid capability never reaches the database or external API',async()=>{
 let calls=0;await assert.rejects(runCatalogJob({token:'bad'},{rpc:async()=>{calls++;}}));assert.equal(calls,0);
});
test('catalog schema protects writes, hides unfinished pages, and publishes atomically',async()=>{
 const db=new PGlite();
 try {
  await db.exec('create role anon; create role authenticated; create schema smart_metro_private;');
  await db.exec(await readFile(new URL('../supabase/migrations/202609280002_transit_catalog.sql',import.meta.url),'utf8'));
  const spec={service:'stops',operation:'getCtyCodeList',params:{}};
  const {rows:[scope]}=await db.query('select id,run_id from smart_metro_private.catalog_scopes where spec=$1',[spec]);
  await db.exec('update smart_metro_private.catalog_control set enabled=true');
  const token='a'.repeat(64),id='11111111-1111-4111-8111-111111111111';
  await db.query("insert into smart_metro_private.catalog_job values(true,$1,sha256(convert_to($2,'UTF8')),$3,now()+interval '45 seconds',false)",[id,token,scope.id]);
  await assert.rejects(db.query('select public.claim_smart_metro_catalog_job($1,$2)',[id,'b'.repeat(64)]));
  await db.query('select public.claim_smart_metro_catalog_job($1,$2)',[id,token]);
  const before=await db.query('select public.read_smart_metro_catalog($1) as value',[spec]);assert.equal(before.rows[0].value,null);
  await db.query('select public.finish_smart_metro_catalog_job($1,$2,$3)',[id,token,{rows:[{citycode:31}],total:1,done:true,children:[]}]);
  const after=await db.query('select public.read_smart_metro_catalog($1) as value',[spec]);assert.equal(after.rows[0].value.complete,true);
  await assert.rejects(db.query('select public.finish_smart_metro_catalog_job($1,$2,$3)',[id,token,{rows:[],total:0,done:true,children:[]}]));
  await db.query("update smart_metro_private.catalog_job set expires_at=now()+interval '45 seconds',claimed=false where singleton");
  await db.query('select public.claim_smart_metro_catalog_job($1,$2)',[id,token]);
  await db.query('select public.finish_smart_metro_catalog_job($1,$2,$3)',[id,token,{error:'HTTP_429'}]);
  assert.equal((await db.query("select blocked_until>now() as blocked from smart_metro_private.catalog_usage where service='stops'")).rows[0].blocked,true);
  await db.exec('set role anon');await assert.rejects(db.query('select * from smart_metro_private.catalog_scopes'));
  assert.equal((await db.query('select public.read_smart_metro_catalog($1) as value',[spec])).rows[0].value.rows[0].citycode,31);
 } finally {await db.close();}
});

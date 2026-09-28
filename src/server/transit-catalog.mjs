import {createClient} from '@supabase/supabase-js';
import {getSupabaseConfig} from './supabase-gateway.mjs';
import {fetchWithTimeout} from './upstream-fetch.mjs';
import {readTagoResponse} from './tago-api.mjs';

const services={stops:'BusSttnInfoInqireService',routes:'BusRouteInfoInqireService'};
const allowed={stops:['getCtyCodeList','getSttnNoList'],routes:['getCtyCodeList','getRouteNoList','getRouteInfoIem','getRouteAcctoThrghSttnList']};
export function catalogSpec(service,operation,params={}) {
  if(!allowed[service]?.includes(operation)) throw new Error('Unsupported catalog operation');
  const safe={};
  for(const key of ['cityCode','routeId']) if(params[key]!==undefined) {
    const value=String(params[key]);
    if(!/^[A-Za-z0-9_-]{1,60}$/.test(value)) throw new Error('Invalid catalog identity');
    safe[key]=value;
  }
  if(operation!=='getCtyCodeList' && !safe.cityCode) throw new Error('Missing city');
  if(['getRouteInfoIem','getRouteAcctoThrghSttnList'].includes(operation) && !safe.routeId) throw new Error('Missing route');
  return {service,operation,params:safe};
}
export function catalogGateway(env=process.env) {
  const config=getSupabaseConfig(env);if(!config.configured) return null;
  const client=createClient(config.url,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false},
    global:{fetch:(url,init={})=>fetch(url,{...init,signal:AbortSignal.timeout(5000)})}});
  return async(name,args)=>{
    const {data,error}=await client.rpc(name,args);
    if(error) throw new Error('Catalog storage unavailable');
    return data;
  };
}
export async function readCatalogRows(service,operation,params={},env=process.env) {
  try {
    const spec=catalogSpec(service,operation,params),rpc=catalogGateway(env);
    if(!rpc) return null;
    const result=await rpc('read_smart_metro_catalog',{p_spec:spec});
    return result?.complete===true && Array.isArray(result.rows) ? result.rows : null;
  } catch {return null;} // Existing authoritative lookup remains available during rollout.
}
export async function fetchCatalogPage(task,{env=process.env,fetchImpl=fetch}={}) {
  const spec=catalogSpec(task.service,task.operation,task.params);
  const page=Number(task.page);if(!Number.isSafeInteger(page)||page<1) throw new Error('Invalid page');
  if(!env.TAGO_SERVICE_KEY) throw Object.assign(new Error('Missing key'),{catalogCode:'KEY_MISSING'});
  const url=new URL(`https://apis.data.go.kr/1613000/${services[spec.service]}/${spec.operation}`);
  for(const [key,value] of Object.entries({...spec.params,serviceKey:env.TAGO_SERVICE_KEY,_type:'json',numOfRows:100,pageNo:page})) url.searchParams.set(key,value);
  const response=await fetchWithTimeout(url,{}, {fetchImpl,timeoutMs:6000});
  const body=await readTagoResponse(response);
  const item=body.items?.item,rows=item==null||item===''?[]:Array.isArray(item)?item:[item];
  const city=spec.operation==='getCtyCodeList';
  const total=city ? rows.length : Number(body.totalCount);
  if(!Number.isSafeInteger(total)||total<0 || rows.length>1000 || rows.some(r=>!r||typeof r!=='object'||Array.isArray(r))) throw new Error('Invalid catalog response');
  if(!city && (Number(body.pageNo)!==page || Number(body.numOfRows)!==100 ||
    rows.length!==Math.max(0,Math.min(100,total-(page-1)*100)))) throw new Error('Incomplete catalog page');
  const done=city || page*100>=total;
  const children=[];
  if(city) for(const row of rows) {
    children.push(catalogSpec(spec.service,spec.service==='stops'?'getSttnNoList':'getRouteNoList',{cityCode:String(row.citycode)}));
  }
  if(spec.operation==='getRouteNoList') for(const row of rows) {
    for(const operation of ['getRouteInfoIem','getRouteAcctoThrghSttnList']) children.push(catalogSpec('routes',operation,{cityCode:spec.params.cityCode,routeId:row.routeid}));
  }
  return {rows,total,done,children};
}
export async function nearbyCatalogStations(lat,lng) {
  if(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lng))) return null;
  try {const rpc=catalogGateway();return rpc ? await rpc('nearby_smart_metro_catalog',{p_lat:Number(lat),p_lng:Number(lng)}) : null;}
  catch {return null;}
}
export async function runCatalogJob(input,{env=process.env,fetchImpl=fetch,rpc=catalogGateway(env)}={}) {
  if(!/^[0-9a-f-]{36}$/i.test(input?.jobId||'') || !/^[0-9a-f]{64}$/i.test(input?.token||'')) throw Object.assign(new Error('Invalid job'),{statusCode:401});
  if(!rpc) throw new Error('Catalog storage unavailable');
  const auth={p_job_id:input.jobId,p_token:input.token};
  const task=await rpc('claim_smart_metro_catalog_job',auth);
  let result;
  try {result=await fetchCatalogPage(task,{env,fetchImpl});}
  catch(error) {
    const code=error.apiCode ? `TAGO_${error.apiCode}` : error.status===429 ? 'HTTP_429' : error.catalogCode || error.code==='UPSTREAM_TIMEOUT' && 'TIMEOUT' || 'UPSTREAM_FAILED';
    await rpc('finish_smart_metro_catalog_job',{...auth,p_result:{error:code}});
    return {ok:false,reason:code};
  }
  await rpc('finish_smart_metro_catalog_job',{...auth,p_result:result});
  return {ok:true,rows:result.rows.length,complete:result.done};
}

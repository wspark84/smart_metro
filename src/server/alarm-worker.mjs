import {createClient} from '@supabase/supabase-js';
import {getSupabaseConfig} from './supabase-gateway.mjs';
import {runWithDocumentStorage} from './document-storage.mjs';

const denied = () => Object.assign(new Error('Invalid alarm job.'),{statusCode:401});
export function validateAlarmJob(input) {
  if (!input || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.jobId || '') ||
      !/^[0-9a-f]{64}$/i.test(input.token || '')) throw denied();
  return {jobId:input.jobId,token:input.token};
}

export async function createAlarmJobGateway(input,{env=process.env,fetchImpl=globalThis.fetch}={}) {
  const {jobId,token}=validateAlarmJob(input);
  const config=getSupabaseConfig(env);
  if (!config.configured) throw Object.assign(new Error('Worker storage unavailable.'),{statusCode:503});
  const client=createClient(config.url,config.publishableKey,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:(url,options={})=>fetchImpl(url,{...options,signal:AbortSignal.timeout(15000)})}});
  const rpc=async(name,extra={})=>{
    const {data,error}=await client.rpc(name,{p_job_id:jobId,p_token:token,...extra});
    if(error) throw Object.assign(new Error('Alarm job could not be processed.'),{statusCode:error.code==='42501'?401:503});
    return data;
  };
  const claim=await rpc('claim_smart_metro_alarm_job');
  if(!claim?.userId || !Array.isArray(claim.documents)) throw denied();
  const rows=new Map(claim.documents.map(row=>[row.document_key,row]));
  const assertToken=value=>{if(value!==token)throw denied();};
  return {user:{id:claim.userId},accessToken:token,backgroundWorker:true,
    gateway:{
      async readDocument(value,key){assertToken(value);return rows.get(key)||null;},
      async saveDocuments(value,documents){
        assertToken(value);
        const saved=await rpc('commit_smart_metro_alarm_job',{p_documents:documents,p_finish:false});
        for(const row of saved) rows.set(row.document_key,row);
        return saved;
      },
    },
    async complete(){await rpc('commit_smart_metro_alarm_job',{p_documents:[],p_finish:true});},
  };
}

export async function runAlarmWorker(input,tick,options={}) {
  const job=await createAlarmJobGateway(input,options);
  const result=await runWithDocumentStorage(job,job.gateway,()=>tick(job.user));
  await job.complete();
  return {ok:result?.runtime?.status!=='error',processed:1};
}

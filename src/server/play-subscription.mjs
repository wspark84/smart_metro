import {createHash, createSign} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {dateOnlyKey} from '../logic/commute.js';

export const PLAY_PACKAGE = 'com.buswakeup.buswakeup_mobile';
export const PLAY_PRODUCT = 'inochi_schedule_monthly';
export const PLAY_BASE_PLAN = 'monthly';
const ALLOWED = new Set(['SUBSCRIPTION_STATE_ACTIVE','SUBSCRIPTION_STATE_IN_GRACE_PERIOD','SUBSCRIPTION_STATE_CANCELED']);
const fail = (code, message, statusCode=503) => Object.assign(new Error(message),{code,statusCode});
export const billingAccountId = userId => createHash('sha256').update(`inochi:${userId}`).digest('hex');
export function evaluateSubscription(purchase, userId, now=new Date()) {
  if(purchase?.externalAccountIdentifiers?.obfuscatedExternalAccountId!==billingAccountId(userId))
    throw fail('PURCHASE_OWNER_MISMATCH','이 결제는 다른 이노치 계정에 연결되어 있습니다.',403);
  const line=purchase.lineItems?.find(item=>item.productId===PLAY_PRODUCT && item.offerDetails?.basePlanId===PLAY_BASE_PLAN);
  if(!line) throw fail('INVALID_PRODUCT','이노치 월 구독 상품이 아닙니다.',400);
  const expiry=Date.parse(line.expiryTime);
  if(!Number.isFinite(expiry)) throw fail('INVALID_PURCHASE','구독 만료일을 확인하지 못했습니다.',400);
  return {active:ALLOWED.has(purchase.subscriptionState) && expiry>now.getTime(),
    state:purchase.subscriptionState,expiresAt:new Date(expiry).toISOString(),
    autoRenew:line.autoRenewingPlan?.autoRenewEnabled===true};
}
export function subscriptionRequired() {
  return fail('SUBSCRIPTION_REQUIRED','일정 자동 알림은 월 5,000원 구독 기능입니다. 홈의 일회성 알림은 무료입니다.',402);
}
export function assertTripScheduleChange(previous,next,active) {
  if(!active && JSON.stringify(previous?.tripSchedules || [])!==JSON.stringify(next?.tripSchedules || [])) throw subscriptionRequired();
}
export function armFreeHomeAlarm(state,now=new Date()) {
  return {...state,schedule:{...state?.schedule,oneTimeDate:dateOnlyKey(now)}};
}
export function enforceFreeHomeDate(state,now=new Date()) {
  return state.schedule?.oneTimeDate===dateOnlyKey(now)?state:
    {...state,schedule:{...state.schedule,snoozeDate:dateOnlyKey(now)}};
}
let oauthCache;
export function createPlaySubscriptions({env=process.env,fetchImpl=globalThis.fetch,repository,playRequest,now=()=>new Date()}={}) {
  const configured=Boolean(env.PLAY_SERVICE_ACCOUNT_JSON && env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_URL && env.INOCHI_BILLING_ENABLED==='true');
  const ready=()=>{if(!configured && !(repository && playRequest))throw fail('BILLING_NOT_READY','구독 결제 연결을 준비 중입니다. 아직 결제되지 않습니다.');};
  let db;
  const client=()=>db ||= createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options={})=>fetchImpl(url,{...options,signal:AbortSignal.timeout(10000)})}});
  const unwrap=result=>{if(result.error)throw fail('BILLING_STORAGE_ERROR','구독 정보를 저장하거나 확인하지 못했습니다.');return result.data;};
  const repo=repository || {
    async list(userId){return unwrap(await client().from('inochi_play_subscriptions').select('*').eq('user_id',userId)
      .gte('expires_at',new Date(now().getTime()-59*86400000).toISOString()));},
    async save(row){return unwrap(await client().rpc('inochi_save_play_subscription',{p_row:row}));},
  };
  const request=playRequest || (async(path,method='GET',body)=>{
    ready();
    const fingerprint=createHash('sha256').update(env.PLAY_SERVICE_ACCOUNT_JSON).digest('hex');
    if(!oauthCache || oauthCache.key!==fingerprint || oauthCache.expiresAt<Date.now()+60000){
      let account;try{account=JSON.parse(env.PLAY_SERVICE_ACCOUNT_JSON);}catch{throw fail('BILLING_CONFIG_ERROR','결제 서버 설정을 확인해 주세요.');}
      const iat=Math.floor(Date.now()/1000), encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
      const input=`${encode({alg:'RS256',typ:'JWT'})}.${encode({iss:account.client_email,scope:'https://www.googleapis.com/auth/androidpublisher',aud:'https://oauth2.googleapis.com/token',iat,exp:iat+3600})}`;
      const assertion=`${input}.${createSign('RSA-SHA256').update(input).sign(account.private_key,'base64url')}`;
      const response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(10000)});
      const data=await response.json();
      if(!response.ok || !data.access_token)throw fail('PLAY_AUTH_FAILED','구글플레이 결제 확인 서버에 연결하지 못했습니다.');
      oauthCache={key:fingerprint,token:data.access_token,expiresAt:Date.now()+Math.min(Number(data.expires_in)||300,3600)*1000};
    }
    const response=await fetchImpl(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY_PACKAGE}/${path}`,{method,headers:{Authorization:`Bearer ${oauthCache.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw fail(response.status===410?'PLAY_TOKEN_EXPIRED':'PLAY_VERIFY_FAILED','구글플레이에서 결제를 확인하지 못했습니다. 잠시 후 구매 복원을 눌러 주세요.');
    return response.status===204?{}:response.text().then(text=>text?JSON.parse(text):{});
  });
  async function verify(userId,token) {
    ready();
    if(typeof token!=='string' || token.length<10 || token.length>4096 || /\s/.test(token))throw fail('INVALID_TOKEN','올바른 결제 정보가 필요합니다.',400);
    const purchase=await request(`purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`);
    const value=evaluateSubscription(purchase,userId,now());
    // A token can belong to only one app account. The DB function enforces this atomically.
    await repo.save({token_hash:createHash('sha256').update(token).digest('hex'),user_id:userId,purchase_token:token,
      product_id:PLAY_PRODUCT,state:value.state,expires_at:value.expiresAt,auto_renew:value.autoRenew,verified_at:now().toISOString()});
    if(value.active && purchase.acknowledgementState==='ACKNOWLEDGEMENT_STATE_PENDING')
      await request(`purchases/subscriptions/${PLAY_PRODUCT}/tokens/${encodeURIComponent(token)}:acknowledge`,'POST',{});
    return {...value,available:true,productId:PLAY_PRODUCT,basePlanId:PLAY_BASE_PLAN,accountId:billingAccountId(userId)};
  }
  async function status(userId,{force=false}={}) {
    if(!configured && !(repository && playRequest))return {active:false,available:false,productId:PLAY_PRODUCT,basePlanId:PLAY_BASE_PLAN,accountId:billingAccountId(userId)};
    const rows=await repo.list(userId);
    const values=[];
    let verificationError;
    for(const row of rows){
      // Recheck refunds/renewals while running alarms, including expired rows (renewals can arrive without opening the app).
      if(force || now().getTime()-Date.parse(row.verified_at)>60000){
        try { values.push(await verify(userId,row.purchase_token)); }
        catch(error) { verificationError=error; } // An obsolete token must not block a separately verified new purchase.
      }else values.push({active:ALLOWED.has(row.state)&&Date.parse(row.expires_at)>now().getTime(),expiresAt:row.expires_at,state:row.state,autoRenew:row.auto_renew});
    }
    const value=values.filter(item=>item.active).sort((a,b)=>Date.parse(b.expiresAt)-Date.parse(a.expiresAt))[0] || {active:false};
    if(!value.active && verificationError)throw verificationError;
    return {...value,available:true,productId:PLAY_PRODUCT,basePlanId:PLAY_BASE_PLAN,accountId:billingAccountId(userId)};
  }
  return {status,verify};
}

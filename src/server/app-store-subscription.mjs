import {createHash, createPrivateKey, createSign} from 'node:crypto';

// 아이폰 월 구독 (2026-11-22). Play와 같은 상품 ID·같은 구독 테이블을 쓴다.
// 상태 값은 Play 이름으로 맞춰 저장해 DB 일정 보호 트리거를 그대로 재사용한다.
export const APPLE_BUNDLE_ID_DEFAULT = 'com.buswakeup.buswakeup-mobile';
export const APPLE_PRODUCT = 'inochi_schedule_monthly';
export const APPLE_TOKEN_PREFIX = 'apple:';
const API = {
  production: 'https://api.storekit.itunes.apple.com',
  sandbox: 'https://api.storekit-sandbox.itunes.apple.com',
};
const fail = (code, message, statusCode=503) => Object.assign(new Error(message),{code,statusCode});

/// StoreKit appAccountToken (UUID 형식)으로 쓰는 계정 표지. Play의 billingAccountId와
/// 같은 원리로 사용자 ID를 그대로 애플에 보내지 않는다.
export function appleAccountToken(userId) {
  const hex = createHash('sha256').update(`inochi-apple:${userId}`).digest('hex').slice(0,32).split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16],16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

/// 애플 서버에서 직접 받은 JWS의 본문. TLS·인증된 App Store Server API 응답에서만
/// 꺼내므로 서명 재검증 없이 본문을 읽는다. 앱이 보낸 JWS는 절대 이 함수로 신뢰하지 않는다.
export function decodeJwsPayload(jws) {
  const part = String(jws || '').split('.')[1];
  if (!part) throw fail('APPLE_VERIFY_FAILED','애플 결제 정보를 읽지 못했습니다.');
  try { return JSON.parse(Buffer.from(part,'base64url').toString('utf8')); }
  catch { throw fail('APPLE_VERIFY_FAILED','애플 결제 정보를 읽지 못했습니다.'); }
}

// App Store Server API 구독 상태 값 → 기존 Play 상태 이름.
// 1 활성, 2 만료, 3 결제 재시도(이용 불가), 4 유예 기간, 5 환불·취소.
export function evaluateAppleSubscription(lookup, userId, {bundleId=APPLE_BUNDLE_ID_DEFAULT, now=new Date()}={}) {
  if (lookup?.bundleId !== bundleId) throw fail('INVALID_PRODUCT','이노치 앱의 결제가 아닙니다.',400);
  const candidates = [];
  for (const group of lookup?.data || []) for (const item of group.lastTransactions || []) {
    const transaction = decodeJwsPayload(item.signedTransactionInfo);
    if (transaction.productId !== APPLE_PRODUCT || transaction.bundleId !== bundleId) continue;
    candidates.push({item, transaction, renewal: item.signedRenewalInfo ? decodeJwsPayload(item.signedRenewalInfo) : {}});
  }
  if (!candidates.length) throw fail('INVALID_PRODUCT','이노치 월 구독 상품이 아닙니다.',400);
  const {item, transaction, renewal} = candidates.sort((a,b)=>Number(b.transaction.expiresDate||0)-Number(a.transaction.expiresDate||0))[0];
  if (String(transaction.appAccountToken || '').toLowerCase() !== appleAccountToken(userId))
    throw fail('PURCHASE_OWNER_MISMATCH','이 결제는 다른 이노치 계정에 연결되어 있습니다.',403);
  const autoRenew = renewal.autoRenewStatus === 1;
  const grace = Number(renewal.gracePeriodExpiresDate || 0);
  let expiry = Number(transaction.expiresDate);
  if (item.status === 4 && grace > expiry) expiry = grace;
  if (!Number.isFinite(expiry) || expiry <= 0) throw fail('INVALID_PURCHASE','구독 만료일을 확인하지 못했습니다.',400);
  const state = transaction.revocationDate || item.status === 5 ? 'SUBSCRIPTION_STATE_REVOKED'
    : item.status === 1 ? (autoRenew ? 'SUBSCRIPTION_STATE_ACTIVE' : 'SUBSCRIPTION_STATE_CANCELED')
    : item.status === 4 ? 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
    : item.status === 3 ? 'SUBSCRIPTION_STATE_ON_HOLD'
    : 'SUBSCRIPTION_STATE_EXPIRED';
  const active = ['SUBSCRIPTION_STATE_ACTIVE','SUBSCRIPTION_STATE_IN_GRACE_PERIOD','SUBSCRIPTION_STATE_CANCELED'].includes(state)
    && expiry > now.getTime();
  return {active, state, expiresAt:new Date(expiry).toISOString(), autoRenew,
    originalTransactionId:String(transaction.originalTransactionId), environment:lookup.environment || transaction.environment};
}

export function appleConfig(env=process.env) {
  return {
    configured: Boolean(env.APPSTORE_ISSUER_ID && env.APPSTORE_KEY_ID && env.APPSTORE_PRIVATE_KEY),
    issuerId: String(env.APPSTORE_ISSUER_ID || '').trim(),
    keyId: String(env.APPSTORE_KEY_ID || '').trim(),
    privateKey: String(env.APPSTORE_PRIVATE_KEY || '').replace(/\\n/g,'\n'),
    bundleId: String(env.APPSTORE_BUNDLE_ID || APPLE_BUNDLE_ID_DEFAULT).trim(),
    // 앱 심사와 TestFlight 결제는 샌드박스에서 일어나므로 기본 허용 (애플 권장).
    allowSandbox: env.APPSTORE_ALLOW_SANDBOX !== 'false',
  };
}

let jwtCache;
/// App Store Server API 호출기. 운영 서버에서 먼저 찾고, 없으면 샌드박스에서 찾는다.
export function createAppStoreClient({env=process.env, fetchImpl=globalThis.fetch}={}) {
  const config = appleConfig(env);
  function token() {
    const nowSeconds = Math.floor(Date.now()/1000);
    const cacheKey = `${config.issuerId}:${config.keyId}:${config.bundleId}`;
    if (jwtCache && jwtCache.cacheKey === cacheKey && nowSeconds - jwtCache.iat < 30*60) return jwtCache.token;
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const input = `${encode({alg:'ES256',kid:config.keyId,typ:'JWT'})}.${encode({iss:config.issuerId,iat:nowSeconds,exp:nowSeconds+3600,aud:'appstoreconnect-v1',bid:config.bundleId})}`;
    let key;
    try { key = createPrivateKey(config.privateKey); }
    catch { throw fail('BILLING_CONFIG_ERROR','결제 서버 설정을 확인해 주세요.'); }
    const signature = createSign('SHA256').update(input).sign({key, dsaEncoding:'ieee-p1363'},'base64url');
    jwtCache = {cacheKey, iat:nowSeconds, token:`${input}.${signature}`};
    return jwtCache.token;
  }
  async function get(environment, transactionId) {
    const response = await fetchImpl(`${API[environment]}/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`,
      {headers:{Authorization:`Bearer ${token()}`}, signal:AbortSignal.timeout(10000)});
    if (response.status === 404) return null;
    if (!response.ok) {
      const reason = await response.text().catch(()=> '');
      console.error('[app-store-subscription] App Store Server API', environment, response.status, String(reason).slice(0,300));
      if (response.status === 401) jwtCache = null;
      throw fail('APPLE_VERIFY_FAILED','앱스토어에서 결제를 확인하지 못했습니다. 잠시 후 구매 복원을 눌러 주세요.');
    }
    return response.json();
  }
  return {
    configured: config.configured,
    bundleId: config.bundleId,
    async lookup(transactionId) {
      if (!config.configured) throw fail('BILLING_NOT_READY','구독 결제 연결을 준비 중입니다. 아직 결제되지 않습니다.');
      const found = await get('production', transactionId) || (config.allowSandbox ? await get('sandbox', transactionId) : null);
      if (!found) throw fail('INVALID_TOKEN','앱스토어 결제 정보를 찾지 못했습니다.',400);
      return found;
    },
  };
}

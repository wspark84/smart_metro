import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, createVerify} from 'node:crypto';
import {appleAccountToken, createAppStoreClient, evaluateAppleSubscription, APPLE_BUNDLE_ID_DEFAULT} from '../src/server/app-store-subscription.mjs';
import {createPlaySubscriptions} from '../src/server/play-subscription.mjs';

const USER = '11111111-2222-3333-4444-555555555555';
const NOW = new Date('2026-12-01T00:00:00Z');
const jws = payload => `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
function lookup({status=1, user=USER, expires=NOW.getTime()+86400000, autoRenew=1, revoked, bundleId=APPLE_BUNDLE_ID_DEFAULT, productId='inochi_schedule_monthly', grace}={}) {
  return {bundleId, environment:'Sandbox', data:[{lastTransactions:[{originalTransactionId:'2000000000000001', status,
    signedTransactionInfo:jws({transactionId:'2000000000000009', originalTransactionId:'2000000000000001', bundleId, productId,
      expiresDate:expires, appAccountToken:appleAccountToken(user), ...(revoked?{revocationDate:revoked}:{})}),
    signedRenewalInfo:jws({autoRenewStatus:autoRenew, ...(grace?{gracePeriodExpiresDate:grace}:{})})}]}]};
}

test('appleAccountToken is a stable UUID that does not reveal the user id', () => {
  const token = appleAccountToken(USER);
  assert.match(token, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(token, appleAccountToken(USER));
  assert.notEqual(token, appleAccountToken('other'));
  assert.ok(!token.includes(USER.slice(0,8)));
});

test('Apple subscription states map onto the shared Play state names', () => {
  const at = options => evaluateAppleSubscription(lookup(options), USER, {now:NOW});
  assert.deepEqual([at({}).active, at({}).state], [true, 'SUBSCRIPTION_STATE_ACTIVE']);
  assert.deepEqual([at({autoRenew:0}).active, at({autoRenew:0}).state], [true, 'SUBSCRIPTION_STATE_CANCELED']);
  assert.equal(at({status:2, expires:NOW.getTime()-1}).active, false);
  assert.equal(at({status:3}).active, false);
  assert.equal(at({status:5}).state, 'SUBSCRIPTION_STATE_REVOKED');
  assert.equal(at({revoked:NOW.getTime()-1}).active, false);
  const grace = at({status:4, expires:NOW.getTime()-1000, grace:NOW.getTime()+3600000});
  assert.deepEqual([grace.active, grace.state], [true, 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD']);
  assert.equal(at({}).originalTransactionId, '2000000000000001');
});

test('Apple purchases bound to another account, app or product are refused', () => {
  assert.throws(() => evaluateAppleSubscription(lookup({user:'someone-else'}), USER, {now:NOW}), {code:'PURCHASE_OWNER_MISMATCH'});
  assert.throws(() => evaluateAppleSubscription(lookup({bundleId:'com.other.app'}), USER, {now:NOW}), {code:'INVALID_PRODUCT'});
  assert.throws(() => evaluateAppleSubscription(lookup({productId:'other'}), USER, {now:NOW}), {code:'INVALID_PRODUCT'});
});

test('App Store client signs an ES256 token and falls back to sandbox', async () => {
  const {privateKey, publicKey} = generateKeyPairSync('ec', {namedCurve:'prime256v1'});
  const env = {APPSTORE_ISSUER_ID:'issuer', APPSTORE_KEY_ID:'KEY123', APPSTORE_PRIVATE_KEY:privateKey.export({type:'pkcs8', format:'pem'})};
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    const [header, payload, signature] = options.headers.Authorization.slice(7).split('.');
    assert.ok(createVerify('SHA256').update(`${header}.${payload}`).verify({key:publicKey, dsaEncoding:'ieee-p1363'}, signature, 'base64url'));
    const claims = JSON.parse(Buffer.from(payload, 'base64url'));
    assert.deepEqual([claims.iss, claims.aud, claims.bid], ['issuer', 'appstoreconnect-v1', APPLE_BUNDLE_ID_DEFAULT]);
    return url.includes('sandbox') ? new Response(JSON.stringify(lookup()), {status:200}) : new Response('', {status:404});
  };
  const client = createAppStoreClient({env, fetchImpl});
  assert.equal((await client.lookup('2000000000000009')).environment, 'Sandbox');
  assert.deepEqual(calls.map(url => new URL(url).host), ['api.storekit.itunes.apple.com', 'api.storekit-sandbox.itunes.apple.com']);
  const noSandbox = createAppStoreClient({env:{...env, APPSTORE_ALLOW_SANDBOX:'false'}, fetchImpl});
  await assert.rejects(noSandbox.lookup('2000000000000009'), {code:'INVALID_TOKEN'});
});

test('verifyApple stores one row per original transaction and status rechecks it with Apple', async () => {
  const rows = new Map();
  const repository = {async list(userId){return [...rows.values()].filter(row => row.user_id === userId);},
    async save(row){const old = rows.get(row.token_hash); if (old && old.user_id !== row.user_id) throw new Error('owner'); rows.set(row.token_hash, row);}};
  let current = lookup();
  let clock = NOW;
  const appStore = {configured:true, bundleId:APPLE_BUNDLE_ID_DEFAULT, lookups:0, async lookup(id){this.lookups++; assert.match(id, /^\d+$/); return current;}};
  const billing = createPlaySubscriptions({env:{}, repository, appStore, now:() => clock});
  const verified = await billing.verifyApple(USER, '2000000000000009');
  assert.deepEqual([verified.active, verified.platform, verified.appleAvailable], [true, 'ios', true]);
  assert.equal(rows.size, 1);
  assert.equal([...rows.values()][0].purchase_token, 'apple:2000000000000001');
  await assert.rejects(billing.verifyApple(USER, 'not-a-number'), {code:'INVALID_TOKEN'});

  current = lookup({status:5});
  clock = new Date(NOW.getTime() + 120000);
  const status = await billing.status(USER);
  assert.equal(status.active, false);
  assert.equal(appStore.lookups, 2);
  assert.equal([...rows.values()][0].state, 'SUBSCRIPTION_STATE_REVOKED');
});

test('Apple billing is off until App Store keys and billing are configured', async () => {
  const status = await createPlaySubscriptions({env:{}}).status(USER);
  assert.deepEqual([status.available, status.appleAvailable, status.active], [false, false, false]);
  await assert.rejects(createPlaySubscriptions({env:{}}).verifyApple(USER, '1'), {code:'BILLING_NOT_READY'});
});

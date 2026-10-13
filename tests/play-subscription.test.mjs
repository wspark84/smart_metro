import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateSubscription,billingAccountId,assertTripScheduleChange,createPlaySubscriptions,PLAY_PRODUCT,armFreeHomeAlarm,enforceFreeHomeDate} from '../src/server/play-subscription.mjs';
import {subscriptionPaywall} from '../src/subscription-view.js';
const user='11111111-1111-4111-8111-111111111111';
const at=new Date('2026-10-04T00:00:00Z');
test('free home alarm is manually armed for one KST date, not a recurring schedule',()=>{
 const state=armFreeHomeAlarm({schedule:{},tripSchedules:[{id:'keep'}]},at);
 assert.equal(enforceFreeHomeDate(state,at).schedule.snoozeDate,undefined);
 assert.equal(enforceFreeHomeDate(state,new Date('2026-10-04T15:00:00Z')).schedule.snoozeDate,'2026-10-05');
 assert.deepEqual(enforceFreeHomeDate(state,new Date('2026-10-04T15:00:00Z')).tripSchedules,[{id:'keep'}]);
});
const purchase=(state='SUBSCRIPTION_STATE_ACTIVE',expiry='2026-11-04T00:00:00Z')=>({
 externalAccountIdentifiers:{obfuscatedExternalAccountId:billingAccountId(user)},subscriptionState:state,
 acknowledgementState:'ACKNOWLEDGEMENT_STATE_PENDING',lineItems:[{productId:PLAY_PRODUCT,offerDetails:{basePlanId:'monthly'},expiryTime:expiry,autoRenewingPlan:{autoRenewEnabled:true}}]});
test('only verified eligible subscription states grant access before expiry',()=>{
 for(const state of ['ACTIVE','IN_GRACE_PERIOD','CANCELED'])assert.equal(evaluateSubscription(purchase(`SUBSCRIPTION_STATE_${state}`),user,at).active,true);
 for(const state of ['PENDING','ON_HOLD','PAUSED','EXPIRED','PENDING_PURCHASE_CANCELED'])assert.equal(evaluateSubscription(purchase(`SUBSCRIPTION_STATE_${state}`),user,at).active,false);
 assert.equal(evaluateSubscription(purchase(undefined,at.toISOString()),user,at).active,false);
});
test('wrong owner, wrong product, wrong base plan are denied',()=>{
 assert.throws(()=>evaluateSubscription(purchase(),'different',at),{code:'PURCHASE_OWNER_MISMATCH'});
 const p=purchase();p.lineItems[0].productId='other';assert.throws(()=>evaluateSubscription(p,user,at),{code:'INVALID_PRODUCT'});
 p.lineItems[0].productId=PLAY_PRODUCT;p.lineItems[0].offerDetails.basePlanId='annual';assert.throws(()=>evaluateSubscription(p,user,at));
});
test('free home writes work while paid schedule changes are rejected',()=>{
 assert.doesNotThrow(()=>assertTripScheduleChange({tripSchedules:[]},{tripSchedules:[],user:{requiredArrivalTime:'10:00'}},false));
 assert.throws(()=>assertTripScheduleChange({}, {tripSchedules:[{id:'a'}]},false),{statusCode:402});
 assert.doesNotThrow(()=>assertTripScheduleChange({}, {tripSchedules:[{id:'a'}]},true));
 const old={tripSchedules:[{id:'a'}]};assert.doesNotThrow(()=>assertTripScheduleChange(old,{...old,user:{}},false));
});
test('unconfigured billing never grants paid access or simulates payment',async()=>{
 const billing=createPlaySubscriptions({env:{}});assert.equal((await billing.status(user)).active,false);
 await assert.rejects(billing.verify(user,'1234567890'),{code:'BILLING_NOT_READY'});
});
test('verification saves before acknowledgement; client-supplied product/expiry not used',async()=>{
 const calls=[];
 const billing=createPlaySubscriptions({repository:{save:async row=>calls.push(['save',row]),list:async()=>[]},now:()=>at,
  playRequest:async(path,method)=>{calls.push([path,method]);return purchase();}});
 const result=await billing.verify(user,'test-purchase-token');assert.equal(result.active,true);
 assert.equal(calls[1][0],'save');assert.match(calls[2][0],/:acknowledge$/);
 assert.equal(calls[1][1].user_id,user);assert.equal(calls[1][1].expires_at,'2026-11-04T00:00:00.000Z');
});
test('refund/renewal rechecked after one minute; verification failure does not grant access',async()=>{
 const row={purchase_token:'test-purchase-token',verified_at:'2026-10-03T00:00:00Z',expires_at:'2026-11-04T00:00:00Z',state:'SUBSCRIPTION_STATE_ACTIVE'};
 const billing=createPlaySubscriptions({repository:{list:async()=>[row],save:async()=>{}},now:()=>at,playRequest:async()=>purchase('SUBSCRIPTION_STATE_EXPIRED')});
 assert.equal((await billing.status(user)).active,false);
 const broken=createPlaySubscriptions({repository:{list:async()=>[row]},now:()=>at,playRequest:async()=>{throw new Error('offline');}});
 await assert.rejects(broken.status(user));
});
test('paywall explains paid recurring schedules and free home; no fake checkout',()=>{
 const html=subscriptionPaywall({available:true});assert.match(html,/월 5,000원/);assert.match(html,/유료 구독을 하시겠어요/);assert.match(html,/계속 무료/);
 assert.match(subscriptionPaywall(),/disabled/);assert.doesNotMatch(subscriptionPaywall({error:'<script>'}),/<script>/);
});

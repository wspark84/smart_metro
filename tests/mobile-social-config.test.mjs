import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSocialLoginRoute} from '../src/server/social-login-routes.mjs';

test('mobile auth config exposes only public client configuration', async () => {
  let status; let payload;
  const response = {writeHead(code) { status = code; }, end(body) { payload = JSON.parse(body); }};
  const env = {SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    FCM_SERVICE_ACCOUNT_JSON: 'private-sentinel', SUPABASE_SERVICE_ROLE_KEY: 'private-sentinel'};
  const handled = await handleSocialLoginRoute({url:'/api/auth/mobile-config',method:'GET'}, response, async()=>({}), {env});
  assert.equal(handled,true); assert.equal(status,200);
  assert.deepEqual(payload,{url:env.SUPABASE_URL,publishableKey:env.SUPABASE_PUBLISHABLE_KEY});
  assert.equal(JSON.stringify(payload).includes('private-sentinel'),false);
});

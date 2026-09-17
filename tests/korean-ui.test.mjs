import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { formatUiLabel, formatUiMessage, localizeDisplayFields, userErrorMessage } from '../src/locale-ko.js';

test('Korean labels do not mutate machine codes or user-entered text', () => {
  const original = {status:'SENT', label:'DELIVERED', name:'Active', title:'사용자 지정 제목', providers:['google']};
  const translated = localizeDisplayFields(original);
  assert.equal(translated.label, '전달 완료');
  assert.equal(translated.status, 'SENT');
  assert.equal(translated.name, 'Active');
  assert.deepEqual(translated.providers, ['google']);
  assert.equal(original.label, 'DELIVERED');
  assert.equal(formatUiLabel('android'), '안드로이드');
  assert.equal(formatUiMessage('Alarm window 07:00 - 07:45'), '알람 시간대 07:00 - 07:45');
  assert.equal(localizeDisplayFields({weekdayLabel:'Thu'}).weekdayLabel, '목요일');
  assert.match(formatUiMessage('No Android push token has been provided yet.'), /등록되지/);
  assert.match(userErrorMessage(new Error('Failed to fetch')), /인터넷 연결/);
});

async function makeView() {
  let source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const bindings = {};
  for (const match of source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*"([^"]+)";/g)) {
    const module = await import(new URL('../src/'+match[2].replace(/^\.\//,''), import.meta.url));
    for (const name of match[1].split(',').map((x)=>x.trim()).filter(Boolean)) bindings[name] = module[name];
  }
  source = source.replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, '').replace(/\nbootstrap\(\);/, '');
  const app = {innerHTML:'',addEventListener(){},querySelectorAll(){return [];}};
  const context = vm.createContext({...bindings, URL, Intl, Date, console, setTimeout(){}, clearTimeout(){},
    document:{querySelector(){return app;},querySelectorAll(){return [];},visibilityState:'visible'},
    window:{location:{hash:'#/home'},addEventListener(){},setInterval(){},requestAnimationFrame(){}},
  });
  vm.runInContext(source,context);
  vm.runInContext('authMeta.status="authenticated"; authMeta.user={id:"test",name:"한국어 사용자",providers:["google"]};',context);
  return {context,app};
}

test('all four web screens render Korean controls without changing input values', async () => {
  const {context,app} = await makeView();
  for (const screen of ['home','settings','schedule','onboarding']) {
    vm.runInContext(`window.location.hash='#/${screen}'; render();`,context);
    const visible = app.innerHTML.replace(/<span[^>]*class="material-symbols-outlined[^>]*>[\s\S]*?<\/span>/g,'').replace(/<[^>]*>/g,'');
    for (const word of visible.match(/[A-Za-z][A-Za-z _-]{2,}/g) || []) {
      assert.ok(['TAGO', 'FCM', 'API'].includes(word.trim()), `${screen}: untranslated copy: ${word}`);
    }
    if (process.env.KOREAN_COPY_AUDIT) {
      console.log(screen, [...new Set(visible.match(/[A-Za-z][A-Za-z _-]{2,}/g) || [])]);
    }
    assert.match(app.innerHTML,/스마트 메트로|알림 설정|알람 일정|이동 경로 등록/);
    assert.doesNotMatch(app.innerHTML,/>\s*(?:Settings|Dashboard|Schedule|Device Delivery|Sound Alert|Active|Paused|Save Settings|Register)\s*</);
    if(screen==='settings') {
      assert.match(app.innerHTML,/기기 알림 설정/);
      assert.match(app.innerHTML,/음성 안내/);
      assert.match(app.innerHTML,/value="android"/);
      assert.match(app.innerHTML,/data-field="device.pushEnabled"/);
    }
  }
});

test('an alarm plan with remaining triggers renders without an undefined variable', async () => {
  const {context,app} = await makeView();
  vm.runInContext(`alarmPlanMeta.plan={remainingTriggers:1,todayStatus:{detail:'예정된 알람'},triggers:[{triggerAt:new Date().toISOString(),triggerKind:'normal',arrivalsMin:[5,10],notificationSpec:{riskLevel:'GREEN',body:'알람 안내'}}]};render();`,context);
  assert.match(app.innerHTML,/예정된 알람/);
});

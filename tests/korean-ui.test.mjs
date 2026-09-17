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

test('all five web screens render Korean controls without changing input values', async () => {
  const {context,app} = await makeView();
  for (const screen of ['home','settings','schedule','onboarding','diagnostics']) {
    vm.runInContext(`window.location.hash='#/${screen}'; render();`,context);
    const visible = app.innerHTML.replace(/<span[^>]*class="material-symbols-outlined[^>]*>[\s\S]*?<\/span>/g,'').replace(/<[^>]*>/g,'');
    for (const word of visible.match(/[A-Za-z][A-Za-z _-]{2,}/g) || []) {
      assert.ok(['TAGO', 'FCM', 'APNs', 'API'].includes(word.trim()), `${screen}: untranslated copy: ${word}`);
    }
    if (process.env.KOREAN_COPY_AUDIT) {
      console.log(screen, [...new Set(visible.match(/[A-Za-z][A-Za-z _-]{2,}/g) || [])]);
    }
    assert.match(app.innerHTML,/스마트 메트로|알림 설정|알람 일정|이동 경로 등록|진단 및 기록/);
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
  vm.runInContext(`window.location.hash='#/diagnostics';alarmPlanMeta.plan={remainingTriggers:1,todayStatus:{detail:'예정된 알람'},triggers:[{triggerAt:new Date().toISOString(),triggerKind:'normal',arrivalsMin:[5,10],notificationSpec:{riskLevel:'GREEN',body:'알람 안내'}}]};render();`,context);
  assert.match(app.innerHTML,/예정된 알람/);
});

test('home keeps trip controls and countdown while diagnostics retain operational panels', async () => {
  const {context,app} = await makeView();
  vm.runInContext('render()', context);
  for (const expected of ['출발지 · 탑승 정류장 / 역','도착지','data-field="user.requiredArrivalTime"','마지막 탑승편 확인 대기','출발했어요']) assert.ok(app.innerHTML.includes(expected), expected);
  for (const excluded of ['서버 알람 처리 상태','오늘의 알람 계획','도착시간 정확도 확인','알림 전송 대기열']) assert.ok(!app.innerHTML.includes(excluded), excluded);
  vm.runInContext('homeEditor="destination";render()', context);
  assert.match(app.innerHTML, /data-action="search-work-address"/);
  vm.runInContext('homeEditor="departure";state.live.provider="tago";render()', context);
  assert.match(app.innerHTML, /data-action="search-live-stops"/);
  assert.match(app.innerHTML, /data-field="live.cityCode"/);
  vm.runInContext('window.location.hash="#/diagnostics";alarmRuntimeMeta.status="loading";alarmPlanMeta.status="loading";render()', context);
  assert.match(app.innerHTML, /서버 알람 처리 상태/);
  assert.match(app.innerHTML, /오늘의 알람 계획/);
});

test('last-chance countdown requires live evidence, not demo values or unknown duration', async () => {
  const {context,app} = await makeView();
  const html = code => vm.runInContext(`(() => {const model=getDashboardModel();${code};return renderHome('home',model);})()`,context);
  const live = "model.dataSource='LIVE';model.risk.lastChanceConfirmed=true;model.risk.targetResult={level:'GREEN',arrivalMinutes:5,arriveWorkAt:new Date()};";
  assert.match(html(live), /놓치면 늦는 마지막 탑승편/);
  assert.match(html(live), /5<span>분 남음/);
  assert.doesNotMatch(html(live+"model.dataSource='DEMO';"), /놓치면 늦는 마지막 탑승편/);
  assert.match(html(live+"model.risk.lastChanceConfirmed=false;"), /마지막 탑승편으로 확정되지/);
  assert.match(html("model.risk.targetResult.level='UNKNOWN';model.risk.lastChanceConfirmed=false;"), /정보 확인 필요/);
});

test('boarding UI offers subway, map preview, and confirmation without committing a candidate', async () => {
  const {context,app} = await makeView();
  vm.runInContext(`homeEditor='departure';state.live.provider='subway';state.ui.liveSearchResults=[{stationId:'kakao:1',stationName:'광교중앙',displayName:'광교중앙역 신분당선',posX:'127.05',posY:'37.28'}];render();`,context);
  assert.match(app.innerHTML,/data-mode="bus"/);assert.match(app.innerHTML,/data-mode="subway"/);
  assert.match(app.innerHTML,/id="boarding-map"/);
  assert.match(app.innerHTML,/data-action="preview-boarding-stop"/);
  assert.doesNotMatch(app.innerHTML,/지하철 실시간 연결은 아직 지원되지/);
  vm.runInContext(`boardingPreview.candidate=state.ui.liveSearchResults[0];boardingPreview.status='ready';boardingPreview.routes=[{routeId:'route',routeNumber:'신분당선',label:'상행 · 성복 방면 · 신사행 · 일반'}];boardingPreview.route=boardingPreview.routes[0];render();`,context);
  assert.match(app.innerHTML,/상행 · 성복 방면 · 신사행 · 일반/);
  assert.match(app.innerHTML,/지도·노선·방향 확인 후 선택/);
  assert.equal(vm.runInContext('state.live.routeId',context),'');
});

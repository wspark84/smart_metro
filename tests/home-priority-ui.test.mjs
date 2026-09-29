import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function view() {
  let source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const bindings = {};
  for (const match of source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*"([^"]+)";/g)) {
    const module = await import(new URL('../src/' + match[2].replace(/^\.\//, ''), import.meta.url));
    for (const name of match[1].split(',').map(v => v.trim()).filter(Boolean)) bindings[name] = module[name];
  }
  const app = {innerHTML:'', addEventListener(){}, contains(element){return element?.inApp===true;}, querySelector(){return null;}, querySelectorAll(){return [];}};
  const context = vm.createContext({...bindings, URL, Intl, Date, console, setTimeout(){}, clearTimeout(){},
    document:{querySelector(){return app;}, querySelectorAll(){return [];}, visibilityState:'visible'},
    window:{location:{hash:'#/home'}, addEventListener(){}, setInterval(){}, setTimeout(){}, clearTimeout(){}, requestAnimationFrame(){}}});
  source = source.replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, '').replace(/\nbootstrap\(\);/, '');
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run('authMeta.status="authenticated";authMeta.user={id:"ui-test",providers:["google"]};');
  return {run, app, html: setup => run(`(() => {const model=getDashboardModel();model.homePlan=null;${setup || ''};return renderHome('home',model);})()`) };
}

test('saving interrupted by a route update unlocks the form and retains the draft',async()=>{
 const v=await view();
 v.run('getHomeTripDraft().access="3";homeTripDraft.target="14:30";homeTripDraft.dirty=true;saveRemoteAppState=async()=>{};syncDomainSnapshot=async()=>{state.user.workAddress="changed destination";state.user.workLocation={lat:37.5,lng:127.2};};');
 await v.run('submitHomeTrip()');
 assert.equal(v.run('homeTripSave.status'),'error');
 assert.equal(v.run('homeTripDraft.target'),'14:30');
});

test('mobile time inputs have fixed touch-friendly height instead of vertical flex growth',async()=>{
 const css=await readFile(new URL('../src/metro-theme.css',import.meta.url),'utf8');
 assert.doesNotMatch(css,/\.home-target input\s*\{[^}]*flex:\s*1 1 140px/);
 assert.match(css,/\.home-time-fields input\s*\{[^}]*height:\s*44px/);
});

test('background rendering never replaces a focused native time picker',async()=>{
 const v=await view();v.run('render();');
 v.app.innerHTML='existing input node and open picker';
 v.run('document.activeElement={inApp:true,type:"time",hasAttribute(){return false;},dataset:{field:"user.requiredArrivalTime"},value:"14:00",selectionStart:null,selectionEnd:null};render();');
 assert.equal(v.app.innerHTML,'existing input node and open picker');
 v.run('document.activeElement=null;render();');
 assert.match(v.app.innerHTML,/data-trip-field="target"/);
});
test('time picker does not block navigation or session expiry',async()=>{
 const v=await view();v.run('render();document.activeElement={inApp:true,type:"time"};window.location.hash="#/schedule";render();');
 assert.match(v.app.innerHTML,/data-field="schedule.startTime"/);
 v.run('authMeta.status="anonymous";authMeta.user=null;render();');
 assert.doesNotMatch(v.app.innerHTML,/data-field="schedule.startTime"/);
});

test('home prioritizes countdown, core inputs, submit, and only then transit detail', async () => {
  const v = await view();
  const html = v.html();
  const markers = ['class="home-countdown ', 'class="home-trip"', 'data-editor="departure"', 'data-editor="destination"', 'data-trip-field="target"', 'data-trip-field="access"', 'data-action="complete-home-trip"', 'class="home-alarm-actions"', 'data-action="departed"', 'class="home-timetable"', 'class="home-transit-detail"', 'class="home-help"'];
  const indexes = markers.map(marker => html.indexOf(marker));
  indexes.forEach((index, i) => assert.ok(index >= 0 && (!i || index > indexes[i-1]), markers[i]));
});

test('missing access time never substitutes vehicle ETA into the home-departure hero', async () => {
  const v = await view();
  const html = v.html("model.dataSource='LIVE';model.risk.departure=null;model.risk.targetResult={level:'GREEN',arrivalMinutes:10,deltaMinutes:10};");
  const hero = html.split('</section>')[0];
  assert.match(hero, /home-countdown-value">—/);
  assert.doesNotMatch(hero, /10<span>|분 후 교통편 도착/);
  assert.match(html, /10<span>분 후 교통편 도착/);
});

test('confirmed last departure prominently renders leave-home time, not vehicle time', async () => {
  const v = await view();
  const html = v.html("model.dataSource='LIVE';model.risk=evaluateLateRisk({now:model.now,requiredArrivalTime:'23:59',route:{boardingAccessMin:5,onboardToDestinationMin:20},busArrivalsMin:[16]});model.risk.lastChanceConfirmed=true;");
  const hero = html.split('</section>')[0];
  assert.match(hero, /늦지 않는 마지막 출발까지/);
  assert.match(hero, /11<span>분 안에 출발/);
  assert.match(hero, /까지 집에서 출발/);
  assert.match(hero, /정류장·역까지 5분 반영/);
});

test('estimated and unconfirmed departure evidence remains explicitly labeled', async () => {
  const v = await view();
  const setup = "model.dataSource='LIVE';model.risk=evaluateLateRisk({now:model.now,requiredArrivalTime:'23:59',route:{boardingAccessMin:5,onboardToDestinationMin:20},busArrivalsMin:[16]});";
  assert.match(v.html(setup).split('</section>')[0], /마지막 편 미확정/);
  assert.match(v.html(setup).split('</section>')[0], /실시간 정보로 예상/);
  assert.match(v.html(setup + 'model.risk.targetResult.estimated=true;').split('</section>')[0], /배차간격으로 예상/);
  const live = v.html(setup + 'model.risk.targetResult.estimated=false;model.risk.lastChanceConfirmed=true;').split('</section>')[0];
  assert.match(live, /실시간 정보로 예상/);
  assert.doesNotMatch(live, /배차간격으로 예상/);
});

test('hero shows destination arrival and only warns of missing the last trip with a late following trip', async () => {
  const v = await view();
  const setup = "model.dataSource='LIVE';model.risk=evaluateLateRisk({now:model.now,requiredArrivalTime:'23:59',route:{boardingAccessMin:5,onboardToDestinationMin:20},busArrivalsMin:[16]});";
  const normal = v.html(setup).split('</section>')[0];
  assert.match(normal, /목적지 <strong>\d{2}:\d{2}<\/strong> 도착 예상/);
  assert.doesNotMatch(normal, /이 차를 놓치면 다음 차는/);
  const last = v.html(setup + "model.risk.lastChanceConfirmed=true;model.risk.followingResult={deltaMinutes:-12};").split('</section>')[0];
  assert.match(last, /다음 차는 지각 예상/);
  const fresh = await view();
  const unknown = fresh.html("model.dataSource='UNAVAILABLE';").split('</section>')[0];
  assert.doesNotMatch(unknown, /home-arrive-by|home-last-warning/);
});

test('core field buttons still expose inline editors and saving locks inputs', async () => {
  const v = await view();
  v.run('homeEditor="destination";homeTripSave.status="saving";');
  const html = v.html();
  assert.match(html, /data-editor="destination" aria-expanded="true" aria-controls="home-destination-editor"/);
  assert.match(html, /data-action="search-work-address"/);
  assert.match(html, /<fieldset[^>]+disabled/);
  assert.match(html, /data-action="complete-home-trip" disabled>저장 중/);
});

test('saved trip stays disabled until input or destination changes, and reverting disables again', async () => {
  const v=await view();
  v.run('state.commute.boardingAccessMin=5;homeTripSave={status:"saved",key:tripInputKey(),message:"저장 완료"};');
  assert.match(v.html(),/data-action="complete-home-trip" disabled>입력 완료 · 저장됨/);
  v.run('getHomeTripDraft().access="6";homeTripDraft.dirty=true;');
  assert.doesNotMatch(v.html(),/data-action="complete-home-trip" disabled/);
  v.run('getHomeTripDraft().access="5";');
  assert.match(v.html(),/data-action="complete-home-trip" disabled/);
  v.run('state.user.workLocation={lat:37.4,lng:127.1};');
  assert.doesNotMatch(v.html(),/data-action="complete-home-trip" disabled/);
});

test('a failed save remains retryable even when values have not changed',async()=>{
  const v=await view();v.run('homeTripSave={status:"error",key:tripInputKey(),message:"실패"};');
  assert.doesNotMatch(v.html(),/data-action="complete-home-trip" disabled/);
});

test('headway without a same-day arrival anchor explains why saved inputs cannot produce a bus time',async()=>{
  const v=await view();
  v.run('state.live.routeNumber="1";state.commute.boardingAccessMin=5;');
  const html=v.html('model.homePlan={rows:[],interval:34,anchorCheckedAt:null,risk:model.risk};model.risk.departure=null;model.risk.targetResult={level:"UNKNOWN"};');
  assert.match(html.split('</section>')[0],/배차간격 34분은 확인됐지만, 오늘의 기준 도착시각이 없어/);
  assert.doesNotMatch(html.split('</section>')[0],/까지 집에서 출발/);
});

test('departure action no longer overlays the core input workspace', async () => {
  const css = await readFile(new URL('../src/metro-theme.css', import.meta.url), 'utf8');
  const rule = css.match(/\.home-alarm-actions \.primary-cta\s*\{([^}]+)\}/)[1];
  assert.match(rule, /position:\s*static/);
  assert.doesNotMatch(rule, /position:\s*fixed/);
  assert.match(css, /\.home-trip \.home-trip-submit[^}]+min-height:\s*44px/);
});

test('alarm controls follow save and explanatory help remains below all actions', async () => {
  const v = await view();
  const html = v.html();
  assert.match(html, /disabled aria-pressed="true">알람 켜기/);
  assert.match(html, /aria-pressed="false">알람 끄기/);
  assert.ok(html.indexOf('id="boarding-access-help"') > html.indexOf('data-action="departed"'));
  v.run('state.schedule.snoozeDate=dateOnlyKey(new Date());');
  assert.match(v.html(), /disabled aria-pressed="true">알람 끄기/);
});

test('an unsaved target change marks the hero as based on previous settings', async () => {
  const v = await view();
  v.run('getHomeTripDraft();homeTripDraft.target="10:00";homeTripDraft.dirty=true;');
  const html = v.html();
  assert.match(html.split('</section>')[0], /미적용 · 이전 설정 기준/);
  assert.match(html, /value="10:00" data-trip-field="target"/);
  assert.equal(v.run('state.user.requiredArrivalTime'), '09:00');
});

test('refresh keeps the displayed prediction until completion, but never across a changed trip', async () => {
  const v = await view();
  const setup = "model.dataSource='LIVE';model.risk=evaluateLateRisk({now:model.now,requiredArrivalTime:'23:59',route:{boardingAccessMin:5,onboardToDestinationMin:20},busArrivalsMin:[16]});";
  assert.match(v.html(setup), /11<span>분 안에 출발/);
  v.run('visibleTransitRefreshPending=true;');
  const pending=v.html("model.dataSource='UNAVAILABLE';model.risk.departure=null;");
  assert.match(pending, /1[01]<span>분 안에 출발/);
  assert.match(pending, /갱신 중 · 이전 계산 유지/);
  v.run('visibleTransitRefreshPending=false;');
  const updated=v.html(setup.replace('busArrivalsMin:[16]', 'busArrivalsMin:[21]'));
  assert.match(updated, /16<span>분 안에 출발/);
  assert.doesNotMatch(updated, /갱신 중 · 이전 계산 유지/);
  v.run('visibleTransitRefreshPending=true;');
  v.run('state.user.requiredArrivalTime="18:00";');
  assert.match(v.html("model.dataSource='UNAVAILABLE';model.risk.departure=null;"), /home-countdown-value">—/);
});

test('loading without a prior prediction stays empty; an existing prediction survives beyond two minutes', async () => {
  const v=await view();
  v.run('state.live.status="loading";');
  assert.match(v.html("model.dataSource='UNAVAILABLE';model.risk.departure=null;"), /home-countdown-value">—/);
  v.run('state.live.status="ready";');
  v.html("model.dataSource='LIVE';model.risk=evaluateLateRisk({now:model.now,requiredArrivalTime:'23:59',route:{boardingAccessMin:5,onboardToDestinationMin:20},busArrivalsMin:[16]});");
  v.run('state.live.status="loading";homeDisplayPrediction.now=new Date(Date.now()-121000);');
  const retained=v.html("model.dataSource='UNAVAILABLE';model.risk.departure=null;");
  assert.doesNotMatch(retained,/home-countdown-value">—/);
  assert.match(retained,/이전 계산 유지/);
});

test('empty and failed refreshes retain the exact departure time, then valid data replaces it while loading',async()=>{
  const v=await view();
  const setup="model.now=new Date('2026-09-26T12:30:00+09:00');model.dataSource='LIVE';model.risk=evaluateLateRisk({now:model.now,requiredArrivalTime:'14:00',route:{boardingAccessMin:5,onboardToDestinationMin:34},busArrivalsMin:[38,72]});";
  const initial=v.html(setup);
  const leave=initial.match(/<strong>(\d{2}:\d{2})<\/strong>까지 집에서 출발/)[1];
  v.run('state.live.status="error";visibleTransitRefreshPending=false;');
  const empty="model.now=new Date('2026-09-26T12:35:00+09:00');model.dataSource='UNAVAILABLE';model.risk.departure=null;model.homePlan={rows:[],risk:model.risk};";
  const retained=v.html(empty);
  assert.ok(retained.includes(`<strong>${leave}</strong>까지 집에서 출발`));
  assert.match(retained,/이전 정보 · 새 정보 확인 중/);
  assert.match(retained,/당시 실시간 기준/);
  assert.doesNotMatch(v.html(empty),/home-countdown-value">—/);
  v.run('visibleTransitRefreshPending=true;');
  const next=v.html(setup.replace('busArrivalsMin:[38,72]','busArrivalsMin:[30,64]'));
  assert.doesNotMatch(next,/이전 정보 · 새 정보 확인 중|갱신 중 · 이전 계산 유지/);
  assert.notEqual(next.match(/<strong>(\d{2}:\d{2})<\/strong>까지 집에서 출발/)[1],leave);
  const tomorrow=v.html(empty.replace('2026-09-26','2026-09-27'));
  assert.match(tomorrow,/home-countdown-value">—/);
});

test('urgent live change bypasses loading retention and shows the last on-time vehicle immediately', async () => {
  const v=await view();
  v.run('state.user.requiredArrivalTime="16:00";');
  const setup="model.now=new Date('2026-09-23T15:00:00+09:00');model.homePlan=buildBoardingPlan({now:model.now,requiredArrivalTime:'16:00',route:{durationAvailable:true,onboardToDestinationMin:34,boardingAccessMin:5},arrivalsMin:[MINUTES],officialHeadwayMin:29,snapshot:{fetchedAt:model.now.toISOString(),arrivalsMin:[MINUTES]}});";
  assert.match(v.html(setup.replaceAll('MINUTES','15')), /10<span>분 안에 출발/);
  v.run('visibleTransitRefreshPending=true;');
  const hero=v.html(setup.replaceAll('MINUTES','4')).split('</section>')[0];
  assert.match(hero,/지금 바로 출발하세요/);
  assert.match(hero,/15:38/);
  assert.match(hero,/탑승이 빠듯/);
  assert.doesNotMatch(hero,/이전 계산 유지|목적지 <strong>16:07/);
});

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
  const app = {innerHTML:'', addEventListener(){}, querySelector(){return null;}, querySelectorAll(){return [];}};
  const context = vm.createContext({...bindings, URL, Intl, Date, console, setTimeout(){}, clearTimeout(){},
    document:{querySelector(){return app;}, querySelectorAll(){return [];}, visibilityState:'visible'},
    window:{location:{hash:'#/home'}, addEventListener(){}, setInterval(){}, setTimeout(){}, clearTimeout(){}, requestAnimationFrame(){}}});
  source = source.replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, '').replace(/\nbootstrap\(\);/, '');
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run('authMeta.status="authenticated";authMeta.user={id:"ui-test",providers:["google"]};');
  return {run, html: setup => run(`(() => {const model=getDashboardModel();model.homePlan=null;${setup || ''};return renderHome('home',model);})()`) };
}

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
  assert.match(v.html(setup + 'model.risk.targetResult.estimated=true;').split('</section>')[0], /배차간격으로 예상/);
});

test('hero shows destination arrival and only warns of missing the last trip with a late following trip', async () => {
  const v = await view();
  const setup = "model.dataSource='LIVE';model.risk=evaluateLateRisk({now:model.now,requiredArrivalTime:'23:59',route:{boardingAccessMin:5,onboardToDestinationMin:20},busArrivalsMin:[16]});";
  const normal = v.html(setup).split('</section>')[0];
  assert.match(normal, /목적지 <strong>\d{2}:\d{2}<\/strong> 도착 예상/);
  assert.doesNotMatch(normal, /이 차를 놓치면 다음 차는/);
  const last = v.html(setup + "model.risk.lastChanceConfirmed=true;model.risk.followingResult={deltaMinutes:-12};").split('</section>')[0];
  assert.match(last, /다음 차는 지각 예상/);
  const unknown = v.html("model.dataSource='UNAVAILABLE';").split('</section>')[0];
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

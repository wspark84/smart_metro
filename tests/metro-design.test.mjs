import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { addMinutes, evaluateLateRisk, formatClock } from '../src/logic/commute.js';

const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const functionSource = source.slice(source.indexOf('function renderHomeTimetable('), source.indexOf('function renderHome(screen'));
const context = vm.createContext({ Number, Math, addMinutes, formatClock,
  escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
});
vm.runInContext(functionSource, context);
function table({arrivals=[3,11,20], duration=30, source='LIVE'}={}) {
  const now = new Date('2026-09-19T08:10:00+09:00');
  context.model = {now, dataSource:source, stop:{name:'광교역'}, risk:evaluateLateRisk({
    now, requiredArrivalTime:'09:00', busArrivalsMin:arrivals,
    route:{onboardToDestinationMin:duration, durationAvailable:duration !== null},
  })};
  return vm.runInContext('renderHomeTimetable(model, "신분당선", "상행 · 상현 방면")', context);
}
test('timetable displays real arrivals in Korean with exact boarding and destination times', () => {
  const html = table({arrivals:[3,11,21],duration:35});
  assert.match(html, /08:13/); assert.match(html, /08:48/);
  assert.match(html, /08:21/); assert.match(html, /08:56/);
  assert.match(html, /09:06/); assert.match(html, /지각<br><small>\+6분/);
  assert.equal((html.match(/class="timetable-cut-label"/g)||[]).length,1);
  assert.match(html,/상행 · 상현 방면/);
});
test('no lateness rule is drawn when a following late vehicle is not confirmed', () => {
  assert.doesNotMatch(table({arrivals:[3,11]}), /timetable-cut-label/);
  assert.doesNotMatch(table({arrivals:[40,50]}), /timetable-cut-label/);
  assert.doesNotMatch(table({arrivals:[3]}), /timetable-cut-label/);
});
test('unknown journey preserves boarding times but never claims on-time arrival', () => {
  const html=table({duration:null});
  assert.match(html,/08:13/); assert.match(html,/미확인/);
  assert.doesNotMatch(html,/is-ontime|is-cut|>정시</);
});
test('demo and unavailable data never appear as real timetable predictions', () => {
  for(const source of ['DEMO','UNAVAILABLE']) {
    const html=table({source});
    assert.match(html,/실시간 정보가 연결되면/);
    assert.doesNotMatch(html,/08:13|정시|is-cut/);
  }
});
test('station and direction labels are escaped before entering the timetable', () => {
  table();
  const html=vm.runInContext('renderHomeTimetable(model, "<script>bad</script>", "<img src=x>")', context);
  assert.doesNotMatch(html,/<script>|<img/);
  assert.match(html,/&lt;script&gt;/);
});

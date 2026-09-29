import test from 'node:test';
import assert from 'node:assert/strict';
import {createTripScheduleEditor} from '../src/trip-schedule-editor.js';

test('schedule editor offers single start and repeat choices, weekdays and holiday toggle',()=>{
 const editor=createTripScheduleEditor({getState:()=>({tripSchedules:[]}),saveTrips:async()=>{},render:()=>{},mapKey:()=>''});
 editor.click({dataset:{tripAction:'new'}});
 assert.match(editor.html(),/출발 30분 전부터/);
 assert.match(editor.html(),/출발 1시간 전부터/);
 assert.match(editor.html(),/출발 2시간 전부터/);
 assert.match(editor.html(),/알람 반복 간격/);
 assert.match(editor.html(),/반복 요일/);
 assert.match(editor.html(),/공휴일에는 알람 쉬기/);
 assert.doesNotMatch(editor.html(),/알람 시간대|여러 개 선택 가능|공식 공휴일 정보/);
 editor.click({dataset:{tripAction:'alarm-start',value:'120'}});
 editor.click({dataset:{tripAction:'alarm-interval',value:'15'}});
 assert.match(editor.html(),/aria-pressed="true" data-trip-action="alarm-start" data-value="120"/);
 assert.match(editor.html(),/aria-pressed="true" data-trip-action="alarm-interval" data-value="15"/);
 assert.doesNotMatch(editor.html(),/aria-pressed="true" data-trip-action="alarm-start" data-value="30"/);
});

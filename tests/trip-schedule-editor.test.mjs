import test from 'node:test';
import assert from 'node:assert/strict';
import {createTripScheduleEditor} from '../src/trip-schedule-editor.js';

test('saved trip actions use separate accessible delete and a full-width departure row',()=>{
 const trip={id:'commute',name:'출근',enabled:true,daysOfWeek:[1],alarmStartLeadMin:60,repeatIntervalMin:5};
 const editor=createTripScheduleEditor({getState:()=>({tripSchedules:[trip]}),saveTrips:async()=>{},render:()=>{},mapKey:()=>''});
 const html=editor.html();
 assert.match(html,/class="trip-card-heading"/);
 assert.match(html,/class="trip-delete-button"[^>]*aria-label="출근 일정 삭제"/);
 assert.match(html,/class="trip-card-actions"/);
 for(const action of ['edit','toggle','departed']) assert.match(html,new RegExp(`data-trip-action="${action}"`));
 assert.match(html,/<span>오늘 출발했어요<\/span>/);
 assert.match(html,/aria-hidden="true">directions_walk/);
 assert.equal((html.match(/data-trip-action="delete"/g)||[]).length,1);
});

test('schedule editor offers single start and repeat choices, weekdays and holiday toggle',()=>{
 const editor=createTripScheduleEditor({getState:()=>({tripSchedules:[]}),saveTrips:async()=>{},render:()=>{},mapKey:()=>''});
 editor.click({dataset:{tripAction:'new'}});
 assert.match(editor.html(),/출발 30분 전부터/);
 assert.match(editor.html(),/출발 1시간 전부터/);
 assert.match(editor.html(),/출발 2시간 전부터/);
 assert.match(editor.html(),/알람 반복 간격/);
 assert.match(editor.html(),/반복 요일/);
 assert.match(editor.html(),/공휴일에는 알람 쉬기/);
 assert.match(editor.html(),/class="trip-weekdays"/);
 assert.equal((editor.html().match(/class="trip-option-grid"/g)||[]).length,2);
 assert.equal((editor.html().match(/class="trip-check-row"/g)||[]).length,2);
 assert.match(editor.html(),/>30분 전<\/button>/);
 assert.match(editor.html(),/class="trip-card-actions"/);
 assert.doesNotMatch(editor.html(),/알람 시간대|여러 개 선택 가능|공식 공휴일 정보/);
 editor.click({dataset:{tripAction:'alarm-start',value:'120'}});
 editor.click({dataset:{tripAction:'alarm-interval',value:'15'}});
 assert.match(editor.html(),/aria-pressed="true" data-trip-action="alarm-start" data-value="120"/);
 assert.match(editor.html(),/aria-pressed="true" data-trip-action="alarm-interval" data-value="15"/);
 assert.doesNotMatch(editor.html(),/aria-pressed="true" data-trip-action="alarm-start" data-value="30"/);
});

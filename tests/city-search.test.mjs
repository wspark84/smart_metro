import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {cityDisplayName,searchCityCandidates} from '../src/logic/city-search.js';
const cities=[{id:'gg:수원시',cityName:'경기 수원시',available:true},{id:'gg:성남시',cityName:'경기 성남시',available:true},{id:'seoul',cityName:'서울특별시',available:false}];
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
test('partial Suwon input resolves to Gyeonggi-do Suwon without fabricating IDs',()=>{
  for(const query of ['수원','수원시','경기도 수원','수 원']) {
    const result=searchCityCandidates(cities,query);
    assert.equal(result.length,1);assert.equal(result[0].id,'gg:수원시');
    assert.equal(cityDisplayName(result[0]),'경기도 수원시');
  }
  assert.deepEqual(searchCityCandidates(cities,''),[]);
  assert.deepEqual(searchCityCandidates(cities,'없는도시'),[]);
});
test('suggestions are bounded, Korean, hide the full list and expose only matched buttons',()=>{
  const c=vm.createContext({state:{ui:{busCityId:'',busCityQuery:'수원'}},busCitiesMeta:{cities,status:'ready'},cityDisplayName,searchCityCandidates,escapeHtml:String});
  vm.runInContext(source.slice(source.indexOf('function renderCitySearchResults()'),source.indexOf('function renderHomeDepartureEditor()')),c);
  let html=vm.runInContext('renderCitySearchResults()',c);
  assert.match(html,/경기도 수원시/);assert.match(html,/data-city-id="gg:수원시"/);assert.doesNotMatch(html,/서울|성남/);
  c.state.ui.busCityQuery='서울';html=vm.runInContext('renderCitySearchResults()',c);assert.match(html,/disabled/);assert.match(html,/연결 준비 중/);
  c.state.ui.busCityQuery='';assert.doesNotMatch(vm.runInContext('renderCitySearchResults()',c),/data-action="select-bus-city"/);
  c.state.ui.busCityQuery='경기';c.busCitiesMeta.cities=Array.from({length:20},(_,i)=>({id:String(i),cityName:`경기 도시${i}`,available:true}));
  html=vm.runInContext('renderCitySearchResults()',c);assert.equal((html.match(/data-action="select-bus-city"/g)||[]).length,8);assert.match(html,/이름을 더 입력/);
});
test('selecting a city stores exact ID and label without touching the current alarm route',()=>{
  let saves=0,resets=0,focus=0;
  const state={ui:{busCityId:'',busCityQuery:'수원'},live:{provider:'tago',nodeId:'existing'}};
  const c=vm.createContext({state,busCitiesMeta:{cities},cityDisplayName,persist:()=>saves++,render(){},resetLiveSearchState:()=>resets++,resetLiveRouteSearchState:()=>resets++,app:{querySelector:()=>({focus:()=>focus++})}});
  const start=source.indexOf('  if (action === "select-bus-city")');const end=source.indexOf('  if (action === "search-nearby-stops")',start);
  vm.runInContext(`function click(action,target){${source.slice(start,end)}}`,c);
  vm.runInContext('click("select-bus-city",{dataset:{cityId:"gg:수원시"}})',c);
  assert.equal(state.ui.busCityId,'gg:수원시');assert.equal(state.ui.busCityQuery,'경기도 수원시');assert.equal(saves,1);assert.equal(resets,2);assert.equal(focus,1);
  assert.deepEqual(state.live,{provider:'tago',nodeId:'existing'});
  vm.runInContext('click("select-bus-city",{dataset:{cityId:"seoul"}})',c);assert.equal(saves,1);
});
test('typing invalidates the old selection and requests without replacing the Korean input',()=>{
  const inputBlock=source.slice(source.indexOf('app.addEventListener("input"'),source.indexOf('app.addEventListener("compositionstart"'));
  const start=inputBlock.indexOf('  if (path === "ui.busCityQuery")');const end=inputBlock.indexOf('\n  const value =',start);
  let invalidations=0;
  const state={ui:{busCityId:'gg:성남시',busCityQuery:''}};const results={},search={disabled:false},preview={hidden:false};
  const c=vm.createContext({state,path:'ui.busCityQuery',target:{value:'수원'},resetLiveSearchState:()=>invalidations++,resetLiveRouteSearchState:()=>invalidations++,renderCitySearchResults:()=>'<button>경기도 수원시</button>',app:{querySelector:selector=>selector==='#bus-city-results'?results:selector.includes('search-live-stops')?search:preview}});
  vm.runInContext(`(()=>{${inputBlock.slice(start,end)}})()`,c);
  assert.equal(state.ui.busCityId,'');assert.equal(state.ui.busCityQuery,'수원');assert.equal(invalidations,2);assert.equal(search.disabled,true);assert.equal(preview.hidden,true);
  assert.doesNotMatch(inputBlock.slice(start,end),/persist\(|render\(/);
});

test('Enter chooses a single available result but never submits Korean composition',()=>{
  let handler,clicked=0;
  const c=vm.createContext({isAuthenticated:()=>true,citySearchComposing:false,searchCityCandidates,busCitiesMeta:{cities},state:{ui:{busCityQuery:'수원'}},app:{addEventListener:(_,fn)=>handler=fn,querySelector:()=>({click:()=>clicked++})}});
  const start=source.indexOf('app.addEventListener("keydown", event =>');const end=source.indexOf('app.addEventListener("change"',start);
  vm.runInContext(source.slice(start,end),c);
  const event={target:{dataset:{field:'ui.busCityQuery'}},key:'Enter',isComposing:false,preventDefault(){}};
  handler({...event,isComposing:true});assert.equal(clicked,0);
  handler(event);assert.equal(clicked,1);
  c.state.ui.busCityQuery='경기';handler(event);assert.equal(clicked,1);
  c.state.ui.busCityQuery='서울';handler(event);assert.equal(clicked,1);
});

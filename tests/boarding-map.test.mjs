import test from 'node:test';
import assert from 'node:assert/strict';
import { mountKakaoBoardingMap } from '../src/services/kakao-map.js';

test('boarding map uses official coordinates, separate opposite-stop markers, and explicit clicks',async()=>{
  const markers=[],labels=[],selections=[];
  const originalWindow=globalThis.window,originalDocument=globalThis.document;
  globalThis.window={kakao:{maps:{Map:class{},LatLng:class{constructor(lat,lng){this.lat=lat;this.lng=lng;}},
    LatLngBounds:class{extend(){}},Marker:class{constructor(options){Object.assign(this,options);markers.push(this);}},
    CustomOverlay:class{constructor(options){labels.push(options);}},event:{addListener(marker,event,handler){marker.handler=handler;}}}}};
  globalThis.document={createElement(){return {addEventListener(event,handler){this.handler=handler;}};}};
  const element={isConnected:true,dataset:{},textContent:''};
  try {
    await mountKakaoBoardingMap(element,{appKey:'public-key',selectedId:'a',candidates:[
      {stationId:'a',stationName:'같은 정류장',posX:'127.01',posY:'37.28'},
      {stationId:'b',stationName:'같은 정류장',posX:'127.02',posY:'37.29'}],onSelect:id=>selections.push(id)});
    assert.equal(element.dataset.mapStatus,'ready');assert.equal(markers.length,2);
    assert.equal(markers[0].position.lat,37.28);assert.equal(markers[0].position.lng,127.01);
    assert.deepEqual(selections,[]);
    markers[1].handler();assert.deepEqual(selections,['b']);
    assert.equal(labels[0].content.textContent,'1. 같은 정류장');
  } finally { globalThis.window=originalWindow;globalThis.document=originalDocument; }
});

test('missing map key or invalid coordinates do not produce a fake confirmed location',async()=>{
  const element={isConnected:true,dataset:{},textContent:''};
  await mountKakaoBoardingMap(element,{appKey:'',candidates:[],onSelect(){assert.fail();}});
  assert.equal(element.dataset.mapStatus,'unavailable');
  await mountKakaoBoardingMap(element,{appKey:'key',candidates:[{posX:'',posY:''}],onSelect(){assert.fail();}});
  assert.equal(element.dataset.mapStatus,'unavailable');
});

test('empty search can display a requested area and reports map movements only while connected',async()=>{
  const originalWindow=globalThis.window;
  const centers=[];
  let map, idle;
  const element={isConnected:true,dataset:{},textContent:''};
  globalThis.window={kakao:{maps:{
    LatLng:class{constructor(lat,lng){this.lat=lat;this.lng=lng;}getLat(){return this.lat;}getLng(){return this.lng;}},
    Map:class{constructor(element,options){this.options=options;map=this;}getCenter(){return this.options.center;}},
    LatLngBounds:class{},event:{addListener(target,event,handler){assert.equal(event,'idle');idle=handler;}}
  }}};
  try {
    await mountKakaoBoardingMap(element,{appKey:'public',candidates:[],center:{lat:37.28,lng:127.06},onSelect(){assert.fail('no selection without explicit station');},onCenterChanged:value=>centers.push(value)});
    assert.equal(element.dataset.mapStatus,'ready');
    assert.equal(map.options.keyboardShortcuts,true);
    assert.deepEqual(centers,[{lat:37.28,lng:127.06}]);
    map.options.center=new window.kakao.maps.LatLng(37.29,127.07);idle();
    assert.deepEqual(centers.at(-1),{lat:37.29,lng:127.07});
    element.isConnected=false;idle();assert.equal(centers.length,2);
  } finally { globalThis.window=originalWindow; }
});

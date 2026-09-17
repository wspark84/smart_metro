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

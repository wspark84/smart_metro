import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const script=await readFile(new URL('../src/theme-init.js',import.meta.url),'utf8');
const css=await readFile(new URL('../src/metro-theme.css',import.meta.url),'utf8');
function boot(storage=new Map(),blocked=false) {
  const listeners={},root={dataset:{},style:{}},meta={setAttribute(key,value){this[key]=value;}};
  const window={localStorage:{getItem:key=>{if(blocked)throw Error('blocked');return storage.get(key);},setItem(key,value){if(blocked)throw Error('blocked');storage.set(key,value);}},
    addEventListener:(name,fn)=>{listeners[name]=fn;},matchMedia:()=>({matches:true})};
  vm.runInNewContext(script,{window,document:{documentElement:root,querySelector:()=>meta}});
  return {window,root,meta,listeners,storage};
}
test('light is the default even on a dark OS, and invalid saved values are ignored',()=>{
  assert.equal(boot().root.dataset.theme,'light');
  assert.equal(boot(new Map([['smart-metro-appearance','unexpected']])).root.dataset.theme,'light');
  assert.doesNotMatch(css,/prefers-color-scheme/);
});
test('theme toggle persists across reload, sets native controls and browser chrome color, and can return to light',()=>{
  const first=boot();
  assert.equal(first.window.smartMetroTheme.setTheme('dark'),true);
  assert.equal(first.root.dataset.theme,'dark');assert.equal(first.root.style.colorScheme,'dark');
  assert.equal(first.meta.content,'#0F0D0C');
  const reloaded=boot(first.storage);
  assert.equal(reloaded.window.smartMetroTheme.getTheme(),'dark');
  reloaded.window.smartMetroTheme.setTheme('light');
  assert.equal(boot(first.storage).root.dataset.theme,'light');
  assert.equal(reloaded.meta.content,'#F6F4F3');
});
test('blocked storage still switches current page and reports persistence failure',()=>{
  const page=boot(new Map(),true);
  assert.equal(page.window.smartMetroTheme.setTheme('dark'),false);
  assert.equal(page.root.dataset.theme,'dark');
});
test('cross-tab changes update appearance but unrelated storage cannot override it',()=>{
  const page=boot();
  page.listeners.storage({key:'smart-metro-appearance',newValue:'dark'});
  assert.equal(page.root.dataset.theme,'dark');
  page.listeners.storage({key:'other',newValue:'light'});
  assert.equal(page.root.dataset.theme,'dark');
  page.listeners.storage({key:null,newValue:null});
  assert.equal(page.root.dataset.theme,'light');
});
test('theme boot runs before styles, uses external script, and exact approved palettes are present',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.ok(html.indexOf('src/theme-init.js')<html.indexOf('rel="stylesheet"'));
  for(const color of ['#f6f4f3','#131111','#6b6663','#e5e1df','#c7350f','#0f0d0c','#1a1716','#f4f2f0','#99938f','#282422','#ff6a45']) assert.ok(css.includes(color),color);
});
test('settings toggle has accessible switch semantics and does not change trip or account state',async()=>{
  const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
  assert.match(source,/role="switch" aria-checked="\$\{darkMode\}"/);
  const start=source.indexOf('  if (action === "toggle-dark-mode")');
  const end=source.indexOf('  if (action === "edit-home-trip")',start);
  const page=boot();let renders=0,focused=0;
  const c=vm.createContext({window:page.window,render(){renders++;},app:{querySelector:()=>({focus(){focused++;}})},themePreferenceSaved:true});
  vm.runInContext(`(function(action){${source.slice(start,end)}})('toggle-dark-mode')`,c);
  assert.equal(page.root.dataset.theme,'dark');assert.equal(renders,1);assert.equal(focused,1);
  assert.doesNotMatch(source.slice(start,end),/persist\(|state\.|fetch\(/);
});

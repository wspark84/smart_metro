// Local-only visual QA. Real UI + synthetic timetable; no account/API requests.
// Run: node scripts/preview-appearance.mjs, then http://127.0.0.1:4179
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=`
authMeta.status='authenticated';authMeta.user={id:'visual-fixture',name:'디자인 확인용 예시',providers:['google']};
state.live.provider='seoul';state.live.routeNumber='146';state.user.workAddress='테헤란로 152';
const fixtureModel=getDashboardModel();
fixtureModel.now=new Date('2026-09-20T08:30:00+09:00');fixtureModel.dataSource='LIVE';
fixtureModel.stop={...fixtureModel.stop,name:'강남역 2번 출구'};
fixtureModel.risk.results=[7,9,11,19,25].map((minutes,index)=>({index,arrivalMinutes:minutes,deltaMinutes:index<3?8-index*3:-14-(index-3)*7,arriveWorkAt:new Date('2026-09-20T'+['08:52','08:56','08:59','09:14','09:21'][index]+':00+09:00'),level:index<3?'GREEN':'RED'}));
fixtureModel.risk.targetResult=fixtureModel.risk.results[2];fixtureModel.risk.lastChanceConfirmed=true;fixtureModel.risk.urgency='NORMAL';
getDashboardModel=()=>fixtureModel;render();
`;
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(req.method!=='GET'||url.pathname.startsWith('/api/')) {res.writeHead(403,{'Content-Type':'application/json'});res.end('{"error":"디자인 확인용 예시에서는 서버 기능을 실행하지 않습니다."}');return;}
    const path=resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
    if(!path.startsWith(root.endsWith(sep)?root:root+sep)) {res.writeHead(403);res.end();return;}
    let body=await readFile(path);
    if(url.pathname==='/src/app.js') body=Buffer.from('window.setInterval=()=>0;\n'+body.toString().replace(/\nbootstrap\(\);/,fixture));
    res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css'}[extname(path)]||'application/octet-stream')+'; charset=utf-8','Cache-Control':'no-store'});res.end(body);
  } catch {res.writeHead(404);res.end();}
});
server.listen(4179,'127.0.0.1',()=>console.log('Local synthetic appearance preview: http://127.0.0.1:4179/#/settings'));

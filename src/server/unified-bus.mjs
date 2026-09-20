import { fetchTagoCities } from './tago-api.mjs';
import { searchLiveStations } from './bus-providers.mjs';

// Names only: never manufacture TAGO city codes or translate station IDs.
// Administrative list: Gyeonggi provincial government (31 cities/counties).
export const GYEONGGI_CITIES = '수원시 성남시 의정부시 안양시 부천시 광명시 평택시 동두천시 안산시 고양시 과천시 구리시 남양주시 오산시 시흥시 군포시 의왕시 하남시 용인시 파주시 이천시 안성시 김포시 화성시 광주시 양주시 포천시 여주시 연천군 가평군 양평군'.split(' ');
const labels = {seoul:'서울 버스',gyeonggi:'경기 버스',tago:'전국 버스'};
const bareCity = name => String(name || '').replace(/^경기도\s*/, '').trim();

export function buildBusCities(tagoCities, configured) {
  const consumed = new Set();
  function regional(id, cityName, provider, match) {
    const tago = tagoCities.find(match);
    if (tago) consumed.add(tago.cityCode);
    const providers = [provider, ...(tago ? ['tago'] : [])].filter(key => configured[key]);
    return {id,cityName,cityCode:tago?.cityCode || '',providers,available:providers.length>0};
  }
  const cities = [regional('seoul','서울특별시','seoul',city=>/^서울/.test(city.cityName))];
  for (const name of GYEONGGI_CITIES) {
    cities.push(regional(`gg:${name}`,`경기 ${name}`,'gyeonggi',city=>String(city.cityCode).startsWith('31') && bareCity(city.cityName)===name));
  }
  for (const city of tagoCities) {
    if (!consumed.has(city.cityCode)) cities.push({id:`tago:${city.cityCode}`,cityName:city.cityName,cityCode:city.cityCode,providers:configured.tago?['tago']:[],available:Boolean(configured.tago)});
  }
  return cities.sort((a,b)=>a.id==='seoul'?-1:b.id==='seoul'?1:a.cityName.localeCompare(b.cityName,'ko'));
}

export async function fetchUnifiedBusCities({env=process.env,fetchImpl=fetch}={}) {
  const configured={seoul:Boolean(env.SEOUL_OPEN_API_KEY),gyeonggi:Boolean(env.GYEONGGI_SERVICE_KEY),tago:Boolean(env.TAGO_SERVICE_KEY)};
  let tagoCities=[];
  const warnings=[];
  if(configured.tago) {
    try { tagoCities=await fetchTagoCities({serviceKey:env.TAGO_SERVICE_KEY,service:'stops',fetchImpl}); }
    catch { warnings.push('전국 도시 목록을 불러오지 못했습니다. 잠시 후 도시 목록을 다시 불러와 주세요.'); }
  }
  return {provider:'auto',cities:buildBusCities(tagoCities,configured),warnings,configured};
}

export async function searchUnifiedBusStations({cityId,keyword},{loadCities=fetchUnifiedBusCities,search=searchLiveStations}={}) {
  const query=String(keyword || '').trim();
  if(!query || query.length>100) throw new Error('정류장 이름 또는 번호를 100자 이내로 입력해 주세요.');
  const catalog=await loadCities();
  const city=catalog.cities.find(item=>item.id===cityId);
  if(!city) throw new Error('도시 목록에서 검색할 도시를 선택해 주세요.');
  if(!city.available) throw new Error('선택한 도시의 버스 정보 연결이 필요합니다. 운영자에게 문의해 주세요.');
  const results=await Promise.allSettled(city.providers.map(provider=>search({provider,cityCode:city.cityCode,keyword:query,
    ...(provider==='gyeonggi'?{regionName:city.id.slice(3)}:{})})));
  const warnings=[...(catalog.warnings || [])], stations=[];
  let succeeded=0;
  results.forEach((result,index)=>{
    const provider=city.providers[index];
    if(result.status==='rejected') { warnings.push(`${labels[provider]} 조회에 실패하여 해당 결과를 포함하지 못했습니다. 잠시 후 다시 검색해 주세요.`); return; }
    succeeded++;
    for(const station of result.value.stations || []) {
      // GBIS searches multiple municipalities. Do not include a different city,
      // or an unverifiable blank region, in the selected city's results.
      if(provider==='gyeonggi' && bareCity(station.regionName)!==city.id.slice(3)) continue;
      stations.push({...station,cityCode:station.cityCode || city.cityCode,provider,providerLabel:labels[provider],cityId:city.id,
        selectionId:`${provider}:${station.stationId}`});
    }
  });
  if(!succeeded) throw new Error('연결된 버스 정보 조회가 모두 실패했습니다. 잠시 후 다시 검색해 주세요.');
  // Keep identities separate even when two agencies use the same numeric ID.
  // Never combine routes or arrival times from different agencies.
  const unique=[...new Map(stations.map(item=>[item.selectionId,item])).values()];
  return {provider:'auto',stations:unique,warnings};
}

import {readCatalogRows} from './transit-catalog.mjs';

// Never join same-name stations across different lines, directions or operators.
const clean=value=>String(value??'').replace(/\s+/g,'').trim();
const name=value=>clean(value).replace(/역$/,'');
export async function matchCatalogSubwayStation(stationName,lineName,env=process.env) {
  const rows=await readCatalogRows('subway','GetKwrdFndSubwaySttnList',{},env);
  return matchSubwayIdentity(rows,stationName,lineName);
}
export function matchSubwayIdentity(rows,stationName,lineName) {
  if(!name(stationName)||!clean(lineName)) return null;
  const matches=(rows||[]).filter(row=>name(row.subwayStationName)===name(stationName) && clean(row.subwayRouteName)===clean(lineName));
  return matches.length===1?matches[0]:null;
}

export async function readSubwayTimetable({stationId,dailyTypeCode,upDownTypeCode},env=process.env) {
  const rows=await readCatalogRows('subway','GetSubwaySttnAcctoSchdulList',{
    subwayStationId:stationId,dailyTypeCode,upDownTypeCode},env);
  if(!rows) return null;
  return {source:'timetable',realtime:false,stationId,dailyTypeCode,upDownTypeCode,
    rows:rows.filter(row=>String(row.subwayStationId)===String(stationId)&&
      String(row.dailyTypeCode)===dailyTypeCode&&String(row.upDownTypeCode)===upDownTypeCode)};
}

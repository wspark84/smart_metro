import { fetchWithTimeout } from "./upstream-fetch.mjs";
import {loadWithCache} from './request-cache.mjs';
import {holidayRefreshDue, koreanCalendarMonth} from '../logic/holiday-calendar.js';

function xmlDecode(value) {
  return String(value ?? "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function getXmlBlocks(xml, tagNames) {
  for (const tagName of tagNames) {
    const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "g");
    const matches = [...xml.matchAll(pattern)].map((match) => match[1]);
    if (matches.length) {
      return matches;
    }
  }

  return [];
}

function getXmlValue(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`));
  return xmlDecode(match?.[1] ?? "");
}

function normalizeYear(year) {
  const normalized = String(year ?? "").trim();
  if (!/^\d{4}$/.test(normalized)) {
    throw new Error("Holiday sync requires a four-digit year.");
  }

  return normalized;
}

function normalizeMonth(month) {
  if (month === undefined || month === null || String(month).trim() === "") {
    return "";
  }

  const numeric = Number(month);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 12) {
    throw new Error("Holiday sync month must be between 1 and 12.");
  }

  return String(numeric).padStart(2, "0");
}

function formatHolidayDate(rawDate) {
  const digits = String(rawDate ?? "").replace(/\D/g, "");
  if (digits.length !== 8) {
    return "";
  }

  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

export function parseHolidayXml(xml) {
  if (!/<resultCode>00<\/resultCode>/.test(xml)) {
    throw new Error('공휴일 API 응답을 확인하지 못했습니다. 활용승인과 인증키를 확인해 주세요.');
  }
  const resultCode = getXmlValue(xml, "resultCode");
  if (resultCode && resultCode !== "00") {
    throw new Error(`Holiday API error: ${getXmlValue(xml, "resultMsg") || resultCode}`);
  }

  const items = getXmlBlocks(xml, ["item", "itemList"]).map((block) => ({
    date: formatHolidayDate(getXmlValue(block, "locdate")),
    name: getXmlValue(block, "dateName"),
    isHoliday: getXmlValue(block, "isHoliday"),
    dateKind: getXmlValue(block, "dateKind"),
    sequence: getXmlValue(block, "seq"),
  }));

  return {
    totalCount: Number(getXmlValue(xml, "totalCount") || items.length || 0),
    items,
  };
}

export function normalizeHolidayItems(parsed) {
  const deduped = new Map();

  for (const item of parsed?.items ?? []) {
    if (!item.date || String(item.isHoliday).trim().toUpperCase() !== "Y") {
      continue;
    }

    deduped.set(item.date, {
      date: item.date,
      name: String(item.name || "").trim(),
      isHoliday: true,
      dateKind: String(item.dateKind || "").trim(),
      sequence: String(item.sequence || "").trim(),
    });
  }

  return [...deduped.values()].sort((first, second) => first.date.localeCompare(second.date));
}

export function getHolidayApiConfig() {
  return {
    configured: Boolean(holidayServiceKey()),
  };
}

export function holidayServiceKey(env = process.env) {
  return env.HOLIDAY_API_SERVICE_KEY || env.TAGO_SERVICE_KEY || '';
}

export async function refreshHolidayCalendar(previous = {}, {now = new Date(), loader = loadOfficialHolidayYear} = {}) {
  const year = Number(new Intl.DateTimeFormat('en', {timeZone:'Asia/Seoul',year:'numeric'}).format(now));
  const years = [String(year), String(year + 1)];
  if (!holidayRefreshDue(previous.checkedAt, previous.error, now) &&
      years.every(value => previous.years?.includes(value))) return previous;
  try {
    const results = await Promise.all(years.map(year => loader(year)));
    return {years, holidays:results.flatMap(result => result.holidays),checkedAt:now.toISOString(),
      fetchedAt:results.map(result=>result.fetchedAt).sort()[0],error:''};
  } catch {
    return {...previous, years, checkedAt:now.toISOString(),error:'공휴일 정보를 갱신하지 못했습니다. 이전에 확인한 휴일을 유지합니다.'};
  }
}

export async function loadOfficialHolidayYear(year) {
  const normalizedYear = normalizeYear(year);
  const result = await loadWithCache({key:['official-holidays',normalizedYear,koreanCalendarMonth(new Date())],ttlMs:31*86400000,
    allowStaleOnError:false,loader:()=>fetchOfficialHolidays({serviceKey:holidayServiceKey(),year:normalizedYear})});
  return {year:normalizedYear,holidays:result.value,fetchedAt:result.fetchedAt,source:result.cacheStatus};
}

export async function fetchOfficialHolidays({ serviceKey, year, month = "", fetchImpl = fetch }) {
  if (!serviceKey) {
    throw new Error("HOLIDAY_API_SERVICE_KEY is not configured.");
  }

  const normalizedYear = normalizeYear(year);
  const normalizedMonth = normalizeMonth(month);
  const url = new URL("https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo");
  try { serviceKey = decodeURIComponent(serviceKey); } catch { /* raw key */ }
  url.searchParams.set("ServiceKey", serviceKey);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "100");
  url.searchParams.set("solYear", normalizedYear);
  if (normalizedMonth) {
    url.searchParams.set("solMonth", normalizedMonth);
  }

  const response = await fetchWithTimeout(url, {}, { fetchImpl });
  if (!response.ok) {
    throw new Error(`Holiday API request failed with ${response.status}.`);
  }

  const xml = await response.text();
  return normalizeHolidayItems(parseHolidayXml(xml));
}

import { fetchWithTimeout } from "./upstream-fetch.mjs";

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
    configured: Boolean(process.env.HOLIDAY_API_SERVICE_KEY),
  };
}

export async function fetchOfficialHolidays({ serviceKey, year, month = "", fetchImpl = fetch }) {
  if (!serviceKey) {
    throw new Error("HOLIDAY_API_SERVICE_KEY is not configured.");
  }

  const normalizedYear = normalizeYear(year);
  const normalizedMonth = normalizeMonth(month);
  const url = new URL("http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo");
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

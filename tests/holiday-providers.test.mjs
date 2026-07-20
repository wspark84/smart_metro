import test from "node:test";
import assert from "node:assert/strict";

import { fetchOfficialHolidays, normalizeHolidayItems, parseHolidayXml } from "../src/server/holiday-providers.mjs";

test("parseHolidayXml extracts raw holiday rows from the official XML response", () => {
  const xml = `
    <response>
      <header>
        <resultCode>00</resultCode>
        <resultMsg>OK</resultMsg>
      </header>
      <body>
        <totalCount>2</totalCount>
        <items>
          <item>
            <dateKind>01</dateKind>
            <dateName>New Year's Day</dateName>
            <isHoliday>Y</isHoliday>
            <locdate>20260101</locdate>
            <seq>1</seq>
          </item>
          <item>
            <dateKind>01</dateKind>
            <dateName>Temporary Working Day</dateName>
            <isHoliday>N</isHoliday>
            <locdate>20260102</locdate>
            <seq>1</seq>
          </item>
        </items>
      </body>
    </response>
  `;

  const parsed = parseHolidayXml(xml);

  assert.equal(parsed.totalCount, 2);
  assert.deepEqual(parsed.items[0], {
    date: "2026-01-01",
    name: "New Year's Day",
    isHoliday: "Y",
    dateKind: "01",
    sequence: "1",
  });
});

test("normalizeHolidayItems keeps only official holidays and sorts by date", () => {
  const normalized = normalizeHolidayItems({
    items: [
      {
        date: "2026-05-06",
        name: "Substitute Holiday",
        isHoliday: "Y",
        dateKind: "01",
        sequence: "1",
      },
      {
        date: "2026-05-05",
        name: "Children's Day",
        isHoliday: "Y",
        dateKind: "01",
        sequence: "1",
      },
      {
        date: "2026-05-04",
        name: "Working Day",
        isHoliday: "N",
        dateKind: "01",
        sequence: "1",
      },
    ],
  });

  assert.deepEqual(normalized, [
    {
      date: "2026-05-05",
      name: "Children's Day",
      isHoliday: true,
      dateKind: "01",
      sequence: "1",
    },
    {
      date: "2026-05-06",
      name: "Substitute Holiday",
      isHoliday: true,
      dateKind: "01",
      sequence: "1",
    },
  ]);
});

test("fetchOfficialHolidays validates parameters and returns normalized official dates", async () => {
  let requestedUrl = null;
  const holidays = await fetchOfficialHolidays({
    serviceKey: "demo-key",
    year: "2026",
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        text: async () => `
          <response>
            <header>
              <resultCode>00</resultCode>
              <resultMsg>OK</resultMsg>
            </header>
            <body>
              <totalCount>1</totalCount>
              <items>
                <item>
                  <dateKind>01</dateKind>
                  <dateName>Children's Day</dateName>
                  <isHoliday>Y</isHoliday>
                  <locdate>20260505</locdate>
                  <seq>1</seq>
                </item>
              </items>
            </body>
          </response>
        `,
      };
    },
  });

  assert.equal(requestedUrl.searchParams.get("ServiceKey"), "demo-key");
  assert.equal(requestedUrl.searchParams.get("solYear"), "2026");
  assert.equal(requestedUrl.searchParams.get("numOfRows"), "100");
  assert.deepEqual(holidays, [
    {
      date: "2026-05-05",
      name: "Children's Day",
      isHoliday: true,
      dateKind: "01",
      sequence: "1",
    },
  ]);
});

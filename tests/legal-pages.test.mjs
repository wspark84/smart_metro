import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderLegalPage, readReturnPath } from "../src/server/legal-pages.mjs";

test("store-required legal pages render in Korean", () => {
  const privacy = renderLegalPage("/privacy");
  assert.match(privacy, /<html lang="ko">/);
  for (const text of ["처리하는 개인정보", "보유 기간과 파기", "국외 이전", "개인정보 보호책임자", "위치정보를 수집하지 않습니다", "5년"]) assert.ok(privacy.includes(text), text);
  const terms = renderLegalPage("/terms/");
  for (const text of ["월 5,000원", "자동 갱신", "회원 탈퇴만으로는 구독이 해지되지 않습니다", "시간표 기준"]) assert.ok(terms.includes(text), text);
  const remove = renderLegalPage("/account/delete");
  assert.match(remove, /\/api\/account\/delete/);
  assert.match(remove, /구독 관리에서 해지/);
  assert.equal(renderLegalPage("/admin"), null);
});

test("post-login return path is allow-listed", () => {
  assert.equal(readReturnPath("smart-metro-return=%2Faccount%2Fdelete"), "/account/delete");
  assert.equal(readReturnPath("smart-metro-return=%2F%2Fevil.com"), "/");
  assert.equal(readReturnPath("smart-metro-return=https%3A%2F%2Fevil.com"), "/");
  assert.equal(readReturnPath(""), "/");
});

test("server exposes legal pages and the account deletion endpoint", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /renderLegalPage\(requestUrl\.pathname\)/);
  assert.match(server, /requestUrl\.pathname === "\/api\/account\/delete"\) \{/);
  const social = await readFile(new URL("../src/server/social-login-routes.mjs", import.meta.url), "utf8");
  assert.match(social, /Location: returnTo/);
});

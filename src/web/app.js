// 이노치 웹: the same screens as the Android app (mobile_app/lib), on the same
// server API (/api/mobile/*). Logged in with the site's own session cookie.

const root = document.getElementById("app");

// ---- Small helpers ----------------------------------------------------------
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const obj = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const list = (value) => (Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : []);
const num = (value) => (typeof value === "number" ? value : Number.parseFloat(value));
const finite = (value) => Number.isFinite(num(value));
const two = (n) => String(n).padStart(2, "0");
const icon = (name) => `<span class="icon" aria-hidden="true">${name}</span>`;

/** Times are always Korea time, whatever the computer's own zone is. */
function kst(iso) {
  const ms = Date.parse(String(iso ?? ""));
  return Number.isFinite(ms) ? new Date(ms + 9 * 3600_000) : null;
}
export function kstClock(iso) {
  const at = kst(iso);
  return at ? `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}` : "--:--";
}
export function koreanTime(hhmm) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!match) return "";
  const hour = Number(match[1]);
  return `${hour < 12 ? "오전" : "오후"} ${hour % 12 === 0 ? 12 : hour % 12}:${match[2]}`;
}
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function urgencyFor(minutes, overdue = false) {
  if (minutes === null || minutes === undefined) return "idle";
  if (overdue || minutes <= 3) return "now";
  if (minutes <= 10) return "soon";
  return "relaxed";
}
export function countdownText(minutes) {
  if (minutes < 60) return `${minutes}분`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)}시간` : `${Math.floor(minutes / 60)}시간 ${rest}분`;
}
export function vehicleLabel(route, subway) {
  if (!route) return "대중교통";
  if (subway) return route;
  return /^[0-9A-Za-z-]+$/.test(route) ? `${route}번 버스` : route;
}
export function rowStatus(row) {
  const slack = finite(row.slackMinutes) ? Math.trunc(num(row.slackMinutes)) : null;
  if (row.onTime !== true) return slack === null ? "지각" : `${-slack}분 늦음`;
  if (row.target === true) return "추천";
  if (row.catchable !== true) return "놓쳐요";
  return slack === null ? "정시" : `${slack}분 여유`;
}
const isSubway = (stop) => stop?.mode === "subway" || stop?.provider === "subway";
function stopKindLabel(stop) {
  if (isSubway(stop)) return stop.lineName ? `지하철 · ${stop.lineName}` : "지하철";
  const number = String(stop.stationNumber || stop.arsId || "").trim();
  return number ? `버스 · ${number}` : "버스";
}
function stopTitle(stop) {
  const name = String(stop?.stationName || "").trim();
  return isSubway(stop) && name && !name.endsWith("역") ? `${name}역` : name;
}
const BASIS = { realtime: "실시간", timetable: "시간표 기준", estimate: "배차간격 예상", schedule: "시간표 예상" };
const BASIS_SHORT = { realtime: "실시간", timetable: "시간표", estimate: "배차예상", schedule: "시간표예상" };
// What the leave time is based on, said in full under the headline.
const BASIS_SENTENCE = {
  realtime: "실시간 도착정보 기준 시간이에요",
  timetable: "열차 시간표 기준 시간이에요",
  estimate: "앞 차 실시간 정보에 배차간격을 더해 예상한 시간이에요 (실시간 아님)",
  schedule: "실시간 정보가 아직 없어 시간표(배차간격)로 예상한 시간이에요",
};
function basisChip(basis) {
  const text = BASIS[basis];
  if (!text) return "";
  const color = basis === "realtime" ? "var(--ok)" : basis === "timetable" ? "var(--timetable)" : "var(--muted)";
  return `<span class="pill" style="color:${color}">${text}</span>`;
}

// ---- Server ------------------------------------------------------------------
class ApiError extends Error {
  constructor(status, message, code = "", retryAt = null) {
    super(message);
    Object.assign(this, { status, code, retryAt });
  }
}
function statusMessage(status) {
  if (status === 401) return "다시 로그인해 주세요.";
  if (status === 403) return "허용되지 않은 요청입니다.";
  if (status === 409) return "다른 기기에서 설정이 바뀌었습니다. 새로고침 후 다시 시도해 주세요.";
  if (status === 429) return "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.";
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
async function api(method, path, { body, query, timeout = 45_000 } = {}) {
  const url = new URL(path, location.origin);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && String(value).trim() !== "") url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method, credentials: "same-origin", signal: controller.signal,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) {
      const retryAt = payload.retryAt ? new Date(payload.retryAt) : null;
      throw new ApiError(response.status, payload.error || statusMessage(response.status), payload.code || "", retryAt);
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === "AbortError") throw new ApiError(0, "서버 응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.");
    throw new ApiError(0, "인터넷 연결을 확인해 주세요.");
  } finally {
    clearTimeout(timer);
  }
}
const server = {
  session: () => api("GET", "/api/auth/session"),
  providers: () => api("GET", "/api/auth/providers"),
  startLogin: (provider) => api("POST", "/api/auth/oauth/start", { body: { provider } }),
  logout: () => api("POST", "/api/auth/logout", { body: {} }),
  home: () => api("GET", "/api/mobile/home"),
  saveSetup: (patch) => api("POST", "/api/mobile/setup", { body: patch }),
  // The bell turns today's alarms on/off; 출발했어요 also marks today as departed.
  setToday: (enabled, departed = false) => api("POST", "/api/mobile/today", { body: departed ? { enabled, departed } : { enabled } }),
  refresh: () => api("POST", "/api/mobile/refresh", { body: {} }),
  departed: () => api("POST", "/api/alarm-delivery/actions", { body: { type: "ACK_DEPARTED" } }),
  testPush: () => api("POST", "/api/push-gateway/test-dispatch", { body: {} }),
  places: async (query) => list((await api("GET", "/api/places/search", { query: { query } })).results),
  placeConfig: () => api("GET", "/api/places/config"),
  nearby: (lat, lng) => api("GET", "/api/mobile/stops/nearby", { query: { lat: lat.toFixed(6), lng: lng.toFixed(6) }, timeout: 30_000 }),
  describe: (stop) => {
    const query = {};
    for (const key of ["provider", "stationId", "stationName", "arsId", "cityCode", "nodeId", "lineName", "lat", "lng"]) query[key] = stop[key];
    return api("GET", "/api/mobile/stops/describe", { query, timeout: 30_000 });
  },
};

// ---- Theme (시스템 / 라이트 / 다크, this browser only) -------------------------
const THEME_KEY = "inochi-theme-mode";
function themeMode() {
  try { return ["light", "dark"].includes(localStorage.getItem(THEME_KEY)) ? localStorage.getItem(THEME_KEY) : "system"; } catch { return "system"; }
}
function applyTheme() {
  const mode = themeMode();
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#141311" : "#F4F2EE");
}
function setThemeMode(mode) {
  try { mode === "system" ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, mode); } catch { /* applies until reload */ }
  applyTheme();
}
applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);

// ---- Toast ---------------------------------------------------------------------
let toastTimer;
function toast(message) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.textContent = message;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

// ---- App state & screens ---------------------------------------------------------
// The main screen (login / onboarding / today) sits at the bottom; settings and
// pickers are pushed on top and the browser back button pops them.
const app = {
  auth: "checking", // checking | out | in
  providers: {},
  loginBusy: false,
  loginError: "",
  data: null,
  error: "",
  busy: false,
  checking: false,
  now: new Date(),
  onboard: null,
};
const stack = [];
const top = () => stack[stack.length - 1] || null;
function push(screen) {
  stack.push(screen);
  history.pushState({ depth: stack.length }, "");
  render();
  window.scrollTo(0, 0);
}
// Programmatic pops step the browser history back too, batched so that two
// pops in a row (confirm, then picker) go back two entries at once.
let pendingBack = 0;
function pop(result) {
  const screen = stack.pop();
  if (screen?.resolve) screen.resolve(result);
  pendingBack++;
  if (pendingBack === 1) setTimeout(() => { const n = pendingBack; pendingBack = 0; history.go(-n); }, 0);
  render();
}
window.addEventListener("popstate", () => {
  const depth = history.state?.depth || 0;
  let changed = false;
  while (stack.length > depth) {
    const screen = stack.pop();
    screen?.resolve?.(undefined);
    changed = true;
  }
  if (changed) render();
});
const open = (screen) => new Promise((resolve) => push({ ...screen, resolve }));

function render() {
  const screen = top();
  document.body.style.removeProperty("--page");
  if (screen?.type === "settings") return renderSettings(screen);
  if (screen?.type === "stops") return renderStopPicker(screen);
  if (screen?.type === "confirm") return renderConfirm(screen);
  if (screen?.type === "place") return renderPlaceSearch(screen);
  if (app.auth === "checking") return renderCenter('<div class="spinner" aria-label="불러오는 중"></div>');
  if (app.auth === "out") return renderLogin();
  if (!app.data) {
    return renderCenter(app.error
      ? `<p class="danger">${esc(app.error)}</p><button class="btn outline small" data-action="reload">다시 시도</button>`
      : '<div class="spinner" aria-label="불러오는 중"></div>');
  }
  if (obj(app.data.setup).complete !== true) return renderOnboarding();
  return renderToday();
}
function renderCenter(inner) {
  root.innerHTML = `<main class="screen"><div class="center">${inner}</div></main>`;
}

// ---- Login ------------------------------------------------------------------------
function renderLogin() {
  const ready = (name) => obj(obj(app.providers.providers)[name]).ready !== false;
  root.innerHTML = `<main class="screen"><div class="login"><div class="box">
    <div><span class="brand-icon" role="img" aria-label="이노치"></span></div>
    <h1>이거 놓치면 지각</h1>
    <p>집에서 나갈 시각을 버스·지하철 도착에 맞춰 알려드려요.</p>
    ${ready("google") ? `<button class="btn" data-action="login" data-provider="google" ${app.loginBusy ? "disabled" : ""}>구글로 시작하기</button>` : ""}
    ${ready("kakao") ? `<button class="btn kakao" data-action="login" data-provider="kakao" ${app.loginBusy ? "disabled" : ""}>카카오로 시작하기</button>` : ""}
    ${app.loginError ? `<p class="danger" style="margin:8px 0 0">${esc(app.loginError)}</p>` : ""}
    <small class="muted">시작하면 <a href="/terms">이용약관</a>에 동의하고 <a href="/privacy">개인정보처리방침</a>을 확인한 것으로 봅니다. 만 14세 이상만 가입할 수 있어요.</small>
  </div></div></main>`;
}
async function login(provider) {
  app.loginBusy = true;
  app.loginError = "";
  render();
  try {
    const result = await server.startLogin(provider);
    if (!result.authorizationUrl) throw new Error();
    location.href = result.authorizationUrl;
  } catch (error) {
    app.loginBusy = false;
    app.loginError = error instanceof ApiError && error.status ? error.message : "로그인을 시작하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.";
    render();
  }
}

// ---- Loading ------------------------------------------------------------------------
async function start() {
  render();
  try {
    const session = await server.session();
    if (!session.authenticated) {
      app.auth = "out";
      try { app.providers = obj((await server.providers()).config); } catch { app.providers = {}; }
      render();
      return;
    }
    app.auth = "in";
    app.email = session.user?.email || "";
    await load();
  } catch (error) {
    app.auth = "in";
    app.error = error.message;
    render();
  }
}
async function load() {
  try {
    apply(await server.home());
  } catch (error) {
    if (error.status === 401) {
      app.auth = "out";
      app.data = null;
    } else {
      app.error = error.message || "정보를 불러오지 못했습니다.";
    }
    if (!top()) render();
  }
}
function apply(data) {
  app.data = data;
  app.error = "";
  app.now = new Date();
  const at = Date.parse(obj(data.refresh).manualAvailableAt || "");
  app.manualAvailableAt = Number.isFinite(at) ? at : null;
  if (!top()) render();
}
setInterval(() => { if (app.auth === "in" && !app.busy && document.visibilityState === "visible") load(); }, 60_000);
setInterval(() => { app.now = new Date(); if (!top() && app.data) renderToday(); }, 15_000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && app.auth === "in") load(); });

// ---- Today (C안) ------------------------------------------------------------------------
function daysLabel(days) {
  const set = new Set(days);
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return "평일 반복";
  if (set.size === 7) return "매일 반복";
  return `${[1, 2, 3, 4, 5, 6, 0].filter((d) => set.has(d)).map((d) => WEEKDAYS[d]).join("·")} 반복`;
}
function notReadyText(forecast, forecastError) {
  if (forecastError) return forecastError;
  if (forecast.status === "no-catchable") return "지금은 제시간에 도착할 교통편이 없어요. 도착 시각이 지났거나 운행이 끝났을 수 있어요.";
  return String(forecast.warning || "").trim() || "경로와 도착정보를 확인하고 있어요. 잠시 후 다시 보여 드릴게요.";
}
function countMarkup(text) {
  const hasDigits = /\d/.test(text);
  const parts = text.match(/\d+|\D+/g) || [];
  return parts.map((part, i) => /^\d+$/.test(part) || !hasDigits
    ? `<span class="d">${esc(part)}</span>`
    : `<span class="u">${esc(` ${part.trim()}${i < parts.length - 1 ? "  " : ""}`)}</span>`).join("");
}
function renderToday() {
  const data = app.data;
  const setup = obj(data.setup), today = obj(data.today), repeat = obj(data.repeat), forecast = obj(data.forecast);
  const boarding = obj(setup.boarding);
  const ready = forecast.status === "ready";
  const departed = today.departedToday === true;
  const armed = today.armed === true;
  const leaveMs = Date.parse(forecast.leaveAt || "");
  const remaining = Number.isFinite(leaveMs) ? leaveMs - app.now.getTime() : null;
  const minutes = ready && remaining !== null ? Math.max(0, Math.ceil(remaining / 60_000)) : null;
  const overdue = remaining !== null && remaining < 0;
  const urgency = departed ? "relaxed" : forecast.status === "too-late" ? "now" : urgencyFor(minutes, overdue);
  const status = String(forecast.status || "");
  const goalIssue = !departed && (status === "goal-passed" || status === "too-late");
  // A bus is still possible but live arrivals have not come yet (e.g. it is
  // waiting at the turnaround): no "0분", checks continue automatically.
  const awaitingLive = !departed && status === "awaiting-live";
  const needsManual = !ready && !departed && !goalIssue && !awaitingLive && (status === "not-checked" || status === "no-live" || obj(data.refresh).state === "unknown");
  const label = departed ? "오늘은 출발했어요"
    : goalIssue ? String(forecast.title || (status === "too-late" ? "이미 지각입니다." : "시간을 다시 설정해 보세요."))
    : awaitingLive ? String(forecast.title || "아직 실시간 정보가 확인되지 않았습니다.")
    : needsManual ? "현재 시간이 조회되지 않습니다"
    : !ready ? (status === "no-catchable" ? "제시간 도착이 어려워요" : "경로를 확인하고 있어요")
    : urgency === "now" ? "지금 나가야 해요" : "출발까지";
  const count = departed ? "완료" : minutes === null ? "" : countdownText(minutes);
  const route = String(forecast.routeNumber || "").trim();
  const subway = boarding.mode === "subway";
  const slack = finite(forecast.slackMinutes) ? Math.trunc(num(forecast.slackMinutes)) : null;
  const rows = list(forecast.rows);
  const basis = String(forecast.basis || rows[0]?.basis || "");
  const days = Array.isArray(repeat.days) ? repeat.days.map(Number) : [];
  const repeatLabel = repeat.enabled === true ? daysLabel(days) : "오늘 하루";
  const where = subway ? "역" : "정류장";
  const field = urgency === "idle" ? "var(--ground)" : `var(--${urgency}-ground)`;
  const tone = urgency === "idle" ? "var(--ink)" : `var(--${urgency}-tone)`;
  document.body.style.setProperty("--page", field);

  const waitMs = app.manualAvailableAt ? app.manualAvailableAt - Date.now() : 0;
  const waiting = !app.checking && waitMs > 0;
  const manual = needsManual ? `<div class="manual">
      <button class="btn" data-action="manual-refresh" ${app.checking || waiting ? "disabled" : ""}>
        ${app.checking ? '<span class="spinner" style="width:18px;height:18px;border-width:2px"></span>' : icon("refresh")}
        ${app.checking ? "지금 확인 중입니다" : waiting ? `${Math.ceil(waitMs / 60_000)}분 뒤 다시 확인할 수 있어요` : "새로고침"}
      </button>
      <p>누르면 지금 도착정보를 확인해요. 3분에 한 번 확인할 수 있어요.</p></div>` : "";

  const rowHtml = rows.length ? rows.map((row) => {
    const onTime = row.onTime === true, target = row.target === true, catchable = row.catchable === true;
    const cls = !onTime ? "late faded" : target ? "target" : !catchable ? "missed faded" : "";
    const what = vehicleLabel(String(row.routeNumber || "").trim(), subway);
    const arrive = kstClock(row.arriveAt);
    return `<div class="row ${cls}"><span class="at tab">${kstClock(row.boardingAt)}</span>
      <span class="what tab">${esc(arrive === "--:--" ? what : `${what} · ${arrive} 도착`)}</span>
      ${BASIS_SHORT[row.basis] ? `<span class="bs" style="font-size:11px;font-weight:600;margin-right:6px;color:${row.basis === "realtime" ? "var(--ok)" : "var(--muted)"}">${BASIS_SHORT[row.basis]}</span>` : ""}
      <span class="st">${esc(rowStatus(row))}</span></div>`;
  }).join("") : '<div class="empty">표시할 교통편이 아직 없어요.</div>';

  root.innerHTML = `<main class="screen today" style="--tone:${tone};background:${field}">
    <header class="today-head"><b>이거 놓치면 지각</b><span class="now tab">지금 ${kstClock(app.now.toISOString())}</span>
      <button class="icon-btn" data-action="settings" aria-label="설정">${icon("settings")}</button></header>
    ${app.busy ? '<div class="loading-bar"></div>' : ""}
    <section class="today-main" aria-label="출발까지 남은 시간">
      <p class="today-label ${count ? "" : "big"}">${esc(label)}</p>
      <div class="count-box">${count ? `<span class="count tab" aria-label="${esc(count)}">${countMarkup(count)}</span>` : ""}</div>
      ${ready && !departed ? `<p class="leave tab">${kstClock(forecast.leaveAt)}에 나가세요</p>
        ${BASIS_SENTENCE[forecast.basis] ? `<p class="note" style="font-size:10px;font-weight:600;margin:2px 0 6px">${BASIS_SENTENCE[forecast.basis]}</p>` : ""}
        <p class="info">출발&nbsp; <span class="v">${esc(vehicleLabel(route, subway))}</span><span class="t tab">${kstClock(forecast.boardingAt)}</span><span class="v">탑승</span></p>
        <p class="info">도착&nbsp; <span class="t tab">${kstClock(forecast.arriveAt)}</span>${slack !== null ? `<span class="v">${slack > 0 ? `${slack}분 여유` : "딱 맞게 도착"}</span>` : ""}</p>`
      : goalIssue ? `<p class="note" style="font-size:17px;font-weight:700">${esc(forecast.message || "")}</p>
        ${status === "too-late" ? "" : `<div class="manual"><label class="btn" style="width:auto;position:relative">${icon("schedule")} 도착 시각 바꾸기
          <input type="time" data-input="today-arrival" value="${esc(setup.requiredArrivalTime || "09:00")}" aria-label="도착 시각"
            style="position:absolute;inset:0;opacity:0;width:100%;cursor:pointer"></label></div>`}`
      : awaitingLive ? `<p class="note" style="font-size:17px;font-weight:700">${esc(forecast.message || "실시간 정보가 확인되는 대로 다시 알려드릴게요.")}</p>`
      : `${!needsManual || status === "no-live" ? `<p class="note">${esc(notReadyText(forecast, String(data.forecastError || "")))}</p>` : ""}${manual}`}
      ${ready && forecast.urgent === true && !departed ? '<p class="note" style="font-weight:700;font-size:14px;margin-top:8px">이 차가 제시간에 도착하는 마지막 교통편이에요.</p>' : ""}
      ${app.error ? `<p class="note" style="font-size:13px;margin-top:8px">${esc(app.error)}</p>` : ""}
    </section>
    <section class="sheet">
      <div class="sheet-title"><b>${subway ? "곧 오는 열차" : "곧 오는 버스"}</b>${basisChip(basis)}</div>
      <div class="rows">${rowHtml}</div>
      <div class="actions">
        <button class="btn" data-action="departed" ${app.busy || departed || !armed ? "disabled" : ""}>${departed ? "오늘은 출발 완료" : "출발했어요"}</button>
        <button class="bell ${armed ? "" : "off"}" data-action="toggle-today" role="switch" aria-checked="${armed}" aria-label="오늘 출발 알림" ${app.busy ? "disabled" : ""}>${icon(armed ? "notifications_active" : "notifications_off")}</button>
      </div>
      <p class="footer tab">${esc(`${repeatLabel} · 도착 ${setup.requiredArrivalTime || ""} · ${where}까지 걸어서 ${setup.boardingAccessMin ?? "-"}분${!armed && !departed ? " · 오늘 알림 꺼짐" : ""}`)}</p>
    </section>
  </main>`;
  fitCountdown();
}
// Shrinks the big number until it fits the width and the space left above the sheet.
function fitCountdown() {
  const count = root.querySelector(".count");
  const box = root.querySelector(".count-box");
  if (!count || !box) return;
  const main = root.querySelector(".today-main");
  count.style.removeProperty("--d");
  let size = parseFloat(getComputedStyle(count.querySelector(".d") || count).fontSize) || 168;
  for (let i = 0; i < 6; i++) {
    const tooWide = count.scrollWidth > box.clientWidth + 1;
    const tooTall = main.scrollHeight > main.clientHeight + 1;
    if (!tooWide && !tooTall) break;
    const ratio = Math.min(tooWide ? box.clientWidth / count.scrollWidth : 1, tooTall ? 0.88 : 1);
    size = Math.max(48, Math.floor(size * ratio));
    count.style.setProperty("--d", `${size}px`);
  }
}
window.addEventListener("resize", () => { if (!top() && app.data && obj(app.data.setup).complete === true) fitCountdown(); });

async function run(action, done) {
  app.busy = true;
  render();
  try {
    const data = await action();
    if (data?.setup) apply(data); else await load();
    toast(done);
  } catch (error) {
    toast(error.message || "처리하지 못했습니다. 다시 시도해 주세요.");
  } finally {
    app.busy = false;
    render();
  }
}
async function manualRefresh() {
  if (app.checking) return;
  app.checking = true;
  render();
  try {
    apply(await server.refresh());
  } catch (error) {
    if (error.code === "REFRESH_TOO_SOON" && error.retryAt) app.manualAvailableAt = error.retryAt.getTime();
    toast(error.message || "확인하지 못했습니다. 잠시 후 다시 눌러 주세요.");
  } finally {
    app.checking = false;
    render();
    if (app.manualAvailableAt > Date.now()) setTimeout(() => { if (!top()) render(); }, app.manualAvailableAt - Date.now() + 1000);
  }
}

// ---- Onboarding: one question per screen ----------------------------------------------
const STEPS = 5;
function onboardState() {
  if (!app.onboard) {
    const setup = obj(app.data.setup);
    app.onboard = {
      step: 0,
      boarding: setup.boarding && typeof setup.boarding === "object" ? setup.boarding : null,
      destination: setup.destination && typeof setup.destination === "object" ? setup.destination : null,
      arrival: /^\d{2}:\d{2}$/.test(setup.requiredArrivalTime || "") ? setup.requiredArrivalTime : "09:00",
      walk: finite(setup.boardingAccessMin) ? Math.trunc(num(setup.boardingAccessMin)) : 5,
      saving: false, error: "",
    };
  }
  return app.onboard;
}
function choice(value, empty, action) {
  const chosen = Boolean(value);
  return `<button class="choice pressable ${chosen ? "chosen" : ""}" data-action="${action}">
    <span class="val">${esc(chosen ? value : empty)}</span><span class="hint">${chosen ? "바꾸기" : ""}</span>
    <span class="icon muted">${chosen ? "chevron_right" : "search"}</span></button>`;
}
function stepper(minutes, action, compact = false) {
  return `<div class="stepper ${compact ? "compact" : ""}">
    <button data-action="${action}" data-delta="-1" aria-label="1분 줄이기" ${minutes <= 0 ? "disabled" : ""}>−</button>
    <span class="tab">${minutes}분</span>
    <button data-action="${action}" data-delta="1" aria-label="1분 늘리기" ${minutes >= 60 ? "disabled" : ""}>+</button></div>`;
}
function renderOnboarding() {
  const o = onboardState();
  const questions = [
    ["어디서 버스·지하철을\n타세요?", "집에서 가장 먼저 타는 정류장이나 역이에요. 버스는 길 건너편과 헷갈리지 않게 방향까지 확인해요.",
      choice(o.boarding ? `${stopTitle(o.boarding)} · ${stopKindLabel(o.boarding)}` : "", "정류장·역 찾기", "pick-stop")],
    ["어디로 가세요?", "회사나 학교 이름, 주소로 찾을 수 있어요.",
      choice(o.destination ? String(o.destination.label || o.destination.address || "") : "", "도착지 찾기", "pick-destination")],
    ["몇 시까지\n도착해야 하나요?", "이 시각에 맞춰 집에서 나갈 시각을 계산해요.",
      `<input class="time-big tab" type="time" data-input="arrival" value="${esc(o.arrival)}" aria-label="도착해야 하는 시각">`],
    ["정류장·역까지\n걸어서 몇 분인가요?", "집 문을 나서서 타는 곳에 도착할 때까지예요.", stepper(o.walk, "walk")],
    ["나갈 시각에\n알려 드릴게요", "알림은 이노치 안드로이드 앱을 설치한 휴대폰으로 와요. 웹에서는 출발까지 남은 시간과 곧 오는 교통편을 볼 수 있어요.", ""],
  ];
  const [title, hint, body] = questions[o.step];
  const can = o.step === 0 ? Boolean(o.boarding) : o.step === 1 ? Boolean(o.destination) : true;
  root.innerHTML = `<main class="screen">
    <header class="appbar">${o.step > 0 ? `<button class="icon-btn" data-action="onboard-back" aria-label="이전">${icon("arrow_back")}</button>` : '<span style="width:16px"></span>'}
      <span class="sub">출근길 설정 ${o.step + 1}/${STEPS}</span></header>
    <div class="progress"><i style="width:${((o.step + 1) / STEPS) * 100}%"></i></div>
    <div class="pad">
      <div class="grow"><h2 class="q-title">${esc(title)}</h2><p class="q-hint">${esc(hint)}</p>${body}</div>
      ${o.error ? `<p class="danger">${esc(o.error)}</p>` : ""}
      ${o.step < STEPS - 1
        ? `<button class="btn" data-action="onboard-next" ${can ? "" : "disabled"}>다음</button>`
        : `<button class="btn" data-action="onboard-finish" ${o.saving ? "disabled" : ""}>시작하기</button>`}
    </div></main>`;
}
async function finishOnboarding() {
  const o = onboardState();
  o.saving = true;
  o.error = "";
  render();
  try {
    const data = await server.saveSetup({
      boarding: boardingPayload(o.boarding), destination: o.destination,
      requiredArrivalTime: o.arrival, boardingAccessMin: o.walk,
    });
    app.onboard = null;
    apply(data);
  } catch (error) {
    o.error = error.message || "저장하지 못했습니다. 다시 시도해 주세요.";
  } finally {
    o.saving = false;
    render();
  }
}
function boardingPayload(stop) {
  const payload = {};
  for (const key of ["provider", "stationId", "stationName", "arsId", "cityCode", "nodeId", "lineName"]) payload[key] = String(stop[key] ?? "");
  payload.lat = num(stop.lat);
  payload.lng = num(stop.lng);
  return payload;
}

// ---- Settings -------------------------------------------------------------------------
function cell({ label, value, detail, title, trail, action, danger }) {
  return `<button class="cell" ${action ? `data-action="${action}"` : "disabled"}>
    <span class="grow stack">${value !== undefined
      ? `<span class="label">${esc(label)}</span><span class="value">${esc(value)}</span>`
      : `<span class="title" ${danger ? 'style="color:var(--danger)"' : ""}>${esc(title)}</span>`}
      ${detail ? `<span class="detail">${esc(detail)}</span>` : ""}</span>
    ${trail ? `<span class="trail">${esc(trail)}</span>` : ""}${danger ? "" : icon("chevron_right")}</button>`;
}
function switchRow(title, detail, checked, action, disabled = false, extra = "") {
  return `<div class="cell"><span class="grow stack"><span class="title">${title}${extra}</span>${detail ? `<span class="detail">${esc(detail)}</span>` : ""}</span>
    <button class="switch" role="switch" aria-checked="${checked}" aria-label="${esc(title.replace(/<[^>]+>/g, ""))}" data-action="${action}" ${disabled ? "disabled" : ""}></button></div>`;
}
function renderSettings(screen) {
  const data = app.data || {};
  const setup = obj(data.setup), repeat = obj(data.repeat), alerts = obj(data.alerts);
  const boarding = obj(setup.boarding), destination = obj(setup.destination);
  const subscribed = obj(data.subscription).active === true;
  const repeatOn = repeat.enabled === true;
  const days = new Set((Array.isArray(repeat.days) ? repeat.days : [1, 2, 3, 4, 5]).map(Number));
  const skipHolidays = repeat.skipHolidays !== false;
  const walk = screen.walk ?? (finite(setup.boardingAccessMin) ? Math.trunc(num(setup.boardingAccessMin)) : 5);
  const where = boarding.mode === "subway" ? "역" : "정류장";
  const minutes = (Array.isArray(alerts.minutes) ? alerts.minutes : [10, 5, 0]).map(Number).filter((m) => m >= 0);
  const late = alerts.late === true;
  const busy = app.busy;
  const mode = themeMode();
  root.innerHTML = `<main class="screen">
    <header class="appbar"><button class="icon-btn" data-action="back" aria-label="오늘 화면으로">${icon("arrow_back")}</button><h1>설정</h1></header>
    ${busy ? '<div class="loading-bar"></div>' : ""}
    <div class="settings">
      <h2 class="h">내 출근길</h2>
      <div class="group">
        ${cell({ label: "출발 정류장·역", value: boarding.stationName ? [stopTitle(boarding), boarding.lineName].filter(Boolean).join(" · ") : "선택해 주세요", action: busy ? "" : "pick-stop" })}
        ${cell({ label: "도착지", value: destination.label || "선택해 주세요", detail: destination.address && destination.address !== destination.label ? destination.address : "", action: busy ? "" : "pick-destination" })}
        <label class="cell"><span class="grow stack"><span class="label">도착 시각</span>
          <span class="value">${esc(setup.requiredArrivalTime ? `${koreanTime(setup.requiredArrivalTime)}까지` : "선택해 주세요")}</span></span>
          <input type="time" data-input="settings-arrival" value="${esc(setup.requiredArrivalTime || "09:00")}" aria-label="도착 시각" style="border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--card)" ${busy ? "disabled" : ""}></label>
        <div class="cell"><span class="grow stack"><span class="label">${where}까지 걸어서</span><span class="value tab">${walk}분</span></span>${stepper(walk, "settings-walk", true)}</div>
      </div>

      <h2 class="h">반복</h2>
      <div class="group">
        ${switchRow("매일 자동 알림", "끄면 오늘 하루만 알려 드려요", repeatOn, "repeat-toggle", busy, ' <span class="pill filled">유료</span>')}
        <div class="days" role="group" aria-label="반복 요일" style="padding-top:8px;padding-bottom:8px">${[1, 2, 3, 4, 5, 6, 0].map((d) =>
          `<button class="day" aria-pressed="${days.has(d)}" data-action="repeat-day" data-day="${d}" aria-label="${WEEKDAYS[d]}요일" ${!repeatOn || busy ? "disabled" : ""}>${WEEKDAYS[d]}</button>`).join("")}</div>
        ${switchRow("공휴일에는 쉬어요", subscribed ? "월 5,000원 구독 중" : "월 5,000원 · 구독하면 켤 수 있어요", skipHolidays, "repeat-holidays", !repeatOn || busy)}
      </div>

      <h2 class="h">화면</h2>
      <div class="segmented" role="group" aria-label="화면 모드">${[["system", "시스템"], ["light", "라이트"], ["dark", "다크"]].map(([value, text]) =>
        `<button aria-pressed="${mode === value}" data-action="theme" data-mode="${value}">${text}</button>`).join("")}</div>

      <h2 class="h">알림 시간</h2>
      <div class="group">
        <div class="cell" style="display:block;padding:14px 16px 12px"><span class="title">나갈 시각 전에</span><br><span class="detail">여러 개를 고를 수 있어요</span>
          <div class="leads">${[30, 20, 15, 10, 5, 3, 1].map((lead) =>
            `<button class="lead tab" aria-pressed="${minutes.includes(lead)}" data-action="lead" data-lead="${lead}" ${busy ? "disabled" : ""}>${lead}분 전</button>`).join("")}</div></div>
        ${switchRow("나갈 시각에", '"지금 집에서 출발하세요"', minutes.includes(0), "lead-zero", busy)}
        ${switchRow("지각 위험 알림", '나갈 시각이 2분 지나도 출발하지 않으면 "바로 뛰어나가세요"', late, "late", busy)}
      </div>

      <h2 class="h">알림</h2>
      <div class="group">
        ${cell({ title: "시험 알림 보내기", detail: "알림은 이노치 앱을 설치한 휴대폰으로 와요", action: busy ? "" : "test-push" })}
      </div>

      <h2 class="h">계정</h2>
      <div class="group">
        ${cell({ title: "구독 관리", trail: subscribed ? "이용 중" : "미이용", action: "subscription" })}
        ${cell({ title: "로그아웃", detail: app.email || "", action: busy ? "" : "logout" })}
        ${cell({ title: "회원 탈퇴", danger: true, action: "delete-account" })}
      </div>
      <nav class="links"><a href="/terms">이용약관</a><a href="/privacy">개인정보처리방침</a><a href="mailto:lifelogics@naver.com?subject=%EC%9D%B4%EB%85%B8%EC%B9%98%20%EB%AC%B8%EC%9D%98">고객 문의</a></nav>
      <p class="credit">교통정보: 국토교통부(TAGO), 서울특별시, 경기도, 카카오. 지하철은 수도권 실시간, 그 밖의 지역은 공식 시간표 기준이에요.</p>
    </div></main>`;
}
async function save(patch, done) {
  app.busy = true;
  render();
  try {
    const data = await server.saveSetup(patch);
    app.data = data;
    if (done) toast(done);
    return true;
  } catch (error) {
    toast(error.code === "SUBSCRIPTION_REQUIRED" || error.status === 402
      ? "매일 자동 알림은 구독 후 켤 수 있어요. 구독은 이노치 앱에서 할 수 있어요." : error.message || "저장하지 못했습니다. 다시 시도해 주세요.");
    return false;
  } finally {
    app.busy = false;
    render();
  }
}
function saveAlerts(minutes, late) {
  if (!minutes.length && !late) {
    toast("알림을 하나 이상 골라 주세요.");
    return;
  }
  app.data = { ...app.data, alerts: { ...obj(app.data.alerts), minutes, late } };
  save({ alerts: { minutes, late } });
}

// ---- Place search (도착지) ---------------------------------------------------------------
function renderPlaceSearch(screen) {
  root.innerHTML = `<main class="screen">
    <header class="appbar"><button class="icon-btn" data-action="back" aria-label="뒤로">${icon("arrow_back")}</button><h1>도착지 검색</h1></header>
    <form class="pad" style="flex:0;padding-top:8px" data-form="place">
      <div class="search"><input name="q" value="${esc(screen.query || "")}" placeholder="예: 센텀시티, 판교역로 166" autocomplete="off" enterkeyhint="search" autofocus>
        <button class="icon-btn" aria-label="검색" ${screen.loading ? "disabled" : ""}>${icon("search")}</button></div></form>
    ${screen.loading ? '<div class="loading-bar"></div>' : ""}
    <div class="list">${screen.message ? `<p class="msg">${esc(screen.message)}</p>` : ""}
      ${(screen.results || []).map((item, i) => {
        const name = String(item.placeName || "").trim();
        const address = String(item.roadAddress || "").trim() || String(item.jibunAddress || item.label || "");
        return `<button class="item" data-action="pick-place" data-index="${i}">${icon("place")}<span class="grow stack"><span class="t">${esc(name || address)}</span>${name ? `<span class="s">${esc(address)}</span>` : ""}</span></button>`;
      }).join("")}</div></main>`;
  if (!screen.results?.length) root.querySelector("input")?.focus();
}
async function searchPlaces(screen, query) {
  screen.query = query;
  if (query.trim().length < 2) {
    screen.message = "두 글자 이상 입력해 주세요.";
    return render();
  }
  screen.loading = true;
  screen.message = "";
  render();
  try {
    screen.results = (await server.places(query.trim())).filter((item) => finite(item.lat) && finite(item.lng));
    screen.message = screen.results.length ? "" : "검색 결과가 없어요. 다른 이름이나 주소로 찾아 보세요.";
  } catch (error) {
    screen.message = error.message || "검색하지 못했습니다.";
  } finally {
    screen.loading = false;
    render();
  }
}

// ---- Kakao map ----------------------------------------------------------------------------
let mapsPromise = null;
function kakaoMaps() {
  if (window.kakao?.maps?.Map) return Promise.resolve(window.kakao.maps);
  mapsPromise ||= (async () => {
    const config = await server.placeConfig();
    const key = config?.maps?.kakao?.javascriptKey || "";
    if (!key) throw new Error("지도 키가 없습니다.");
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&appkey=${encodeURIComponent(key)}`;
      script.onload = () => (window.kakao?.maps ? window.kakao.maps.load(resolve) : reject(new Error()));
      script.onerror = () => reject(new Error());
      document.head.append(script);
    });
    return window.kakao.maps;
  })().catch((error) => { mapsPromise = null; throw error; });
  return mapsPromise;
}
async function mountMap(element, { lat, lng, level = 4, pins, onPin, onMoved }) {
  if (!element) return;
  try {
    const maps = await kakaoMaps();
    if (!element.isConnected) return;
    element.textContent = "";
    const map = new maps.Map(element, { center: new maps.LatLng(lat, lng), level });
    for (const pin of pins) {
      const node = document.createElement("div");
      node.innerHTML = pin.html;
      const content = node.firstElementChild;
      if (onPin) content.addEventListener("click", () => onPin(pin.id));
      new maps.CustomOverlay({ position: new maps.LatLng(pin.lat, pin.lng), content, map, yAnchor: 0.5, xAnchor: 0.5, zIndex: pin.z || 1 });
    }
    if (onMoved) {
      let first = true;
      maps.event.addListener(map, "idle", () => {
        if (first) { first = false; return; }
        const center = map.getCenter();
        onMoved(center.getLat(), center.getLng());
      });
    }
  } catch {
    if (element.isConnected) element.textContent = "지도를 불러오지 못했어요. 아래 목록에서 골라 주세요.";
  }
}

// ---- Stop picker (출발 정류장·역) ---------------------------------------------------------
function outlined(stops, index) {
  const other = stops.findIndex((item) => item.key === stops[index].oppositeKey);
  return Boolean(stops[index].oppositeKey) && other >= 0 && other < index;
}
function badge(stops, index, extra = "") {
  const stop = stops[index];
  const kind = isSubway(stop) ? "subway" : outlined(stops, index) ? "alt" : "";
  return `<span class="badge ${kind} ${extra} tab">${index + 1}</span>`;
}
function renderStopPicker(screen) {
  const hasMap = finite(screen.lat) && finite(screen.lng);
  root.innerHTML = `<main class="screen">
    <header class="appbar"><button class="icon-btn" data-action="back" aria-label="뒤로">${icon("arrow_back")}</button><h1>출발 정류장·역</h1></header>
    <form style="padding:0 16px 10px" data-form="stops">
      <div class="search">${icon("search")}<input name="q" value="${esc(screen.query || "")}" placeholder="예: 서면역, 강남역 11번 출구" autocomplete="off" enterkeyhint="search">
        <button class="icon-btn" aria-label="검색" ${screen.loading ? "disabled" : ""}>${icon("arrow_forward")}</button></div>
      <p class="caption">버스 정류장과 지하철역을 함께 찾아요 · 지도를 옮겨서도 찾을 수 있어요</p></form>
    ${hasMap ? `<div class="map"><div class="canvas" id="stop-map">지도를 불러오는 중…</div>
      <button class="btn small again" data-action="search-here" ${screen.movedTo ? "" : "hidden"}>${icon("refresh")} 이 위치에서 다시 찾기</button></div>` : ""}
    ${screen.loading ? '<div class="loading-bar"></div>' : ""}
    <div class="list" id="stop-list">${stopListHtml(screen)}</div></main>`;
  if (!hasMap && !screen.query) root.querySelector("input")?.focus();
  if (hasMap) {
    const stops = screen.stops || [];
    mountMap(document.getElementById("stop-map"), {
      lat: num(screen.lat), lng: num(screen.lng), level: 4,
      pins: stops.slice(0, 9).map((stop, i) => ({ id: stop.key, lat: num(stop.lat), lng: num(stop.lng), html: badge(stops, i, "pin-badge"), z: 10 - i })),
      onPin: (key) => openConfirm(screen, stops.find((stop) => stop.key === key)),
      onMoved: (lat, lng) => {
        screen.movedTo = { lat, lng };
        root.querySelector(".again")?.removeAttribute("hidden");
      },
    });
  }
}
function stopListHtml(screen) {
  if (screen.places?.length) {
    return `<p class="list-head">어디 근처에서 찾을까요?</p>${screen.places.map((place, i) =>
      `<button class="item" data-action="near-place" data-index="${i}">${icon("place")}<span class="grow stack"><span class="t">${esc(place.placeName || place.label || place.roadAddress || "")}</span>
        <span class="s">${esc(place.roadAddress || place.jibunAddress || "")}</span></span></button>`).join("")}`;
  }
  const stops = screen.stops || [];
  return `${screen.message ? `<p class="msg">${esc(screen.message)}</p>` : ""}${stops.map((stop, i) => {
    const subway = isSubway(stop);
    const description = screen.descriptions[stop.key];
    const heading = String(description?.heading || "").trim();
    const next = String(description?.nextStop || "").trim();
    const opposite = stops.findIndex((item) => item.key === stop.oppositeKey);
    const detail = [next && `다음 정류장: ${next}`, opposite >= 0 && `${opposite + 1}번 맞은편`, finite(stop.distanceM) && `${Math.round(num(stop.distanceM))}m`].filter(Boolean).join(" · ");
    return `<button class="item pressable" data-action="open-stop" data-index="${i}" aria-label="${i + 1}번 ${esc(stopTitle(stop))}">${badge(stops, i)}
      <span class="grow stack"><span><span class="t">${esc(stopTitle(stop))}</span><span class="k">${esc(stopKindLabel(stop))}</span></span>
      ${subway ? '<span class="s">방향은 도착지에 맞춰 자동으로 골라요</span>' : heading ? `<span class="h">→ ${esc(heading)} 방면</span>` : !description ? '<span class="s">방면 확인 중…</span>' : ""}
      ${!subway && detail ? `<span class="s">${esc(detail)}</span>` : ""}</span>${icon("chevron_right")}</button>`;
  }).join("")}`;
}
function refreshStopList(screen) {
  if (top() !== screen) return;
  const el = document.getElementById("stop-list");
  if (el) el.innerHTML = stopListHtml(screen);
}
async function searchStops(screen, query) {
  screen.query = query;
  if (query.trim().length < 2) {
    screen.message = "두 글자 이상 입력해 주세요.";
    return render();
  }
  screen.loading = true;
  screen.message = "";
  screen.places = [];
  render();
  try {
    const results = (await server.places(query.trim())).filter((item) => finite(item.lat) && finite(item.lng));
    if (!results.length) {
      screen.loading = false;
      screen.message = "검색 결과가 없어요. 역 이름이나 근처 건물로 찾아 보세요.";
      return render();
    }
    if (results.length === 1) return loadNearby(screen, num(results[0].lat), num(results[0].lng));
    screen.places = results.slice(0, 8);
    screen.loading = false;
    render();
  } catch (error) {
    screen.loading = false;
    screen.message = error.message || "검색하지 못했습니다.";
    render();
  }
}
async function loadNearby(screen, lat, lng) {
  const run = ++screen.run;
  Object.assign(screen, { lat, lng, movedTo: null, places: [], loading: true, message: "" });
  render();
  try {
    const result = await server.nearby(lat, lng);
    if (run !== screen.run) return;
    screen.stops = list(result.stops).filter((stop) => finite(stop.lat) && finite(stop.lng)).slice(0, 12);
    screen.loading = false;
    screen.message = screen.stops.length ? (Array.isArray(result.warnings) ? result.warnings.join(" ") : "") : "근처 400m 안에 정류장·역이 없어요. 지도를 옮겨 다시 찾아 보세요.";
    render();
    for (const stop of screen.stops.slice(0, 8)) {
      if (screen.descriptions[stop.key]) continue;
      if (run !== screen.run) return;
      try {
        screen.descriptions[stop.key] = await server.describe(stop);
        refreshStopList(screen);
      } catch { /* the confirm screen retries */ }
    }
  } catch (error) {
    if (run !== screen.run) return;
    screen.loading = false;
    screen.message = error.message || "주변 정류장을 불러오지 못했습니다.";
    render();
  }
}
function openStopPicker(initial) {
  const screen = { type: "stops", run: 0, descriptions: {}, stops: [], places: [], query: "", message: "정류장·역 이름이나 근처 장소를 검색해 주세요." };
  if (initial && finite(initial.lat) && finite(initial.lng)) {
    screen.query = initial.stationName || "";
    screen.message = "";
    setTimeout(() => loadNearby(screen, num(initial.lat), num(initial.lng)));
  }
  return open(screen);
}
async function openConfirm(picker, stop) {
  if (!stop) return;
  const chosen = await open({ type: "confirm", stop, nearby: picker.stops, descriptions: picker.descriptions, error: "" });
  if (chosen && top() === picker) pop(chosen);
}

// ---- Stop confirm -------------------------------------------------------------------------
function oppositeOf(screen) {
  return screen.stop.oppositeKey ? screen.nearby.find((stop) => stop.key === screen.stop.oppositeKey) || null : null;
}
function renderConfirm(screen) {
  const stop = screen.stop;
  const subway = isSubway(stop);
  const opposite = oppositeOf(screen);
  const description = screen.descriptions[stop.key];
  const oppositeDescription = opposite ? screen.descriptions[opposite.key] : null;
  const heading = String(description?.heading || "").trim();
  const next = String(description?.nextStop || "").trim();
  const routes = list(description?.routes);
  const directions = Array.isArray(description?.directions) ? description.directions.map(String) : [];
  const number = String(stop.stationNumber || stop.arsId || "").trim();
  const oppositeNumber = String(opposite?.stationNumber || opposite?.arsId || "").trim();
  const oppositeHeading = String(oppositeDescription?.heading || "").trim();
  root.innerHTML = `<main class="screen">
    <div class="confirm-map"><div class="canvas" id="confirm-map"></div>
      <button class="icon-btn float-back" data-action="back" aria-label="뒤로">${icon("arrow_back")}</button></div>
    <section class="confirm-sheet">
      <div class="grow">
        <h2>${esc(stopTitle(stop))}<small class="tab">${esc(subway ? stop.lineName || "" : number ? `정류장 번호 ${number}` : "")}</small></h2>
        ${subway
          ? `<p class="way">방향은 도착지에 맞춰 자동으로 골라요</p>${directions.length ? `<p class="muted" style="margin:2px 0 0;font-size:14px">${esc(directions.map((d) => `${d} 방면`).join(" · "))} 열차가 서요</p>` : ""}
             ${description?.timetable === true ? `<p style="margin:6px 0 0">${basisChip("timetable")}</p>` : ""}`
          : `${heading ? `<p class="way">→ ${esc(heading)} 방면으로 가는 쪽</p>` : ""}
             <p class="muted" style="margin:2px 0 0;font-size:14px">${esc([next && `다음 정류장 ${next}`, "정류장 표지판의 번호와 같은지 확인하세요"].filter(Boolean).join(" · "))}</p>`}
        ${screen.error ? `<p class="danger" style="margin:6px 0 0;font-size:14px">${esc(screen.error)}</p>` : ""}
        ${screen.loading ? '<div class="loading-bar" style="margin-top:12px"></div>' : ""}
        ${!subway && routes.length ? `<p class="muted" style="font-size:14px;font-weight:700;margin:14px 0 8px">여기 서는 버스</p>
          <div class="chips">${routes.slice(0, 16).map((route) => `<span class="chip">${esc(route.routeNumber)}</span>`).join("")}</div>` : ""}
        ${opposite ? `<button class="swap pressable" data-action="swap-opposite">${icon("swap_horiz")}<span class="stack"><b>반대 방향이에요</b>
          <span class="muted" style="font-size:13px">${esc(`${oppositeNumber ? `맞은편 ${oppositeNumber}` : "맞은편 정류장"}${oppositeHeading ? ` · ${oppositeHeading} 방면으로 바꾸기` : "으로 바꾸기"}`)}</span></span></button>` : ""}
      </div>
      <button class="btn" style="margin-top:16px" data-action="confirm-stop">${subway ? "이 역에서 출발" : "이 정류장에서 출발"}</button>
    </section></main>`;
  const pins = [{ id: stop.key, lat: num(stop.lat), lng: num(stop.lng), html: '<div class="pin-here"></div>', z: 2 }];
  if (opposite) pins.push({ id: opposite.key, lat: num(opposite.lat), lng: num(opposite.lng), html: `<div class="pin-label">${esc(oppositeNumber ? `맞은편 ${oppositeNumber}` : "맞은편")}</div>`, z: 1 });
  mountMap(document.getElementById("confirm-map"), {
    lat: num(stop.lat), lng: num(stop.lng), level: 2, pins,
    onPin: (id) => { if (id !== stop.key) swapOpposite(screen); },
  });
  if (!screen.described) describeConfirm(screen);
}
async function describeConfirm(screen) {
  screen.described = true;
  const opposite = oppositeOf(screen);
  const missing = [screen.stop, opposite].filter((stop) => stop && !screen.descriptions[stop.key]);
  if (!missing.length) return;
  screen.loading = true;
  screen.error = "";
  render();
  for (const stop of missing) {
    try {
      screen.descriptions[stop.key] = await server.describe(stop);
    } catch (error) {
      if (stop.key === screen.stop.key) screen.error = error.message || "방면 정보를 불러오지 못했어요.";
    }
  }
  screen.loading = false;
  if (top() === screen) render();
}
function swapOpposite(screen) {
  const opposite = oppositeOf(screen);
  if (!opposite) return;
  screen.stop = opposite;
  screen.error = "";
  screen.described = false;
  render();
}
function confirmResult(stop) {
  const result = {};
  for (const key of ["provider", "stationId", "stationName", "arsId", "cityCode", "nodeId", "lineName", "stationNumber", "mode"]) result[key] = String(stop[key] ?? "");
  result.lat = num(stop.lat);
  result.lng = num(stop.lng);
  return result;
}

// ---- Events --------------------------------------------------------------------------------
root.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  const screen = top();
  switch (action) {
    case "reload": app.error = ""; render(); return load();
    case "login": return login(target.dataset.provider);
    case "settings": if (app.data) push({ type: "settings" }); return;
    case "back": return pop();
    case "manual-refresh": return manualRefresh();
    case "departed":
      return run(async () => {
        try { await server.departed(); } catch { /* no alarm ringing right now */ }
        return server.setToday(false, true);
      }, "오늘 남은 알림을 멈췄어요. 잘 다녀오세요!");
    case "toggle-today": {
      const armed = obj(app.data?.today).armed === true;
      return run(() => server.setToday(!armed), armed ? "오늘 출발 알림을 껐어요." : "오늘 출발 알림을 켰어요.");
    }
    // Onboarding
    case "onboard-back": app.onboard.step = Math.max(0, app.onboard.step - 1); return render();
    case "onboard-next": app.onboard.step = Math.min(STEPS - 1, app.onboard.step + 1); return render();
    case "onboard-finish": return finishOnboarding();
    case "walk": {
      const o = onboardState();
      o.walk = Math.min(60, Math.max(0, o.walk + Number(target.dataset.delta)));
      return render();
    }
    case "pick-stop": {
      const inSettings = screen?.type === "settings";
      const current = inSettings ? obj(obj(app.data.setup).boarding) : app.onboard?.boarding;
      const stop = await openStopPicker(current && current.stationName ? current : null);
      if (!stop) return;
      if (inSettings) return save({ boarding: boardingPayload(stop) }, "출발 정류장·역을 바꿨어요.");
      onboardState().boarding = stop;
      return render();
    }
    case "pick-destination": {
      const inSettings = screen?.type === "settings";
      const place = await open({ type: "place", results: [], message: "회사·학교 이름이나 주소를 입력해 주세요." });
      if (!place) return;
      if (inSettings) return save({ destination: place }, "도착지를 바꿨어요.");
      onboardState().destination = place;
      return render();
    }
    case "pick-place": {
      const item = screen.results[Number(target.dataset.index)];
      const name = String(item.placeName || "").trim();
      const address = String(item.roadAddress || "").trim() || String(item.jibunAddress || item.label || "");
      return pop({ address, label: name || address, lat: num(item.lat), lng: num(item.lng) });
    }
    // Stop picker
    case "near-place": {
      const place = screen.places[Number(target.dataset.index)];
      return loadNearby(screen, num(place.lat), num(place.lng));
    }
    case "search-here": return screen.movedTo && loadNearby(screen, screen.movedTo.lat, screen.movedTo.lng);
    case "open-stop": return openConfirm(screen, screen.stops[Number(target.dataset.index)]);
    case "swap-opposite": return swapOpposite(screen);
    case "confirm-stop": return pop(confirmResult(screen.stop));
    // Settings
    case "settings-walk": {
      const setup = obj(app.data.setup);
      const walk = Math.min(60, Math.max(0, (screen.walk ?? Math.trunc(num(setup.boardingAccessMin) || 5)) + Number(target.dataset.delta)));
      screen.walk = walk;
      render();
      clearTimeout(screen.walkTimer);
      screen.walkTimer = setTimeout(async () => { await save({ boardingAccessMin: walk }); screen.walk = undefined; }, 700);
      return;
    }
    case "repeat-toggle": {
      const on = obj(app.data.repeat).enabled === true;
      if (!on && obj(app.data.subscription).active !== true) return toast("매일 자동 알림은 구독 후 켤 수 있어요. 구독은 이노치 앱에서 할 수 있어요.");
      return save({ repeat: { enabled: !on } }, on ? "매일 자동 알림을 껐어요. 오늘 하루만 알려 드려요." : "매일 자동 알림을 켰어요.");
    }
    case "repeat-day": {
      const days = new Set((obj(app.data.repeat).days || [1, 2, 3, 4, 5]).map(Number));
      const day = Number(target.dataset.day);
      if (!days.delete(day)) days.add(day);
      if (!days.size) return toast("반복할 요일을 하나 이상 골라 주세요.");
      return save({ repeat: { days: [...days].sort() } });
    }
    case "repeat-holidays": return save({ repeat: { skipHolidays: !(obj(app.data.repeat).skipHolidays !== false) } });
    case "theme": setThemeMode(target.dataset.mode); return render();
    case "lead":
    case "lead-zero": {
      const alerts = obj(app.data.alerts);
      const minutes = new Set((Array.isArray(alerts.minutes) ? alerts.minutes : [10, 5, 0]).map(Number));
      const lead = action === "lead-zero" ? 0 : Number(target.dataset.lead);
      if (!minutes.delete(lead)) minutes.add(lead);
      return saveAlerts([...minutes].sort((a, b) => b - a), alerts.late === true);
    }
    case "late": {
      const alerts = obj(app.data.alerts);
      return saveAlerts((Array.isArray(alerts.minutes) ? alerts.minutes : [10, 5, 0]).map(Number), alerts.late !== true);
    }
    case "test-push":
      app.busy = true;
      render();
      try {
        await server.testPush();
        toast("시험 알림을 보냈어요. 휴대폰에 도착하는지 확인해 주세요.");
      } catch (error) {
        toast(error.message || "보내지 못했습니다.");
      } finally {
        app.busy = false;
        render();
      }
      return;
    case "subscription":
      return toast(obj(app.data.subscription).active === true ? "구독 중이에요. 구독 변경·해지는 구글 플레이에서 할 수 있어요." : "구독은 이노치 안드로이드 앱에서 할 수 있어요.");
    case "logout":
      try { await server.logout(); } catch { /* the session may already be gone */ }
      location.replace("/");
      return;
    case "delete-account": location.href = "/account/delete"; return;
    default:
  }
});
// Desktop browsers do not open the time picker on a click by themselves.
root.addEventListener("click", (event) => {
  const input = event.target.closest('input[type="time"]');
  if (input && !input.disabled) try { input.showPicker?.(); } catch { /* focus is enough */ }
});
root.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  const query = new FormData(form).get("q") || "";
  form.querySelector("input")?.blur();
  if (form.dataset.form === "place") searchPlaces(top(), String(query));
  if (form.dataset.form === "stops") searchStops(top(), String(query));
});
root.addEventListener("change", (event) => {
  const input = event.target.closest("[data-input]");
  if (!input || !/^\d{2}:\d{2}$/.test(input.value)) return;
  if (input.dataset.input === "arrival") onboardState().arrival = input.value;
  if (input.dataset.input === "settings-arrival") save({ requiredArrivalTime: input.value }, "도착 시각을 바꿨어요.");
  if (input.dataset.input === "today-arrival") run(() => server.saveSetup({ requiredArrivalTime: input.value }), `도착 시각을 바꿨어요 · ${koreanTime(input.value)}`);
});

history.replaceState({ depth: 0 }, "");
start();

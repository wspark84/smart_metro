// Public legal pages required by Google Play / App Store and Korean law:
//   /privacy          개인정보처리방침
//   /terms            이용약관
//   /account/delete   웹 계정 삭제 (Google Play "계정 삭제 URL")
// Operator details supplied by 대표 (2026-10-13). Blank values would render as "등록 예정".

export const OPERATOR = Object.freeze({
  serviceName: "이노치 (이거 놓치면 지각)",
  businessName: "라이프로직스",
  representative: "박우석",
  registrationNumber: "214-59-00854",
  mailOrderNumber: "제2025-용인수지-1706호",
  address: "경기도 화성시 동탄구 동탄중심상가1길 36, 8층 801-137A호(반송동, 원영빌딩)",
  email: "lifelogics@naver.com",
  privacyOfficer: "박우석 (대표)",
  effectiveDate: "2026-11-01",
});

export const RETURN_COOKIE = "smart-metro-return";
export const RETURN_PATHS = new Set(["/account/delete"]);

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const field = (value) => esc(value || "등록 예정");

function layout(title, body, script = "") {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · 이노치</title><meta name="robots" content="index,follow">
<style>
:root{--bg:#f6f4f3;--fg:#1d1b1a;--muted:#5f5955;--card:#fff;--line:#e4dfdc;--accent:#d94a1e;--danger:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#141210;--fg:#f1ece8;--muted:#b4aca6;--card:#1f1c1a;--line:#36302c;--accent:#ff7a4d;--danger:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 64px}h1{font-size:1.6rem;line-height:1.3;margin:0 0 4px}h2{font-size:1.1rem;margin:32px 0 8px;padding-top:16px;border-top:1px solid var(--line)}
p,li{color:var(--fg)}.muted{color:var(--muted);font-size:.92rem}table{width:100%;border-collapse:collapse;font-size:.92rem;margin:8px 0}th,td{border:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}th{background:var(--card)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin:16px 0}button{font:inherit;border:0;border-radius:10px;padding:12px 16px;cursor:pointer;width:100%;margin:6px 0;background:var(--line);color:var(--fg)}
button.danger{background:var(--danger);color:#fff}button:disabled{opacity:.5;cursor:not-allowed}input[type=text]{font:inherit;width:100%;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
label{display:flex;gap:8px;align-items:flex-start;margin:12px 0}nav{margin-top:40px;font-size:.92rem}nav a{color:var(--accent);margin-right:16px}#status{min-height:1.5em;font-weight:600}
</style></head><body><main>${body}
<nav><a href="/privacy">개인정보처리방침</a><a href="/terms">이용약관</a><a href="/account/delete">계정 삭제</a></nav>
</main>${script}</body></html>`;
}

function operatorTable() {
  return `<table><tbody>
<tr><th>서비스명</th><td>${esc(OPERATOR.serviceName)}</td></tr>
<tr><th>상호</th><td>${field(OPERATOR.businessName)}</td></tr>
<tr><th>대표자</th><td>${field(OPERATOR.representative)}</td></tr>
<tr><th>사업자등록번호</th><td>${field(OPERATOR.registrationNumber)}</td></tr>
<tr><th>통신판매업 신고번호</th><td>${field(OPERATOR.mailOrderNumber)}</td></tr>
<tr><th>주소</th><td>${field(OPERATOR.address)}</td></tr>
<tr><th>문의</th><td>${field(OPERATOR.email)}</td></tr>
</tbody></table>`;
}

export function privacyPage() {
  return layout("개인정보처리방침", `
<h1>개인정보처리방침</h1>
<p class="muted">시행일 ${esc(OPERATOR.effectiveDate)}</p>
<p>${field(OPERATOR.businessName)}(이하 “회사”)는 「개인정보 보호법」 등 관련 법령을 지키며, ${esc(OPERATOR.serviceName)} 서비스(앱과 웹, 이하 “서비스”)를 이용하는 분의 개인정보를 다음과 같이 처리합니다.</p>

<h2>1. 처리하는 개인정보와 목적</h2>
<table><thead><tr><th>구분</th><th>항목</th><th>목적</th></tr></thead><tbody>
<tr><td>회원 가입·로그인 (필수)</td><td>소셜 로그인 식별값, 이메일 주소, 이름(닉네임), 로그인 제공자(구글·카카오·네이버·애플)</td><td>본인 식별, 계정 관리, 문의 응대</td></tr>
<tr><td>통근 알람 설정 (필수)</td><td>출발지·목적지로 입력한 장소명·주소와 좌표, 이용 정류장·역·노선, 도착 목표 시각, 요일·일정, 알람 선호(소리·진동 등)</td><td>놓치면 늦는 교통편 계산과 알람 제공</td></tr>
<tr><td>알림 전송 (필수)</td><td>기기 푸시 토큰(FCM·APNs·웹 푸시 구독 정보), 기기 종류·이름, 알람 발송·확인 기록</td><td>알람 전달, 전달 실패 재시도, 오류 확인</td></tr>
<tr><td>유료 구독 (구독 시)</td><td>스토어 구매 토큰, 상품·상태·만료일, 자동 갱신 여부</td><td>구독 확인, 결제 분쟁 대응</td></tr>
<tr><td>자동 수집</td><td>접속 일시, IP 주소, 오류 기록</td><td>보안, 부정 이용 방지, 장애 대응</td></tr>
</tbody></table>
<p>회사는 휴대전화의 GPS 등 위치정보를 수집하지 않습니다. 출발지·목적지는 이용자가 직접 입력한 정보만 사용합니다. 결제 카드 정보는 Google Play·App Store가 처리하며 회사는 받지 않습니다.</p>

<h2>2. 보유 기간과 파기</h2>
<ul>
<li>회원 정보와 알람 설정·기록: <b>회원 탈퇴 시 즉시 삭제</b>합니다. 데이터베이스 백업에 남은 사본은 백업 보관 주기(최대 30일)가 지나면 자동 삭제됩니다.</li>
<li>알람 발송·오류 기록: 서비스 운영을 위해 최근 기록만 보관하며 탈퇴 시 함께 삭제합니다.</li>
<li>구독 결제 기록: 「전자상거래 등에서의 소비자보호에 관한 법률」에 따라 <b>5년</b> 보관합니다. 탈퇴 시 이메일·주소·원본 구매 토큰은 삭제하고, 이용자를 직접 알아볼 수 없도록 변환한 값(해시)과 상품·상태·기간만 별도 보관한 뒤 기간이 지나면 파기합니다.</li>
<li>전자적 파일은 복구할 수 없는 방법으로 삭제합니다.</li>
</ul>

<h2>3. 처리 위탁과 국외 이전</h2>
<p>서비스 제공을 위해 아래 업체에 처리를 맡기며, 일부는 해외에 저장·처리됩니다. 이용자는 회원 탈퇴로 국외 이전을 거부할 수 있으나, 이 경우 서비스를 이용할 수 없습니다.</p>
<table><thead><tr><th>받는 자 (국가)</th><th>항목</th><th>목적</th><th>이전 방법·시점</th><th>보유 기간</th></tr></thead><tbody>
<tr><td>Supabase Inc. (미국 법인, 데이터 저장 위치: 대한민국 서울 리전)</td><td>1항의 회원·알람·구독 정보</td><td>로그인, 데이터 저장</td><td>서비스 이용 시 네트워크 전송</td><td>탈퇴 시까지</td></tr>
<tr><td>Vercel Inc. (미국, 서버 실행 지역 서울)</td><td>요청 처리 중의 정보, 접속 기록</td><td>서버 운영</td><td>서비스 이용 시 네트워크 전송</td><td>처리 후 즉시 또는 로그 보관 기간</td></tr>
<tr><td>Google LLC (미국)</td><td>푸시 토큰, 알람 내용, 구매 토큰, 구글 로그인 정보</td><td>푸시 전송(Firebase), 구독 결제 확인(Google Play), 로그인</td><td>알람·결제·로그인 시 네트워크 전송</td><td>각 서비스 정책에 따름</td></tr>
<tr><td>Apple Inc. (미국)</td><td>푸시 토큰, 알람 내용, 애플 로그인 정보, 구매 정보</td><td>iPhone 알림, 애플 로그인, App Store 결제</td><td>알람·결제·로그인 시 네트워크 전송</td><td>각 서비스 정책에 따름</td></tr>
<tr><td>(주)카카오 (대한민국)</td><td>장소 검색어, 출발·도착 좌표, 카카오 로그인 정보</td><td>장소 검색, 대중교통 경로 계산, 로그인</td><td>검색·경로 조회 시</td><td>처리 후 즉시</td></tr>
<tr><td>네이버(주) (대한민국)</td><td>네이버 로그인 정보</td><td>로그인</td><td>로그인 시</td><td>처리 후 즉시</td></tr>
</tbody></table>
<p class="muted">국토교통부(TAGO)·서울특별시·경기도 교통정보 API에는 정류장·역·노선 식별값만 보내며 개인정보를 보내지 않습니다.</p>

<h2>4. 제3자 제공</h2>
<p>회사는 이용자의 동의나 법령에 근거가 있는 경우를 제외하고 개인정보를 제3자에게 제공하지 않습니다.</p>

<h2>5. 이용자의 권리</h2>
<p>이용자는 언제든지 개인정보의 열람·정정·삭제·처리정지를 요구할 수 있습니다. 앱의 설정 화면 또는 <a href="/account/delete">계정 삭제 페이지</a>에서 직접 탈퇴할 수 있고, 아래 연락처로 요청할 수도 있습니다. 회사는 지체 없이 조치합니다.</p>

<h2>6. 안전성 확보 조치</h2>
<ul><li>전송 구간 암호화(HTTPS), 계정별 데이터 접근 제한(행 단위 보안)</li><li>비밀키 분리 보관, 운영자 기능 접근 제한</li><li>접속 기록 보관과 이상 접근 점검</li></ul>

<h2>7. 만 14세 미만</h2>
<p>서비스는 만 14세 미만 아동의 회원 가입을 받지 않습니다.</p>

<h2>8. 개인정보 보호책임자</h2>
<p>책임자: ${field(OPERATOR.privacyOfficer)} · 연락처: ${field(OPERATOR.email)}</p>
<p class="muted">개인정보 침해 신고: 개인정보침해신고센터(privacy.kisa.or.kr, 국번 없이 118), 개인정보분쟁조정위원회(kopico.go.kr, 1833-6972), 대검찰청(spo.go.kr, 1301), 경찰청(ecrm.police.go.kr, 182)</p>

<h2>9. 변경</h2>
<p>이 방침을 바꾸는 경우 시행 7일 전(이용자에게 불리한 변경은 30일 전) 앱 또는 이 페이지로 알립니다.</p>

<h2>운영자 정보</h2>${operatorTable()}`);
}

export function termsPage() {
  return layout("이용약관", `
<h1>이용약관</h1>
<p class="muted">시행일 ${esc(OPERATOR.effectiveDate)}</p>

<h2>제1조 (목적)</h2>
<p>이 약관은 ${field(OPERATOR.businessName)}(이하 “회사”)가 제공하는 ${esc(OPERATOR.serviceName)}(이하 “서비스”)의 이용 조건과 절차, 회사와 이용자의 권리·의무를 정합니다.</p>

<h2>제2조 (서비스 내용)</h2>
<ol>
<li>서비스는 이용자가 입력한 출발지·목적지·도착 목표 시각을 바탕으로, 선택한 버스·지하철을 놓치면 늦는 시점을 계산해 알람으로 알려 줍니다.</li>
<li>버스 도착정보는 국토교통부(TAGO)·서울특별시·경기도 등 공공기관이 제공하는 실시간 정보를 사용합니다. 일부 지역은 실시간 정보가 제공되지 않을 수 있으며, 앱에서 해당 사실을 표시합니다.</li>
<li>지하철은 수도권 일부 노선에서 실시간 도착정보를, 그 밖의 지역에서는 운영기관의 <b>공식 시간표</b>를 사용합니다. 시간표 기준 정보는 앱에 “시간표 기준”으로 표시하며 실제 운행과 다를 수 있습니다.</li>
</ol>

<h2>제3조 (회원 가입과 탈퇴)</h2>
<ol><li>이용자는 구글·카카오·네이버·애플 계정으로 가입합니다. 만 14세 미만은 가입할 수 없습니다.</li>
<li>이용자는 앱 설정 또는 <a href="/account/delete">계정 삭제 페이지</a>에서 언제든지 탈퇴할 수 있으며, 탈퇴 시 개인정보는 개인정보처리방침에 따라 삭제됩니다.</li></ol>

<h2>제4조 (유료 서비스)</h2>
<ol>
<li>요일 반복 일정 알림은 월 5,000원(부가세 포함)의 정기 구독 서비스입니다. 홈 화면의 일회성 알림은 무료입니다.</li>
<li>구독은 Google Play 또는 App Store를 통해 결제되며, 이용자가 해지하지 않으면 매월 자동 갱신됩니다.</li>
<li>해지는 각 스토어의 구독 관리 화면에서 할 수 있고, 해지해도 이미 결제한 기간이 끝날 때까지 이용할 수 있습니다. <b>회원 탈퇴만으로는 구독이 해지되지 않습니다.</b></li>
<li>청약철회와 환불은 「전자상거래 등에서의 소비자보호에 관한 법률」 및 각 스토어의 환불 정책에 따릅니다. 결제 후 7일 이내 구독 기능을 사용하지 않은 경우 청약철회를 요청할 수 있습니다.</li>
</ol>

<h2>제5조 (이용자의 의무)</h2>
<p>이용자는 타인의 계정을 사용하거나, 서비스를 비정상적으로 대량 호출하거나, 서비스 운영을 방해해서는 안 됩니다.</p>

<h2>제6조 (서비스의 변경·중단)</h2>
<p>회사는 공공 교통정보 제공 중단, 설비 점검, 천재지변 등의 사유로 서비스를 일시 중단할 수 있으며, 가능한 경우 미리 알립니다.</p>

<h2>제7조 (책임의 제한)</h2>
<ol>
<li>교통정보는 외부 기관이 제공하는 값이며, 교통 상황·통신 상태·기기 설정(무음, 배터리 절약, 알림 차단 등)에 따라 알람이 늦거나 오지 않을 수 있습니다. 중요한 일정은 이용자가 직접 한 번 더 확인해 주십시오.</li>
<li>회사는 회사의 고의 또는 중대한 과실이 없는 한, 외부 정보의 오류나 지연으로 인한 손해에 대해 책임을 지지 않습니다.</li>
</ol>

<h2>제8조 (분쟁 해결)</h2>
<p>이 약관은 대한민국 법률을 따르며, 분쟁은 민사소송법상 관할 법원에서 해결합니다.</p>

<h2>운영자 정보</h2>${operatorTable()}`);
}

export function accountDeletePage() {
  return layout("계정 삭제", `
<h1>계정 삭제</h1>
<p>${esc(OPERATOR.serviceName)} 계정과 저장된 정보를 삭제합니다. 앱에서는 <b>설정 → 계정 → 회원 탈퇴</b>에서도 할 수 있습니다.</p>
<div class="card">
<p><b>삭제되는 정보</b>: 로그인 정보, 출발지·목적지·통근 일정, 알람 설정과 기록, 기기 알림 토큰</p>
<p><b>보관되는 정보</b>: 유료 구독 결제 기록은 법령에 따라 이용자를 알아볼 수 없는 형태로 5년간 보관 후 파기합니다.</p>
<p><b>구독 중이라면</b>: 탈퇴만으로는 결제가 멈추지 않습니다. 먼저 Google Play 또는 App Store의 구독 관리에서 해지해 주세요.</p>
</div>
<div class="card" id="login-step" hidden>
<p>본인 확인을 위해 가입한 계정으로 로그인해 주세요.</p>
<button type="button" data-provider="google">구글로 로그인</button>
<button type="button" data-provider="kakao">카카오로 로그인</button>
<button type="button" data-provider="naver">네이버로 로그인</button>
</div>
<div class="card" id="delete-step" hidden>
<p id="who"></p>
<label for="confirm-input">확인을 위해 <b>탈퇴</b>를 입력해 주세요.</label>
<input type="text" id="confirm-input" autocomplete="off" inputmode="text">
<label id="ack-row" hidden><input type="checkbox" id="ack-subscription"> 구독을 스토어에서 해지했거나, 해지하지 않으면 결제가 계속될 수 있음을 확인했습니다.</label>
<button type="button" class="danger" id="delete-button" disabled>계정 영구 삭제</button>
</div>
<p id="status" role="status" aria-live="polite"></p>
<p class="muted">로그인이 어려우면 ${field(OPERATOR.email)}로 가입한 이메일과 함께 삭제를 요청해 주세요. 확인 후 지체 없이 처리합니다.</p>`,
  `<script>
(function(){
  var status=document.getElementById('status'),login=document.getElementById('login-step'),step=document.getElementById('delete-step');
  var input=document.getElementById('confirm-input'),button=document.getElementById('delete-button'),ackRow=document.getElementById('ack-row'),ack=document.getElementById('ack-subscription');
  function say(t){status.textContent=t;}
  function json(r){return r.json().catch(function(){return {};}).then(function(b){return {ok:r.ok,status:r.status,body:b};});}
  fetch('/api/auth/session',{credentials:'same-origin'}).then(json).then(function(r){
    if(r.body&&r.body.authenticated){step.hidden=false;document.getElementById('who').textContent=(r.body.user&&r.body.user.email?r.body.user.email:'로그인한 계정')+' 계정을 삭제합니다.';}
    else login.hidden=false;
  }).catch(function(){login.hidden=false;});
  Array.prototype.forEach.call(document.querySelectorAll('[data-provider]'),function(b){b.addEventListener('click',function(){
    document.cookie='${RETURN_COOKIE}=/account/delete; Max-Age=600; Path=/; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');
    say('로그인 화면으로 이동합니다…');
    fetch('/api/auth/oauth/start',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:b.getAttribute('data-provider')})})
      .then(json).then(function(r){if(r.ok&&r.body.authorizationUrl)location.href=r.body.authorizationUrl;else say(r.body.error||'로그인을 시작하지 못했습니다.');});
  });});
  input.addEventListener('input',function(){button.disabled=input.value.trim()!=='탈퇴';});
  button.addEventListener('click',function(){
    button.disabled=true;say('삭제하는 중…');
    fetch('/api/account/delete',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:input.value.trim(),acknowledgeSubscription:ack.checked})})
      .then(json).then(function(r){
        if(r.ok){step.hidden=true;say('계정과 정보가 삭제되었습니다. 이용해 주셔서 감사합니다.');return;}
        if(r.body.code==='SUBSCRIPTION_ACTIVE'){ackRow.hidden=false;}
        say(r.body.error||'삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.');button.disabled=input.value.trim()!=='탈퇴';
      }).catch(function(){say('네트워크 오류로 삭제하지 못했습니다.');button.disabled=false;});
  });
})();
</script>`);
}

const PAGES = { "/privacy": privacyPage, "/terms": termsPage, "/account/delete": accountDeletePage };

export function renderLegalPage(pathname) {
  const path = String(pathname || "").replace(/\/+$/, "") || "/";
  const page = PAGES[path];
  return page ? page() : null;
}

// Post-login redirect for the web deletion page only (never an open redirect).
export function readReturnPath(cookieHeader = "") {
  const match = String(cookieHeader).split(";").map((p) => p.trim()).find((p) => p.startsWith(`${RETURN_COOKIE}=`));
  const value = match ? decodeURIComponent(match.slice(RETURN_COOKIE.length + 1)) : "";
  return RETURN_PATHS.has(value) ? value : "/";
}

const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function subscriptionPaywall({loading=false,available=false,error=''}={}) {
  return `<section class="stack-panel" aria-label="일정 구독 안내">
    <h2>매번 입력하지 말고, 출근 알림을 자동으로</h2>
    <p>출발지와 도착 시간, 반복 요일을 일정에 등록하면 지정한 날마다 교통편에 맞춰 출발 시간을 계산하고 알려드려요.</p>
    <p><strong>일정 자동 알림은 월 5,000원 유료 구독 기능입니다.</strong></p>
    <p>유료 구독을 하시겠어요? 홈에서 직접 설정하는 일회성 알림은 로그인만 하면 계속 무료입니다.</p>
    <p>매월 자동 갱신됩니다. 해지하면 다음 결제부터 중단되며, 결제한 기간까지 이용할 수 있습니다.</p>
    <button class="primary-button" data-action="subscribe-schedules" ${loading||!available?'disabled':''}>${loading?'구독 상태 확인 중…':available?'안드로이드 앱에서 구독하기':'구독 결제 준비 중'}</button>
    <button class="secondary-button" data-action="subscription-refresh">이미 결제했어요 · 다시 확인</button>
    <button class="secondary-button" data-action="goto" data-screen="home">무료로 홈 사용하기</button>
    ${error?`<p role="status">${escape(error)}</p>`:''}
    <p>구매 복원과 구독 관리는 이노치 앱의 구독 화면에서 할 수 있습니다.</p>
  </section>`;
}

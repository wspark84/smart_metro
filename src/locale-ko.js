import { KOREAN_COPY } from './locale-catalog.js';
// Presentation only: never use these labels as stored values, CSS classes or API identifiers.
const labels = {
  LIVE: '실시간', DEMO: '예시', UNAVAILABLE: '정보 없음', IDLE: '대기', STALE: '이전 정보', CACHE: '최근 저장 정보', FRESH: '최신 정보', ON: '켜짐', OFF: '꺼짐', INFO: '안내', LOCAL: '이 브라우저', SERVER: '계정별 서버',
  ACTIVE: '진행 중', PAUSED: '일시 중지', READY: '준비됨', PENDING: '대기 중', LOADING: '불러오는 중', SAVING: '저장 중', SAVED: '저장됨', SYNCING: '동기화 중', SYNCED: '동기화됨', ERROR: '오류',
  UNKNOWN: '확인 불가', NONE: '없음', ALL: '전체', LOW: '낮음', MEDIUM: '보통', HIGH: '높음', ELEVATED: '주의', WATCH: '주의', CONSERVATIVE: '보수적 판단', NORMAL: '일반', BOOSTED: '강화', PRECHECK: '사전 점검',
  GREEN: '여유', YELLOW: '정시 가능', ORANGE: '서둘러야 함', RED: '지각 위험', 'MISS RISK': '놓칠 위험', LATE: '지각 예상', NEXT: '다음 차량',
  'NO DATA': '정보 없음', 'ONE SOURCE': '제공처 1곳', 'KEY MISSING': '연결 키 없음', 'WEEKDAY-WINDOW': '요일·시간대', WINDOW: '알람 시간대', 'ALL-DAY': '하루 전체',
  ANDROID: '안드로이드', IOS: '아이폰', WEB: '웹 브라우저', SEOUL: '서울시', GYEONGGI: '경기도', NATIONAL: '전국', TAGO: '국토교통부 TAGO',
  'SEOUL DIRECT': '서울시 버스정보', 'GYEONGGI DIRECT (COMPARE ACCURACY)': '경기도 버스정보(비교용)', 'TAGO (ACCURACY-FIRST CANDIDATE)': '국토교통부 TAGO',
  FCM: '구글 푸시(FCM)', APNS: '애플 푸시(APNs)', 'WEB-PUSH': '웹 푸시', WEB_PUSH: '웹 푸시',
  PREVIEW: '미리보기', EXECUTE: '실제 전송', DRY_RUN: '모의 실행', DRY_RUN_READY: '모의 요청 준비됨', MANUAL: '직접 실행', AUTO: '자동', TEST: '시험', RETRY: '재시도',
  SENT: '전송됨', DELIVERED: '전달 완료', BLOCKED: '차단됨', FAILED: '실패', DISABLED: '꺼짐', QUEUED: '대기 중', SKIPPED: '생략', SIMULATED: '모의 실행', SIMULATED_SENT: '모의 전송 완료', TRIGGERED: '알람 발생',
  RETRY_PENDING: '재시도 대기', 'RETRY PENDING': '재시도 대기', 'PREVIEW ONLY': '미리보기만 실행', 'SIMULATED ONLY': '모의 실행만 확인', 'SERVER ONLY': '서버 처리만 확인',
  SERVICE_ACCOUNT: '서비스 계정', 'SERVICE-ACCOUNT': '서비스 계정', MANUAL_BEARER: '직접 입력한 인증 토큰', 'MANUAL-BEARER': '직접 입력한 인증 토큰',
  CACHED: '저장된 토큰', 'CACHE-HIT': '저장된 정보 사용', 'CACHE-MISS': '새로 조회', EXPIRED: '만료', MISSING: '없음', VALID: '사용 가능', INVALID: '올바르지 않음', UNCONFIGURED: '미설정',
  FCM_REGISTRATION: 'FCM 등록 토큰', APNS_HEX: 'APNs 기기 토큰', WEB_ENDPOINT: '웹 알림 주소', WEB_SUBSCRIPTION: '웹 알림 구독', OPAQUE: '기타 토큰',
  SLOW: '느리게', FAST: '빠르게', FASTEST: '가장 빠르게', WARMUP: '사전 확인', COOLDOWN: '다음 조회 대기', STEADY: '기본',
  'REINFORCED MONITORING ACTIVE': '강화 확인 중', 'BOOSTED FIRST ALARM ARMED': '첫 알림 강화 설정됨', 'HIGH-WATCH ROUTE PROTECTION': '주의 노선 보호 설정',
  'Server event': '서버 기록', 'Dispatch bundle': '알림 전송 묶음', 'Dispatch execution': '전송 처리', 'Push gateway': '푸시 전송', 'Retry queue': '재시도 대기열', Trace: '처리 기록',
  'UNBLOCK PUSH PATH': '푸시 차단 원인 확인', 'CHECK LAST FAILURE': '최근 실패 확인', 'WATCH NEXT RETRY': '다음 재시도 확인', 'CHECK ALERT PATH': '알림 전송 과정 확인',
  SINGLE: '제공처 1곳', SNOOZED: '잠시 미룸', NOT_REQUIRED: '필요 없음', RUNNING: '실행 중', STOPPED: '중지됨', REFRESHING: '갱신 중', INITIAL: '첫 알림', ESCALATED: '강화 알림', CRITICAL: '긴급 알림',
  'PUSH NOTIFICATION': '푸시 알림', 'FULL-SCREEN ALARM': '전체 화면 알람', 'DND OVERRIDE': '방해금지 우회', 'ALARM SOUND': '알람 소리', 'TTS VOICE': '음성 안내', 'LOCAL BACKUP ALARM': '기기 내 예비 알람',
  'HISTORICAL-INSTABILITY-PRECHECK': '최근 변동에 따른 사전 점검', 'HIGH-WATCH-FIRST-MAIN-ALARM': '주의 노선의 첫 알람 강화',
  CONCENTRATED: '한 경로에 집중', MIXED: '여러 경로에서 발생', SPREADING: '여러 경로로 확산',
};

export function formatUiLabel(value) {
  const text = String(value ?? '');
  return labels[text] || labels[text.toUpperCase()] || text;
}

export function formatUiMessage(value) {
  const text = String(value ?? '');
  return KOREAN_COPY[text] || formatUiLabel(text);
}

// Make a separate display copy. Machine-readable IDs, statuses, and user data
// stay untouched, including when the server still has an older English history.
export function localizeDisplayFields(value) {
  if (Array.isArray(value)) return value.map(localizeDisplayFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    typeof item === 'string' && /(?:Label|Copy|Reason)$|^(?:label|copy|reason|detail|title)$/.test(key)
      ? formatUiMessage(item) : typeof item === 'object' ? localizeDisplayFields(item) : item,
  ]));
}

export function userErrorMessage(error, fallback = '요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.') {
  const message = error instanceof Error ? error.message : '';
  if (/[가-힣]/.test(message)) return message;
  if (/fetch|network|connection|offline/i.test(message)) return '서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.';
  if (/timeout|timed out|abort/i.test(message)) return '응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.';
  if (/permission|notallowed/i.test(message)) return '필요한 권한이 허용되지 않았습니다. 브라우저 또는 기기 설정을 확인해 주세요.';
  return fallback;
}

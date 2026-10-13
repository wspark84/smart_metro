# Smart Metro 재점검 및 대표님 준비 작업

검토일: 2026-09-10. 검토 코드: main / ca699d5. 운영 주소: https://smart-metro.vercel.app/

## 결론

웹 배포는 완료됐지만 실서비스 출시 준비는 완료되지 않았다. 대표님이 키만 입력하면 모든 기능이 완성되는 상태가 아니다. 아래 계산 오류, 저장·실행 구조, 모바일 기능은 개발자가 수정해야 한다.

이번 작업은 읽기 전용 검토와 재현 검사이며, 제품 코드를 수정하거나 GitHub 업로드·재배포·외부 설정 변경을 하지 않았다. 이 문서만 추가했다.

## 1. 검사 결과와 한계

- Node 자동 테스트: 275개 통과, 실패 0개.
- JavaScript/ES module 문법: 71개 파일 검사, 실패 0개.
- Flutter analyze --no-pub: No issues found.
- Flutter test --no-pub: 8개 통과.
- 운영 공개 상태 API 7개: 모두 HTTP 200 응답.
- 아래 3개 데이터 처리 오류는 기존 테스트 밖의 별도 입력으로 실제 함수를 호출하여 재현했다. 테스트 통과가 무오류를 뜻하지 않는다.
- 실제 회원가입, 메일 발송, 실시간 공급자 키 호출, 푸시 발송, 휴대폰 잠금·절전 시험은 하지 않았다.
- 원본 전체 기능 기획서는 이번 검토 자료에 없으며, 대화에서 확정한 요구와 코드·기존 검토 문서를 기준으로 했다.
- 웹 전체 UI 통합 검사, 의존성 취약점 전수 감사, 부하 시험까지 완료했다는 의미는 아니다.

## 2. 개발자가 먼저 수정할 부분

### P0. 운영 저장소와 상시 알람 실행 구조

- src/server/auth-store.mjs:4에서 회원을 data/auth/users.json 파일에 저장한다. 사용자 일정도 data/users 아래 파일이다.
- server.mjs:1383에서 15초 setInterval로 알람을 확인한다.
- 현재 Vercel 설정은 외부 영구 DB와 독립적인 예약 실행 구조를 제공하지 않는다. 서버 함수의 내부 파일과 메모리 타이머를 영구 저장소·상시 서버처럼 사용하는 구조를 바꿔야 한다.
- 위험: 재시작·새 배포·여러 실행 인스턴스에서 데이터 일관성 및 알림 지속 실행을 보장할 수 없다. 이번 검토에서 실제 계정 삭제 사고를 관측한 것은 아니다.
- 개발 작업: DB 이전, 사용자별 데이터 격리, 중복 발송 방지, 예약 실행, 재시도, 백업·복원 검증.
- 대표님 작업: 서버/DB 운영 비용 및 계정 소유권 결정. 지금 아무 서버 상품이나 먼저 결제할 필요는 없다. Vercel 웹 주소는 유지할 수 있으며, 정확한 구성·비용은 별도 확정 후 연결한다.
- 공식 근거: [Vercel 함수 실행 한도](https://vercel.com/docs/functions/limitations), [배포 환경과 로컬 파일 저장 차이](https://vercel.com/kb/guide/why-does-my-serverless-function-work-locally-but-not-when-deployed).

### P1. 도착정보를 두 대로 잘라 마지막 차량을 놓치는 오류

- src/server/bus-providers.mjs:65의 slice(0, 2).
- 재현: TAGO 입력 [5, 12, 20, 26]분 → 반환 [5, 12]분.
- 결과: 계산 함수는 여러 대를 비교할 수 있지만 실제 제공처 연결 단계에서 세 번째 이후 차량이 사라진다.
- 수정: 실제로 받은 같은 노선의 모든 유효 도착편을 유지하고, 제공처→판정까지 이어지는 테스트 추가. 제공처가 두 대만 주는 경우 이후 차량을 만들어내서는 안 된다.

### P1. 초 단위 반올림 때문에 실제 지각을 정시로 판단하는 오류

- src/server/bus-providers.mjs:43의 초→분 변환에서 Math.round 사용.
- 재현: 현재 08:00, 버스 도착 1,229초 후(20분 29초), 탑승 후 40분, 목표 09:00.
- 실제 입력 기준 예상 도착은 09:00:29이지만, 20분으로 반올림되어 YELLOW/정시 가능으로 계산된다.
- 수정: 내부 계산은 초 또는 소수 분을 보존하고 화면 문구만 적절히 반올림. 서울·TAGO 모두 점검.

### P1. TAGO의 서로 다른 노선 ID가 섞이는 오류

- src/server/bus-providers.mjs:335~353에서 한 행을 고른 뒤 버스 번호만으로 나머지 행을 모은다.
- 재현: R1/100번/10분, R2/100번/1분 입력에서 R1 선택 결과가 [1, 10]분이다.
- 수정: 고유 routeid 기준으로 필터링하고 선택 ID가 있는데 다른 노선으로 대체하지 않도록 한다. 노선 번호만으로는 동일 노선임을 보장하지 않는다.

### P1. 모바일 알람 권한과 실제 동작의 불일치

- local_alarm_scheduler.dart:126은 전체 화면 권한 허용 여부를 실제로 읽지 않고 사용자 요청값을 허용값으로 취급한다.
- mobile_push_runtime.dart:384의 원격 푸시 긴급 채널은 bypassDnd: false이다. 로컬 보조 알람의 DND 채널 설정과 별개다.
- 한국어 TTS는 native_alarm_preview_service.dart의 미리보기 재생 경로에 있으며 백그라운드 푸시 처리에서 반복 TTS를 실행하지 않는다.
- 수정: 권한 상태를 사실대로 표시하고, 원격 알림/로컬 알람 채널을 정리하며, OS별 네이티브 알람 설계 및 실기기 검증을 수행한다.
- iOS와 Android에 동일한 전체 화면·방해금지 우회·무제한 반복을 보장한다고 표현해서는 안 된다.

### 아직 남은 기능/출시 작업

- 지하철 실제 도착정보, 호선·방향·급행·종착역 필터.
- 여러 버스·지하철 경로 동시 비교. 현재 선택한 단일 경로 중심이다.
- 환승 이후 차량의 실시간 대기·지연 반영. 현재 경로 구간 예상시간과 첫 버스 도착정보를 결합한다.
- 날짜를 넘는 일정과 자정 전후 알람.
- 로컬 알람은 앞으로 30일의 시작 시각 보조 알람이다. 모든 반복 경고를 오프라인으로 예약한 것이 아니다.
- Flutter 소비자용 화면, 지도 SDK 표시, 한국어 문구와 Smart Metro 브랜드 정리. 현재 웹 가입 화면도 영어/BusWakeUp 이름이 남아 있다.
- 계정 복구: 메일 연동 이후 만료·재사용 차단·새 비밀번호 로그인·기존 세션 해제 실환경 시험. 로그인/메일 요청 남용 방지와 운영 지원 절차도 출시 전 점검한다.
- 버스 데이터 출처별 정확도를 실제 노선에서 측정한다. 코드에 있는 TAGO 우선 정책 자체가 정확성의 증거는 아니다.

## 3. 현재 운영 서버에서 확인한 설정

| 항목 | 확인된 값/상태 |
|---|---|
| 서비스 상태 | /api/healthz 200 |
| 기본 공개 주소 | http://127.0.0.1:4173, 수정 필요 |
| 카카오 장소/경로/지도 키 | configured: false |
| 서울/경기/TAGO 버스 키 | 모두 configured: false |
| 공휴일 키 | configured: false |
| Google/Apple 로그인 | 모두 ready: false |
| 모바일 푸시 | preview, executeSupported: false |
| Flutter Firebase | firebase_options.dart에 미설정 예외를 던지는 초기 코드 |
| SMTP·개별 APNs·Web Push 비밀값 | 이번 공개 API 검사로는 개별 설정 유무를 확정하지 않음 |

환경변수를 숨겨진 화면에서 읽거나 비밀키 값을 출력하지 않았다. configured는 키 존재 여부이며 실제 이용 권한·성공 호출 확인과 다르다.

## 4. 대표님 작업: 우선순위별 상세 순서

### 1순위. 현재 사이트 주소 설정 바로잡기

1. [Vercel](https://vercel.com/wsparks-projects) 로그인.
2. smart-metro 프로젝트 → Settings → Environment Variables.
3. 이름 APP_BASE_URL, 값 https://smart-metro.vercel.app 입력. 기존 값이 있으면 수정한다.
4. 현재 운영에 적용하려면 Production을 선택하고 저장한다. Preview에는 별도 테스트 주소/설정을 사용하는 것이 안전하다.
5. Deployments에서 새 배포 또는 Redeploy 실행. 환경변수는 기존 배포에 자동 소급 적용되지 않는다.
6. 완료 기준: /api/auth/providers의 baseUrl과 callbackUrl이 실제 HTTPS 주소를 사용한다. 키를 넣지 않은 소셜 로그인까지 ready가 될 필요는 없다.

이는 잘못된 링크 주소를 해결할 뿐, 파일 저장/알람 실행 구조까지 해결하지 않는다. [Vercel 환경변수 공식 안내](https://vercel.com/docs/environment-variables).

### 2순위. 카카오 지도·주소 검색·대중교통 키

1. [카카오 개발자사이트](https://developers.kakao.com/)에서 대표님 소유 앱을 생성하거나 기존 Smart Metro 앱을 선택한다.
2. 앱의 REST API 키를 확인한다. 서버의 KAKAO_LOCAL_REST_API_KEY에 저장한다.
3. 대중교통에 같은 키를 쓰면 현재 코드는 위 키를 대체값으로 읽는다. 별도 키를 쓸 때 KAKAO_TRANSIT_REST_API_KEY를 설정한다. 별도 키 두 개를 반드시 발급받으라는 뜻은 아니다.
4. 앱 → 앱 설정 → 앱 → 플랫폼 키에서 JavaScript 키를 선택한다.
5. JavaScript SDK 도메인에 https://smart-metro.vercel.app 등록. 이 키를 KAKAO_JAVASCRIPT_KEY로 저장한다. REST 키와 JavaScript 키를 바꿔 넣지 않는다.
6. 카카오맵 사용 설정·권한 안내가 나타나면 해당 앱에 활성화한다. 실제 이용 가능 여부는 개발자가 호출해서 확인한다.
7. 서버 환경변수 저장 뒤 재배포한다. 운영 서버를 분리하면 서버용 키는 실제 API 서버에도 설정해야 한다.
8. 완료 기준: 실제 주소 검색, 지도 표시, 선택 정류장→목적지 경로 조회가 모두 성공한다.

카카오 공식 문서에서 현재 대중교통 경로 API가 제공됨을 재확인했다. 그러나 지도/경로 키 하나가 서울·경기 버스 실시간 도착 API 키를 대신하지는 않는다. 집→정류장 도보 계산용 키 발급은 현재 핵심 요구의 우선 작업이 아니다.

공식 안내: [지도 키/도메인 등록](https://apis.map.kakao.com/web/guide/), [대중교통 REST API](https://developers.kakao.com/docs/ko/kakaomap/rest-api).

### 3순위. 실제 시험 지역의 버스 API 신청

공통: [공공데이터포털](https://www.data.go.kr/) 가입·로그인 → 아래 서비스 페이지의 활용신청 → 신청 목적과 사용 범위 작성 → 승인 확인 → 인증키 확인. 같은 계정의 키가 같아 보여도 서비스별 활용승인은 확인한다. 현재 코드는 요청 때 인코딩하므로 일반 인증키 중 Decoding 값을 사용한다.

| 시험 범위 | 신청할 서비스 | 서버 환경변수 |
|---|---|---|
| 서울 | [서울특별시 버스도착정보조회](https://www.data.go.kr/data/15000314/openapi.do), [정류소정보조회](https://www.data.go.kr/data/15000303/openapi.do) | SEOUL_OPEN_API_KEY |
| 경기 | [경기도 버스도착정보 조회](https://www.data.go.kr/data/15080346/openapi.do), 검색에 사용하는 경기도 버스정류소 조회 서비스 추가 승인 확인 | GYEONGGI_SERVICE_KEY |
| TAGO 지원 지역 | [국토교통부 TAGO 버스도착정보](https://www.data.go.kr/data/15098530/openapi.do) | TAGO_SERVICE_KEY |

SEOUL_OPEN_API_KEY라는 코드 이름에도 불구하고 현재 서울 버스 연결은 ws.bus.go.kr의 serviceKey 방식이다. 서울 지하철용 열린데이터 인증키와 혼동하지 않는다. 지하철 키·환경변수는 실제 연결 개발 시 별도로 정한다.

처음부터 모든 지역 키를 준비할 필요는 없다. 첫 시험 지역·정류장·버스 번호·목적지·목표 도착 시간을 대표님이 알려주면 필요한 제공처부터 검증한다. TAGO 정류장/노선 검색 자동화는 현재 없어서 식별값 연결은 개발자 작업이다.

완료 기준: 선택한 정류장과 방향의 실제 버스 도착정보가 수신되고, 데이터 시각·공식 안내와 비교된다. 이용 한도 증액/운영계정 신청은 실제 호출량 산정 후 진행한다.

### 4순위. 회원 인증·비밀번호 재설정용 메일

기존 회사 SMTP를 쓸 수 있다면 새 메일 서비스 가입은 필수가 아니다. 새 서비스를 선택할 경우 현재 코드와 연결 가능한 예로 Resend SMTP가 있다.

1. 대표님이 관리하는 발신 도메인과 발신 주소를 정한다. 웹은 현재 vercel.app 주소를 계속 쓸 수 있지만, 메일 발신 도메인 인증은 DNS를 관리할 수 있는 도메인이 필요하다.
2. [Resend](https://resend.com/) 가입 → Domains에서 소유 도메인 등록 → 표시되는 DNS 레코드를 도메인 관리 사이트에 추가 → Verified 확인.
3. API Keys에서 발송용 키 생성. 도메인 범위/권한을 필요한 수준으로 제한한다.
4. 서버 설정: SMTP_HOST=smtp.resend.com, SMTP_PORT=587, SMTP_SECURE=false, SMTP_USER=resend, SMTP_PASS=발급한_API_키, EMAIL_FROM=인증한_도메인의_발신주소.
5. APP_BASE_URL도 실제 사이트 주소여야 한다. 적용 후 실제 회원 인증과 비밀번호 재설정 메일을 시험한다.
6. 완료 기준: 수신함 도착 → 링크 열기 → 비밀번호 변경 → 새 비밀번호 로그인 → 기존 세션 해제 확인.

SMTP_SECURE=false는 위 587번 설정에서 평문 발송을 뜻하지 않는다. 현재 코드는 STARTTLS를 요구한다. 기존 SMTP를 쓰면 해당 업체의 포트/암호화 안내를 따른다.

공식 안내: [Resend SMTP](https://resend.com/docs/send-with-smtp), [발신 도메인 인증](https://resend.com/docs/dashboard/domains/introduction).

### 5순위. Firebase 및 실제 휴대폰 푸시

1. [Firebase Console](https://console.firebase.google.com/)에서 대표님 소유 프로젝트 생성/선택.
2. 앱 이름과 패키지 ID를 개발자와 확정한 후 Android/iOS 앱 등록. 현재 Android는 com.buswakeup.buswakeup_mobile, iOS는 com.buswakeup.buswakeupMobile이다. 바꿀 예정이면 먼저 변경한다.
3. 프로젝트 설정 → 서비스 계정에서 서버용 서비스 계정을 준비한다. 서버 설정 이름은 FCM_PROJECT_ID와 FCM_SERVICE_ACCOUNT_JSON이다.
4. 서비스 계정 JSON은 비밀파일이므로 GitHub·채팅에 붙이지 않는다. 서버 Secret에 안전하게 저장한다.
5. 개발자가 FlutterFire 설정, 앱 설정 파일 반영, 재빌드·기기 등록을 진행한다. 서버 키 입력만으로 현재 firebase_options.dart 초기 코드가 완성되지 않는다.
6. 현재 PUSH_GATEWAY_MODE는 preview다. 실제 전송 모드 전환은 개발자가 테스트 기기·수신자를 확인한 뒤 수행한다.
7. 대표님은 시험 Android 휴대폰을 준비하고 앱의 알림/알람 권한 허용과 잠금 상태 시험에 참여한다.

공식 안내: [Flutter FCM 시작](https://firebase.google.com/docs/cloud-messaging/flutter/get-started), [서버 FCM 인증](https://firebase.google.com/docs/cloud-messaging/send/v1-api).

### 6순위. iPhone, 직접 APNs, Web Push

- iPhone: [Apple Developer](https://developer.apple.com/account/) 계정/팀 준비, 실제 iPhone과 macOS/Xcode 빌드 환경 필요. App ID·Push capability·서명을 개발자가 맞춘다.
- APNs: Certificates, Identifiers & Profiles → Keys에서 APNs용 키를 생성한다. .p8 파일은 다시 내려받을 수 없으므로 안전하게 보관한다. [Apple 키 안내](https://developer.apple.com/help/account/keys/create-a-private-key).
- FCM으로 iPhone에 보내려면 APNs 키를 Firebase에도 연결한다.
- 직접 APNs 전송까지 검증할 때 서버에 APNS_BUNDLE_ID, APNS_TEAM_ID, APNS_KEY_ID, APNS_PRIVATE_KEY, APNS_ENV를 설정한다. 테스트 빌드와 운영 빌드의 환경을 맞춘다. App Store Connect API 키나 Apple 로그인 키와 혼동하지 않는다.
- Web Push는 외부 사이트에서 유료 키를 구매하는 작업이 아니다. 개발자가 VAPID 공개/비밀키 한 쌍을 생성한다. 대표님은 연락 이메일과 시험 브라우저 알림 허용을 준비한다. 설정 이름은 WEB_PUSH_VAPID_SUBJECT, WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY다.
- 위 키들은 알림 전달용이다. 백그라운드 반복 TTS나 DND 우회 기능을 자동 완성하지 않는다.

### 7순위. 공휴일과 소셜 로그인

- 공휴일: [한국천문연구원 특일 정보](https://www.data.go.kr/data/15012690/openapi.do) 활용신청 → HOLIDAY_API_SERVICE_KEY 설정 → 해당 연도 휴일 동기화 시험.
- Google 로그인: [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트와 OAuth 동의 화면 설정 → 웹 애플리케이션 OAuth 클라이언트 생성. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 설정. 현재 서버 콜백은 https://smart-metro.vercel.app/api/auth/oauth/google/callback 이다. [공식 OAuth 안내](https://developers.google.com/identity/protocols/oauth2/web-server).
- Apple 로그인: Apple Developer의 Sign in with Apple 설정 및 Services ID·로그인용 키 준비. APPLE_SERVICE_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY 설정. 콜백은 https://smart-metro.vercel.app/api/auth/oauth/apple/callback 이다. 실제 도메인/Return URL 검증은 콘솔에서 함께 진행한다.
- 소셜 로그인은 기본 이메일 계정 및 핵심 알람 검증 이후에 진행해도 된다.

### 8순위. 공개 출시 전 대표님 확정사항

- 시험 지역·노선·목표 도착 시간, Android 우선/iOS 동시 출시 여부.
- 서비스명, 운영 문의 이메일, 실제 운영 주체 정보.
- 개인정보처리방침·이용약관에 필요한 수집 항목·보관·삭제 정책 확정 및 필요한 검토. 이 문서는 법률 적합성 심사를 대신하지 않는다.
- Play Console/App Store Connect 운영 계정, 스토어 등록 자료와 심사 협조. 패키지 서명/릴리즈 빌드는 개발자 담당이다.
- 실제 기기 시험: 화면 켜짐/잠금/절전/앱 종료/권한 거부/네트워크 끊김/출발 완료/오늘 끄기/공휴일/재부팅. 기대 결과와 실제 알림 시각을 기록한다.

## 5. 다음 진행 순서

1. 개발자: 재현한 도착정보 오류 3개 수정 및 공급자→판정 통합 회귀 테스트.
2. 개발자+대표님: DB·예약 실행 운영 구조/비용 확정, 회원 데이터와 알람의 저장·지속 실행 보장.
3. 대표님: 공개 주소 설정, 카카오 키와 첫 시험 지역 버스 키 준비.
4. 개발자: 실제 노선으로 경로·도착정보 결합 검증, 지하철 및 남은 핵심 기능 구현.
5. 공동: 메일·푸시 연결, 모바일 네이티브 알람 보완, 실기기 시험.
6. 공동: 백업·복원·모니터링·계정 복구·스토어 배포 점검 후 공개 출시 판단.

비밀값은 채팅이나 GitHub에 올리지 않는다. 설정 후에는 변수 이름과 저장 완료 여부만 공유하면 된다. 비용 결제·서비스 생성·데이터 이동은 별도 확인 없이 수행하지 않았다.

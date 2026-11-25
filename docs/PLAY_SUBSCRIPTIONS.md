# 이노치 월 구독 연결 (2026-10-04)

## 상품 정책
- 로그인한 모든 회원: 홈의 일회성 알림 무료.
- 일정 자동 알림: 월 3,000원(하루 100원 꼴, 2026-11-10 대표 결정). 등록한 요일과 도착 목표에 맞춰 반복 알림.
- 해지: 이미 결제한 기한까지 이용. 만료 후 일정 데이터는 보존.
- Android Google Play 결제만 구현. 웹은 앱의 구독 화면을 열고 서버에서 같은 계정의 권한을 확인한다.

## 운영 활성화에 필요한 외부 작업
1. Play Console에 앱 등록. 패키지는 `com.buswakeup.buswakeup_mobile`.
2. 정기결제 상품 ID `inochi_schedule_monthly`, 기본 요금제 ID `monthly` 생성.
3. 자동 갱신 1개월, 대한민국 KRW 3,000원으로 활성화. 현재 구현은 할인/무료체험 없는 이 요금제만 판매한다.
4. 출시 서명된 AAB를 내부 테스트 트랙에 업로드하고 테스터 및 라이선스 테스터 등록.
5. Google Play Android Developer API 활성화. 별도 서비스 계정을 Play Console에 초대하여 이 앱의 구매 확인/구독 관리에 필요한 권한만 부여.
6. 이 프로젝트의 Supabase SQL Editor에서 `supabase/migrations/202610040001_paid_schedules.sql` 적용.
7. Vercel의 서버 전용 Secret에 `PLAY_SERVICE_ACCOUNT_JSON`, `SUPABASE_SERVICE_ROLE_KEY` 설정. 클라이언트에는 절대 전달하지 않는다.
8. 내부 테스트에서 `INOCHI_BILLING_ENABLED=true`로 실제 라이선스 테스트 구매/복원/해지/만료/보류/환불/다른 계정 차단 검증.
9. 검증 후 서버와 새 앱을 함께 출시. 예전 앱에는 구독 결제 화면이 없다.

## 검증 구조
- 서버는 Google `purchases.subscriptionsv2.get`로 상품/기본요금제/상태/만료일/해시된 앱 계정을 확인한다.
- 토큰 소유권은 DB에서 원자적으로 고정한다. 앱에서 보낸 `active`, 만료일, 가격을 신뢰하지 않는다.
- 서버 저장 후 acknowledge. 전송 실패 시 앱에서 구매 복원으로 재시도한다.
- 상태 조회와 일정 실행 때 마지막 확인이 1분 이상 지나면 Google에 재조회한다. 실시간 개발자 알림(RTDN)은 아직 연결하지 않았으므로 환불을 즉시 수신하는 방식은 아니다.
- 검증 실패/설정 누락은 일정 실행 차단. 홈 무료 기능은 별도로 유지.
- 홈 저장 요청은 한국 날짜 기준 그날의 일회성 알림만 활성화한다. 다음 날 자동 반복은 하지 않는다.
- Supabase 직접 저장도 구독 테이블을 수정할 수 없으며, 일정 수정 트리거로 방어한다.
- 구매 토큰은 서버 전용 테이블에 저장된다. 데이터 보안/개인정보처리방침 및 탈퇴 시 삭제 범위에 포함해야 한다.

## 배포 전 필수 확인
- 구독 여부만 바꿔서 테스트 통과했다고 결제 완료로 간주하지 말 것.
- UI/서버/DB 변경은 현재 로컬 코드이며 운영 적용 및 Play 상품/인증 정보는 별도 확인이 필요하다.
- 구독 활성화 전에 요금/자동 갱신/해지 안내 및 개인정보처리방침을 출시 화면에서 확인.
- 서버 자동 알림이 구독 판정의 기준이다. 기존 기기에 예약된 구형 보조 알람은 새 앱에서 제거해야 한다.
- 새 앱은 시작할 때 기존 다일 보조 알람을 취소하며, 운영 알림은 서버 검증 후 발송한다. 기존 앱은 업데이트 안내가 필요하다.

## 아이폰 (App Store) 구독 (2026-11-22)
- 앱 ID `com.buswakeup.buswakeup-mobile` (애플은 밑줄 불가). 상품 ID는 Play와 같은 `inochi_schedule_monthly`, 1개월 자동 갱신, 대한민국 3,000원.
- 앱은 StoreKit 2로 결제하고 `appAccountToken`(계정 해시로 만든 UUID)을 결제에 붙인다. 결제 후 거래 ID만 서버에 보낸다 (`POST /api/subscription/verify {appleTransactionId}`).
- 서버(`src/server/app-store-subscription.mjs`)는 App Store Server API `GET /inApps/v1/subscriptions/{id}`로 직접 조회해 앱 번들·상품·`appAccountToken`·상태·만료일을 확인한다. 운영 서버에서 없으면 샌드박스(TestFlight·심사)를 조회한다.
- 저장은 기존 `inochi_play_subscriptions` 테이블에 `purchase_token = apple:<originalTransactionId>`로 하고, 상태는 Play 이름으로 맞춰 DB 일정 보호 트리거를 그대로 쓴다. DB 변경 없음.
- App Store Server Notifications(V2)는 아직 연결하지 않았다. Play와 마찬가지로 상태 조회·일정 실행 때 1분 이상 지난 기록을 애플에 재조회한다.

### 운영 활성화에 필요한 외부 작업
1. 애플 개발자 계정 → App ID `com.buswakeup.buswakeup-mobile` 등록 (In-App Purchase, Push Notifications, Sign in with Apple 켜기).
2. App Store Connect에서 앱 생성 → 유료 앱 계약(Paid Apps Agreement)·세금·은행 정보 완료. 이게 없으면 상품이 불러와지지 않는다.
3. 구독 그룹 생성 → 자동 갱신 구독 `inochi_schedule_monthly`, 1개월, 대한민국 3,000원. 심사용 스크린샷과 설명 입력.
4. 사용자 및 액세스 → 통합 → 앱 내 구입 키 생성 → Vercel Secret에 `APPSTORE_ISSUER_ID`, `APPSTORE_KEY_ID`, `APPSTORE_PRIVATE_KEY` 설정.
5. TestFlight 샌드박스 테스터로 결제·복원·해지·만료·다른 계정 차단 검증 후 출시.

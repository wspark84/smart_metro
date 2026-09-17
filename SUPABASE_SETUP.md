# Smart Metro 소셜 로그인 설정 안내

## 현재 상태 — 2026-09-17 배포 준비

웹/서버의 소셜 로그인 전환을 로컬 코드에 반영했습니다. **GitHub 업로드와 운영 배포는 아직 하지 않았습니다.**

- 웹 로그인: 구글, 카카오, 네이버 버튼만 표시합니다.
- 이메일 가입·비밀번호 로그인·재설정 API는 410 응답으로 차단합니다.
- Supabase 공식 SDK의 PKCE 로그인, 서버 전용 HttpOnly 쿠키, 세션 갱신을 사용합니다.
- 서버에서 Supabase에 사용자 신원을 확인한 뒤에만 데이터를 읽습니다.
- 사용자별 설정 11종을 Supabase 데이터베이스에 저장합니다. 여러 항목은 한 트랜잭션으로 저장합니다.
- 네이버는 사용자 정보 변환 경로를 구현했습니다. 실제 제공자 연동은 아직 확인하지 않았습니다.
- Google 제공자 설정, 운영 리디렉션 URL, Vercel의 google 활성화, SQL 두 파일 실행을 사용자가 완료했다고 확인했습니다. 실제 Google 계정 로그인 왕복 검증은 아직 남아 있습니다.
- Kakao/Naver 자격 증명과 승인 상태는 아직 확인하지 않았습니다.
- Flutter 네이티브 앱의 로그인 화면·앱 복귀 연결은 아직 전환하지 않았습니다. 기존 앱은 새 서버의 이메일 로그인 API를 사용할 수 없습니다.

**지금의 테스트 성공은 실제 소셜 계정 로그인 성공이나 운영 배포 완료를 의미하지 않습니다.**

## 1. Supabase 데이터 저장 설정

먼저 반드시 새로 만든 smart_metro 프로젝트인지 확인하세요. 다른 프로젝트의 SQL Editor에서 실행하면 안 됩니다.

첫 번째 파일은 이미 실행 완료 화면을 보내 주셨습니다:

- supabase/migrations/202609160001_smart_metro_documents.sql

이번 변경에서 두 번째 파일이 추가됐으며 사용자에게 실행 완료를 확인받았습니다:

- supabase/migrations/202609160002_atomic_document_batch.sql

Supabase → smart_metro → SQL Editor → New query에서 두 번째 파일 전체를 복사해 실행하세요.
경로와 알람 설정이 절반만 저장되는 일을 막는 저장 함수를 추가합니다.
기존 계정을 삭제하거나 기존 데이터를 초기화하지 않습니다.
성공 여부는 화면의 Success 메시지로 확인합니다.

## 2. 로그인 후 돌아올 주소 등록

Supabase → Authentication → URL Configuration에서 설정합니다.

- Site URL: https://smart-metro.vercel.app
- Redirect URLs에 정확히 추가: https://smart-metro.vercel.app/api/auth/callback

주소 두 종류를 구분하세요:

- Google/Kakao/Naver 개발자 사이트에 넣는 주소: **Supabase의 해당 Provider 화면에 표시되는 Callback URL**을 복사합니다.
- Supabase Redirect URLs에 넣는 주소: 위의 **Smart Metro /api/auth/callback** 주소입니다.

두 주소는 서로 다릅니다. 프로젝트 ID를 눈으로 읽어서 직접 입력하지 말고 Copy로 복사하세요.
운영 주소에 와일드카드(*)를 추가하지 않습니다.

## 3. 구글 로그인 — 먼저 연결할 항목

1. https://console.cloud.google.com/ 에 접속합니다.
2. Smart Metro용 프로젝트를 선택하거나 만듭니다.
3. Google Auth Platform에서 앱 이름, 사용자 지원 이메일, 개발자 연락처를 설정합니다.
4. 일반 사용자 대상이면 Audience는 External로 설정합니다. 테스트 상태에서는 테스트할 Google 계정을 Test users에 추가합니다.
5. Clients → Create client에서 Web application을 선택합니다.
6. Authorized JavaScript origins에 https://smart-metro.vercel.app 를 입력합니다.
7. Supabase → Authentication → Sign In / Providers → Google 화면의 Callback URL을 복사합니다.
8. 그 주소를 Google의 Authorized redirect URIs에 추가합니다.
9. 발급된 Client ID와 Client Secret을 **Supabase Google 설정**에 입력하고 활성화·저장합니다.
10. 키를 채팅으로 보내지 않습니다. Vercel에 예전 GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET을 추가할 필요는 없습니다.

공개 출시 전 Google의 Audience/게시 상태와 필요한 심사 항목을 확인해야 합니다.
테스트 사용자 로그인 성공과 모든 고객이 로그인 가능한 상태는 다릅니다.

공식 안내: https://supabase.com/docs/guides/auth/social-login/auth-google

## 4. 카카오 로그인

이미 만든 Kakao Developers의 Smart Metro 앱을 사용합니다.

1. https://developers.kakao.com/ → 내 애플리케이션 → Smart Metro로 이동합니다.
2. 제품 설정 → 카카오 로그인에서 활성화 상태를 ON으로 합니다.
3. 앱 설정 → 앱 → 플랫폼 키 → 사용할 REST API 키를 엽니다.
4. Supabase → Authentication → Sign In / Providers → Kakao에 표시된 Callback URL을 복사합니다.
5. 카카오의 Kakao Login Redirect URI에 그 주소를 등록합니다.
6. Kakao Login Client Secret을 확인하고 활성화합니다.
7. Supabase Kakao 설정의 Client ID에는 **REST API 키**, Client Secret에는 **카카오 로그인 Client Secret**을 넣습니다.
8. 지도용 JavaScript 키를 로그인 Client ID에 넣으면 안 됩니다.
9. 카카오 로그인 동의항목에서 프로필 닉네임과 프로필 사진을 설정합니다.
10. 이메일을 받지 않으려면 Supabase Kakao 설정의 **Allow users without an email**을 켭니다. 공식 문서는 이 경우 account_email 동의를 생략할 수 있다고 안내합니다. 실제 앱 권한과 로그인 동작은 테스트에서 확인합니다.
11. Supabase에서 Kakao를 활성화하고 저장합니다.

지도 키 등록만으로 카카오 로그인이 활성화되지는 않습니다.
이메일 제공 동의와 Smart Metro가 별도 인증 메일을 보내는 것은 서로 다른 기능입니다.

공식 안내: https://supabase.com/docs/guides/auth/social-login/auth-kakao

## 5. 네이버 로그인 — 추가 연동 및 실서비스 심사 확인 필요

네이버는 Supabase 기본 Provider가 아니므로 Custom OAuth Provider를 사용합니다.
네이버 응답의 response.id를 Supabase가 읽는 sub로 변환하는 서버 경로를 구현했습니다.

1. https://developers.naver.com/ → Application → 애플리케이션 등록으로 이동합니다.
2. 네이버 로그인을 선택하고 서비스 URL은 https://smart-metro.vercel.app 로 설정합니다.
3. Supabase → Authentication → Sign In / Providers → New Provider → Manual configuration을 엽니다.
4. Identifier는 custom:naver로 설정합니다.
5. 그 화면에 표시되는 Callback URL을 네이버의 Callback URL에 그대로 등록합니다.
6. 네이버 Client ID와 Client Secret을 Supabase의 해당 항목에 입력합니다.
7. 아래 주소를 설정합니다.

| 항목 | 값 |
| --- | --- |
| Authorization URL | https://nid.naver.com/oauth2.0/authorize |
| Token URL | https://nid.naver.com/oauth2.0/token |
| UserInfo URL | https://smart-metro.vercel.app/api/auth/naver/userinfo |
| Allow users without an email / email_optional | true |

네이버 공식 API 명세에는 PKCE 입력 항목이 문서화되어 있지 않습니다.
외부 네이버 구간의 PKCE 호환성은 실제 연동에서 확인해야 합니다. 지원하지 않아 실패하는 것이 확인되면 Custom Provider의 pkce_enabled를 false로 조정합니다.
**앱과 Supabase 사이의 PKCE는 계속 유지합니다.**

현재 변환 경로는 이메일을 Supabase에 전달하지 않고 네이버 고유 ID와 이름만 전달합니다.
따라서 이메일 미인증 상태를 임의로 인증 완료로 만들거나, 이메일이 같다는 이유로 구글 계정과 자동 합치지 않습니다.
네이버로 처음 시작한 사용자는 다음에도 네이버로 로그인해야 같은 설정을 볼 수 있습니다.

먼저 새 서버를 배포해야 UserInfo URL이 동작합니다. 그 후 테스트 계정으로 왕복 로그인을 확인하고,
네이버 개발/검수 상태에서 허용되는 사용자의 범위와 실서비스 제공을 위한 검수 요건을 확인합니다.
Custom Provider 화면에 필요한 옵션이 없으면 임의로 대신 설정하지 말고 화면을 확인받으세요.

공식 안내:
- https://supabase.com/docs/guides/auth/custom-oauth-providers
- https://developers.naver.com/docs/login/api/api.md
- https://developers.naver.com/docs/login/profile/profile.md

## 6. Vercel 환경변수

Vercel → smart-metro → Environment Variables에서 Production에 설정합니다.

| Key | Value | 유형 |
| --- | --- | --- |
| APP_BASE_URL | https://smart-metro.vercel.app | Config |
| SUPABASE_URL | Supabase 프로젝트 URL | Config |
| SUPABASE_PUBLISHABLE_KEY | sb_publishable_로 시작하는 공개용 키 | Config |
| SUPABASE_AUTH_PROVIDERS | 설정을 마친 제공자 이름, 예: google,kakao | Config |

새 변수 SUPABASE_AUTH_PROVIDERS는 사이트에서 사용할 로그인 버튼을 켜는 설정입니다.
키 값이 아니라 **google,kakao,naver처럼 이름을 쉼표로 구분한 문자열**입니다.
네이버 Provider 설정이 끝나기 전에는 naver를 넣지 않습니다. 설정 후 테스트할 때 추가하고 실제 로그인을 확인합니다.
이 변수만 입력해도 외부 서비스 설정이 자동 완료되는 것은 아닙니다.

비밀 키를 SUPABASE_PUBLISHABLE_KEY에 넣지 마세요.
Google/Kakao/Naver의 Client Secret은 Supabase Provider 설정에만 저장합니다.
환경변수 변경은 새 배포에 반영됩니다.

## 7. 이메일 로그인 끄기와 출시 순서

1. SQL 두 파일이 모두 적용됐는지 확인합니다.
2. Supabase 리디렉션 주소와 최소 한 개 소셜 Provider를 설정합니다.
3. Supabase → Authentication → Sign In / Providers → Email에서 이메일 로그인 자체를 비활성화합니다.
   이메일 인증만 끄는 것으로 대신하지 않습니다.
4. Vercel에서 준비된 Provider 이름을 설정합니다.
5. 개발자가 테스트를 다시 실행하고 GitHub 업로드·배포를 진행합니다.
6. 실제 계정으로 로그인 → 경로 저장 → 로그아웃 → 다시 로그인 → 설정 유지 여부를 확인합니다.
7. 두 번째 계정에서 첫 번째 계정의 설정이 보이지 않는지 확인합니다.
8. 네이버는 배포된 UserInfo 변환 경로까지 포함해 검증한 후 켭니다.

소셜 로그인만 제공하는 이 흐름에는 SMTP/Resend 설정이 필요하지 않습니다.
이메일 발송 기능을 나중에 별도로 추가한다면 그때 메일 서비스를 설정합니다.

## 아직 별도 작업이 필요한 부분

- 실제 제공자 키·권한·승인 상태, 운영 로그인 왕복 검증, GitHub 업로드/배포.
- Flutter 앱 소셜 로그인, 안전한 세션 저장과 앱으로 돌아오는 연결, 실기기 테스트.
- 기존 파일 기반 테스트 계정/설정은 자동 이관하지 않았습니다. 옛 비밀번호나 세션은 새 로그인에 사용할 수 없습니다.
- 요청이 없는 동안 서버가 계속 알람을 처리하는 스케줄러는 별도 작업입니다.
  기존 로컬 계정 순회 타이머는 제거했습니다. 사용자 JWT를 몰래 보관하거나 RLS를 끄는 방식으로 대신하지 않습니다.
  이번 변경으로 백그라운드 알람을 보장한다고 볼 수 없습니다.
- 서로 다른 소셜 계정을 사용자가 안전하게 묶는 별도 계정 연결 화면은 구현하지 않았습니다.

## 개발 검증

2026-09-17: 자동 테스트 326개 통과, 운영 의존성 보안 검사 취약점 0개. 실제 계정 로그인과 운영 DB 저장 검증은 별도입니다.

- npm test
- node --check server.mjs
- node --check src/app.js
- git diff --check

테스트는 외부 로그인 서비스를 모의한 서버 통합 테스트, 공식 SDK 쿠키/PKCE 테스트,
PostgreSQL 엔진에서의 RLS·버전 충돌·트랜잭션 롤백 테스트를 포함합니다.
실제 운영 Supabase에 테스트 데이터를 쓰거나 실제 소셜 계정을 생성한 것은 아닙니다.

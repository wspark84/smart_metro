# BusWakeUp Prototype

This repository contains a runnable front-end and local server prototype for the smart bus commute alarm product.

## What is implemented

- Mobile-style dashboard, onboarding, schedule, and notification settings screens
- Browser `localStorage` state plus server persistence through `/api/app-state`
- Local email/password authentication with cookie-backed sessions through:
  - `/api/auth/session`
  - `/api/auth/register`
  - `/api/auth/login`
  - `/api/auth/logout`
- One-time email verification and password reset flows, with SMTP delivery when configured and safe local preview links when it is not
- Social auth readiness and OAuth launch endpoints through:
  - `/api/auth/providers`
  - `/api/auth/oauth/start`
  - `/api/auth/oauth/google/callback`
  - `/api/auth/oauth/apple/callback`
- Signed-in account management through:
  - `/api/account`
  - `/api/account/profile`
  - `/api/account/password`
- User-scoped server storage under `data/users/<user-id>/...` so app state, domain data, runtime state, dispatch state, and push attempts do not mix between accounts
- Domain-oriented persistence through `/api/domain-snapshot`, `/api/profile`, `/api/route`, `/api/schedule`, and `/api/notification-settings`
- Accuracy-first bus API proxy structure that can compare Seoul, Gyeonggi, and TAGO sources and favor the source with the best observed ETA
- Per-user ETA accuracy tracking through:
  - `/api/bus/accuracy`
  - `/api/bus/accuracy/leaderboard`
  - `/api/bus/accuracy/probe`
  - `/api/bus/accuracy/actual-arrival`
  - `/api/bus/accuracy/auto-probe`
- Address search and coordinate capture through `/api/places/search`
- Interactive Kakao Maps commute view for the saved home, boarding-stop, and work coordinates when `KAKAO_JAVASCRIPT_KEY` is configured
- Server-side walking commute estimates through `/api/commute/estimate`
- Late-risk evaluation using:
  - required arrival time
  - walk time to the stop
  - bus ride time
  - walk time from the stop to work
  - current bus and next bus arrival times
- Weekday, weekend, and custom repeat rules
- Today-only snooze or skip behavior
- Korean public holiday sync through `/api/holidays`
- Server-side live arrival cache with stale fallback
- Risk-based notification escalation for vibration, sound, full-screen mode, and spoken guidance
- Critical alarms now default to a repeated mechanical tone and the repeated Korean late-warning phrase
- Browser auto-play of the latest active alarm bundle after one user interaction
- Server-calculated daily alarm plan preview through `/api/alarm-plan`
- High-instability commute pairs can now schedule one extra server-side `stability precheck` 10 minutes before the normal morning alarm window
- Server alarm runtime, delivery flow, event log, dispatch queue, and dispatch execution feeds
- Device delivery profile sync through `/api/device-profile`
- Device token registration and format health through:
  - `/api/device-profile/token-health`
  - `/api/device-profile/register-token`
- Stage-based dispatch escalation planning through `/api/dispatch-queue`
- Simulated dispatch execution tracking through `/api/dispatch-executions`
- Push adapter preview through `/api/push-preview`
- Push gateway config, attempt log, automatic handoff of new dispatch bundles, and manual dry-run dispatch through:
  - `/api/push-gateway/config`
  - `/api/push-gateway/attempts`
  - `/api/push-gateway/dispatch`
  - `/api/push-gateway/test-dispatch`
  - `/api/push-gateway/retry-simulation`
- Automatic retry queue with 30s / 120s / 300s standard backoff for retryable provider failures, plus a faster 10s / 30s / 90s retry profile for boosted first alarms on historically unstable routes, surfaced through:
  - `/api/push-gateway/attempts`
  - `/api/alarm-runtime`
- When a route is on the recent HIGH instability watchlist, the home hero now also shows reinforced monitoring status so you can see that the server armed a boosted first main alarm and the faster retry path for that morning.
- That boosted first main alarm now also raises its initial sound volume, vibration repeats, and speech intensity even before the alert has escalated to the later red-stage fallback rules.
- In the browser prototype, that same boosted first alarm now also repeats the mechanical tone for extra loops and repeats the TTS guidance twice, so the stronger first alert is audible rather than only visible in metadata.
- The same playback-intensity metadata now also stays visible through the alarm plan, active server alarm, dispatch queue, dispatch execution feed, push preview, push gateway attempts, retry queue, and server event log, so you can confirm exactly how strong the reinforced alert was supposed to play.
- The home dashboard now also adds a `Today's strongest alert` summary that ranks only the recorded playback-intensity traces for the current local day, so you can quickly see which alert was configured to be the strongest without confusing that with real speaker success on the phone.
- That same strongest-alert summary now also follows the matching delivery chain and labels whether the alert actually reached `DELIVERED`, is still `RETRY PENDING`, stayed `BLOCKED`, or only reached `PREVIEW ONLY`, so the CTO dashboard can separate "loudly configured" from "actually handed off."
- The same panel now also summarizes today's delivery health across strong alerts, separating `push-visible` outcomes from `upstream-only` traces and counting how many strong alerts still need attention because they are pending retry, failed, or blocked.
- When strong alerts do need attention, the dashboard now also picks one `Top attention alert` and prioritizes `BLOCKED` over `FAILED` over `RETRY PENDING`, so the first escalation target is explicit.
- That same `Top attention alert` card now also adds an explicit next action, so `BLOCKED` tells you to unblock the push path, `FAILED` tells you to inspect the latest failure, and `RETRY PENDING` tells you to watch the next retry time.
- The `Top attention alert` card now also includes a direct jump button, and it lands on the exact place that needs attention: blocked alerts jump to the push-token field, failed alerts jump to the failed push-attempt row, and retry-pending alerts jump to the queued retry row.
- The same `Top attention alert` card now also exposes one immediate first-step button: `Register Current Token` for blocked alerts, `Run Gateway Dry Run` for failed alerts, and `Run Due Retry Demo` for retry-pending alerts.
- That same card now also shows small timing status such as `Next retry in 10s` or `Last failure 1m ago`, so the operator can judge urgency without opening the deeper logs.
- The same `Top attention alert` card now also adds a short cause summary, for example `Retry overdue`, `Token blocked`, or `Provider rejected request`, using the exact delivery-trace wording already captured by the prototype.
- The same strongest-alert panel now also summarizes the most repeated attention cause for the current local day as `Top issue`, so you can tell whether today's operator burden is mostly blocked tokens, rejected provider requests, or overdue retries.
- That same `Top issue` card now also inherits the jump button and first-step action from the representative alert inside that issue bucket, so the operator can go straight from today's dominant failure pattern to the right panel or quick action.
- The same `Top issue` card now also lists the top affected commute pairs for that dominant problem bucket, so you can see whether the issue is concentrated on one route-stop pair or spreading across several morning trips.
- The same `Top issue` card now also breaks that dominant problem bucket into `BLOCKED / FAILED / RETRY PENDING` counts, so you can tell whether the day is mostly hard-stop failures or still-moving retry backlog.
- The same `Top issue` card now also labels whether that dominant problem is `CONCENTRATED`, `MIXED`, or `SPREADING` across commute pairs, so you can tell if the issue is isolated to one route-stop pair or expanding across the morning network.
- A new Flutter mobile-app workspace now lives under `mobile_app/`, with a first Android/iPhone shell that signs in to the existing server and reads account, alarm runtime, device profile, and ETA leaderboard data for Seoul/Gyeonggi launch operations.
- The mobile auth entry screen now also verifies `/api/mobile/health` before sign-in when QA wants to confirm the saved host first, surfacing reachability, launch focus, push mode, and the recommended ETA provider order directly on the phone shell.
- The same mobile API client now auto-prefixes `http://` for bare LAN host inputs such as `192.168.0.10:4173`, rejects malformed server URLs early, and applies an 8-second request timeout so bad host entries fail fast on the phone shell.
- That mobile shell now also includes a first `Commute setup` tab that saves profile, route, schedule, and notification settings back to the existing domain endpoints on the local server.
- The same mobile setup flow can now search home and work addresses through `/api/places/search`, load official Seoul/Gyeonggi station candidates through `/api/bus/stations`, and load station route candidates through `/api/bus/station-routes` before saving the route binding.
- When TAGO is selected on the same mobile setup screen, station and route search buttons are now disabled up front and replaced with explicit manual-binding guidance, so the shell does not pretend TAGO lookup is wired when it still requires city code, node id, route id, route number, and stop order to be entered directly.
- That same mobile setup screen now also reads provider setup metadata from `/api/bus/config`, so Seoul and Gyeonggi stay search-assisted while TAGO stays manual according to the backend policy rather than hard-coded app-only rules.
- The same mobile setup flow can now also call `/api/commute/estimate`, so the app can preview walk-to-stop and total commute minutes from the saved mobile route draft before the user saves the setup.
- The same mobile shell now also uses the server-side `deliveryIntensity` report in its Overview tab, so `Top attention` and `Top issue` are not separate mobile-only guesses.
- Those mobile Overview cards now also expose the same server-driven quick actions and open-target guidance used by the web prototype, so blocked-token, failed-gateway, and retry-pending cases can be opened or acted on directly from the phone shell.
- The same mobile Overview tab now also pulls the server-side `stabilityWatch` and top conservative watchlist pair into a dedicated `Instability watch` card, so Seoul/Gyeonggi launch operators can see reinforced watch mode and jump straight into the Accuracy tab from the phone shell.
- `/api/alarm-runtime` now also exposes `precheckTriggerCount`, `remainingPrecheckTriggers`, and `stabilityWatch` inside the mobile-facing `plan` payload, so the Flutter shell can show reinforced-watch timing without re-deriving that logic locally.
- The same mobile Overview tab now also adds a `Reinforced watch today` card, showing the current route, watch level, precheck counts, next trigger, and delivery priority, with one-tap jumps into either the Accuracy tab or the Device push-health tab.
- That reinforced-watch mobile card now also embeds the current `Top attention` outcome/action/status and exposes the same server-driven quick action buttons there, so the first mobile screen already combines instability monitoring with the most urgent delivery follow-up.
- That same reinforced-watch mobile card now also surfaces the strongest alert route, playback plan, and strongest delivery outcome, so the phone shell can show instability, delivery urgency, and alert strength together on the first card.
- The mobile `Device` tab can now save platform-specific push settings, register the current Android FCM token or iPhone APNs token, and inspect `/api/device-profile/token-health`, `/api/push-gateway/config`, and `/api/fcm-auth/status` from inside the app shell.
- The same mobile `Device` tab now also includes an in-app `API base URL` editor, so a tester can switch from `127.0.0.1` to a reachable LAN IP or HTTPS server without dropping back to the login screen.
- That mobile API base URL now also persists across app restarts with Flutter `shared_preferences`, so the real-device test server address survives relaunch on iPhone and Android.
- The same mobile `Device` tab now also runs a dedicated `/api/mobile/health` check, so a tester can confirm the saved LAN or HTTPS host is a reachable BusWakeUp server before push rollout testing.
- The same server-endpoint card now also reduces that health result into plain-language launch verdicts such as `LOCALHOST MISMATCH RISK`, `LAN TEST MODE`, `GATEWAY AUTH BLOCKED`, and `READY FOR REAL-DEVICE TEST`.
- That same verdict block now also carries a rollout checklist and a verdict-specific primary action, so mobile QA can move directly into LAN correction, gateway re-check, or the first real-device push flow.
- The same mobile `Device` tab now also adds a dedicated `Real-device push test flow` card that walks through token registration, permissions review, readiness confirmation, and the actual test push in order.
- That real-device flow card now also remembers the last completed step locally on the phone, adds a resume guide based on that saved progress, upgrades the main action into clearer resume labels such as `Continue with Step 3 readiness checks`, shows `Why paused` and `Operator hint` from the current rollout checks, keeps `Reset saved progress` cleared across refresh until new progress is made, lets warning-only states continue to the next step instead of blocking the flow, shows the saved checkpoint detail, and can clear only the saved checklist progress when QA wants to restart the flow without changing live token or gateway state.
- The same mobile `Device` tab can now also inspect the current `/api/push-preview`, read recent `/api/push-gateway/attempts`, and run `/api/push-gateway/test-dispatch` directly from the app shell for Android/iPhone rollout checks.
- The same mobile `Device` tab can now also trigger `/api/push-gateway/dispatch` for the current live bundle, and drive `/api/push-gateway/retry-simulation` so the app shell can show retry queue behavior without leaving mobile QA.
- The same mobile `Device` tab now also adds a `Push launch readiness` summary card that merges token health, adapter credential state, preview readiness, and the latest gateway attempt into one first-step rollout checklist.
- The same mobile `Device` tab now also adds a `Launch blockers` card that separates true rollout blockers from weaker warnings, so you can tell whether the next test is blocked by token or credential issues, or only weakened by DND, battery, or playback settings.
- The same mobile `Device` tab now also includes a foreground-only `Local late-alarm preview` action that plays the mechanical alert tone asset, strong vibration pattern, and repeated Korean TTS phrase `이 버스 놓치면 지각이다.` directly on Android/iPhone for on-device playback verification before background push wiring is finished.
- FCM authentication health inspection through `/api/fcm-auth/status`
- Daily queue and execution cleanup so yesterday's pending dispatch state does not leak into today's morning view

## How to run

```bash
npm run dev
```

The local server starts on `http://127.0.0.1:4173`.

## Docker pilot deployment

The repository now includes `Dockerfile`, `docker-compose.yml`, `.dockerignore`, and `.env.example` for a one-container pilot deployment. Copy `.env.example` to `.env`, fill in only the provider credentials you need, and run:

```bash
docker compose up -d --build
```

The Docker image excludes `data/` and `.env`; account and alarm data is kept in the `buswakeup-data` Docker volume. Put the service behind public HTTPS and set `APP_BASE_URL` to that exact HTTPS URL before enabling Google or Apple sign-in. Read [DEPLOYMENT.md](DEPLOYMENT.md) before deployment: this remains a single-process, file-backed prototype and must run as one application instance.

## Optional environment variables

```bash
SEOUL_OPEN_API_KEY=your-seoul-key
GYEONGGI_SERVICE_KEY=your-gyeonggi-service-key
TAGO_SERVICE_KEY=your-tago-service-key
HOLIDAY_API_SERVICE_KEY=your-public-data-service-key
KAKAO_LOCAL_REST_API_KEY=your-kakao-local-rest-api-key
KAKAO_MOBILITY_REST_API_KEY=your-kakao-mobility-rest-api-key
KAKAO_JAVASCRIPT_KEY=your-kakao-maps-javascript-key
PUSH_GATEWAY_MODE=preview
APP_BASE_URL=http://127.0.0.1:4173
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
APPLE_SERVICE_ID=your-apple-services-id
APPLE_TEAM_ID=your-apple-team-id
APPLE_KEY_ID=your-apple-key-id
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
FCM_PROJECT_ID=your-firebase-project-id
FCM_ACCESS_TOKEN=your-short-lived-fcm-oauth-token
FCM_SERVICE_ACCOUNT_EMAIL=your-service-account-email
FCM_SERVICE_ACCOUNT_PRIVATE_KEY=your-service-account-private-key
FCM_SERVICE_ACCOUNT_PRIVATE_KEY_ID=your-service-account-private-key-id
FCM_SERVICE_ACCOUNT_PROJECT_ID=optional-service-account-project-id
FCM_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
FCM_SERVICE_ACCOUNT_FILE=C:\\path\\to\\firebase-service-account.json
APNS_BUNDLE_ID=your-ios-bundle-id
APNS_TEAM_ID=your-apple-team-id
APNS_KEY_ID=your-apns-key-id
APNS_PRIVATE_KEY=your-apns-p8-private-key
APNS_ENV=production
EMAIL_FROM="BusWakeUp <noreply@example.com>"
SMTP_URL=smtps://user:password@smtp.example.com:465
WEB_PUSH_VAPID_SUBJECT=mailto:ops@example.com
WEB_PUSH_VAPID_PUBLIC_KEY=your-vapid-public-key
WEB_PUSH_VAPID_PRIVATE_KEY=your-vapid-private-key
```

If these are not set, the app stays in demo mode or records the gateway handoff as blocked.

## How to test

```bash
npm test
```

## Mobile Flutter commands

From the repository root:

```bash
npm run mobile:doctor
npm run mobile:pub:get
npm run mobile:analyze
npm run mobile:test
npm run mobile:build:web
npm run mobile:build:apk:debug
```

Verified on this workstation:

- Flutter 3.44.5 installed locally at `C:\Users\User\flutter-sdk`
- Android command-line SDK installed locally at `C:\Users\User\Android\sdk`
- `mobile_app` now contains real `android/`, `ios/`, and `web/` Flutter scaffolding
- `flutter analyze`, `flutter test`, `flutter build web`, and `flutter build apk --debug` all completed successfully
- Latest Android debug APK output: `mobile_app/build/app/outputs/flutter-apk/app-debug.apk`

## Important limitations

- This is still a prototype web app, not a shipped Flutter, Android, or iOS production app.
- The Flutter app now has an FCM runtime that registers the current Android/iPhone FCM token only after the rider requests permission, creates Android mechanical-sound/vibration channels, and uses the same bundled sound for iPhone foreground notifications. Live background delivery still requires the owner-controlled Firebase, APNs, server credential, signing, and physical-device validation steps documented in `mobile_app/README.md`.
- Android/iPhone background notifications use OS-managed sound and vibration. The repeated Korean TTS warning is verified only while the app is in the foreground; background speech playback is not guaranteed by either mobile OS.
- FCM `UNREGISTERED` and invalid-token replies now stop reuse of that token, do not enter the retry queue, and require the current phone to register a fresh FCM token before the next push attempt.
- The server now exposes only the browser entry point and browser-side `src` files. It no longer serves `data/`, backend source, auth session files, or user alarm files as static downloads.
- The file-backed prototype serializes runtime requests and scheduled ticks inside one process so one user's active alarm context cannot switch into another user's request. A production launch still needs transactional database storage before multi-instance scaling.
- Alarm day, weekday, and scheduled clock calculations are now fixed to `Asia/Seoul`, regardless of the server host timezone.
- Provider and push gateway requests now have an 8-second upper bound, so one stalled upstream should not hold the in-process alarm scheduler indefinitely.
- Mobile sessions now restore from encrypted device storage, and release builds require an HTTPS API URL. Changing the saved server URL clears the old session first.
- Android release builds now include `INTERNET`. They no longer fall back to the Android debug signing key; an owner-controlled `android/key.properties` keystore configuration is required before distribution.
- Email/password accounts now include one-time email verification and password reset links. Configure SMTP to deliver them; without SMTP, the server safely creates the link in preview mode but cannot send email.
- Google OAuth start and callback routes are now wired into the prototype, but they still require real Google OAuth web credentials to complete a live sign-in.
- Apple OAuth readiness is now checked explicitly, but Apple login still needs a public HTTPS `APP_BASE_URL`; the current `127.0.0.1` prototype URL is blocked by Apple's redirect URI rules.
- Apple callback handling verifies the signed Apple ID token, issuer, audience, expiry, and one-time nonce before using its claims. It still needs validation with the owner's live Apple developer credentials.
- The server now stores data per signed-in local user, but it is still file-based storage, not a production database or hosted multi-region backend.
- Kakao Maps requires the owner to register the production domain and provide `KAKAO_JAVASCRIPT_KEY`; without it, the app keeps saved coordinates but deliberately shows no interactive map.
- Live public transit API usage still requires official stop and route identifiers.
- The prototype now follows an accuracy-first policy. In the current product rule, TAGO is treated as the first ETA candidate for Gyeonggi, while Seoul Direct remains the first candidate for Seoul.
- ETA accuracy scoring currently improves when someone logs the real arrival moment, because the server then converts pending forecasts into measured provider error samples.
- Signed-in sessions now run an automatic ETA probe loop for configured providers. The prototype only re-runs the same probe set after a 60-second cooldown.
- When 2 or more configured providers converge to an imminent arrival for the same route and stop, the server can now auto-record a real arrival sample without waiting for a manual button tap.
- Measured ETA data does not flip the provider recommendation immediately. The prototype keeps the product default until at least 2 providers each have 2 or more resolved samples, and the measured winner leads by at least 0.5 minutes of mean absolute error.
- The measured recommendation now uses a recent-weighted accuracy score, so newer arrival samples count more strongly than older samples when the server decides which provider is best for a route and stop.
- When the user has an alarm window such as `07:00 - 07:45`, the ETA scorer now tries to rank providers from that same time slice first. It only falls back to all-day scored arrivals when the window does not yet have enough compared provider samples.
- The scorer now goes one step further and prefers the same weekday inside that alarm window first. For example, a Friday morning recommendation can learn from past Friday morning arrivals before it falls back to the wider `07:00 - 07:45` window or all-day history.
- ETA scoring now also carries a canonical stop key when possible, so the same real stop does not get split into separate accuracy buckets just because one provider labels it slightly differently from another.
- Measured ETA history no longer flips the live recommendation if it is stale. Even when a provider has enough total samples, the app now requires fresh scored arrivals inside the recent 7-day window before that measured history can override the safer product default.
- The runtime now also keeps the latest live ETA spread across comparable providers, so the home accuracy monitor can warn when providers are currently tightly aligned, mildly split, or sharply diverged.
- When that live ETA spread is sharply diverged, the automatic ETA probe loop now tightens its cadence and the alarm copy itself warns that real-time provider data is currently unstable.
- That same live ETA spread now also drives a conservative dashboard mode: the home screen tells the rider to leave more cautiously, the late-risk engine now grows its safety buffer from 1 up to 3 minutes as provider ETAs split farther apart, and the UI temporarily holds back source-switch recommendations until the spread settles down.
- When that conservative buffer is active, the alert body and spoken TTS copy now also explain the current extra buffer in minutes, so the rider can hear why the app is asking for an earlier departure.
- That same conservative ETA context is now preserved end-to-end in local history, the server event log, dispatch bundles, dispatch executions, push gateway attempts, and retry queue items, so you can trace exactly why a more cautious alert was generated and delivered.
- The home dashboard now also summarizes those recent conservative traces into a single reliability panel, showing how often conservative mode fired in the loaded window, which route-stop pairs triggered it the most, and how deep each trace traveled through the alert pipeline.
- That same reliability panel now also slices those loaded conservative traces by weekday and by the configured alarm window, so you can quickly see whether Monday morning, Friday morning, or outside-window samples are driving the cautious ETA behavior.
- Signed-in users now receive that conservative reliability panel from the server as a rolling 7-day summary, so older conservative traces fall out automatically instead of lingering forever in the home dashboard.
- That same rolling summary now also builds a route-stop watchlist, so the dashboard can call out which commute pairs are structurally unstable right now instead of only listing the most recent conservative traces.
- The home hero card now surfaces that watchlist immediately, prioritizing the currently selected commute pair when it is on the watchlist and otherwise showing the strongest caution route for today.
- That rolling 7-day conservative history now also feeds back into the automatic ETA probe cadence. If the same route-stop pair, or the same weekday alarm window, has recently triggered conservative mode several times, the server probes a little faster even before the current ETA spread becomes severe again.
- That same recent instability history now also pulls the auto-probe start earlier before the morning window: normal routes begin 15 minutes early, elevated watchlist routes begin 20 minutes early, and high watchlist routes begin 30 minutes early.
- For those same `high` watchlist routes, the final 10 minutes before the normal morning window now switch into a denser ETA probe warmup cadence so the server refreshes arrival estimates more aggressively right before the first main alarm.
- When that same rolling history is `high`, the daily alarm plan can now add one extra `stability precheck` 10 minutes before the normal window so the rider gets an earlier heads-up on structurally unstable commute pairs.
- That same historical conservative bias now also flows into the actual alert copy, so the rider can hear when a route-stop pair has been shaky for several recent mornings and why the app is staying cautious.
- That same recent instability history now also changes the live ETA guard itself: even a mild `watch`-level split can temporarily hold source switching, and a `high` recent instability route can escalate that mild split into a conservative leave-now posture with a 1-minute risk buffer.
- The ETA accuracy monitor now also exposes a route/stop leaderboard, so you can see which provider is currently winning across multiple tracked commute pairs instead of only the one on screen.
- Automatic ETA probing now adapts its cadence to the morning window and bus imminence: it pauses outside the active schedule window, then speeds up to 15s / 30s / 45s / 90s inside the window depending on how soon the bus is expected.
- Live binding inputs are now remembered per provider, so you can switch between TAGO, Seoul, and Gyeonggi candidates without losing each provider's stop and route IDs.
- Address search works with the built-in demo library by default and switches to live Kakao Local results only when `KAKAO_LOCAL_REST_API_KEY` is configured.
- Walking commute estimates use Kakao Mobility when `KAKAO_MOBILITY_REST_API_KEY` is present and fall back to a straight-line local estimate otherwise. If you already use `KAKAO_LOCAL_REST_API_KEY`, the prototype can also reuse that key for the walking estimate route as a local convention.
- Holiday sync requires `HOLIDAY_API_SERVICE_KEY`.
- Dispatch queue generation remains server-side planning; gateway handoff sends real FCM, APNs, or Web Push traffic only when `PUSH_GATEWAY_MODE=execute` and the matching provider credentials are present.
- Dispatch execution is still mostly a simulation layer for the non-push channels.
- Push preview is an internal adapter-envelope preview, not a direct provider HTTP request.
- The push gateway can build real FCM request blueprints and can attempt FCM send when either a short-lived bearer token or service-account credentials are supplied.
- New dispatch bundles are now auto-handed off to the push gateway once per `dispatchKey`, so the server no longer depends only on a manual button press to record push attempts.
- Only retryable provider failures, such as network errors, HTTP `429`, or HTTP `5xx`, enter the automatic retry queue. Blocked configuration errors and hard `4xx` provider rejections do not auto-retry.
- The prototype now includes a retry simulation path so you can seed a retryable failure and replay the due retry without real Firebase credentials.
- The retry simulation path now also supports replaying a due retry as a hard HTTP `400` failure and clearing simulation-only retry records afterward.
- When service-account credentials are supplied, the prototype can mint a short-lived FCM OAuth token on demand and cache it until shortly before expiry.
- Service-account credentials can now come from inline environment variables, a JSON blob, or a local service-account file path.
- Device token registration now normalizes Android FCM tokens, iOS APNs tokens, and complete browser Web Push subscriptions before preview or gateway handoff.
- You can now run a manual test push even when there is no active morning dispatch bundle, as long as the stored token format is acceptable for that platform.
- The push gateway can send direct APNs requests over HTTP/2 when `APNS_BUNDLE_ID`, `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`, and `PUSH_GATEWAY_MODE=execute` are configured. It signs and refreshes the short-lived ES256 bearer token in-process; APNs credentials and physical-device tokens still require owner setup and validation.
- Browser Web Push is end-to-end: the web settings page requests permission, registers `/sw.js`, saves a complete encrypted subscription, and sends it with VAPID credentials when execute mode is enabled.
- Browser auto-play still depends on normal browser media permission rules, so the page may need one tap before sound can start automatically.
- `/api/alarm-runtime` now also ships a server-side `deliveryIntensity` summary, so the new mobile app and the web dashboard can consume the same strongest-alert, top-attention, and top-issue logic instead of re-implementing it separately.
- The Flutter shell now builds on this Windows workstation for web and Android debug output, but iPhone builds still require macOS with Xcode, and real Android/iPhone notification behavior still needs device-level validation.

## Main files

- `index.html`: app entry
- `server.mjs`: local API server and runtime orchestration
- `mobile_app/`: first Flutter mobile shell for Android and iPhone targets
- `src/app.js`: UI rendering and browser-side behavior
- `src/state.js`: prototype state and sanitizing
- `src/logic/commute.js`: commute timing and schedule logic
- `src/logic/notification-engine.js`: escalation, vibration, sound, and spoken-copy logic
- `src/domain-model.js`: profile, route, schedule, and notification snapshot mapping
- `src/server/auth-service.mjs`: password hashing, session cookies, and auth helpers
- `src/server/auth-store.mjs`: persisted auth user and session storage
- `src/server/user-storage.mjs`: per-user data file path helpers
- `src/server/alarm-runtime.mjs`: server-side trigger execution tracking
- `src/server/alarm-delivery.mjs`: active alarm response flow
- `src/server/dispatch-engine.mjs`: dispatch bundle planning
- `src/server/dispatch-execution-engine.mjs`: simulated per-channel execution results
- `src/server/push-preview.mjs`: provider-adapter envelope preview
- `src/server/push-gateway.mjs`: provider handoff planning and FCM-capable gateway execution
- `src/server/push-gateway-simulation.mjs`: retry simulation helpers for demoing failure and replay without live provider credentials
- `src/server/push-gateway-runtime.mjs`: automatic push handoff deduplication and attempt recording
- `src/server/push-gateway-store.mjs`: push gateway attempt persistence
- `src/server/bus-providers.mjs`: accuracy-first Seoul, Gyeonggi, and TAGO adapter policy
- `src/server/bus-accuracy.mjs`: provider ETA observation, actual-arrival scoring, and recommendation summary logic
- `src/server/bus-accuracy-store.mjs`: per-user ETA accuracy persistence
- `src/server/bus-accuracy-runtime.mjs`: automatic ETA probe cooldown and runtime counters
- `src/server/bus-accuracy-runtime-store.mjs`: per-user automatic ETA probe runtime persistence
- `src/server/place-providers.mjs`: Kakao Local and demo address search adapters
- `src/server/route-providers.mjs`: Kakao walking route and straight-line fallback adapters
- `src/server/holiday-providers.mjs`: official holiday API adapter
- `src/styles.css`: UI styling
- `tests/`: automated tests





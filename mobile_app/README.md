# BusWakeUp Mobile Shell

This folder contains the first Flutter mobile-app workspace for the BusWakeUp product.

## What is inside

- Cross-platform app shell for Android and iPhone targets
  - The mobile API client now auto-adds `http://` to bare LAN host inputs like `192.168.0.10:4173`, validates malformed server URLs early, and times out network checks instead of hanging indefinitely
- Email sign-in and sign-up flow against the existing local server
  - The auth screen now lets QA save and verify the server URL before sign-in, showing reachability, launch focus, push mode, and the recommended ETA provider order from `/api/mobile/health`
- Operations dashboard that reads:
  - `/api/account`
  - `/api/alarm-runtime`
  - `/api/device-profile`
  - `/api/bus/accuracy/leaderboard`
- Commute setup flow that now reaches:
  - `/api/profile`
  - `/api/route`
  - `/api/schedule`
  - `/api/notification-settings`
  - `/api/places/search`
  - `/api/bus/stations`
  - `/api/bus/station-routes`
  - `/api/commute/estimate`
  - When TAGO is selected, the mobile shell now disables station and route search buttons up front and switches to explicit manual binding guidance for city code, node id, route id, route number, and stop order
  - The same setup screen now follows provider setup metadata from `/api/bus/config`, so binding mode and search support stay aligned with the backend policy instead of drifting inside the app shell
- Accuracy tab tuned for Seoul and Gyeonggi launch checks
- Device and push-health tab for token and gateway monitoring
  - In-app server endpoint editor for switching from localhost to a reachable LAN or HTTPS host during real-device testing; Android debug and iOS local-network access permit HTTP only for that local testing path, while release builds require HTTPS
  - The same API base URL now persists across app restarts with `shared_preferences`, so a real-device LAN or HTTPS host does not have to be re-entered every launch
  - A dedicated `Run server health check` action now verifies that the saved host is a reachable BusWakeUp server before the first push test
  - The same card now classifies the launch host into plain-language verdicts like `LOCALHOST MISMATCH RISK`, `LAN TEST MODE`, `GATEWAY AUTH BLOCKED`, and `READY FOR REAL-DEVICE TEST`
  - The same verdict block now adds a launch checklist and a verdict-specific primary action button, so a tester can jump straight to LAN correction, gateway re-check, or the first real-device push flow
  - A separate `Real-device push test flow` card now walks through the exact order: register token, check permissions, confirm readiness, and run the test push
  - The same flow card now remembers the last completed step locally, explains where QA should resume from that saved progress, upgrades the main button copy into labels like `Continue with Step 3 readiness checks`, shows `Why paused` and `Operator hint` directly from the live rollout checks, keeps `Reset saved progress` cleared across refresh until new progress is made, lets warning-only states continue to the next step instead of blocking the flow, shows the saved checkpoint detail, and can reset only the saved progress when QA wants to restart the checklist without changing live token or gateway state
  - The same tab now initializes a real FCM device-notification runtime without prompting at startup, shows whether Firebase and OS notification permission are ready, and registers the current phone's FCM token after the user presses `Enable and register this phone`
  - Android foreground and background FCM alerts use stable `buswakeup-critical` / `buswakeup-morning` notification channels with the bundled `mechanical_alarm.wav` sound and vibration patterns
  - iPhone foreground alerts use the same bundled sound; iPhone background alerts use the FCM-to-APNs handoff after APNs is connected to Firebase
  - When FCM reports an `UNREGISTERED` or invalid registration token, the server blocks that token instead of retrying later alarms; the Device tab shows `TOKEN REFRESH REQUIRED` and provides a one-tap current-token re-registration action
  - The same tab also includes a foreground-only `Local late-alarm preview` button that plays the mechanical alarm tone, strong vibration pattern, and repeated Korean TTS phrase `이 버스 놓치면 지각이다.` on the device itself
  - `/api/device-profile`
  - `/api/device-profile/token-health`
  - `/api/device-profile/register-token`
  - `/api/push-gateway/config`
  - `/api/fcm-auth/status`
  - `/api/push-preview`
  - `/api/push-gateway/attempts`
  - `/api/push-gateway/dispatch`
  - `/api/push-gateway/test-dispatch`
  - `/api/push-gateway/retry-simulation`
  - A `Push launch readiness` summary card that combines token readiness, push-preview state, gateway credential health, and the latest gateway attempt into one rollout check
  - A `Launch blockers` card that separates hard blockers from softer warnings before the first real-device push test
- Mobile launch overview now also reads the server-side `deliveryIntensity` report
  - `Top attention` shows the current highest-priority delivery problem
  - `Top issue` shows the most repeated delivery problem bucket for the day
  - Both cards now expose the same quick actions and open-target buttons that the web prototype already computes on the server
- The same Overview tab now also surfaces the server-side `stabilityWatch` and the top conservative watchlist pair
  - Current watch level, recent route/weekday trace counts, and precheck trigger timing
  - One-tap jump into the Accuracy tab when today's route is under reinforced instability monitoring
- The same Overview tab now also adds a `Reinforced watch today` summary card
  - Current route, watch level, precheck counts, next trigger, and delivery priority
  - One-tap jump into either the Accuracy tab or the Device push-health tab when today's route is under reinforced monitoring
  - The same card now also shows the current `Top attention` outcome/action/status and reuses the same server-driven quick action buttons directly inside the reinforced-watch context
  - The same card now also shows the strongest alert route, playback plan, and strongest delivery outcome, so launch operators can see instability, delivery risk, and alert strength in one place

## Verified local status

- Flutter 3.44.5 is now installed locally at `C:\Users\User\flutter-sdk`
- Android command-line SDK is now installed locally at `C:\Users\User\Android\sdk`
- The `mobile_app` folder is now a real Flutter project with `android/`, `ios/`, and `web/` scaffolding
- Verified on this workstation:
  - `flutter analyze`
  - `flutter test`
  - `flutter build web`
  - `flutter build apk --debug`
- Latest verified Android debug APK output:
  - `mobile_app/build/app/outputs/flutter-apk/app-debug.apk`

## Useful commands

From the repository root:

1. `npm run mobile:doctor`
2. `npm run mobile:pub:get`
3. `npm run mobile:analyze`
4. `npm run mobile:test`
5. `npm run mobile:build:web`
6. `npm run mobile:build:apk:debug`

## Remaining platform work

1. Copy `android/key.properties.example` to `android/key.properties` and set the owner-controlled Android release keystore before making a distributable Android release. The release build no longer falls back to the Android debug key.
2. Create/select the BusWakeUp Firebase project and run `flutterfire configure` in this folder for Android and iOS. It replaces `lib/firebase_options.dart`, which is currently a build-safe placeholder that deliberately leaves FCM disabled.
3. Configure the server with `FCM_PROJECT_ID` and a service-account credential, then set `PUSH_GATEWAY_MODE=execute` on a publicly reachable HTTPS backend. Do not use a short-lived manually copied OAuth token for production.
4. In Firebase Console, upload the Apple APNs `.p8` key with Apple Team ID and Key ID. On macOS, open `ios/Runner.xcworkspace`, choose the paid Apple Developer team, and verify the Push Notifications plus Background Modes capabilities. The iPhone target now requires iOS 15 or later because the installed Firebase plugins require it.
5. Build and validate on one physical Android phone and one physical iPhone. iPhone FCM/APNs registration cannot be validated in the iOS simulator.
6. Background delivery uses OS-managed mechanical sound and vibration. The repeated Korean TTS warning remains foreground-only because Android and iOS do not guarantee arbitrary background speech playback.
7. The app now includes an Android permission action for exact alarms, full-screen intent, and DND policy access, plus a daily Asia/Seoul local-backup alarm. The OS and app-store policy can still deny these capabilities, so validate the returned device state on each real phone. iOS uses time-sensitive local notifications and does not promise full-screen/DND bypass behavior.





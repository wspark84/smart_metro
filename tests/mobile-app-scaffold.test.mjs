import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";

const root = new URL("../mobile_app/", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

async function dartFiles(dir) {
  const entries = await readdir(new URL(dir, root), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = `${dir}${entry.name}${entry.isDirectory() ? "/" : ""}`;
    if (entry.isDirectory()) files.push(...await dartFiles(path));
    else if (entry.name.endsWith(".dart")) files.push(path);
  }
  return files;
}

test("mobile Flutter workspace scaffold exists", async () => {
  const pubspec = await read("pubspec.yaml");
  const androidGradle = await read("android/app/build.gradle.kts");
  const androidManifest = await read("android/app/src/main/AndroidManifest.xml");
  const pushRuntime = await read("lib/core/device/mobile_push_runtime.dart");
  assert.match(pubspec, /name:\s+buswakeup_mobile/);
  for (const dep of ["firebase_core", "firebase_messaging", "flutter_local_notifications", "supabase_flutter", "in_app_purchase", "url_launcher"]) {
    assert.match(pubspec, new RegExp(`${dep}:`), dep);
  }
  assert.match(androidGradle, /applicationId = "com\.buswakeup\.buswakeup_mobile"/);
  assert.match(androidGradle, /hasReleaseSigning/);
  assert.doesNotMatch(androidGradle, /signingConfig = signingConfigs\.getByName\("debug"\)/);
  assert.match(androidManifest, /POST_NOTIFICATIONS/);
  assert.match(androidManifest, /SCHEDULE_EXACT_ALARM/);
  assert.match(pushRuntime, /FirebaseMessaging\.onBackgroundMessage/);
  assert.match(pushRuntime, /requestPermissionAndGetToken/);
});

test("the store build opens the consumer app, not developer tools", async () => {
  const app = await read("lib/app/bus_wakeup_app.dart");
  const rootScreen = await read("lib/features/root/inochi_root.dart");
  assert.match(app, /home: const InochiRoot\(\)/);
  for (const screen of ["TodayScreen", "SocialLoginScreen"]) assert.match(rootScreen, new RegExp(screen));
  const today = await read("lib/features/today/today_screen.dart");
  for (const screen of ["SettingsScreen", "OnboardingScreen"]) assert.match(today, new RegExp(screen));
  for (const removed of ["features/operations/mobile_operations_screen.dart", "features/auth/auth_workspace_screen.dart", "features/root/mobile_root_screen.dart",
    "features/home/home_screen.dart", "features/trips/trips_screen.dart"]) {
    await assert.rejects(access(new URL(`lib/${removed}`, root)), removed);
  }
  // No developer wording or server-address fields anywhere in the app UI.
  for (const file of await dartFiles("lib/features/")) {
    const source = await read(file);
    for (const forbidden of [/BusWakeUp Ops/, /Launch blockers/, /API base URL/, /Overview/, /Smart Metro/, /�/]) {
      assert.doesNotMatch(source, forbidden, `${file} ${forbidden}`);
    }
  }
});

test("consumer app uses the server app API and store-required account features", async () => {
  const api = await read("lib/core/network/inochi_api.dart");
  for (const path of ["/api/mobile/home", "/api/mobile/setup", "/api/mobile/today", "/api/mobile/stops/nearby", "/api/mobile/stops/describe", "/api/account/delete",
    "/api/device-profile/register-token", "/api/alarm-delivery/actions", "/api/bus/station-routes", "/api/places/search"]) {
    assert.ok(api.includes(path), path);
  }
  assert.match(api, /uri\.origin != MobileSocialAuth\.origin/, "login token is only sent to the production origin");
  const settings = await read("lib/features/settings/settings_screen.dart");
  for (const text of ["회원 탈퇴", "개인정보처리방침", "이용약관", "/privacy", "/terms"]) assert.ok(settings.includes(text), text);
  const deletion = await read("lib/features/settings/account_delete_screen.dart");
  assert.match(deletion, /탈퇴만으로는 Google Play 결제가 멈추지 않아요/);
  const basis = await read("lib/features/common/basis_chip.dart");
  assert.match(basis, /'timetable' => '시간표 기준'/);
  const today = await read("lib/features/today/today_screen.dart");
  assert.match(today, /scheduleDepartureBackup/);
  assert.match(today, /cancelDepartureBackup/);
  assert.match(settings, /매일 자동 알림/);
  assert.match(settings, /ThemeMode\.dark/);
  const login = await read("lib/features/auth/social_login_screen.dart");
  assert.match(login, /만 14세 이상/);
});

test("stop picker shows a Kakao map and never ships the map key in source", async () => {
  const pubspec = await read("pubspec.yaml");
  assert.match(pubspec, /kakao_map_sdk:/);
  assert.match(pubspec, /BlackHanSans-Regular\.ttf/);
  await access(new URL("assets/fonts/BlackHanSans-OFL.txt", root));
  const map = await read("lib/features/stops/stop_map.dart");
  assert.match(map, /String\.fromEnvironment\('KAKAO_NATIVE_APP_KEY'\)/);
  assert.match(map, /import 'package:kakao_map_sdk\/kakao_map_sdk\.dart' as kakao;/, "prefixed: kakao exports Badge/Route names");
  const confirm = await read("lib/features/stops/stop_confirm_screen.dart");
  for (const text of ["반대 방향이에요", "방면으로 가는 쪽", "정류장 표지판의 번호"]) assert.ok(confirm.includes(text), text);
  const proguard = await read("android/app/proguard-rules.pro");
  assert.match(proguard, /-keep class com\.kakao\.vectormap\.\*\* \{ \*; \}/);
  const gradle = await read("android/build.gradle.kts");
  assert.match(gradle, /devrepo\.kakao\.com\/nexus\/repository\/kakaomap-releases/);
  const manifest = await read("android/app/src/main/AndroidManifest.xml");
  assert.doesNotMatch(manifest, /ACCESS_FINE_LOCATION/, "stop search does not need the phone's location");
});

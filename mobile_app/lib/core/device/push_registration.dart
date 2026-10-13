import 'dart:async';

import 'package:flutter/foundation.dart';

import '../network/inochi_api.dart';
import 'local_alarm_scheduler.dart';
import 'mobile_push_runtime.dart';

/// Connects this phone to the server's push alarms. Returns `null` when the
/// phone is registered, otherwise a Korean message explaining what to do.
class PushRegistration {
  static StreamSubscription<String>? _refreshSubscription;

  static Future<String?> register(InochiApi api) async {
    final result = await MobilePushRuntime.instance.requestPermissionAndGetToken();
    if (!result.ready) {
      final status = MobilePushRuntime.instance.status;
      if (status.state == 'PERMISSION DENIED') {
        return '휴대폰 설정에서 이노치 알림을 허용한 뒤 다시 눌러 주세요.';
      }
      if (!status.firebaseReady) {
        return '이 앱 빌드에서는 알림 연결을 사용할 수 없습니다. 고객센터로 문의해 주세요.';
      }
      return '알림 연결에 실패했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.';
    }
    final deviceName = defaultTargetPlatform == TargetPlatform.iOS ? 'iPhone' : 'Android 휴대폰';
    await api.registerPushToken(token: result.token, platform: result.platform, deviceName: deviceName);
    await api.updateDevice({
      'pushEnabled': true,
      'soundEnabled': true,
      'vibrationEnabled': true,
      'fullScreenEnabled': defaultTargetPlatform == TargetPlatform.android,
    });
    _refreshSubscription ??= MobilePushRuntime.instance.tokenRefreshes.listen((token) {
      unawaited(api
          .registerPushToken(token: token, platform: result.platform, deviceName: deviceName)
          .then((_) {}, onError: (_) {}));
    });
    return null;
  }

  /// Android 12+ needs separate consent for exact alarms and full-screen
  /// alerts; Android shows its own settings pages.
  static Future<void> requestAlarmPermissions() async {
    if (defaultTargetPlatform != TargetPlatform.android) return;
    await LocalAlarmScheduler.instance.requestAndroidAlarmPermissions();
  }
}

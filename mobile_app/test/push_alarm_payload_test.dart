import 'package:flutter_test/flutter_test.dart';

import 'package:buswakeup_mobile/core/device/push_alarm_payload.dart';

void main() {
  test('critical FCM payload uses the urgent Android channel', () {
    final payload = PushAlarmPayload.fromRemoteFields(
      title: '지각 방지 긴급 알림',
      body: '이 버스 놓치면 지각이다.',
      data: <String, dynamic>{
        'dispatchKey': '2026-07-13:alarm-1',
        'routeNumber': '8109',
        'riskLevel': 'RED',
        'stage': '2',
      },
    );

    expect(payload.isCritical, isTrue);
    expect(payload.androidChannelId, 'buswakeup-critical');
    expect(payload.notificationId, greaterThan(0));
  });

  test('normal FCM payload uses the morning Android channel', () {
    final payload = PushAlarmPayload.fromRemoteFields(
      title: null,
      body: null,
      data: <String, dynamic>{
        'routeNumber': '1002',
        'riskLevel': 'GREEN',
      },
    );

    expect(payload.isCritical, isFalse);
    expect(payload.androidChannelId, 'buswakeup-morning');
    expect(payload.title, '1002 bus commute alarm');
  });
}

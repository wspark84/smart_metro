import 'package:buswakeup_mobile/core/device/push_alarm_payload.dart';
import 'package:flutter_test/flutter_test.dart';

PushAlarmPayload alarm(Map<String, dynamic> data) =>
    PushAlarmPayload.fromRemoteFields(title: null, body: null, data: data);

void main() {
  final now = DateTime.parse('2026-11-03T11:47:00Z'); // 20:47 KST

  test('the alarm reads the minutes left at the moment it rings', () {
    final payload = alarm({'title': '집에서 출발까지 3분', 'departureAt': '2026-11-03T11:50:00Z', 'routeNumber': '7'});
    expect(payload.title, '집에서 출발까지 3분');
    expect(alarmSpeech(payload, now), '집에서 출발까지 3분 남았습니다. 오후 8시 50분까지 나가세요. 7번 버스를 타야 해요.');
    expect(alarmSpeech(payload, now.add(const Duration(minutes: 2))), startsWith('집에서 출발까지 1분'));
    expect(alarmSpeech(payload, now.add(const Duration(minutes: 3))), '지금 집에서 출발하세요! 7번 버스를 타야 해요.');
  });

  test('late and leave-now alarms are urgent; subway names read naturally', () {
    final late = alarm({'triggerKind': 'late', 'departureAt': '2026-11-03T11:45:00Z', 'routeNumber': '신분당선'});
    expect(late.isCritical, isTrue);
    expect(late.androidChannelId, urgentAlarmChannelId);
    expect(alarmSpeech(late, now), '지각 위험! 바로 뛰어나가세요. 신분당선을 타야 해요.');
    expect(alarm({'riskLevel': 'YELLOW'}).androidChannelId, alarmChannelId);
  });

  test('without a leave time the server text is read', () {
    expect(alarmSpeech(alarm({'title': '[시험] 이노치 알람 점검', 'spokenText': '시험 알람입니다.'}), now), '시험 알람입니다.');
    expect(spokenClock(DateTime.parse('2026-11-02T23:00:00Z')), '오전 8시');
    expect(objectParticle('버스'), '를');
    expect(objectParticle('신분당선'), '을');
  });
}

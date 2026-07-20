import 'package:buswakeup_mobile/core/device/native_alarm_preview_spec.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('must-catch preview spec uses the repeated Korean late warning', () {
    final spec = buildMustCatchNativeAlarmPreviewSpec(
      routeNumber: '1002',
      currentArrivalMin: 3,
      nextArrivalMin: 19,
    );

    expect(spec.soundPresetId, 'mechanical');
    expect(spec.repeatedLateWarningPhrase, contains('이 버스 놓치면 지각이다.'));
    expect(spec.body, contains('1002번 버스 3분 후 도착.'));
    expect(spec.body, contains('다음 버스는 19분 후 도착.'));
    expect(spec.speechText, contains('지금 바로 이동하세요.'));
    expect(spec.vibrationPattern, <int>[1000, 200]);
    expect(spec.vibrationRepeats, 8);
    expect(spec.mechanicalLoopCount, 8);
    expect(spec.previewDuration, const Duration(milliseconds: 7600));
  });

  test('repeated late warning helper clamps repeat count to at least one', () {
    expect(buildRepeatedLateWarningPhrase(0), '이 버스 놓치면 지각이다.');
    expect(
      buildRepeatedLateWarningPhrase(2),
      '이 버스 놓치면 지각이다. 이 버스 놓치면 지각이다.',
    );
  });
}

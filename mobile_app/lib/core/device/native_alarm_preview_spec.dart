class NativeAlarmPreviewSpec {
  const NativeAlarmPreviewSpec({
    required this.routeNumber,
    required this.currentArrivalMin,
    required this.nextArrivalMin,
    required this.title,
    required this.body,
    required this.speechText,
    required this.lateWarningPhrase,
    required this.repeatedLateWarningPhrase,
    required this.soundPresetId,
    required this.assetPath,
    required this.volumePercent,
    required this.vibrationPattern,
    required this.vibrationRepeats,
    required this.mechanicalLoopCount,
    required this.assetCycleMs,
  });

  final String routeNumber;
  final int currentArrivalMin;
  final int nextArrivalMin;
  final String title;
  final String body;
  final String speechText;
  final String lateWarningPhrase;
  final String repeatedLateWarningPhrase;
  final String soundPresetId;
  final String assetPath;
  final int volumePercent;
  final List<int> vibrationPattern;
  final int vibrationRepeats;
  final int mechanicalLoopCount;
  final int assetCycleMs;

  Duration get previewDuration =>
      Duration(milliseconds: assetCycleMs * mechanicalLoopCount);
}

const String mustCatchLateWarningPhrase = '이 버스 놓치면 지각이다.';

String buildRepeatedLateWarningPhrase([int repeatCount = 2]) {
  final safeCount = repeatCount < 1 ? 1 : repeatCount;
  return List<String>.filled(safeCount, mustCatchLateWarningPhrase).join(' ');
}

NativeAlarmPreviewSpec buildMustCatchNativeAlarmPreviewSpec({
  String routeNumber = '8109',
  int currentArrivalMin = 4,
  int nextArrivalMin = 21,
}) {
  final safeRoute = routeNumber.trim().isEmpty ? '등록된' : routeNumber.trim();
  final safeCurrentArrival = currentArrivalMin < 1 ? 1 : currentArrivalMin;
  final safeNextArrival = nextArrivalMin < safeCurrentArrival
      ? safeCurrentArrival + 10
      : nextArrivalMin;
  final repeatedWarning = buildRepeatedLateWarningPhrase(2);

  return NativeAlarmPreviewSpec(
    routeNumber: safeRoute,
    currentArrivalMin: safeCurrentArrival,
    nextArrivalMin: safeNextArrival,
    title: '지각 방지 긴급 알림',
    body:
        '$safeRoute번 버스 $safeCurrentArrival분 후 도착. $repeatedWarning 다음 버스는 $safeNextArrival분 후 도착.',
    speechText:
        '$safeRoute번 버스 $safeCurrentArrival분 후 도착. $repeatedWarning 지금 바로 이동하세요.',
    lateWarningPhrase: mustCatchLateWarningPhrase,
    repeatedLateWarningPhrase: repeatedWarning,
    soundPresetId: 'mechanical',
    assetPath: 'audio/mechanical_alarm.wav',
    volumePercent: 100,
    vibrationPattern: const <int>[1000, 200],
    vibrationRepeats: 8,
    mechanicalLoopCount: 8,
    assetCycleMs: 950,
  );
}

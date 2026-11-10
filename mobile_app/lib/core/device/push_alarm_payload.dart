class PushAlarmPayload {
  const PushAlarmPayload({
    required this.title,
    required this.body,
    required this.routeNumber,
    required this.stopName,
    required this.riskLevel,
    required this.stage,
    required this.dispatchKey,
    required this.deliveryPriorityClass,
    this.spokenText = '',
    this.departureAt = '',
    this.triggerKind = '',
  });

  final String title;
  final String body;
  final String routeNumber;
  final String stopName;
  final String riskLevel;
  final String stage;
  final String dispatchKey;
  final String deliveryPriorityClass;
  final String spokenText;
  final String departureAt;
  final String triggerKind;

  bool get isCritical {
    return riskLevel.toUpperCase() == 'RED' ||
        deliveryPriorityClass.toLowerCase() == 'boosted' ||
        triggerKind == 'leave-now' ||
        triggerKind == 'late';
  }

  /// v2 channels ring on the alarm volume (also in silent mode) with a short
  /// tone; the app then reads the time left aloud.
  String get androidChannelId => isCritical ? urgentAlarmChannelId : alarmChannelId;

  int get notificationId {
    var hash = 17;
    for (final unit in '$dispatchKey:$stage:$routeNumber'.codeUnits) {
      hash = 37 * hash + unit;
    }
    return hash & 0x7fffffff;
  }

  factory PushAlarmPayload.fromRemoteFields({
    required String? title,
    required String? body,
    required Map<String, dynamic> data,
  }) {
    final routeNumber = _read(data, 'routeNumber');
    return PushAlarmPayload(
      title: _prefer(title, _prefer(_read(data, 'title'), '이노치 출근 알림')),
      body: _prefer(body, _prefer(_read(data, 'body'), _read(data, 'spokenText'))),
      routeNumber: routeNumber,
      stopName: _read(data, 'stopName'),
      riskLevel: _read(data, 'riskLevel'),
      stage: _read(data, 'stage'),
      dispatchKey: _read(data, 'dispatchKey'),
      deliveryPriorityClass: _read(data, 'deliveryPriorityClass'),
      spokenText: _read(data, 'spokenText'),
      departureAt: _read(data, 'departureAt'),
      triggerKind: _read(data, 'triggerKind'),
    );
  }

  static String _read(Map<String, dynamic> data, String key) =>
      (data[key] ?? '').toString().trim();

  static String _prefer(String? value, String fallback) {
    final safe = (value ?? '').trim();
    return safe.isEmpty ? fallback : safe;
  }
}

const alarmChannelId = 'inochi-alarm-v2';
const urgentAlarmChannelId = 'inochi-urgent-v2';

/// "오후 8시 55분" in Korea time, written the way it should be read aloud.
String spokenClock(DateTime at) {
  final kst = at.toUtc().add(const Duration(hours: 9));
  final hour = kst.hour % 12 == 0 ? 12 : kst.hour % 12;
  final noon = kst.hour < 12 ? '오전' : '오후';
  return kst.minute == 0 ? '$noon $hour시' : '$noon $hour시 ${kst.minute}분';
}

/// "7번 버스", "신분당선"; empty when unknown.
String spokenVehicle(String route) {
  final name = route.trim();
  if (name.isEmpty) return '';
  if (name.endsWith('선') || name.contains('호선')) return name;
  return '$name번 버스';
}

/// What the alarm says, using the time left at the moment it rings.
String alarmSpeech(PushAlarmPayload payload, DateTime now) {
  final vehicle = spokenVehicle(payload.routeNumber);
  final ride = vehicle.isEmpty ? '' : ' $vehicle${objectParticle(vehicle)} 타야 해요.';
  if (payload.triggerKind == 'late') return '지각 위험! 바로 뛰어나가세요.$ride';
  // No leave time while live arrivals are awaited: read the notice as sent.
  if (payload.triggerKind == 'awaiting-live') {
    return '${payload.title}. ${payload.body}'.replaceAll('..', '.');
  }
  final departure = DateTime.tryParse(payload.departureAt);
  if (departure != null) {
    final minutes = (departure.difference(now).inSeconds / 60).ceil();
    final found = payload.triggerKind == 'live-found' ? '실시간 정보가 확인됐어요. '
        : payload.triggerKind == 'leave-earlier' ? '출발 시각이 앞당겨졌어요. ' : '';
    // Times planned without live data are said to be estimates.
    final estimate = payload.title.startsWith('예상') ? ' 실시간 정보가 아닌 예상 시간이에요.' : '';
    if (minutes <= 0) return '$found지금 집에서 출발하세요!$ride$estimate';
    return '$found집에서 출발까지 $minutes분 남았습니다. ${spokenClock(departure)}까지 나가세요.$ride$estimate';
  }
  final text = payload.spokenText.isNotEmpty ? payload.spokenText : payload.title;
  return text;
}

/// 을/를 for the last Korean syllable.
String objectParticle(String word) {
  if (word.isEmpty) return '를';
  final code = word.codeUnitAt(word.length - 1);
  if (code < 0xAC00 || code > 0xD7A3) return '를';
  return (code - 0xAC00) % 28 == 0 ? '를' : '을';
}

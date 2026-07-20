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
  });

  final String title;
  final String body;
  final String routeNumber;
  final String stopName;
  final String riskLevel;
  final String stage;
  final String dispatchKey;
  final String deliveryPriorityClass;

  bool get isCritical {
    return riskLevel.toUpperCase() == 'RED' ||
        deliveryPriorityClass.toLowerCase() == 'boosted';
  }

  String get androidChannelId =>
      isCritical ? 'buswakeup-critical' : 'buswakeup-morning';

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
    final riskLevel = _read(data, 'riskLevel');
    final fallbackTitle = routeNumber.isEmpty
        ? 'BusWakeUp commute alarm'
        : '$routeNumber bus commute alarm';
    return PushAlarmPayload(
      title: _prefer(title, fallbackTitle),
      body: _prefer(body, _read(data, 'spokenText')),
      routeNumber: routeNumber,
      stopName: _read(data, 'stopName'),
      riskLevel: riskLevel,
      stage: _read(data, 'stage'),
      dispatchKey: _read(data, 'dispatchKey'),
      deliveryPriorityClass: _read(data, 'deliveryPriorityClass'),
    );
  }

  static String _read(Map<String, dynamic> data, String key) =>
      (data[key] ?? '').toString().trim();

  static String _prefer(String? value, String fallback) {
    final safe = (value ?? '').trim();
    return safe.isEmpty ? fallback : safe;
  }
}

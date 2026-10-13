/// Commute times are always shown in Korea Standard Time, whatever the
/// phone's own time zone is (the server plans alarms in KST).
DateTime? parseKst(Object? iso) {
  final text = '${iso ?? ''}'.trim();
  if (text.isEmpty) return null;
  final parsed = DateTime.tryParse(text);
  return parsed?.toUtc().add(const Duration(hours: 9));
}

String two(int value) => value.toString().padLeft(2, '0');

/// "08:13" (KST) or "--:--".
String kstClock(Object? iso) {
  final value = parseKst(iso);
  return value == null ? '--:--' : '${two(value.hour)}:${two(value.minute)}';
}

/// "오전 8:13" style for headlines.
String kstClockKorean(Object? iso) {
  final value = parseKst(iso);
  if (value == null) return '--:--';
  final morning = value.hour < 12;
  final hour = value.hour % 12 == 0 ? 12 : value.hour % 12;
  return '${morning ? '오전' : '오후'} $hour:${two(value.minute)}';
}

const weekdayLabels = ['일', '월', '화', '수', '목', '금', '토'];

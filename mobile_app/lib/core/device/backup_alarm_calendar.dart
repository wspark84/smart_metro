import 'package:timezone/timezone.dart' as tz;

// Finite one-shot reservations respect holidays and today-only cancellation.
// Renew this calendar when the app reloads saved server settings.
List<tz.TZDateTime> buildBackupAlarmCalendar({
  required DateTime now,
  required String time,
  required Map<String, dynamic> schedule,
  int horizonDays = 30,
}) {
  if (!RegExp(r'^(?:[01]\d|2[0-3]):[0-5]\d$').hasMatch(time)) return [];
  final clock = time.split(':').map(int.parse).toList();
  final zone = tz.getLocation('Asia/Seoul');
  final localNow = tz.TZDateTime.from(now, zone);
  final holidays = <String>{
    ...((schedule['holidayDates'] as List?) ?? []).map(
      (value) => value.toString(),
    ),
    ...((schedule['officialHolidays'] as List?) ?? [])
        .whereType<Map>()
        .where((value) => value['isHoliday'] == true)
        .map((value) => value['date'].toString()),
  };
  final days = ((schedule['daysOfWeek'] as List?) ?? []).toSet();
  final dates = <tz.TZDateTime>[];
  for (var day = 0; day < horizonDays; day++) {
    final date = tz.TZDateTime(
      zone,
      localNow.year,
      localNow.month,
      localNow.day + day,
      clock[0],
      clock[1],
    );
    final key =
        '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
    final weekday = date.weekday % 7;
    if (!date.isAfter(localNow) || schedule['snoozeDate'] == key) continue;
    if (schedule['skipHolidays'] == true && holidays.contains(key)) continue;
    final preset = schedule['repeatPreset'] ?? 'WEEKDAYS';
    if (preset == 'WEEKDAYS' && (weekday == 0 || weekday == 6)) continue;
    if (preset == 'WEEKENDS' && weekday != 0 && weekday != 6) continue;
    if (preset == 'CUSTOM' && !days.contains(weekday)) continue;
    if (!['WEEKDAYS', 'WEEKENDS', 'DAILY', 'CUSTOM'].contains(preset)) continue;
    dates.add(date);
  }
  return dates;
}

import 'package:flutter_test/flutter_test.dart';
import 'package:timezone/data/latest.dart' as tz_data;
import 'package:buswakeup_mobile/core/device/backup_alarm_calendar.dart';

void main() {
  setUpAll(tz_data.initializeTimeZones);
  test('backup respects weekdays, official holidays and today-only skip', () {
    final dates = buildBackupAlarmCalendar(
      now: DateTime.parse('2026-09-11T06:00:00+09:00'),
      time: '07:00',
      horizonDays: 7,
      schedule: {
        'repeatPreset': 'WEEKDAYS',
        'skipHolidays': true,
        'snoozeDate': '2026-09-11',
        'officialHolidays': [
          {'date': '2026-09-14', 'isHoliday': true},
        ],
      },
    );
    expect(dates.map((d) => d.day).toList(), [15, 16, 17]);
  });
  test('custom Sunday uses server Sunday=0 and Korean timezone', () {
    final dates = buildBackupAlarmCalendar(
      now: DateTime.parse('2026-09-12T22:00:00Z'),
      time: '08:00',
      horizonDays: 2,
      schedule: {
        'repeatPreset': 'CUSTOM',
        'daysOfWeek': [0],
      },
    );
    expect(dates.length, 1);
    expect(dates.single.toUtc(), DateTime.parse('2026-09-12T23:00:00Z'));
  });
  test('empty custom selection and invalid clock schedule no alarms', () {
    expect(
      buildBackupAlarmCalendar(
        now: DateTime.now(),
        time: '07:00',
        schedule: {'repeatPreset': 'CUSTOM', 'daysOfWeek': []},
      ),
      isEmpty,
    );
    expect(
      buildBackupAlarmCalendar(
        now: DateTime.now(),
        time: '25:00',
        schedule: {},
      ),
      isEmpty,
    );
  });
}

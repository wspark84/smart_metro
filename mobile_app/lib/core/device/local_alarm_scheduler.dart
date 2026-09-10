import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;
import 'backup_alarm_calendar.dart';

class LocalAlarmScheduleResult {
  const LocalAlarmScheduleResult({
    required this.scheduled,
    required this.exact,
    required this.scheduledAt,
    required this.message,
  });

  final bool scheduled;
  final bool exact;
  final DateTime? scheduledAt;
  final String message;
}

class LocalAlarmScheduler {
  LocalAlarmScheduler._();

  static final LocalAlarmScheduler instance = LocalAlarmScheduler._();
  static const int _backupAlarmId = 91001;
  final FlutterLocalNotificationsPlugin _notifications =
      FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  Future<void> initialize() async {
    if (_initialized) {
      return;
    }
    tz_data.initializeTimeZones();
    // The server's alarm calendar is fixed to Korea Standard Time, so the
    // local fallback alarm uses the same clock instead of the phone's travel
    // timezone.
    tz.setLocalLocation(tz.getLocation('Asia/Seoul'));
    await _notifications.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('ic_stat_buswakeup'),
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      ),
    );
    _initialized = true;
  }

  Future<String> requestAndroidAlarmPermissions() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) {
      return 'Exact alarms, full-screen intent, and DND bypass are Android-only permissions.';
    }
    await initialize();
    final android = _notifications
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >();
    await android?.requestNotificationsPermission();
    await android?.requestExactAlarmsPermission();
    await android?.requestFullScreenIntentPermission();
    await android?.requestNotificationPolicyAccess();
    return 'Android opened the required permission pages. Return here, then save device settings and schedule the local backup alarm.';
  }

  Future<LocalAlarmScheduleResult> scheduleNextDailyBackup({
    required String time,
    required bool fullScreenRequested,
    required bool dndBypassRequested,
    required String routeNumber,
    required Map<String, dynamic> schedule,
  }) async {
    if (kIsWeb ||
        ![
          TargetPlatform.android,
          TargetPlatform.iOS,
        ].contains(defaultTargetPlatform)) {
      return const LocalAlarmScheduleResult(
        scheduled: false,
        exact: false,
        scheduledAt: null,
        message: '휴대폰 보조 알람은 Android 또는 iPhone 앱에서 예약할 수 있습니다.',
      );
    }
    await initialize();
    final parsed = _parseTime(time);
    if (parsed == null) {
      return const LocalAlarmScheduleResult(
        scheduled: false,
        exact: false,
        scheduledAt: null,
        message:
            'Enter a valid start time in HH:mm format before scheduling the local backup alarm.',
      );
    }

    final dates = buildBackupAlarmCalendar(
      now: DateTime.now(),
      time: time.trim(),
      schedule: schedule,
    );
    await cancelLocalBackup();
    if (dates.isEmpty) {
      return const LocalAlarmScheduleResult(
        scheduled: false,
        exact: false,
        scheduledAt: null,
        message: '선택한 요일과 휴일 설정에 따라 앞으로 30일 동안 예약할 보조 알람이 없습니다.',
      );
    }
    final scheduledAt = dates.first;
    var exact = false;
    var dndGranted = false;
    var fullScreenGranted = false;
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      final android = _notifications
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >();
      exact = await android?.canScheduleExactNotifications() ?? false;
      dndGranted = await android?.hasNotificationPolicyAccess() ?? false;
      // Android does not expose a separate reliable read API through this
      // plugin. The request flow is required before this flag can take effect.
      fullScreenGranted = fullScreenRequested;
    }

    final critical = fullScreenRequested || dndBypassRequested;
    final channelId = dndBypassRequested && dndGranted
        ? 'buswakeup-critical-dnd'
        : critical
        ? 'buswakeup-critical'
        : 'buswakeup-morning';
    final details = NotificationDetails(
      android: AndroidNotificationDetails(
        channelId,
        critical ? 'Urgent commute alarms' : 'Morning commute alarms',
        channelDescription: 'Scheduled local BusWakeUp backup alarm.',
        icon: 'ic_stat_buswakeup',
        importance: critical ? Importance.max : Importance.high,
        priority: critical ? Priority.max : Priority.high,
        category: AndroidNotificationCategory.alarm,
        fullScreenIntent: fullScreenGranted,
        channelBypassDnd: dndBypassRequested && dndGranted,
        playSound: true,
        sound: const RawResourceAndroidNotificationSound('mechanical_alarm'),
        enableVibration: true,
        vibrationPattern: Int64List.fromList(
          critical
              ? const <int>[0, 1000, 200, 1000, 200, 1000]
              : const <int>[0, 400, 200, 400],
        ),
        audioAttributesUsage: AudioAttributesUsage.alarm,
      ),
      iOS: DarwinNotificationDetails(
        presentAlert: true,
        presentBanner: true,
        presentList: true,
        presentSound: true,
        sound: 'mechanical_alarm.wav',
        interruptionLevel: critical
            ? InterruptionLevel.timeSensitive
            : InterruptionLevel.active,
      ),
    );

    for (var index = 0; index < dates.length; index++) {
      await _notifications.zonedSchedule(
        id: _backupAlarmId + index,
        title: 'BusWakeUp local backup',
        body: '$routeNumber번 버스 출발 준비 알림입니다.',
        scheduledDate: dates[index],
        notificationDetails: details,
        androidScheduleMode: exact
            ? AndroidScheduleMode.alarmClock
            : AndroidScheduleMode.inexactAllowWhileIdle,
        payload: 'local-backup:$routeNumber',
      );
    }

    final restrictions = <String>[];
    if (!exact && !kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      restrictions.add(
        'exact-alarm permission is not granted, so Android may delay this backup',
      );
    }
    if (dndBypassRequested && !dndGranted) {
      restrictions.add('DND bypass is not granted');
    }
    if (fullScreenRequested && !fullScreenGranted) {
      restrictions.add('full-screen intent permission is not granted');
    }
    return LocalAlarmScheduleResult(
      scheduled: true,
      exact: exact,
      scheduledAt: scheduledAt,
      message: restrictions.isEmpty
          ? '앞으로 30일 중 설정한 요일·휴일에 맞춰 ${dates.length}회의 시작 시각 보조 알람을 예약했습니다 ($time, 한국 시간). 앱을 열면 갱신됩니다.'
          : '설정한 요일·휴일에 맞춰 ${dates.length}회의 보조 알람을 예약했습니다. 제한 사항: ${restrictions.join('; ')}.',
    );
  }

  Future<void> cancelLocalBackup() async {
    if (kIsWeb ||
        ![
          TargetPlatform.android,
          TargetPlatform.iOS,
        ].contains(defaultTargetPlatform)) {
      return;
    }
    await initialize();
    for (var index = 0; index < 30; index++) {
      await _notifications.cancel(id: _backupAlarmId + index);
    }
  }

  (int, int)? _parseTime(String value) {
    final match = RegExp(
      r'^(?:[01]\d|2[0-3]):[0-5]\d$',
    ).firstMatch(value.trim());
    if (match == null) {
      return null;
    }
    final parts = value.trim().split(':');
    return (int.parse(parts[0]), int.parse(parts[1]));
  }
}

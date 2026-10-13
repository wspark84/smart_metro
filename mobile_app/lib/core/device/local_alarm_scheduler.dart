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
    bool serverManaged = true,
  }) async {
    // Recurring production alarms must be authorized at delivery time. Old local
    // 30-day reservations could survive a refund or account change.
    if (serverManaged) {
      await cancelLocalBackup();
      return const LocalAlarmScheduleResult(scheduled: false, exact: false, scheduledAt: null,
        message: '일정 자동 알림은 서버에서 구독 상태를 확인한 뒤 전송합니다. 기기에 반복 예약하지 않습니다.');
    }
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
        ? 'buswakeup-critical-dnd-song-v1'
        : critical
        ? 'buswakeup-critical-song-v1'
        : 'buswakeup-morning-song-v1';
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
        sound: const RawResourceAndroidNotificationSound('smart_metro_song'),
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

  static const int _departureBackupId = 92001;

  /// One on-device backup at today's recommended leave time, in case a push
  /// is delayed. Replaced whenever the forecast changes; cancelled on
  /// "출발했어요", when today's alarm is turned off, and on sign-out.
  Future<bool> scheduleDepartureBackup({
    required DateTime atUtc,
    required String title,
    required String body,
  }) async {
    if (kIsWeb || ![TargetPlatform.android, TargetPlatform.iOS].contains(defaultTargetPlatform)) {
      return false;
    }
    await initialize();
    await _notifications.cancel(id: _departureBackupId);
    final when = tz.TZDateTime.from(atUtc, tz.local);
    if (!when.isAfter(tz.TZDateTime.now(tz.local).add(const Duration(seconds: 30)))) {
      return false;
    }
    var exact = false;
    if (defaultTargetPlatform == TargetPlatform.android) {
      final android = _notifications.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      exact = await android?.canScheduleExactNotifications() ?? false;
    }
    await _notifications.zonedSchedule(
      id: _departureBackupId,
      title: title,
      body: body,
      scheduledDate: when,
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          'buswakeup-critical-song-v1',
          '출발 알림',
          channelDescription: '놓치면 늦는 교통편의 출발 시각 알림',
          icon: 'ic_stat_buswakeup',
          importance: Importance.max,
          priority: Priority.max,
          category: AndroidNotificationCategory.alarm,
          playSound: true,
          sound: const RawResourceAndroidNotificationSound('smart_metro_song'),
          enableVibration: true,
          vibrationPattern: Int64List.fromList(const <int>[0, 1000, 200, 1000, 200, 1000]),
          audioAttributesUsage: AudioAttributesUsage.alarm,
        ),
        iOS: const DarwinNotificationDetails(
          presentAlert: true,
          presentBanner: true,
          presentList: true,
          presentSound: true,
          interruptionLevel: InterruptionLevel.timeSensitive,
        ),
      ),
      androidScheduleMode: exact ? AndroidScheduleMode.alarmClock : AndroidScheduleMode.inexactAllowWhileIdle,
      payload: 'departure-backup',
    );
    return true;
  }

  Future<void> cancelDepartureBackup() async {
    if (kIsWeb || ![TargetPlatform.android, TargetPlatform.iOS].contains(defaultTargetPlatform)) {
      return;
    }
    await initialize();
    await _notifications.cancel(id: _departureBackupId);
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

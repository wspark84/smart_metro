import 'dart:async';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../../firebase_options.dart';
import 'package:vibration/vibration.dart';

import 'alarm_log.dart';
import 'alarm_style.dart';
import 'alarm_voice.dart';
import 'push_alarm_payload.dart';

class MobilePushRuntimeStatus {
  const MobilePushRuntimeStatus({
    required this.state,
    required this.platform,
    required this.firebaseReady,
    required this.permissionGranted,
    required this.message,
  });

  final String state;
  final String platform;
  final bool firebaseReady;
  final bool permissionGranted;
  final String message;

  factory MobilePushRuntimeStatus.notStarted() {
    return const MobilePushRuntimeStatus(
      state: 'NOT STARTED',
      platform: 'unknown',
      firebaseReady: false,
      permissionGranted: false,
      message: 'Push runtime has not been initialized yet.',
    );
  }
}

class MobilePushTokenResult {
  const MobilePushTokenResult({
    required this.ready,
    required this.token,
    required this.platform,
    required this.message,
  });

  final bool ready;
  final String token;
  final String platform;
  final String message;
}

/// Owns the device-side FCM lifecycle. It intentionally does not request a
/// notification permission until the signed-in user asks to register this phone.
class MobilePushRuntime {
  MobilePushRuntime._();

  static final MobilePushRuntime instance = MobilePushRuntime._();

  final _PushNotificationDisplay _display = _PushNotificationDisplay();
  final StreamController<String> _tokenRefreshController =
      StreamController<String>.broadcast();
  StreamSubscription<RemoteMessage>? _foregroundMessageSubscription;
  StreamSubscription<String>? _tokenRefreshSubscription;
  bool _initialized = false;
  MobilePushRuntimeStatus _status = MobilePushRuntimeStatus.notStarted();

  MobilePushRuntimeStatus get status => _status;
  Stream<String> get tokenRefreshes => _tokenRefreshController.stream;

  Future<MobilePushRuntimeStatus> initialize() async {
    if (_initialized) {
      return _status;
    }

    if (!_isSupportedMobilePlatform) {
      _initialized = true;
      _status = MobilePushRuntimeStatus(
        state: 'UNSUPPORTED',
        platform: _platformName,
        firebaseReady: false,
        permissionGranted: false,
        message: 'FCM device push is available only in the Android and iPhone app builds.',
      );
      return _status;
    }

    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp(
          options: DefaultFirebaseOptions.currentPlatform,
        );
      }
      FirebaseMessaging.onBackgroundMessage(
        busWakeUpFirebaseMessagingBackgroundHandler,
      );
      await _display.initialize();
      if (defaultTargetPlatform == TargetPlatform.iOS) {
        await FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(
          alert: false,
          badge: false,
          sound: false,
        );
      }
      final notificationSettings =
          await FirebaseMessaging.instance.getNotificationSettings();
      _foregroundMessageSubscription ??=
          FirebaseMessaging.onMessage.listen((message) {
        unawaited(_display.alarm(message, foreground: true));
      });
      _tokenRefreshSubscription ??=
          FirebaseMessaging.instance.onTokenRefresh.listen((token) {
        if (token.trim().isNotEmpty) {
          _tokenRefreshController.add(token.trim());
        }
      });
      _initialized = true;
      _status = MobilePushRuntimeStatus(
        state: _permissionGranted(notificationSettings) ? 'READY' : 'PERMISSION NEEDED',
        platform: _platformName,
        firebaseReady: true,
        permissionGranted: _permissionGranted(notificationSettings),
        message: _permissionGranted(notificationSettings)
            ? 'Firebase is configured on this device. Register this phone to store its FCM token.'
            : 'Firebase is configured. Register this phone to request notification permission and its FCM token.',
      );
    } catch (_) {
      _initialized = true;
      _status = MobilePushRuntimeStatus(
        state: 'FIREBASE SETUP REQUIRED',
        platform: _platformName,
        firebaseReady: false,
        permissionGranted: false,
        message: 'Firebase is not configured for this app build. Add this app to Firebase and run flutterfire configure before device push can be enabled.',
      );
    }
    return _status;
  }

  Future<MobilePushTokenResult> requestPermissionAndGetToken() async {
    final initializedStatus = await initialize();
    if (!initializedStatus.firebaseReady) {
      return MobilePushTokenResult(
        ready: false,
        token: '',
        platform: _platformName,
        message: initializedStatus.message,
      );
    }

    try {
      if (defaultTargetPlatform == TargetPlatform.android) {
        await _display.requestAndroidNotificationPermission();
      }
      final notificationSettings =
          await FirebaseMessaging.instance.requestPermission(
        alert: true,
        badge: true,
        sound: true,
        criticalAlert: false,
      );
      if (!_permissionGranted(notificationSettings)) {
        _status = MobilePushRuntimeStatus(
          state: 'PERMISSION DENIED',
          platform: _platformName,
          firebaseReady: true,
          permissionGranted: false,
          message: 'Notifications are disabled for BusWakeUp on this phone. Enable them in the device settings, then register again.',
        );
        return MobilePushTokenResult(
          ready: false,
          token: '',
          platform: _platformName,
          message: _status.message,
        );
      }

      if (defaultTargetPlatform == TargetPlatform.iOS &&
          await _waitForApnsToken() == null) {
        return MobilePushTokenResult(
          ready: false,
          token: '',
          platform: _platformName,
          message: 'The iPhone APNs token is not ready yet. Confirm Push Notifications capability and the APNs key in Firebase, then try again.',
        );
      }

      final token = (await FirebaseMessaging.instance.getToken())?.trim() ?? '';
      if (token.isEmpty) {
        return MobilePushTokenResult(
          ready: false,
          token: '',
          platform: _platformName,
          message: 'Firebase did not issue a registration token. Check Firebase configuration and network access, then try again.',
        );
      }

      _status = MobilePushRuntimeStatus(
        state: 'READY',
        platform: _platformName,
        firebaseReady: true,
        permissionGranted: true,
        message: 'Notification permission is granted and this phone has an FCM registration token.',
      );
      return MobilePushTokenResult(
        ready: true,
        token: token,
        platform: _platformName,
        message: _status.message,
      );
    } catch (_) {
      return MobilePushTokenResult(
        ready: false,
        token: '',
        platform: _platformName,
        message: 'Could not request push permission or obtain an FCM token. Check Firebase configuration and try again.',
      );
    }
  }

  /// This phone's current token when notifications are already allowed,
  /// without asking. `ready: false` means notifications are off; null means
  /// push is not set up in this build or Firebase could not be reached.
  Future<MobilePushTokenResult?> tokenIfAllowed() async {
    final initializedStatus = await initialize();
    if (!initializedStatus.firebaseReady) return null;
    try {
      final settings = await FirebaseMessaging.instance.getNotificationSettings();
      var allowed = _permissionGranted(settings);
      final android = defaultTargetPlatform == TargetPlatform.android;
      // Ask Android itself too: Firebase's answer alone showed "off" while
      // notifications were allowed (2026-11-08).
      if (!allowed && android) allowed = await _display.androidNotificationsEnabled() == true;
      if (!allowed && !android) {
        return MobilePushTokenResult(ready: false, token: '', platform: _platformName, message: 'PERMISSION');
      }
      if (defaultTargetPlatform == TargetPlatform.iOS && await _waitForApnsToken() == null) return null;
      // An Android token is issued without notification permission. Sending it
      // anyway keeps the server's copy current after a reinstall, so alarms
      // are not refused as "unregistered" while permission is being given.
      final token = (await FirebaseMessaging.instance.getToken())?.trim() ?? '';
      if (token.isEmpty) return null;
      return MobilePushTokenResult(ready: allowed, token: token, platform: _platformName, message: allowed ? '' : 'PERMISSION');
    } catch (_) {
      return null;
    }
  }

  Future<String?> _waitForApnsToken() async {
    for (var attempt = 0; attempt < 8; attempt += 1) {
      final apnsToken = await FirebaseMessaging.instance.getAPNSToken();
      if (apnsToken != null && apnsToken.trim().isNotEmpty) {
        return apnsToken;
      }
      await Future<void>.delayed(const Duration(milliseconds: 350));
    }
    return null;
  }

  Future<void> dispose() async {
    await _foregroundMessageSubscription?.cancel();
    await _tokenRefreshSubscription?.cancel();
    await _tokenRefreshController.close();
  }

  static bool _permissionGranted(NotificationSettings settings) {
    return settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
  }

  static bool get _isSupportedMobilePlatform {
    if (kIsWeb) {
      return false;
    }
    return defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS;
  }

  static String get _platformName {
    if (kIsWeb) {
      return 'web';
    }
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      return 'ios';
    }
    if (defaultTargetPlatform == TargetPlatform.android) {
      return 'android';
    }
    return 'unsupported';
  }
}

@pragma('vm:entry-point')
Future<void> busWakeUpFirebaseMessagingBackgroundHandler(
  RemoteMessage message,
) async {
  try {
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp(
        options: DefaultFirebaseOptions.currentPlatform,
      );
    }
    // Android alarms arrive data-only: show the alarm, ring on the alarm
    // volume and read the time left aloud. iPhone shows its own alert.
    final display = _PushNotificationDisplay();
    await display.initialize();
    await display.alarm(message, foreground: false);
  } catch (error) {
    // The OS may stop the background isolate quickly; avoid crashing it.
    await AlarmLog.add('백그라운드 처리 실패 ${AlarmLog.describe(error)}');
  }
}

class _PushNotificationDisplay {
  static const AndroidNotificationSound _tone = RawResourceAndroidNotificationSound('inochi_ring');
  final FlutterLocalNotificationsPlugin _notifications =
      FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  Future<void> initialize() async {
    if (_initialized) {
      return;
    }
    const initializationSettings = InitializationSettings(
      android: AndroidInitializationSettings('ic_stat_buswakeup'),
      iOS: DarwinInitializationSettings(
        requestAlertPermission: false,
        requestBadgePermission: false,
        requestSoundPermission: false,
      ),
    );
    await _notifications.initialize(settings: initializationSettings);
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      final android = _notifications.resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin>();
      await android?.createNotificationChannel(_urgentChannel());
      await android?.createNotificationChannel(_vibrateChannel());
      await android?.createNotificationChannel(_alarmChannel());
    }
    _initialized = true;
  }

  /// Android's own answer to whether this app may show notifications.
  Future<bool?> androidNotificationsEnabled() async {
    final android = _notifications.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    try {
      return await android?.areNotificationsEnabled();
    } catch (_) {
      return null;
    }
  }

  Future<void> requestAndroidNotificationPermission() async {
    final android = _notifications.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    await android?.requestNotificationsPermission();
  }

  /// Shows the alarm and, on Android, rings and reads the time left aloud.
  /// In the background the system already shows payloads that carry a
  /// notification (iPhone, or an older server), so only data-only ones are
  /// shown here.
  Future<void> alarm(RemoteMessage message, {required bool foreground}) async {
    final show = foreground || message.notification == null;
    final android = !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
    final style = android ? await AlarmStyleStore.read() : AlarmStyle.sound;
    await AlarmLog.add('받음 ${foreground ? '앱 화면' : '백그라운드'} · ${style.name} · ${message.data['title'] ?? message.notification?.title ?? ''}');
    if (style == AlarmStyle.vibrate) {
      // 진동만: a text pop-up and one long vibration, no sound.
      if (show) await _logged('알림 표시', () => showMessage(message, vibrateOnly: true));
      await _logged('진동', () => Vibration.vibrate(duration: vibrateOnlyMs, amplitude: 255));
      return;
    }
    // Loud before the notification's own tone plays.
    await AlarmVoice.maxVolume();
    if (show) await _logged('알림 표시', () => showMessage(message));
    if (!android) return;
    // The phone's 무음 mode silences the notification's own tone and
    // vibration; an alarm vibration from the app still comes through.
    await _logged('진동', () => Vibration.vibrate(pattern: const [0, 1000, 400, 1000, 400, 1000]));
    final payload = PushAlarmPayload.fromRemoteFields(
      title: message.notification?.title,
      body: message.notification?.body,
      data: Map<String, dynamic>.from(message.data),
    );
    await AlarmVoice.ring(payload, skipFirstTone: show);
  }

  static Future<void> _logged(String step, Future<Object?> Function() action) async {
    try {
      await action();
      await AlarmLog.add('$step 성공');
    } catch (error) {
      await AlarmLog.add('$step 실패 ${AlarmLog.describe(error)}');
    }
  }

  Future<void> showMessage(RemoteMessage message, {bool vibrateOnly = false}) async {
    await initialize();
    final notification = message.notification;
    final payload = PushAlarmPayload.fromRemoteFields(
      title: notification?.title,
      body: notification?.body,
      data: Map<String, dynamic>.from(message.data),
    );
    final notificationDetails = NotificationDetails(
      android: vibrateOnly ? _vibrateDetails() : AndroidNotificationDetails(
        payload.androidChannelId,
        payload.isCritical ? '지금 출발·지각 위험 알람' : '출발 전 알람',
        channelDescription: payload.isCritical
            ? '나갈 시각과 지각 위험 알람. 무음 모드에서도 알람 음량으로 울려요.'
            : '나갈 시각 전 알람. 무음 모드에서도 알람 음량으로 울려요.',
        icon: 'ic_stat_buswakeup',
        importance: Importance.max,
        priority: Priority.max,
        playSound: true,
        sound: _tone,
        enableVibration: true,
        vibrationPattern: Int64List.fromList(
          payload.isCritical
              ? const <int>[0, 1000, 200, 1000, 200, 1000]
              : const <int>[0, 400, 200, 400],
        ),
        audioAttributesUsage: AudioAttributesUsage.alarm,
        fullScreenIntent: payload.isCritical,
        category: AndroidNotificationCategory.alarm,
      ),
      iOS: DarwinNotificationDetails(
        presentAlert: true,
        presentBanner: true,
        presentList: true,
        presentBadge: true,
        presentSound: true,
        sound: 'mechanical_alarm.wav',
        interruptionLevel: payload.isCritical
            ? InterruptionLevel.timeSensitive
            : InterruptionLevel.active,
        threadIdentifier: 'BUSWAKEUP_COMMUTE_ALARM',
      ),
    );
    await _notifications.show(
      id: payload.notificationId,
      title: payload.title,
      body: payload.body,
      notificationDetails: notificationDetails,
      payload: payload.dispatchKey,
    );
  }

  static const String _vibrateName = '진동 알람 (소리 없음)';
  static const String _vibrateDescription = '알람 방식이 진동만일 때: 소리 없이 길게 진동하고 글로 알려요.';

  AndroidNotificationChannel _vibrateChannel() {
    return AndroidNotificationChannel(
      vibrateAlarmChannelId,
      _vibrateName,
      description: _vibrateDescription,
      importance: Importance.max,
      playSound: false,
      enableVibration: true,
      vibrationPattern: Int64List.fromList(const <int>[0, vibrateOnlyMs]),
    );
  }

  AndroidNotificationDetails _vibrateDetails() {
    return AndroidNotificationDetails(
      vibrateAlarmChannelId,
      _vibrateName,
      channelDescription: _vibrateDescription,
      icon: 'ic_stat_buswakeup',
      importance: Importance.max,
      priority: Priority.max,
      playSound: false,
      enableVibration: true,
      vibrationPattern: Int64List.fromList(const <int>[0, vibrateOnlyMs]),
      category: AndroidNotificationCategory.alarm,
    );
  }

  AndroidNotificationChannel _urgentChannel() {
    return AndroidNotificationChannel(
      urgentAlarmChannelId,
      '지금 출발·지각 위험 알람',
      description: '나갈 시각과 지각 위험 알람. 무음 모드에서도 알람 음량으로 울려요.',
      importance: Importance.max,
      playSound: true,
      sound: _tone,
      enableVibration: true,
      vibrationPattern: Int64List.fromList(
        const <int>[0, 1000, 200, 1000, 200, 1000],
      ),
      audioAttributesUsage: AudioAttributesUsage.alarm,
    );
  }

  AndroidNotificationChannel _alarmChannel() {
    return AndroidNotificationChannel(
      alarmChannelId,
      '출발 전 알람',
      description: '나갈 시각 전 알람. 무음 모드에서도 알람 음량으로 울려요.',
      importance: Importance.max,
      playSound: true,
      sound: _tone,
      enableVibration: true,
      vibrationPattern: Int64List.fromList(const <int>[0, 400, 200, 400]),
      audioAttributesUsage: AudioAttributesUsage.alarm,
    );
  }
}

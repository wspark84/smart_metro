import 'dart:async';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../../firebase_options.dart';
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
        unawaited(_display.showMessage(message));
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
    // Notification payloads are shown by Android/iOS system UI in the
    // background. Only data-only payloads need a local notification here.
    if (message.notification == null) {
      final display = _PushNotificationDisplay();
      await display.initialize();
      await display.showMessage(message);
    }
  } catch (_) {
    // The OS may stop the background isolate quickly; avoid crashing it.
  }
}

class _PushNotificationDisplay {
  static const String _criticalChannelId = 'buswakeup-critical';
  static const String _morningChannelId = 'buswakeup-morning';
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
      await android?.createNotificationChannel(_criticalChannel());
      await android?.createNotificationChannel(_morningChannel());
    }
    _initialized = true;
  }

  Future<void> requestAndroidNotificationPermission() async {
    final android = _notifications.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    await android?.requestNotificationsPermission();
  }

  Future<void> showMessage(RemoteMessage message) async {
    await initialize();
    final notification = message.notification;
    final payload = PushAlarmPayload.fromRemoteFields(
      title: notification?.title,
      body: notification?.body,
      data: Map<String, dynamic>.from(message.data),
    );
    final notificationDetails = NotificationDetails(
      android: AndroidNotificationDetails(
        payload.androidChannelId,
        payload.isCritical ? 'Urgent commute alarms' : 'Morning commute alarms',
        channelDescription: payload.isCritical
            ? 'High-priority BusWakeUp late-risk alarms.'
            : 'BusWakeUp morning commute arrival alarms.',
        icon: 'ic_stat_buswakeup',
        importance: payload.isCritical ? Importance.max : Importance.high,
        priority: payload.isCritical ? Priority.max : Priority.high,
        playSound: true,
        sound: const RawResourceAndroidNotificationSound('mechanical_alarm'),
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

  AndroidNotificationChannel _criticalChannel() {
    return AndroidNotificationChannel(
      _criticalChannelId,
      'Urgent commute alarms',
      description: 'High-priority BusWakeUp late-risk alarms.',
      importance: Importance.max,
      playSound: true,
      sound: const RawResourceAndroidNotificationSound('mechanical_alarm'),
      enableVibration: true,
      vibrationPattern: Int64List.fromList(
        const <int>[0, 1000, 200, 1000, 200, 1000],
      ),
      audioAttributesUsage: AudioAttributesUsage.alarm,
      bypassDnd: false,
    );
  }

  AndroidNotificationChannel _morningChannel() {
    return AndroidNotificationChannel(
      _morningChannelId,
      'Morning commute alarms',
      description: 'BusWakeUp morning commute arrival alarms.',
      importance: Importance.high,
      playSound: true,
      sound: const RawResourceAndroidNotificationSound('mechanical_alarm'),
      enableVibration: true,
      vibrationPattern: Int64List.fromList(const <int>[0, 400, 200, 400]),
      audioAttributesUsage: AudioAttributesUsage.alarm,
    );
  }
}

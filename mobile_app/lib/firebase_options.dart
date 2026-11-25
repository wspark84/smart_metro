import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

/// Public client identifiers; no server credentials belong in this file.
///
/// iOS values come from --dart-define at build time, e.g.
///   flutter build ios \
///     --dart-define=FIREBASE_IOS_API_KEY=... \
///     --dart-define=FIREBASE_IOS_APP_ID=1:708502742797:ios:...
/// Without them the getter throws, MobilePushRuntime catches it, and the app
/// starts with device push turned off.
class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      throw UnsupportedError('Firebase is not configured for web.');
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        if (!iosConfigured) {
          throw UnsupportedError(
            'Firebase iOS keys were not provided via --dart-define.',
          );
        }
        return ios;
      default:
        throw UnsupportedError('Firebase is not configured for this platform.');
    }
  }

  static const android = FirebaseOptions(
    apiKey: 'AIzaSyCbRaBgu4rfaoQs3D7luxPv3uhgOZ5OUWg',
    appId: '1:708502742797:android:b9b2d55037b429f5803244',
    messagingSenderId: '708502742797',
    projectId: 'smart-metro-ed2ad',
    storageBucket: 'smart-metro-ed2ad.firebasestorage.app',
  );

  static const _iosApiKey = String.fromEnvironment('FIREBASE_IOS_API_KEY');
  static const _iosAppId = String.fromEnvironment('FIREBASE_IOS_APP_ID');

  static bool get iosConfigured =>
      _iosApiKey.isNotEmpty && _iosAppId.isNotEmpty;

  static const ios = FirebaseOptions(
    apiKey: _iosApiKey,
    appId: _iosAppId,
    messagingSenderId: String.fromEnvironment(
      'FIREBASE_IOS_MESSAGING_SENDER_ID',
      defaultValue: '708502742797',
    ),
    projectId: String.fromEnvironment(
      'FIREBASE_IOS_PROJECT_ID',
      defaultValue: 'smart-metro-ed2ad',
    ),
    storageBucket: String.fromEnvironment(
      'FIREBASE_IOS_STORAGE_BUCKET',
      defaultValue: 'smart-metro-ed2ad.firebasestorage.app',
    ),
    iosBundleId: String.fromEnvironment(
      'FIREBASE_IOS_BUNDLE_ID',
      defaultValue: 'com.buswakeup.buswakeup-mobile',
    ),
  );
}

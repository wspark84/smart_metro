import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

/// Public Android client identifiers; no server credentials belong in this file.
class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) {
      throw UnsupportedError('Firebase is configured for Android only.');
    }
    return android;
  }

  static const android = FirebaseOptions(
    apiKey: 'AIzaSyCbRaBgu4rfaoQs3D7luxPv3uhgOZ5OUWg',
    appId: '1:708502742797:android:b9b2d55037b429f5803244',
    messagingSenderId: '708502742797',
    projectId: 'smart-metro-ed2ad',
    storageBucket: 'smart-metro-ed2ad.firebasestorage.app',
  );
}

import 'package:firebase_core/firebase_core.dart';

/// Safe placeholder for source control before a BusWakeUp Firebase project is
/// selected. `flutterfire configure` replaces this file with real non-secret
/// Firebase app identifiers for Android and iOS.
class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    throw StateError(
      'Firebase is not configured. Run flutterfire configure for Android and iOS.',
    );
  }
}

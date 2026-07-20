import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class MobileSessionStore {
  static const String _sessionCookieKey = 'mobile_auth_session_cookie';

  MobileSessionStore({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  Future<String?> loadSessionCookie() {
    return _storage.read(key: _sessionCookieKey);
  }

  Future<void> saveSessionCookie(String value) {
    return _storage.write(key: _sessionCookieKey, value: value);
  }

  Future<void> clearSessionCookie() {
    return _storage.delete(key: _sessionCookieKey);
  }
}

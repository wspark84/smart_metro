import 'dart:convert';
import 'dart:io';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class MobileSocialAuth {
  static const origin = 'https://smart-metro.vercel.app';
  static const callback = 'com.smartmetro.app://login-callback/';
  static bool ready = false;
  static Future<void> initialize() async {
    if (ready) return;
    final http = HttpClient()..connectionTimeout = const Duration(seconds: 15);
    try {
      final request = await http.getUrl(Uri.parse('$origin/api/auth/mobile-config'));
      request.followRedirects = false;
      final response = await request.close().timeout(const Duration(seconds: 20));
      if (response.statusCode != 200) throw StateError('로그인 설정을 불러오지 못했습니다.');
      final config = jsonDecode(await response.transform(utf8.decoder).join().timeout(const Duration(seconds: 20))) as Map<String, dynamic>;
      if (config['url'] != 'https://uingfgwiajhcwoexoovg.supabase.co' ||
          !(config['publishableKey'] as String? ?? '').startsWith('sb_publishable_')) {
        throw StateError('로그인 서버 설정을 확인해 주세요.');
      }
      await Supabase.initialize(url: config['url'] as String,
        publishableKey: config['publishableKey'] as String, debug: false,
        authOptions: FlutterAuthClientOptions(
          authFlowType: AuthFlowType.pkce,
          localStorage: _SecureSessionStorage(),
          detectSessionInUriPredicate: acceptsCallback,
        ));
      ready = true;
    } finally { http.close(force: true); }
  }
  static SupabaseClient get client => Supabase.instance.client;
  static bool acceptsCallback(Uri uri) => uri.scheme == Uri.parse(callback).scheme &&
      uri.host == 'login-callback' && uri.path == '/' && uri.userInfo.isEmpty && !uri.hasPort;
  static Future<String?> token() async {
    if (!ready) return null;
    final session = client.auth.currentSession;
    if (session == null) return null;
    if (session.isExpired) return (await client.auth.refreshSession()).session?.accessToken;
    return session.accessToken;
  }
  static Future<void> login(OAuthProvider provider) async {
    if (!ready) await initialize();
    final launched = await client.auth.signInWithOAuth(provider, redirectTo: callback,
      authScreenLaunchMode: LaunchMode.externalApplication);
    if (!launched) throw StateError('로그인 브라우저를 열지 못했습니다.');
  }
}

class _SecureSessionStorage extends LocalStorage {
  final _storage = const FlutterSecureStorage();
  static const _key = 'smart_metro_supabase_session';
  @override Future<void> initialize() async {}
  @override Future<bool> hasAccessToken() async => await accessToken() != null;
  @override Future<String?> accessToken() => _storage.read(key: _key);
  @override Future<void> persistSession(String value) => _storage.write(key: _key, value: value);
  @override Future<void> removePersistedSession() => _storage.delete(key: _key);
}

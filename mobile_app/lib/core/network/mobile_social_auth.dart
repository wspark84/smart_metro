import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
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
  /// 이메일 로그인 (대표 결정 2026-11-16): only for accounts the operator
  /// creates (e.g. the Google Play review account). No sign-up in the app.
  static Future<void> loginWithEmail(String email, String password) async {
    if (!ready) await initialize();
    await client.auth.signInWithPassword(email: email.trim(), password: password);
  }
  static Future<void> login(OAuthProvider provider) async {
    if (!ready) await initialize();
    final launched = await client.auth.signInWithOAuth(provider, redirectTo: callback,
      authScreenLaunchMode: LaunchMode.externalApplication);
    if (!launched) throw StateError('로그인 브라우저를 열지 못했습니다.');
  }

  /// 애플 로그인은 아이폰에서만 보여 준다 (App Store 심사 규정 4.8).
  static bool get appleAvailable => !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;

  /// iOS 기본 애플 로그인 창으로 받은 ID 토큰을 Supabase 세션으로 바꾼다.
  /// 사용자가 창을 닫으면 false, 로그인되면 true.
  static Future<bool> loginWithApple() async {
    if (!ready) await initialize();
    final rawNonce = _nonce();
    final AuthorizationCredentialAppleID credential;
    try {
      credential = await SignInWithApple.getAppleIDCredential(
        scopes: const [AppleIDAuthorizationScopes.email, AppleIDAuthorizationScopes.fullName],
        nonce: sha256.convert(utf8.encode(rawNonce)).toString(),
      );
    } on SignInWithAppleAuthorizationException catch (error) {
      if (error.code == AuthorizationErrorCode.canceled) return false;
      rethrow;
    }
    final idToken = credential.identityToken;
    if (idToken == null) throw StateError('애플 로그인 정보를 받지 못했습니다.');
    await client.auth.signInWithIdToken(provider: OAuthProvider.apple, idToken: idToken, nonce: rawNonce);
    // 애플은 이름을 첫 로그인 때 한 번만 준다. 받았을 때 계정에 저장해 둔다.
    final name = [credential.familyName, credential.givenName]
        .whereType<String>().where((part) => part.trim().isNotEmpty).join();
    if (name.isNotEmpty) {
      try {
        await client.auth.updateUser(UserAttributes(data: {'full_name': name, 'name': name}));
      } catch (_) {}
    }
    return true;
  }

  static String _nonce([int length = 32]) {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._';
    final random = Random.secure();
    return List.generate(length, (_) => chars[random.nextInt(chars.length)]).join();
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

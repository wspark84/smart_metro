import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../storage/mobile_client_settings_store.dart';
import '../storage/mobile_session_store.dart';

class MobileApiException implements Exception {
  MobileApiException({
    required this.statusCode,
    required this.message,
    Map<String, dynamic>? payload,
  }) : payload = payload ?? <String, dynamic>{};

  final int statusCode;
  final String message;
  final Map<String, dynamic> payload;

  @override
  String toString() => message;
}

class MobileApiClient {
  static const String _defaultBaseUrl = 'http://127.0.0.1:4173';
  static const Duration _requestTimeout = Duration(seconds: 8);

  MobileApiClient({
    String baseUrl = _defaultBaseUrl,
    MobileSessionStore? sessionStore,
  })  : _baseUrl = _normalizeBaseUrl(baseUrl),
        _sessionStore = sessionStore ?? MobileSessionStore();

  String _baseUrl;
  String? _sessionCookie;
  final MobileClientSettingsStore _settingsStore = MobileClientSettingsStore();
  final MobileSessionStore _sessionStore;

  String get baseUrl => _baseUrl;

  void updateBaseUrl(String value) {
    final nextBaseUrl = _normalizeBaseUrl(value);
    if (_sessionCookie != null && nextBaseUrl != _baseUrl) {
      _sessionCookie = null;
      unawaited(_clearPersistedSessionSilently());
    }
    _baseUrl = nextBaseUrl;
  }

  Future<void> updateBaseUrlAndPersist(String value) async {
    updateBaseUrl(value);
    await _settingsStore.saveBaseUrl(_baseUrl);
  }

  Future<void> restorePersistedBaseUrl() async {
    final savedValue = await _settingsStore.loadBaseUrl();
    if (savedValue == null || savedValue.trim().isEmpty) {
      return;
    }
    updateBaseUrl(savedValue);
  }

  Future<void> restorePersistedSession() async {
    final storedCookie = await _sessionStore.loadSessionCookie();
    if (storedCookie != null && storedCookie.startsWith('auth_session=')) {
      _sessionCookie = storedCookie;
    }
  }

  Future<void> clearSession() async {
    _sessionCookie = null;
    await _clearPersistedSessionSilently();
  }

  Future<Map<String, dynamic>> fetchAuthSession() {
    return _request('GET', '/api/auth/session');
  }

  Future<Map<String, dynamic>> register({
    required String name,
    required String email,
    required String password,
  }) {
    return _request(
      'POST',
      '/api/auth/register',
      body: <String, dynamic>{
        'name': name,
        'email': email,
        'password': password,
      },
    );
  }

  Future<Map<String, dynamic>> login({
    required String email,
    required String password,
  }) {
    return _request(
      'POST',
      '/api/auth/login',
      body: <String, dynamic>{
        'email': email,
        'password': password,
      },
    );
  }

  Future<Map<String, dynamic>> logout() async {
    final payload = await _request('POST', '/api/auth/logout');
    await clearSession();
    return payload;
  }

  Future<Map<String, dynamic>> fetchAccountSummary() {
    return _request('GET', '/api/account');
  }

  Future<Map<String, dynamic>> fetchProfile() {
    return _request('GET', '/api/profile');
  }

  Future<Map<String, dynamic>> saveProfile(Map<String, dynamic> payload) {
    return _request('PUT', '/api/profile', body: payload);
  }

  Future<Map<String, dynamic>> fetchRoute() {
    return _request('GET', '/api/route');
  }

  Future<Map<String, dynamic>> saveRoute(Map<String, dynamic> payload) {
    return _request('PUT', '/api/route', body: payload);
  }

  Future<Map<String, dynamic>> fetchSchedule() {
    return _request('GET', '/api/schedule');
  }

  Future<Map<String, dynamic>> saveSchedule(Map<String, dynamic> payload) {
    return _request('PUT', '/api/schedule', body: payload);
  }

  Future<Map<String, dynamic>> fetchNotificationSettings() {
    return _request('GET', '/api/notification-settings');
  }

  Future<Map<String, dynamic>> saveNotificationSettings(
    Map<String, dynamic> payload,
  ) {
    return _request('PUT', '/api/notification-settings', body: payload);
  }

  Future<Map<String, dynamic>> fetchAlarmRuntime() {
    return _request('GET', '/api/alarm-runtime');
  }

  Future<Map<String, dynamic>> performAlarmAction(String type) {
    return _request('POST', '/api/alarm-delivery/actions',
        body: <String, dynamic>{'type': type});
  }

  Future<Map<String, dynamic>> fetchDeviceProfile() {
    return _request('GET', '/api/device-profile');
  }

  Future<Map<String, dynamic>> saveDeviceProfile(Map<String, dynamic> payload) {
    return _request('PUT', '/api/device-profile', body: payload);
  }

  Future<Map<String, dynamic>> fetchDeviceTokenHealth() {
    return _request('GET', '/api/device-profile/token-health');
  }

  Future<Map<String, dynamic>> registerDeviceToken(
    Map<String, dynamic> payload,
  ) {
    return _request('POST', '/api/device-profile/register-token', body: payload);
  }

  Future<Map<String, dynamic>> fetchPushGatewayConfig() {
    return _request('GET', '/api/push-gateway/config');
  }

  Future<Map<String, dynamic>> fetchFcmAuthStatus() {
    return _request('GET', '/api/fcm-auth/status');
  }

  Future<Map<String, dynamic>> fetchPushPreview() {
    return _request('GET', '/api/push-preview');
  }

  Future<Map<String, dynamic>> fetchPushGatewayAttempts({int limit = 4}) {
    return _request(
      'GET',
      '/api/push-gateway/attempts',
      queryParameters: <String, String>{'limit': '$limit'},
    );
  }

  Future<Map<String, dynamic>> runGatewayDispatch(
    Map<String, dynamic> payload,
  ) {
    return _request('POST', '/api/push-gateway/dispatch', body: payload);
  }

  Future<Map<String, dynamic>> runTestPushDispatch(
    Map<String, dynamic> payload,
  ) {
    return _request('POST', '/api/push-gateway/test-dispatch', body: payload);
  }

  Future<Map<String, dynamic>> runRetrySimulation(
    Map<String, dynamic> payload,
  ) {
    return _request(
      'POST',
      '/api/push-gateway/retry-simulation',
      body: payload,
    );
  }

  Future<Map<String, dynamic>> fetchAccuracyLeaderboard({
    required String region,
    int limit = 6,
  }) {
    return _request(
      'GET',
      '/api/bus/accuracy/leaderboard',
      queryParameters: <String, String>{
        'region': region,
        'limit': '$limit',
      },
    );
  }

  Future<Map<String, dynamic>> fetchPlaceConfig() {
    return _request('GET', '/api/places/config');
  }

  Future<Map<String, dynamic>> searchPlaces({required String query}) {
    return _request(
      'GET',
      '/api/places/search',
      queryParameters: <String, String>{'query': query},
    );
  }

  Future<Map<String, dynamic>> fetchBusConfig() {
    return _request('GET', '/api/bus/config');
  }

  Future<Map<String, dynamic>> searchStations({
    required String provider,
    required String keyword,
    String cityCode = '',
  }) {
    return _request(
      'GET',
      '/api/bus/stations',
      queryParameters: <String, String>{
        'provider': provider,
        'keyword': keyword,
        'cityCode': cityCode,
      },
    );
  }

  Future<Map<String, dynamic>> searchStationRoutes({
    required String provider,
    String stationId = '',
    String arsId = '',
    String routeNumber = '',
    String cityCode = '',
    String nodeId = '',
  }) {
    return _request(
      'GET',
      '/api/bus/station-routes',
      queryParameters: _stripEmpty(<String, String>{
        'provider': provider,
        'stationId': stationId,
        'arsId': arsId,
        'routeNumber': routeNumber,
        'cityCode': cityCode,
        'nodeId': nodeId,
      }),
    );
  }

  Future<Map<String, dynamic>> fetchTagoCities() {
    return _request('GET', '/api/bus/cities',
        queryParameters: <String, String>{'provider': 'tago', 'service': 'stops'});
  }

  Future<Map<String, dynamic>> fetchCommuteConfig() {
    return _request('GET', '/api/commute/config');
  }

  Future<Map<String, dynamic>> fetchMobileHealth() {
    return _request('GET', '/api/mobile/health');
  }

  Future<Map<String, dynamic>> estimateCommute(Map<String, dynamic> payload) {
    return _request('POST', '/api/commute/transit', body: payload);
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, String>? queryParameters,
    Map<String, dynamic>? body,
  }) async {
    final uri = Uri.parse('$_baseUrl$path').replace(
      queryParameters: queryParameters,
    );
    final client = HttpClient()..connectionTimeout = _requestTimeout;

    try {
      final request = await client.openUrl(method, uri);
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      if (_sessionCookie != null && _sessionCookie!.isNotEmpty) {
        request.headers.set(HttpHeaders.cookieHeader, _sessionCookie!);
      }

      if (body != null) {
        request.headers.contentType = ContentType.json;
        request.add(utf8.encode(jsonEncode(body)));
      }

      final response = await request.close().timeout(_requestTimeout);
      _captureSessionCookie(response.headers[HttpHeaders.setCookieHeader]);

      final rawBody = await response
          .transform(utf8.decoder)
          .join()
          .timeout(_requestTimeout);
      final decoded =
          rawBody.isEmpty ? <String, dynamic>{} : jsonDecode(rawBody);
      final payload = decoded is Map<String, dynamic>
          ? decoded
          : <String, dynamic>{'data': decoded};

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw MobileApiException(
          statusCode: response.statusCode,
          message:
              (payload['error'] ?? 'Request failed with ${response.statusCode}.')
                  .toString(),
          payload: payload,
        );
      }

      return payload;
    } on TimeoutException {
      throw MobileApiException(
        statusCode: 0,
        message:
            'Timed out reaching $_baseUrl after ${_requestTimeout.inSeconds} seconds.',
      );
    } on SocketException catch (error) {
      throw MobileApiException(
        statusCode: 0,
        message: 'Could not reach $_baseUrl. ${error.message}',
      );
    } finally {
      client.close(force: true);
    }
  }

  void _captureSessionCookie(List<String>? setCookieHeaders) {
    if (setCookieHeaders == null || setCookieHeaders.isEmpty) {
      return;
    }

    for (final header in setCookieHeaders) {
      final cookie = header.split(';').first.trim();
      if (cookie.startsWith('auth_session=')) {
        _sessionCookie = cookie;
        unawaited(_persistSessionSilently(cookie));
        return;
      }
    }
  }

  static Map<String, String> _stripEmpty(Map<String, String> source) {
    final next = <String, String>{};
    for (final entry in source.entries) {
      final value = entry.value.trim();
      if (value.isNotEmpty) {
        next[entry.key] = value;
      }
    }
    return next;
  }

  Future<void> _persistSessionSilently(String cookie) async {
    try {
      await _sessionStore.saveSessionCookie(cookie);
    } catch (_) {
      // The app can continue with an in-memory session if secure storage fails.
    }
  }

  Future<void> _clearPersistedSessionSilently() async {
    try {
      await _sessionStore.clearSessionCookie();
    } catch (_) {
      // Clearing an unavailable secure store must not block sign-out locally.
    }
  }

  static String _normalizeBaseUrl(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      return _defaultBaseUrl;
    }

    final withScheme = trimmed.contains('://') ? trimmed : 'http://$trimmed';
    final normalized = withScheme.endsWith('/')
        ? withScheme.substring(0, withScheme.length - 1)
        : withScheme;
    final parsed = Uri.tryParse(normalized);

    if (parsed == null ||
        parsed.scheme.isEmpty ||
        (parsed.host.isEmpty && !normalized.startsWith('http://localhost') && !normalized.startsWith('https://localhost'))) {
      throw ArgumentError(
        'Invalid server URL. Use a format like http://127.0.0.1:4173 or http://192.168.0.10:4173.',
      );
    }

    if (kReleaseMode && parsed.scheme != 'https') {
      throw ArgumentError(
        'Release builds require an HTTPS server URL to protect your account and commute data.',
      );
    }

    return normalized;
  }
}

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'mobile_social_auth.dart';

/// Error shown to the user. [message] is already Korean user-facing text.
class InochiApiException implements Exception {
  InochiApiException(this.statusCode, this.message, {this.code = ''});
  final int statusCode;
  final String message;
  final String code;
  bool get subscriptionRequired => code == 'SUBSCRIPTION_REQUIRED' || statusCode == 402;
  bool get loginRequired => statusCode == 401;
  @override
  String toString() => message;
}

/// Client for the server's app API (`/api/mobile/*`) and shared lookups.
/// Only ever talks to the production origin; the login token never leaves it.
class InochiApi {
  InochiApi({this.origin = MobileSocialAuth.origin});

  final String origin;
  static const Duration _timeout = Duration(seconds: 20);

  // ---- Home & commute -------------------------------------------------------
  Future<Map<String, dynamic>> home() => _send('GET', '/api/mobile/home', timeout: const Duration(seconds: 45));
  Future<Map<String, dynamic>> saveSetup(Map<String, dynamic> patch) =>
      _send('POST', '/api/mobile/setup', body: patch, timeout: const Duration(seconds: 45));
  Future<Map<String, dynamic>> setToday(bool enabled) =>
      _send('POST', '/api/mobile/today', body: {'enabled': enabled}, timeout: const Duration(seconds: 45));
  Future<Map<String, dynamic>> departed() =>
      _send('POST', '/api/alarm-delivery/actions', body: {'type': 'ACK_DEPARTED'});

  // ---- Paid trip schedules --------------------------------------------------
  Future<Map<String, dynamic>> trips() => _send('GET', '/api/mobile/trips');
  Future<Map<String, dynamic>> saveTrips(List<Map<String, dynamic>> trips) =>
      _send('PUT', '/api/mobile/trips', body: {'trips': trips});

  // ---- Search ---------------------------------------------------------------
  Future<List<Map<String, dynamic>>> searchPlaces(String query) async {
    final result = await _send('GET', '/api/places/search', query: {'query': query});
    return _list(result['results']);
  }

  Future<List<Map<String, dynamic>>> busCities() async {
    final result = await _send('GET', '/api/bus/cities', query: {'provider': 'auto'});
    return _list(result['cities']);
  }

  Future<Map<String, dynamic>> searchBusStops({required String cityId, required String keyword}) =>
      _send('GET', '/api/bus/stations', query: {'provider': 'auto', 'cityId': cityId, 'keyword': keyword});

  Future<Map<String, dynamic>> searchSubwayStations(String keyword) =>
      _send('GET', '/api/bus/stations', query: {'provider': 'subway', 'keyword': keyword});

  /// Routes (bus) or directions (subway) passing the chosen stop.
  Future<Map<String, dynamic>> stopRoutes(Map<String, dynamic> stop) {
    final query = <String, String>{};
    for (final key in ['provider', 'stationName', 'stationId', 'lineName', 'tagoStationId', 'arsId', 'cityCode', 'nodeId', 'posX', 'posY']) {
      final value = '${stop[key] ?? ''}'.trim();
      if (value.isNotEmpty) query[key] = value;
    }
    return _send('GET', '/api/bus/station-routes', query: query, timeout: const Duration(seconds: 30));
  }

  // ---- Device & account -----------------------------------------------------
  Future<Map<String, dynamic>> registerPushToken({required String token, required String platform, required String deviceName}) =>
      _send('POST', '/api/device-profile/register-token',
          body: {'pushToken': token, 'platform': platform, 'deviceName': deviceName, 'pushEnabled': true});
  Future<Map<String, dynamic>> updateDevice(Map<String, dynamic> patch) => _send('PUT', '/api/device-profile', body: patch);
  Future<Map<String, dynamic>> testPush() => _send('POST', '/api/push-gateway/test-dispatch', body: const {});
  Future<Map<String, dynamic>> session() => _send('GET', '/api/auth/session');
  Future<Map<String, dynamic>> deleteAccount({required bool acknowledgeSubscription}) => _send('POST', '/api/account/delete',
      body: {'confirm': '탈퇴', 'acknowledgeSubscription': acknowledgeSubscription});

  static List<Map<String, dynamic>> _list(Object? value) =>
      value is List ? value.whereType<Map>().map((item) => Map<String, dynamic>.from(item)).toList() : <Map<String, dynamic>>[];

  Future<Map<String, dynamic>> _send(String method, String path,
      {Map<String, String>? query, Object? body, Duration timeout = _timeout}) async {
    final uri = Uri.parse('$origin$path').replace(queryParameters: query == null || query.isEmpty ? null : query);
    if (uri.origin != MobileSocialAuth.origin) throw InochiApiException(0, '허용되지 않은 서버 주소입니다.');
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 10);
    try {
      final request = await client.openUrl(method, uri).timeout(timeout);
      request.followRedirects = false;
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      final token = await MobileSocialAuth.token();
      if (token != null) request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      if (body != null) {
        request.headers.contentType = ContentType.json;
        request.add(utf8.encode(jsonEncode(body)));
      }
      final response = await request.close().timeout(timeout);
      final raw = await response.transform(utf8.decoder).join().timeout(timeout);
      Object? decoded;
      try {
        decoded = raw.isEmpty ? <String, dynamic>{} : jsonDecode(raw);
      } catch (_) {
        decoded = <String, dynamic>{};
      }
      final payload = decoded is Map ? Map<String, dynamic>.from(decoded) : <String, dynamic>{'data': decoded};
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw InochiApiException(response.statusCode,
            '${payload['error'] ?? _statusMessage(response.statusCode)}', code: '${payload['code'] ?? ''}');
      }
      return payload;
    } on InochiApiException {
      rethrow;
    } on TimeoutException {
      throw InochiApiException(0, '서버 응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.');
    } on SocketException {
      throw InochiApiException(0, '인터넷 연결을 확인해 주세요.');
    } on HandshakeException {
      throw InochiApiException(0, '안전한 연결을 만들지 못했습니다. 네트워크를 확인해 주세요.');
    } finally {
      client.close(force: true);
    }
  }

  static String _statusMessage(int status) {
    if (status == 401) return '다시 로그인해 주세요.';
    if (status == 403) return '허용되지 않은 요청입니다.';
    if (status == 409) return '다른 기기에서 설정이 바뀌었습니다. 새로고침 후 다시 시도해 주세요.';
    if (status == 429) return '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.';
    return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
}

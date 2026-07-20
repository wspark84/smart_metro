import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

class MobileClientSettingsStore {
  static const String _baseUrlKey = 'mobile_api_base_url';
  static const String _realDeviceFlowCheckpointKey =
      'mobile_real_device_flow_checkpoint';
  static const String _realDeviceFlowResetBaselineKey =
      'mobile_real_device_flow_reset_baseline';

  final SharedPreferencesAsync _preferences = SharedPreferencesAsync();

  Future<String?> loadBaseUrl() {
    return _preferences.getString(_baseUrlKey);
  }

  Future<void> saveBaseUrl(String value) {
    return _preferences.setString(_baseUrlKey, value);
  }

  Future<Map<String, dynamic>?> loadRealDeviceFlowCheckpoint() async {
    final rawValue = await _preferences.getString(_realDeviceFlowCheckpointKey);
    if (rawValue == null || rawValue.trim().isEmpty) {
      return null;
    }
    final decoded = jsonDecode(rawValue);
    if (decoded is Map<String, dynamic>) {
      return decoded;
    }
    return null;
  }

  Future<void> saveRealDeviceFlowCheckpoint(Map<String, dynamic> value) {
    return _preferences.setString(
      _realDeviceFlowCheckpointKey,
      jsonEncode(value),
    );
  }

  Future<void> clearRealDeviceFlowCheckpoint() {
    return _preferences.remove(_realDeviceFlowCheckpointKey);
  }

  Future<Map<String, dynamic>?> loadRealDeviceFlowResetBaseline() async {
    final rawValue = await _preferences.getString(_realDeviceFlowResetBaselineKey);
    if (rawValue == null || rawValue.trim().isEmpty) {
      return null;
    }
    final decoded = jsonDecode(rawValue);
    if (decoded is Map<String, dynamic>) {
      return decoded;
    }
    return null;
  }

  Future<void> saveRealDeviceFlowResetBaseline(Map<String, dynamic> value) {
    return _preferences.setString(
      _realDeviceFlowResetBaselineKey,
      jsonEncode(value),
    );
  }

  Future<void> clearRealDeviceFlowResetBaseline() {
    return _preferences.remove(_realDeviceFlowResetBaselineKey);
  }
}

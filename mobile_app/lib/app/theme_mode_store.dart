import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 화면 모드(시스템/라이트/다크). Kept on this phone only.
class ThemeModeStore {
  ThemeModeStore._();
  static final ThemeModeStore instance = ThemeModeStore._();
  static const _key = 'inochi_theme_mode';

  final ValueNotifier<ThemeMode> mode = ValueNotifier(ThemeMode.system);

  Future<void> load() async {
    try {
      final saved = await SharedPreferencesAsync().getString(_key);
      mode.value = ThemeMode.values.firstWhere((value) => value.name == saved, orElse: () => ThemeMode.system);
    } catch (_) {
      mode.value = ThemeMode.system;
    }
  }

  Future<void> set(ThemeMode value) async {
    mode.value = value;
    try {
      await SharedPreferencesAsync().setString(_key, value.name);
    } catch (_) {
      // The choice still applies until the app restarts.
    }
  }
}

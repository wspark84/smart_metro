import 'package:shared_preferences/shared_preferences.dart';

import '../network/inochi_api.dart';

/// What happened on this phone when an alarm arrived (received, shown, tone,
/// voice, volume), kept on the phone because the background push isolate
/// cannot reach the server with the login. The today screen sends it to the
/// server's alarm events (kind CLIENT_ALARM) the next time the app is open,
/// so a silent alarm can be traced.
class AlarmLog {
  AlarmLog._();
  static const _key = 'inochi.alarmLog';
  static const _max = 60;

  static String _clock(DateTime at) {
    final kst = at.toUtc().add(const Duration(hours: 9));
    String two(int v) => v.toString().padLeft(2, '0');
    return '${two(kst.hour)}:${two(kst.minute)}:${two(kst.second)}';
  }

  static Future<void> add(String step) async {
    try {
      final prefs = SharedPreferencesAsync();
      final lines = await prefs.getStringList(_key) ?? <String>[];
      lines.add('${_clock(DateTime.now())} $step');
      await prefs.setStringList(_key, lines.length > _max ? lines.sublist(lines.length - _max) : lines);
    } catch (_) {
      // Diagnostics never get in the way of the alarm.
    }
  }

  static String describe(Object error) {
    final text = '$error'.replaceAll(RegExp(r'\s+'), ' ');
    return '${error.runtimeType}: ${text.length > 160 ? text.substring(0, 160) : text}';
  }

  /// Sends what was recorded and clears it once the server has it.
  static Future<void> upload(InochiApi api) async {
    try {
      final prefs = SharedPreferencesAsync();
      final lines = await prefs.getStringList(_key) ?? <String>[];
      if (lines.isEmpty) return;
      await api.reportAlarmLog(lines.join('\n'));
      await prefs.remove(_key);
    } catch (_) {
      // Kept for the next try.
    }
  }
}

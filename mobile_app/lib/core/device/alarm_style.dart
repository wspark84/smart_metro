import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 알람 방식, kept on this phone (the background push isolate reads it too).
/// sound: tone + time left read aloud at full alarm volume.
/// vibrate: no sound, a long 3-second vibration and a text pop-up.
enum AlarmStyle { sound, vibrate }

const vibrateAlarmChannelId = 'inochi-vibrate-v2';

/// Length of the single long vibration in 진동만 mode.
const vibrateOnlyMs = 3000;

class AlarmStyleStore {
  AlarmStyleStore._();
  static final AlarmStyleStore instance = AlarmStyleStore._();
  static const _key = 'inochi_alarm_style';

  final ValueNotifier<AlarmStyle> style = ValueNotifier(AlarmStyle.sound);

  /// Fresh read from storage (works in any isolate); sound when unknown.
  static Future<AlarmStyle> read() async {
    try {
      final saved = await SharedPreferencesAsync().getString(_key);
      return AlarmStyle.values.firstWhere((value) => value.name == saved, orElse: () => AlarmStyle.sound);
    } catch (_) {
      return AlarmStyle.sound;
    }
  }

  Future<void> load() async => style.value = await read();

  Future<void> set(AlarmStyle value) async {
    style.value = value;
    try {
      await SharedPreferencesAsync().setString(_key, value.name);
    } catch (_) {
      // Applies until the app restarts.
    }
  }
}

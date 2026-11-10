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

/// 알람 소리. All tones are original sounds made for 이노치
/// (scripts/make-alarm-tones.py) except the default ring.
class AlarmTone {
  const AlarmTone(this.id, this.label, this.file);
  final String id;
  final String label;
  final String file; // under assets/audio/

  static const all = <AlarmTone>[
    AlarmTone('ring', '기본 알람', 'inochi_ring.wav'),
    AlarmTone('beep', '디지털 비프', 'inochi_beep.wav'),
    AlarmTone('bell', '종소리', 'inochi_bell.wav'),
    AlarmTone('chime', '차임', 'inochi_chime.wav'),
    AlarmTone('rise', '점점 올라가는 소리', 'inochi_rise.wav'),
    AlarmTone('siren', '긴급 사이렌', 'inochi_siren.wav'),
  ];

  static AlarmTone byId(String? id) => all.firstWhere((tone) => tone.id == id, orElse: () => all.first);
}

class AlarmToneStore {
  AlarmToneStore._();
  static final AlarmToneStore instance = AlarmToneStore._();
  static const _key = 'inochi_alarm_tone';

  final ValueNotifier<AlarmTone> tone = ValueNotifier(AlarmTone.all.first);

  /// Fresh read from storage (works in the background push isolate too).
  static Future<AlarmTone> read() async {
    try {
      return AlarmTone.byId(await SharedPreferencesAsync().getString(_key));
    } catch (_) {
      return AlarmTone.all.first;
    }
  }

  Future<void> load() async => tone.value = await read();

  Future<void> set(AlarmTone value) async {
    tone.value = value;
    try {
      await SharedPreferencesAsync().setString(_key, value.id);
    } catch (_) {}
  }
}

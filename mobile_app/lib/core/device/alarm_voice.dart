import 'dart:async';
import 'dart:isolate';
import 'dart:ui';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:flutter_volume_controller/flutter_volume_controller.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'alarm_log.dart';
import 'push_alarm_payload.dart';

/// Rings and reads the time left aloud on the ALARM volume, turned all the way
/// up while it rings (and put back after), so it is heard in silent (무음)
/// mode and whatever the volume was left at. Works in the background push isolate and in the
/// app. Any isolate can stop it with [AlarmVoice.stop] (app opened, 출발했어요).
class AlarmVoice {
  AlarmVoice._();

  static const _portName = 'inochi-alarm-voice';
  static const rounds = 3;

  // No audio-focus request: Android 15 refuses focus to background apps,
  // and the alarm stream plays without it.
  static final AudioContext _alarm = AudioContext(
    android: const AudioContextAndroid(
      usageType: AndroidUsageType.alarm,
      contentType: AndroidContentType.sonification,
      audioFocus: AndroidAudioFocus.none,
      stayAwake: true,
    ),
  );

  static const _savedAlarmKey = 'inochi.alarmVolumeBefore';
  static const _savedMediaKey = 'inochi.mediaVolumeBefore';

  static bool get supported => !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  /// Stop a ringing alarm in whichever isolate it is playing.
  static void stop() {
    if (!supported) return;
    IsolateNameServer.lookupPortByName(_portName)?.send('stop');
  }

  /// Turns the alarm volume all the way up, remembering the person's level
  /// once (a second alarm does not overwrite it). Call before the
  /// notification shows so its tone is already loud.
  static Future<void> maxVolume({AudioStream stream = AudioStream.alarm}) async {
    if (!supported) return;
    final key = stream == AudioStream.alarm ? _savedAlarmKey : _savedMediaKey;
    try {
      await FlutterVolumeController.updateShowSystemUI(false);
      final prefs = SharedPreferencesAsync();
      if (await prefs.getDouble(key) == null) {
        final before = await FlutterVolumeController.getVolume(stream: stream);
        if (before != null) await prefs.setDouble(key, before);
      }
      await FlutterVolumeController.setVolume(1.0, stream: stream);
      await AlarmLog.add('음량 최대 ${stream.name} → ${await FlutterVolumeController.getVolume(stream: stream)}');
    } catch (error) {
      // Some phones refuse volume changes in 방해 금지; ring at the set level.
      await AlarmLog.add('음량 올리기 실패 ${AlarmLog.describe(error)}');
    }
  }

  /// Puts back the volumes the person had before the alarm.
  static Future<void> restoreVolume() async {
    if (!supported) return;
    final prefs = SharedPreferencesAsync();
    for (final (key, stream) in [(_savedAlarmKey, AudioStream.alarm), (_savedMediaKey, AudioStream.music)]) {
      try {
        final before = await prefs.getDouble(key);
        if (before == null) continue;
        await FlutterVolumeController.setVolume(before, stream: stream);
        await prefs.remove(key);
      } catch (_) {}
    }
  }

  /// Short tone, then the time left, [rounds] times (~30 seconds).
  /// [skipFirstTone] when the notification itself just played the tone.
  static Future<void> ring(PushAlarmPayload payload, {bool skipFirstTone = false}) async {
    if (!supported) return;
    // A newer alarm replaces one still ringing; the old one then leaves the
    // volume up for this one.
    IsolateNameServer.lookupPortByName(_portName)?.send('replace');
    await Future<void>.delayed(const Duration(milliseconds: 200));
    await maxVolume();
    var stopped = false;
    var replaced = false;
    final port = ReceivePort();
    IsolateNameServer.removePortNameMapping(_portName);
    IsolateNameServer.registerPortWithName(port.sendPort, _portName);
    final tone = AudioPlayer();
    final voice = AudioPlayer();
    final tts = FlutterTts();
    final listener = port.listen((message) {
      stopped = true;
      replaced = message == 'replace';
      unawaited(tone.stop());
      unawaited(voice.stop());
      unawaited(tts.stop());
    });
    await AlarmLog.add('알람 소리 시작');
    try {
      await tone.setAudioContext(_alarm);
      await voice.setAudioContext(_alarm);
      for (var round = 0; round < rounds && !stopped; round++) {
        if (round > 0 || !skipFirstTone) {
          await _playAndWait(tone, AssetSource('audio/inochi_ring.wav'), const Duration(seconds: 6));
        } else {
          await Future<void>.delayed(const Duration(milliseconds: 4600));
        }
        if (stopped) break;
        final text = alarmSpeech(payload, DateTime.now());
        if (text.trim().isEmpty) continue;
        final file = await _synthesize(tts, text, round);
        if (stopped) break;
        if (file != null) {
          await _playAndWait(voice, DeviceFileSource(file), const Duration(seconds: 25));
        } else {
          // No speech file (TTS engine missing Korean voice etc.): speak on the
          // media volume, also turned up, instead of staying silent.
          await maxVolume(stream: AudioStream.music);
          await tts.awaitSpeakCompletion(true);
          await tts.speak(text).timeout(const Duration(seconds: 25), onTimeout: () => null);
        }
        if (!stopped) await Future<void>.delayed(const Duration(milliseconds: 700));
      }
    } catch (error) {
      // Ringing is best effort; the notification is already on screen.
      await AlarmLog.add('알람 소리 실패 ${AlarmLog.describe(error)}');
    } finally {
      await AlarmLog.add('알람 소리 끝 ${replaced ? '(다음 알람으로 교체)' : stopped ? '(앱 열어서 멈춤)' : ''}');
      await listener.cancel();
      port.close();
      if (!replaced) {
        IsolateNameServer.removePortNameMapping(_portName);
        await restoreVolume();
      }
      await tone.dispose();
      await voice.dispose();
    }
  }

  static Future<void> _playAndWait(AudioPlayer player, Source source, Duration limit) async {
    final done = player.onPlayerComplete.first;
    final what = source is AssetSource ? '알람음' : '음성';
    try {
      await player.play(source, volume: 1.0);
    } catch (error) {
      // A failed tone must not cancel the spoken time left (or the reverse).
      await AlarmLog.add('$what 재생 실패 ${AlarmLog.describe(error)}');
      return;
    }
    var finished = true;
    await done.timeout(limit, onTimeout: () => finished = false);
    await AlarmLog.add('$what ${finished ? '재생 완료' : '재생 끝 확인 못 함'}');
  }

  static Future<String?> _synthesize(FlutterTts tts, String text, int round) async {
    try {
      await tts.setLanguage('ko-KR');
      await tts.setSpeechRate(0.5);
      await tts.setVolume(1.0);
      await tts.awaitSynthCompletion(true);
      final dir = await getTemporaryDirectory();
      final path = '${dir.path}/inochi_alarm_$round.wav';
      final result = await tts
          .synthesizeToFile(text, path, true)
          .timeout(const Duration(seconds: 8), onTimeout: () => 0);
      await AlarmLog.add('음성 만들기 ${result == 1 ? '성공' : '실패($result)'}');
      return result == 1 ? path : null;
    } catch (error) {
      await AlarmLog.add('음성 만들기 실패 ${AlarmLog.describe(error)}');
      return null;
    }
  }
}

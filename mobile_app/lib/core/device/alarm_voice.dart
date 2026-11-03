import 'dart:async';
import 'dart:isolate';
import 'dart:ui';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:path_provider/path_provider.dart';

import 'push_alarm_payload.dart';

/// Rings and reads the time left aloud on the ALARM volume, so it is heard
/// in silent (무음) mode too. Works in the background push isolate and in the
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

  static bool get supported => !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  /// Stop a ringing alarm in whichever isolate it is playing.
  static void stop() {
    if (!supported) return;
    IsolateNameServer.lookupPortByName(_portName)?.send('stop');
  }

  /// Short tone, then the time left, [rounds] times (~30 seconds).
  /// [skipFirstTone] when the notification itself just played the tone.
  static Future<void> ring(PushAlarmPayload payload, {bool skipFirstTone = false}) async {
    if (!supported) return;
    stop(); // a newer alarm replaces one still ringing
    await Future<void>.delayed(const Duration(milliseconds: 200));
    var stopped = false;
    final port = ReceivePort();
    IsolateNameServer.removePortNameMapping(_portName);
    IsolateNameServer.registerPortWithName(port.sendPort, _portName);
    final tone = AudioPlayer();
    final voice = AudioPlayer();
    final tts = FlutterTts();
    final listener = port.listen((_) {
      stopped = true;
      unawaited(tone.stop());
      unawaited(voice.stop());
      unawaited(tts.stop());
    });
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
          // media volume instead of staying silent.
          await tts.awaitSpeakCompletion(true);
          await tts.speak(text).timeout(const Duration(seconds: 25), onTimeout: () => null);
        }
        if (!stopped) await Future<void>.delayed(const Duration(milliseconds: 700));
      }
    } catch (_) {
      // Ringing is best effort; the notification is already on screen.
    } finally {
      await listener.cancel();
      port.close();
      IsolateNameServer.removePortNameMapping(_portName);
      await tone.dispose();
      await voice.dispose();
    }
  }

  static Future<void> _playAndWait(AudioPlayer player, Source source, Duration limit) async {
    final done = player.onPlayerComplete.first;
    await player.play(source, volume: 1.0);
    await done.timeout(limit, onTimeout: () => null);
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
      return result == 1 ? path : null;
    } catch (_) {
      return null;
    }
  }
}

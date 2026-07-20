import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:vibration/vibration.dart';

import 'native_alarm_preview_spec.dart';

class NativeAlarmPreviewService {
  AudioPlayer? _audioPlayer;
  FlutterTts? _tts;
  Timer? _stopTimer;
  bool _previewActive = false;

  Future<String> previewMustCatchAlarm({
    required NativeAlarmPreviewSpec spec,
    required bool soundEnabled,
    required bool vibrationEnabled,
    required bool ttsEnabled,
  }) async {
    if (!soundEnabled && !vibrationEnabled && !ttsEnabled) {
      return 'Enable sound, vibration, or TTS before starting the late-alarm preview.';
    }

    await stop();

    final startedChannels = <String>[];
    final warnings = <String>[];

    if (soundEnabled) {
      try {
        final player = _ensureAudioPlayer();
        await player.setReleaseMode(ReleaseMode.loop);
        await player.setVolume(spec.volumePercent / 100);
        await player.play(AssetSource(spec.assetPath));
        startedChannels.add('mechanical sound');
      } catch (_) {
        warnings.add('Mechanical sound could not start on this device.');
      }
    }

    if (vibrationEnabled) {
      try {
        if (await Vibration.hasVibrator()) {
          await Vibration.vibrate(
            pattern: _buildAndroidStylePattern(
              spec.vibrationPattern,
              spec.vibrationRepeats,
            ),
          );
          startedChannels.add('vibration');
        } else {
          warnings.add('This device reports no vibration motor.');
        }
      } catch (_) {
        warnings.add('Vibration preview could not start on this device.');
      }
    }

    if (ttsEnabled) {
      try {
        final tts = _ensureTts();
        await _configureTts(tts);
        await tts.speak(spec.speechText, focus: true);
        startedChannels.add('Korean TTS');
      } catch (_) {
        warnings.add('Korean TTS could not start on this device.');
      }
    }

    if (startedChannels.isEmpty) {
      return warnings.isEmpty
          ? 'The preview could not start on this device.'
          : warnings.join(' ');
    }

    _previewActive = true;
    _stopTimer = Timer(spec.previewDuration, () {
      unawaited(stop());
    });

    final summary =
        'Late-alarm preview started: ${startedChannels.join(', ')}. Phrase: ${spec.repeatedLateWarningPhrase}';
    if (warnings.isEmpty) {
      return summary;
    }
    return '$summary Warnings: ${warnings.join(' ')}';
  }

  Future<String> stop() async {
    final wasActive = _previewActive;
    _previewActive = false;
    _stopTimer?.cancel();
    _stopTimer = null;

    try {
      await _audioPlayer?.stop();
    } catch (_) {
      // Ignore stop errors for best-effort shutdown.
    }

    try {
      await _tts?.stop();
    } catch (_) {
      // Ignore stop errors for best-effort shutdown.
    }

    try {
      await Vibration.cancel();
    } catch (_) {
      // Ignore stop errors for best-effort shutdown.
    }

    return wasActive
        ? 'Late-alarm preview stopped.'
        : 'No late-alarm preview is currently running.';
  }

  Future<void> dispose() async {
    await stop();
    if (_audioPlayer != null) {
      await _audioPlayer!.dispose();
      _audioPlayer = null;
    }
  }

  AudioPlayer _ensureAudioPlayer() {
    return _audioPlayer ??= AudioPlayer(
      playerId: 'buswakeup-native-alarm-preview',
    );
  }

  FlutterTts _ensureTts() {
    return _tts ??= FlutterTts();
  }

  Future<void> _configureTts(FlutterTts tts) async {
    await tts.awaitSpeakCompletion(false);
    await tts.setLanguage('ko-KR');
    await tts.setSpeechRate(0.42);
    await tts.setVolume(1.0);
    await tts.setPitch(1.0);

    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.iOS) {
      await tts.setSharedInstance(true);
      await tts.autoStopSharedSession(false);
      await tts.setIosAudioCategory(
        IosTextToSpeechAudioCategory.playback,
        <IosTextToSpeechAudioCategoryOptions>[
          IosTextToSpeechAudioCategoryOptions.defaultToSpeaker,
          IosTextToSpeechAudioCategoryOptions.duckOthers,
        ],
        IosTextToSpeechAudioMode.voicePrompt,
      );
    }
  }

  List<int> _buildAndroidStylePattern(
    List<int> basePattern,
    int repeats,
  ) {
    final pattern = <int>[0];
    final safeRepeats = repeats < 1 ? 1 : repeats;
    for (var index = 0; index < safeRepeats; index += 1) {
      pattern.addAll(basePattern);
    }
    return pattern;
  }
}

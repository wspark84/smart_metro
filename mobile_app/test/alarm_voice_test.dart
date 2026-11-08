import 'dart:async';

import 'package:buswakeup_mobile/core/device/alarm_voice.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('waiting for the end of a sound works whatever its event type', () async {
    // The player's completion future carries its own event type; waiting on it
    // must not throw (2026-11-08: a TypeError here left the alarm silent).
    final Future<Object?> typed = Future<int>.value(1);
    expect(await AlarmVoice.finishedWithin(typed, const Duration(seconds: 1)), isTrue);
    final Future<Object?> never = Completer<String>().future;
    expect(await AlarmVoice.finishedWithin(never, const Duration(milliseconds: 20)), isFalse);
  });
}

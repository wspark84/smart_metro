import 'dart:io';

import 'package:buswakeup_mobile/core/device/alarm_style.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('every alarm sound has its file, the default first, unknown ids fall back to it', () {
    expect(AlarmTone.all.first.id, 'ring');
    expect(AlarmTone.all.map((tone) => tone.id).toSet().length, AlarmTone.all.length);
    for (final tone in AlarmTone.all) {
      expect(File('assets/audio/${tone.file}').existsSync(), isTrue, reason: tone.file);
    }
    expect(AlarmTone.byId('bell').label, '종소리');
    expect(AlarmTone.byId('nope').id, 'ring');
    expect(AlarmTone.byId(null).id, 'ring');
  });
}

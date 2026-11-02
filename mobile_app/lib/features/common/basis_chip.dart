import 'package:flutter/material.dart';

import '../../app/inochi_theme.dart';
import '../stops/stop_widgets.dart';

/// Makes clear where a time comes from. Timetable/estimated values must never
/// look like real-time data.
class BasisChip extends StatelessWidget {
  const BasisChip({super.key, required this.basis});
  final String basis;

  static String label(String basis) => switch (basis) {
        'realtime' => '실시간',
        'timetable' => '시간표 기준',
        'estimate' => '배차간격 예상',
        _ => '',
      };

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    final text = label(basis);
    if (text.isEmpty) return const SizedBox.shrink();
    final color = switch (basis) {
      'realtime' => p.ok,
      'timetable' => p.timetable,
      _ => p.muted,
    };
    return Pill(text: text, color: color);
  }
}

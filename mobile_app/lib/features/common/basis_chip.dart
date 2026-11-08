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
        'schedule' => '시간표 예상',
        _ => '',
      };

  /// Short tag for one row in the vehicle list.
  static String short(String basis) => switch (basis) {
        'realtime' => '실시간',
        'timetable' => '시간표',
        'estimate' => '배차예상',
        'schedule' => '시간표예상',
        _ => '',
      };

  /// What the leave time is based on, said in full under the headline.
  static String sentence(String basis) => switch (basis) {
        'realtime' => '실시간 도착정보 기준 시간이에요',
        'timetable' => '열차 시간표 기준 시간이에요',
        'estimate' => '앞 차 실시간 정보에 배차간격을 더해 예상한 시간이에요 (실시간 아님)',
        'schedule' => '실시간 정보가 아직 없어 시간표(배차간격)로 예상한 시간이에요',
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

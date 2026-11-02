import 'package:flutter/material.dart';

import '../../app/inochi_theme.dart';
import '../stops/stop_widgets.dart';

TimeOfDay? parseHhmm(String value) {
  final match = RegExp(r'^([01]\d|2[0-3]):([0-5]\d)$').firstMatch(value.trim());
  return match == null ? null : TimeOfDay(hour: int.parse(match.group(1)!), minute: int.parse(match.group(2)!));
}

String formatHhmm(TimeOfDay time) => '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';

/// "오전 9:00"
String koreanTime(TimeOfDay time) {
  final hour = time.hour % 12 == 0 ? 12 : time.hour % 12;
  return '${time.hour < 12 ? '오전' : '오후'} $hour:${time.minute.toString().padLeft(2, '0')}';
}

/// The fields the server's setup API accepts for a boarding stop.
Map<String, dynamic> boardingPayload(Map<String, dynamic> stop) => {
      for (final key in ['provider', 'stationId', 'stationName', 'arsId', 'cityCode', 'nodeId', 'lineName'])
        key: '${stop[key] ?? ''}',
      'lat': asDouble(stop['lat']),
      'lng': asDouble(stop['lng']),
    };

/// "−  7분  +" with 48dp targets; 0–60 minutes.
class WalkStepper extends StatelessWidget {
  const WalkStepper({super.key, required this.minutes, required this.onChanged, this.compact = false});
  final int minutes;
  final ValueChanged<int> onChanged;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    Widget button(String label, String semantics, int delta) => Semantics(
          button: true,
          label: semantics,
          child: SizedBox(
            width: 48,
            height: 48,
            child: OutlinedButton(
              style: OutlinedButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(48, 48), shape: const CircleBorder()),
              onPressed: (minutes + delta) < 0 || (minutes + delta) > 60 ? null : () => onChanged(minutes + delta),
              child: Text(label, style: TextStyle(fontSize: 22, color: p.ink)),
            ),
          ),
        );
    return Row(mainAxisSize: compact ? MainAxisSize.min : MainAxisSize.max, children: [
      button('−', '1분 줄이기', -1),
      SizedBox(
        width: compact ? 64 : 120,
        child: Text('$minutes분',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: compact ? 17 : 32, fontWeight: FontWeight.w700, fontFeatures: tabular)),
      ),
      button('+', '1분 늘리기', 1),
    ]);
  }
}

import 'package:flutter/material.dart';

import '../../app/inochi_theme.dart';

Map<String, dynamic> asMap(Object? value) => value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
List<Map<String, dynamic>> asMapList(Object? value) =>
    value is List ? value.whereType<Map>().map((item) => Map<String, dynamic>.from(item)).toList() : <Map<String, dynamic>>[];
double? asDouble(Object? value) => value is num ? value.toDouble() : double.tryParse('${value ?? ''}');

bool isSubway(Map<String, dynamic> stop) => stop['mode'] == 'subway' || stop['provider'] == 'subway';

/// "버스 · 05712" / "지하철 · 부산 2호선".
String stopKindLabel(Map<String, dynamic> stop) {
  if (isSubway(stop)) {
    final line = '${stop['lineName'] ?? ''}'.trim();
    return line.isEmpty ? '지하철' : '지하철 · $line';
  }
  final number = '${stop['stationNumber'] ?? stop['arsId'] ?? ''}'.trim();
  return number.isEmpty ? '버스' : '버스 · $number';
}

String stopTitle(Map<String, dynamic> stop) {
  final name = '${stop['stationName'] ?? ''}'.trim();
  return isSubway(stop) && !name.endsWith('역') ? '$name역' : name;
}

/// Number badge used in the list and on the map: filled circle for a bus
/// stop, outlined for its opposite twin, rounded square for a subway station.
class StopBadge extends StatelessWidget {
  const StopBadge({super.key, required this.number, required this.subway, this.outlined = false, this.size = 28});
  final int number;
  final bool subway;
  final bool outlined;
  final double size;

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: subway ? p.subway : outlined ? p.card : p.ink,
        shape: subway ? BoxShape.rectangle : BoxShape.circle,
        borderRadius: subway ? BorderRadius.circular(8) : null,
        border: outlined && !subway ? Border.all(color: p.ink, width: 2) : null,
      ),
      child: Text('$number',
          style: TextStyle(
              fontSize: 13, fontWeight: FontWeight.w700, color: subway ? Colors.white : outlined ? p.ink : p.ground, fontFeatures: tabular)),
    );
  }
}

/// Small rounded label, e.g. "시간표 기준" or "유료".
class Pill extends StatelessWidget {
  const Pill({super.key, required this.text, required this.color, this.filled = false});
  final String text;
  final Color color;
  final bool filled;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 1),
        decoration: BoxDecoration(
          color: filled ? color : null,
          borderRadius: BorderRadius.circular(999),
          border: filled ? null : Border.all(color: color),
        ),
        child: Text(text,
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: filled ? const Color(0xFF1B1A17) : color)),
      );
}

/// Press feedback (scale 0.97, ease-out) for custom tappable surfaces.
class Pressable extends StatefulWidget {
  const Pressable({super.key, required this.child, required this.onTap, this.semanticsLabel});
  final Widget child;
  final VoidCallback? onTap;
  final String? semanticsLabel;

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null;
    return Semantics(
      button: true,
      enabled: enabled,
      label: widget.semanticsLabel,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: enabled ? (_) => setState(() => _down = true) : null,
        onTapCancel: enabled ? () => setState(() => _down = false) : null,
        onTapUp: enabled ? (_) => setState(() => _down = false) : null,
        onTap: widget.onTap,
        child: AnimatedScale(
          scale: _down ? 0.97 : 1,
          duration: motion(context, 120),
          curve: motionCurve,
          child: widget.child,
        ),
      ),
    );
  }
}

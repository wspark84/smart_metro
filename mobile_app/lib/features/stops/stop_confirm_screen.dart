import 'dart:async';

import 'package:flutter/material.dart';

import '../../app/inochi_theme.dart';
import '../../core/network/inochi_api.dart';
import 'stop_map.dart';
import 'stop_widgets.dart';

/// Shows exactly where the chosen stop is and which way it goes, offers the
/// opposite-side stop with one tap, and pops the stop the user confirms.
class StopConfirmScreen extends StatefulWidget {
  const StopConfirmScreen({super.key, required this.api, required this.stop, required this.nearby, required this.descriptions});
  final InochiApi api;
  final Map<String, dynamic> stop;
  final List<Map<String, dynamic>> nearby;
  final Map<String, Map<String, dynamic>> descriptions;

  @override
  State<StopConfirmScreen> createState() => _StopConfirmScreenState();
}

class _StopConfirmScreenState extends State<StopConfirmScreen> {
  late Map<String, dynamic> _stop = widget.stop;
  bool _loading = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    unawaited(_describe());
  }

  String get _key => '${_stop['key']}';
  Map<String, dynamic>? get _description => widget.descriptions[_key];

  Map<String, dynamic>? get _opposite {
    final key = '${_stop['oppositeKey'] ?? ''}';
    if (key.isEmpty) return null;
    for (final stop in widget.nearby) {
      if ('${stop['key']}' == key) return stop;
    }
    return null;
  }

  Future<void> _describe() async {
    final opposite = _opposite;
    final missing = [_stop, if (opposite != null) opposite].where((stop) => !widget.descriptions.containsKey('${stop['key']}')).toList();
    if (missing.isEmpty) return;
    setState(() {
      _loading = true;
      _error = '';
    });
    for (final stop in missing) {
      try {
        final description = await widget.api.describeStop(stop);
        widget.descriptions['${stop['key']}'] = description;
      } catch (error) {
        if ('${stop['key']}' == _key) _error = error is InochiApiException ? error.message : '방면 정보를 불러오지 못했어요.';
      }
      if (!mounted) return;
    }
    setState(() => _loading = false);
  }

  void _switchToOpposite() {
    final opposite = _opposite;
    if (opposite == null) return;
    setState(() {
      _stop = opposite;
      _error = '';
    });
    unawaited(_describe());
  }

  Map<String, dynamic> _result() => {
        for (final key in ['provider', 'stationId', 'stationName', 'arsId', 'cityCode', 'nodeId', 'lineName', 'stationNumber', 'mode'])
          key: '${_stop[key] ?? ''}',
        'lat': asDouble(_stop['lat']),
        'lng': asDouble(_stop['lng']),
      };

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    final subway = isSubway(_stop);
    final lat = asDouble(_stop['lat'])!, lng = asDouble(_stop['lng'])!;
    final opposite = _opposite;
    final oppositeDescription = opposite == null ? null : widget.descriptions['${opposite['key']}'];
    final description = _description;
    final heading = '${description?['heading'] ?? ''}'.trim();
    final next = '${description?['nextStop'] ?? ''}'.trim();
    final routes = asMapList(description?['routes']);
    final directions = (description?['directions'] is List ? description!['directions'] as List : const []).map((e) => '$e').toList();
    final number = '${_stop['stationNumber'] ?? _stop['arsId'] ?? ''}'.trim();
    final oppositeNumber = '${opposite?['stationNumber'] ?? opposite?['arsId'] ?? ''}'.trim();
    final pins = [
      MapPin(id: _key, lat: lat, lng: lng, kind: PinKind.here),
      if (opposite != null)
        MapPin(
          id: '${opposite['key']}',
          lat: asDouble(opposite['lat'])!,
          lng: asDouble(opposite['lng'])!,
          kind: PinKind.opposite,
          label: oppositeNumber.isEmpty ? '맞은편' : '맞은편 $oppositeNumber',
        ),
    ];
    return Scaffold(
      backgroundColor: p.ground,
      body: Stack(children: [
        Positioned(
          top: 0,
          left: 0,
          right: 0,
          height: 380,
          child: StopMap(lat: lat, lng: lng, pins: pins, zoomLevel: 18, onPinTap: (id) {
            if (id != _key) _switchToOpposite();
          }),
        ),
        Positioned(
          left: 8,
          top: MediaQuery.paddingOf(context).top + 8,
          child: Material(
            color: p.card,
            shape: const CircleBorder(),
            elevation: 2,
            child: IconButton(
              tooltip: '뒤로',
              onPressed: () => Navigator.of(context).maybePop(),
              icon: Icon(Icons.arrow_back, color: p.ink),
            ),
          ),
        ),
        Positioned(
          top: 356,
          left: 0,
          right: 0,
          bottom: 0,
          child: Container(
              decoration: BoxDecoration(
                color: p.sheet,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.10), blurRadius: 24, offset: const Offset(0, -6))],
              ),
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Expanded(
                      child: ListView(padding: EdgeInsets.zero, children: [
                        AnimatedSwitcher(
                          duration: motion(context),
                          switchInCurve: motionCurve,
                          child: Column(
                            key: ValueKey(_key),
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text.rich(TextSpan(children: [
                                TextSpan(text: stopTitle(_stop), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
                                TextSpan(
                                  text: subway
                                      ? '  ${'${_stop['lineName'] ?? ''}'.trim()}'
                                      : number.isEmpty ? '' : '  정류장 번호 $number',
                                  style: TextStyle(fontSize: 15, color: p.muted, fontFeatures: tabular),
                                ),
                              ])),
                              const SizedBox(height: 4),
                              if (subway) ...[
                                const Text('방향은 도착지에 맞춰 자동으로 골라요', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                                if (directions.isNotEmpty)
                                  Text('${directions.map((d) => '$d 방면').join(' · ')} 열차가 서요', style: TextStyle(fontSize: 14, color: p.muted)),
                                if (description?['timetable'] == true) ...[
                                  const SizedBox(height: 6),
                                  Pill(text: '시간표 기준', color: p.timetable),
                                ],
                              ] else ...[
                                if (heading.isNotEmpty)
                                  Text('→ $heading 방면으로 가는 쪽', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                                Text(
                                  [
                                    if (next.isNotEmpty) '다음 정류장 $next',
                                    '정류장 표지판의 번호와 같은지 확인하세요',
                                  ].join(' · '),
                                  style: TextStyle(fontSize: 14, color: p.muted),
                                ),
                              ],
                              if (_error.isNotEmpty) Padding(
                                padding: const EdgeInsets.only(top: 6),
                                child: Text(_error, style: TextStyle(fontSize: 14, color: p.danger)),
                              ),
                            ],
                          ),
                        ),
                        if (_loading) const Padding(padding: EdgeInsets.only(top: 12), child: LinearProgressIndicator(minHeight: 2)),
                        if (!subway && routes.isNotEmpty) ...[
                          const SizedBox(height: 14),
                          Text('여기 서는 버스', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: p.muted)),
                          const SizedBox(height: 8),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            for (final route in routes.take(16))
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                decoration: BoxDecoration(border: Border.all(color: p.line), borderRadius: BorderRadius.circular(10)),
                                child: Text('${route['routeNumber']}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
                              ),
                          ]),
                        ],
                        if (opposite != null) ...[
                          const SizedBox(height: 14),
                          Pressable(
                            onTap: _switchToOpposite,
                            semanticsLabel: '반대 방향 정류장으로 바꾸기',
                            child: Container(
                              constraints: const BoxConstraints(minHeight: 56),
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                              decoration: BoxDecoration(color: p.ground, borderRadius: BorderRadius.circular(14)),
                              child: Row(children: [
                                Icon(Icons.swap_horiz, color: p.ink),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    const Text('반대 방향이에요', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                                    Text(
                                      [
                                        oppositeNumber.isEmpty ? '맞은편 정류장' : '맞은편 $oppositeNumber',
                                        if ('${oppositeDescription?['heading'] ?? ''}'.isNotEmpty) '${oppositeDescription!['heading']} 방면으로 바꾸기' else '으로 바꾸기',
                                      ].join(' · ').replaceAll(' · 으로', '으로'),
                                      style: TextStyle(fontSize: 13, color: p.muted),
                                    ),
                                  ]),
                                ),
                              ]),
                            ),
                          ),
                        ],
                        const SizedBox(height: 16),
                      ]),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: FilledButton(
                        onPressed: () => Navigator.of(context).pop(_result()),
                        child: Text(subway ? '이 역에서 출발' : '이 정류장에서 출발'),
                      ),
                    ),
                  ]),
                ),
              ),
            ),
          ),
      ]),
    );
  }
}

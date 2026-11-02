import 'dart:async';

import 'package:flutter/material.dart';

import '../../app/inochi_theme.dart';
import '../../core/network/inochi_api.dart';
import 'stop_confirm_screen.dart';
import 'stop_map.dart';
import 'stop_widgets.dart';

/// "출발 정류장·역": search a place, see every bus stop and subway station
/// around it on the map, read which way each stop goes, then confirm one.
/// Pops the confirmed stop (`provider, stationId, stationName, arsId,
/// cityCode, nodeId, lineName, lat, lng, stationNumber`).
class StopPickerScreen extends StatefulWidget {
  const StopPickerScreen({super.key, required this.api, this.initial});
  final InochiApi api;
  final Map<String, dynamic>? initial;

  @override
  State<StopPickerScreen> createState() => _StopPickerScreenState();
}

class _StopPickerScreenState extends State<StopPickerScreen> {
  final _query = TextEditingController();
  final _focus = FocusNode();
  final Map<String, Map<String, dynamic>> _descriptions = {};
  List<Map<String, dynamic>> _places = const [];
  List<Map<String, dynamic>> _stops = const [];
  double? _lat;
  double? _lng;
  ({double lat, double lng})? _movedTo;
  bool _loading = false;
  String _message = '';
  int _describeRun = 0;

  @override
  void initState() {
    super.initState();
    final initial = widget.initial;
    final lat = asDouble(initial?['lat']), lng = asDouble(initial?['lng']);
    if (lat != null && lng != null) {
      _query.text = '${initial?['stationName'] ?? ''}';
      unawaited(_loadNearby(lat, lng));
    } else {
      _message = '정류장·역 이름이나 근처 장소를 검색해 주세요.';
    }
  }

  @override
  void dispose() {
    _describeRun++;
    _query.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    final query = _query.text.trim();
    if (query.length < 2) {
      setState(() => _message = '두 글자 이상 입력해 주세요.');
      return;
    }
    _focus.unfocus();
    setState(() {
      _loading = true;
      _message = '';
      _places = const [];
    });
    try {
      final results = (await widget.api.searchPlaces(query))
          .where((item) => asDouble(item['lat']) != null && asDouble(item['lng']) != null)
          .toList();
      if (!mounted) return;
      if (results.isEmpty) {
        setState(() {
          _loading = false;
          _message = '검색 결과가 없어요. 역 이름이나 근처 건물로 찾아 보세요.';
        });
        return;
      }
      if (results.length == 1) {
        await _loadNearby(asDouble(results.first['lat'])!, asDouble(results.first['lng'])!);
        return;
      }
      setState(() {
        _places = results.take(8).toList();
        _loading = false;
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _loading = false;
          _message = error is InochiApiException ? error.message : '검색하지 못했습니다.';
        });
      }
    }
  }

  Future<void> _loadNearby(double lat, double lng) async {
    final run = ++_describeRun;
    setState(() {
      _lat = lat;
      _lng = lng;
      _movedTo = null;
      _places = const [];
      _loading = true;
      _message = '';
    });
    try {
      final result = await widget.api.nearbyStops(lat, lng);
      if (!mounted || run != _describeRun) return;
      final stops = asMapList(result['stops']).where((stop) => asDouble(stop['lat']) != null && asDouble(stop['lng']) != null).take(12).toList();
      final warnings = (result['warnings'] is List ? result['warnings'] as List : const []).join(' ');
      setState(() {
        _stops = stops;
        _loading = false;
        _message = stops.isEmpty ? '근처 400m 안에 정류장·역이 없어요. 지도를 옮겨 다시 찾아 보세요.' : warnings;
      });
      unawaited(_describeAll(run, stops));
    } catch (error) {
      if (mounted && run == _describeRun) {
        setState(() {
          _loading = false;
          _message = error is InochiApiException ? error.message : '주변 정류장을 불러오지 못했습니다.';
        });
      }
    }
  }

  // Directions are fetched one by one so the list fills in top-down.
  Future<void> _describeAll(int run, List<Map<String, dynamic>> stops) async {
    for (final stop in stops.take(8)) {
      final key = '${stop['key']}';
      if (_descriptions.containsKey(key)) continue;
      if (!mounted || run != _describeRun) return;
      try {
        final description = await widget.api.describeStop(stop);
        if (!mounted || run != _describeRun) return;
        setState(() => _descriptions[key] = description);
      } catch (_) {
        // The row keeps its stop number; the confirm screen retries.
      }
    }
  }

  Map<String, dynamic>? _byKey(String key) {
    for (final stop in _stops) {
      if ('${stop['key']}' == key) return stop;
    }
    return null;
  }

  bool _outlined(int index) {
    final stop = _stops[index];
    final opposite = '${stop['oppositeKey'] ?? ''}';
    if (opposite.isEmpty) return false;
    final other = _stops.indexWhere((item) => '${item['key']}' == opposite);
    return other >= 0 && other < index;
  }

  Future<void> _open(Map<String, dynamic> stop) async {
    final chosen = await Navigator.of(context).push<Map<String, dynamic>>(MaterialPageRoute(
      builder: (_) => StopConfirmScreen(
        api: widget.api,
        stop: stop,
        nearby: _stops,
        descriptions: _descriptions,
      ),
    ));
    if (chosen != null && mounted) Navigator.of(context).pop(chosen);
  }

  List<MapPin> get _pins => [
        for (var i = 0; i < _stops.length && i < 9; i++)
          MapPin(
            id: '${_stops[i]['key']}',
            lat: asDouble(_stops[i]['lat'])!,
            lng: asDouble(_stops[i]['lng'])!,
            kind: isSubway(_stops[i]) ? PinKind.subway : _outlined(i) ? PinKind.busAlt : PinKind.bus,
            label: '${i + 1}',
          ),
      ];

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('출발 정류장·역')),
      body: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            TextField(
              controller: _query,
              focusNode: _focus,
              autofocus: widget.initial == null,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _search(),
              style: const TextStyle(fontSize: 16),
              decoration: InputDecoration(
                hintText: '예: 서면역, 강남역 11번 출구',
                prefixIcon: Icon(Icons.search, color: p.muted),
                suffixIcon: IconButton(
                  tooltip: '검색',
                  onPressed: _loading ? null : _search,
                  icon: const Icon(Icons.arrow_forward),
                ),
              ),
            ),
            const SizedBox(height: 6),
            Text('버스 정류장과 지하철역을 함께 찾아요 · 지도를 옮겨서도 찾을 수 있어요',
                style: TextStyle(fontSize: 12, color: p.muted)),
          ]),
        ),
        if (_lat != null && _lng != null)
          SizedBox(
            height: 250,
            child: Stack(children: [
              Positioned.fill(
                child: StopMap(
                  lat: _lat!,
                  lng: _lng!,
                  pins: _pins,
                  onPinTap: (key) {
                    final stop = _byKey(key);
                    if (stop != null) unawaited(_open(stop));
                  },
                  onMoved: (lat, lng) => setState(() => _movedTo = (lat: lat, lng: lng)),
                ),
              ),
              if (_movedTo != null)
                Positioned(
                  top: 10,
                  left: 0,
                  right: 0,
                  child: Center(
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(minimumSize: const Size(0, 44), padding: const EdgeInsets.symmetric(horizontal: 16)),
                      onPressed: _loading ? null : () => _loadNearby(_movedTo!.lat, _movedTo!.lng),
                      icon: const Icon(Icons.refresh, size: 18),
                      label: const Text('이 위치에서 다시 찾기', style: TextStyle(fontSize: 14)),
                    ),
                  ),
                ),
            ]),
          ),
        if (_loading) const LinearProgressIndicator(minHeight: 2),
        Expanded(child: ColoredBox(color: p.card, child: _list(p))),
      ]),
    );
  }

  Widget _list(InochiPalette p) {
    if (_places.isNotEmpty) {
      return ListView(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
          child: Text('어디 근처에서 찾을까요?', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: p.muted)),
        ),
        for (final place in _places)
          ListTile(
            minTileHeight: 56,
            leading: Icon(Icons.place_outlined, color: p.muted),
            title: Text('${place['placeName'] ?? place['label'] ?? ''}'.trim().isNotEmpty ? '${place['placeName'] ?? place['label']}' : '${place['roadAddress'] ?? ''}'),
            subtitle: Text('${place['roadAddress'] ?? place['jibunAddress'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis),
            onTap: () => _loadNearby(asDouble(place['lat'])!, asDouble(place['lng'])!),
          ),
      ]);
    }
    return ListView(padding: EdgeInsets.zero, children: [
      if (_message.isNotEmpty) Padding(padding: const EdgeInsets.all(16), child: Text(_message, style: TextStyle(color: p.muted))),
      for (var i = 0; i < _stops.length; i++) _row(p, i),
    ]);
  }

  Widget _row(InochiPalette p, int index) {
    final stop = _stops[index];
    final subway = isSubway(stop);
    final description = _descriptions['${stop['key']}'];
    final heading = '${description?['heading'] ?? ''}'.trim();
    final next = '${description?['nextStop'] ?? ''}'.trim();
    final oppositeIndex = _stops.indexWhere((item) => '${item['key']}' == '${stop['oppositeKey'] ?? ''}');
    final detail = <String>[
      if (next.isNotEmpty) '다음 정류장: $next',
      if (oppositeIndex >= 0) '${oppositeIndex + 1}번 맞은편',
      if (stop['distanceM'] is num) '${(stop['distanceM'] as num).round()}m',
    ].join(' · ');
    return Pressable(
      onTap: () => _open(stop),
      semanticsLabel: '${index + 1}번 ${stopTitle(stop)}',
      child: Container(
        constraints: const BoxConstraints(minHeight: 64),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(border: Border(bottom: BorderSide(color: p.line))),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          StopBadge(number: index + 1, subway: subway, outlined: _outlined(index)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text.rich(TextSpan(children: [
                TextSpan(text: stopTitle(stop), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                TextSpan(text: '  ${stopKindLabel(stop)}', style: TextStyle(fontSize: 13, color: p.muted)),
              ])),
              const SizedBox(height: 2),
              if (subway)
                Text('방향은 도착지에 맞춰 자동으로 골라요', style: TextStyle(fontSize: 13, color: p.muted))
              else if (heading.isNotEmpty)
                Text('→ $heading 방면', style: const TextStyle(fontSize: 14))
              else if (description == null)
                Text('방면 확인 중…', style: TextStyle(fontSize: 13, color: p.muted)),
              if (!subway && detail.isNotEmpty) Text(detail, style: TextStyle(fontSize: 12, color: p.muted)),
            ]),
          ),
          Icon(Icons.chevron_right, color: p.muted),
        ]),
      ),
    );
  }
}

import 'dart:math';

import 'package:flutter/material.dart';

import '../../core/format/kst_format.dart';
import '../../core/network/inochi_api.dart';
import '../setup/place_search_screen.dart';
import '../setup/stop_search_screen.dart';

class TripEditResult {
  const TripEditResult({this.trip, this.deleted = false});
  final Map<String, dynamic>? trip;
  final bool deleted;
}

/// Creates or edits one recurring schedule in the server's `tripSchedules`
/// format.
class TripEditorScreen extends StatefulWidget {
  const TripEditorScreen({super.key, required this.api, this.initial});
  final InochiApi api;
  final Map<String, dynamic>? initial;

  @override
  State<TripEditorScreen> createState() => _TripEditorScreenState();
}

class _TripEditorScreenState extends State<TripEditorScreen> {
  late final TextEditingController _name;
  late String _id;
  TimeOfDay _arrival = const TimeOfDay(hour: 9, minute: 0);
  int _access = 5;
  Map<String, dynamic>? _departure; // {location:{lat,lng}, live:{…}}
  Map<String, dynamic>? _destination; // {address, location:{lat,lng}}
  Set<int> _days = {1, 2, 3, 4, 5};
  int _lead = 30;
  int _interval = 5;
  bool _skipHolidays = true;
  bool _enabled = true;
  String _error = '';

  static const _leads = [30, 60, 120];
  static const _intervals = [1, 2, 3, 5, 10, 15, 30];

  @override
  void initState() {
    super.initState();
    final trip = widget.initial ?? const <String, dynamic>{};
    _id = '${trip['id'] ?? _newId()}';
    _name = TextEditingController(text: '${trip['name'] ?? '출근'}');
    final parts = '${trip['requiredArrivalTime'] ?? '09:00'}'.split(':');
    _arrival = TimeOfDay(hour: int.tryParse(parts.first) ?? 9, minute: parts.length > 1 ? int.tryParse(parts[1]) ?? 0 : 0);
    _access = trip['boardingAccessMin'] is num ? (trip['boardingAccessMin'] as num).toInt() : 5;
    _departure = trip['departure'] is Map ? Map<String, dynamic>.from(trip['departure'] as Map) : null;
    _destination = trip['destination'] is Map ? Map<String, dynamic>.from(trip['destination'] as Map) : null;
    if (trip['daysOfWeek'] is List) _days = (trip['daysOfWeek'] as List).whereType<num>().map((d) => d.toInt()).toSet();
    _lead = _leads.contains(trip['alarmStartLeadMin']) ? trip['alarmStartLeadMin'] as int : 30;
    _interval = _intervals.contains(trip['repeatIntervalMin']) ? trip['repeatIntervalMin'] as int : 5;
    _skipHolidays = trip['skipHolidays'] != false;
    _enabled = widget.initial == null ? true : trip['enabled'] == true;
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  static String _newId() {
    final random = Random.secure();
    return 'trip-${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}-${random.nextInt(1 << 30).toRadixString(36)}';
  }

  String get _arrivalText => '${two(_arrival.hour)}:${two(_arrival.minute)}';

  Future<void> _pickDestination() async {
    final picked = await Navigator.of(context).push<Map<String, dynamic>>(MaterialPageRoute(builder: (_) => PlaceSearchScreen(api: widget.api)));
    if (picked != null) {
      setState(() => _destination = {'address': picked['label'] == picked['address'] ? picked['address'] : '${picked['label']} (${picked['address']})',
          'location': {'lat': picked['lat'], 'lng': picked['lng']}});
    }
  }

  Future<void> _pickDeparture(bool subway) async {
    final picked = await Navigator.of(context).push<Map<String, dynamic>>(MaterialPageRoute(builder: (_) => StopSearchScreen(api: widget.api, subway: subway)));
    if (picked != null) {
      setState(() => _departure = {
            'location': {'lat': picked['lat'], 'lng': picked['lng']},
            'live': {
              for (final key in ['provider', 'stationId', 'stationName', 'arsId', 'cityCode', 'nodeId', 'lineName']) key: '${picked[key] ?? ''}',
            },
          });
    }
  }

  void _done() {
    if (_name.text.trim().isEmpty) return setState(() => _error = '일정 이름을 입력해 주세요.');
    if (_departure == null) return setState(() => _error = '출발 정류장 또는 역을 선택해 주세요.');
    if (_destination == null) return setState(() => _error = '도착지를 선택해 주세요.');
    if (_days.isEmpty) return setState(() => _error = '반복할 요일을 하나 이상 선택해 주세요.');
    Navigator.of(context).pop(TripEditResult(trip: {
      'id': _id,
      'name': _name.text.trim(),
      'enabled': _enabled,
      'requiredArrivalTime': _arrivalText,
      'boardingAccessMin': _access,
      'departure': _departure,
      'destination': _destination,
      'daysOfWeek': (_days.toList()..sort()),
      'alarmStartLeadMin': _lead,
      'repeatIntervalMin': _interval,
      'skipHolidays': _skipHolidays,
      'snoozeDate': widget.initial?['snoozeDate'],
    }));
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final live = _departure?['live'] is Map ? _departure!['live'] as Map : const {};
    final line = '${live['lineName'] ?? ''}';
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.initial == null ? '새 반복 일정' : '반복 일정 수정'),
        actions: [
          if (widget.initial != null)
            IconButton(
              tooltip: '삭제',
              icon: const Icon(Icons.delete_outline),
              onPressed: () async {
                final ok = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
                  title: const Text('일정을 삭제할까요?'),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('취소')),
                    TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('삭제')),
                  ],
                ));
                if (ok == true && context.mounted) Navigator.of(context).pop(const TripEditResult(deleted: true));
              },
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          TextField(controller: _name, maxLength: 60, decoration: const InputDecoration(labelText: '이름 (예: 출근, 등교)')),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('알림 사용'), value: _enabled, onChanged: (v) => setState(() => _enabled = v)),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.schedule),
            title: Text('$_arrivalText까지 도착'),
            trailing: const Text('변경'),
            onTap: () async {
              final picked = await showTimePicker(context: context, initialTime: _arrival, helpText: '도착해야 하는 시각');
              if (picked != null) setState(() => _arrival = picked);
            },
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.flag_outlined),
            title: Text(_destination == null ? '도착지 선택' : '${_destination!['address']}'),
            trailing: const Icon(Icons.chevron_right),
            onTap: _pickDestination,
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.trip_origin),
            title: Text(_departure == null ? '출발 정류장·역 선택' : '${live['stationName']}${line.isEmpty ? '' : ' ($line)'}'),
            subtitle: Row(children: [
              TextButton(onPressed: () => _pickDeparture(false), child: const Text('버스 정류장')),
              TextButton(onPressed: () => _pickDeparture(true), child: const Text('지하철역')),
            ]),
          ),
          Row(children: [
            const Expanded(child: Text('정류장·역까지 도보')),
            IconButton(onPressed: _access > 0 ? () => setState(() => _access--) : null, icon: const Icon(Icons.remove), tooltip: '1분 줄이기'),
            Text('$_access분', style: const TextStyle(fontWeight: FontWeight.w800)),
            IconButton(onPressed: _access < 180 ? () => setState(() => _access++) : null, icon: const Icon(Icons.add), tooltip: '1분 늘리기'),
          ]),
          const SizedBox(height: 8),
          const Text('반복 요일', style: TextStyle(fontWeight: FontWeight.w700)),
          Wrap(spacing: 6, children: [
            for (final day in [1, 2, 3, 4, 5, 6, 0])
              FilterChip(
                label: Text(weekdayLabels[day]),
                selected: _days.contains(day),
                onSelected: (selected) => setState(() => selected ? _days.add(day) : _days.remove(day)),
              ),
          ]),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('공휴일에는 쉬기'), value: _skipHolidays, onChanged: (v) => setState(() => _skipHolidays = v)),
          Row(children: [
            const Expanded(child: Text('알림 시작')),
            DropdownButton<int>(value: _lead, items: [for (final v in _leads) DropdownMenuItem(value: v, child: Text('출발 ${v >= 60 ? '${v ~/ 60}시간' : '$v분'} 전'))],
                onChanged: (v) => setState(() => _lead = v ?? 30)),
          ]),
          Row(children: [
            const Expanded(child: Text('반복 간격')),
            DropdownButton<int>(value: _interval, items: [for (final v in _intervals) DropdownMenuItem(value: v, child: Text('$v분마다'))],
                onChanged: (v) => setState(() => _interval = v ?? 5)),
          ]),
          if (_error.isNotEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(_error, style: TextStyle(color: scheme.error))),
          const SizedBox(height: 12),
          FilledButton(onPressed: _done, child: const Text('저장')),
        ],
      ),
    );
  }
}

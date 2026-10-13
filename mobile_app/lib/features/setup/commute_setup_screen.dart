import 'package:flutter/material.dart';

import '../../core/network/inochi_api.dart';
import 'place_search_screen.dart';
import 'stop_search_screen.dart';

/// One screen for the whole commute: arrival target, destination, boarding
/// stop/station and walking minutes. Saving returns the refreshed home data.
class CommuteSetupScreen extends StatefulWidget {
  const CommuteSetupScreen({super.key, required this.api, required this.initial});
  final InochiApi api;
  final Map<String, dynamic> initial;

  @override
  State<CommuteSetupScreen> createState() => _CommuteSetupScreenState();
}

class _CommuteSetupScreenState extends State<CommuteSetupScreen> {
  late TimeOfDay _arrival;
  int _accessMin = 5;
  Map<String, dynamic>? _destination;
  Map<String, dynamic>? _boarding;
  bool _subway = false;
  bool _saving = false;
  String _error = '';
  bool _boardingChanged = false;
  bool _destinationChanged = false;

  @override
  void initState() {
    super.initState();
    final initial = widget.initial;
    final parts = '${initial['requiredArrivalTime'] ?? '09:00'}'.split(':');
    _arrival = TimeOfDay(hour: int.tryParse(parts.first) ?? 9, minute: parts.length > 1 ? int.tryParse(parts[1]) ?? 0 : 0);
    _accessMin = initial['boardingAccessMin'] is num ? (initial['boardingAccessMin'] as num).toInt() : 5;
    _destination = initial['destination'] is Map ? Map<String, dynamic>.from(initial['destination'] as Map) : null;
    _boarding = initial['boarding'] is Map ? Map<String, dynamic>.from(initial['boarding'] as Map) : null;
    _subway = _boarding?['mode'] == 'subway' || _boarding?['provider'] == 'subway';
  }

  String get _arrivalText => '${_arrival.hour.toString().padLeft(2, '0')}:${_arrival.minute.toString().padLeft(2, '0')}';

  Future<void> _pickArrival() async {
    final picked = await showTimePicker(context: context, initialTime: _arrival, helpText: '도착해야 하는 시각');
    if (picked != null) setState(() => _arrival = picked);
  }

  Future<void> _pickDestination() async {
    final picked = await Navigator.of(context).push<Map<String, dynamic>>(
      MaterialPageRoute(builder: (_) => PlaceSearchScreen(api: widget.api)),
    );
    if (picked != null) {
      setState(() {
        _destination = picked;
        _destinationChanged = true;
      });
    }
  }

  Future<void> _pickBoarding() async {
    final picked = await Navigator.of(context).push<Map<String, dynamic>>(
      MaterialPageRoute(builder: (_) => StopSearchScreen(api: widget.api, subway: _subway, initialCityId: '${_boarding?['cityId'] ?? ''}')),
    );
    if (picked != null) {
      setState(() {
        _boarding = picked;
        _boardingChanged = true;
      });
    }
  }

  Future<void> _save() async {
    if (_destination == null || _boarding == null) {
      setState(() => _error = '도착지와 출발 ${_subway ? '역' : '정류장'}을 모두 선택해 주세요.');
      return;
    }
    setState(() {
      _saving = true;
      _error = '';
    });
    final patch = <String, dynamic>{
      'requiredArrivalTime': _arrivalText,
      'boardingAccessMin': _accessMin,
      if (_destinationChanged) 'destination': _destination,
      if (_boardingChanged) 'boarding': _boarding,
    };
    try {
      final saved = await widget.api.saveSetup(patch);
      if (mounted) Navigator.of(context).pop(saved);
    } catch (error) {
      if (mounted) setState(() => _error = error is InochiApiException ? error.message : '저장하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final boardingLabel = _boarding == null
        ? '선택해 주세요'
        : '${_boarding!['stationName']}${'${_boarding!['lineName'] ?? ''}'.isEmpty ? '' : ' (${_boarding!['lineName']})'}';
    return Scaffold(
      appBar: AppBar(title: const Text('출근길 설정')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          _Section(
            step: '1',
            title: '몇 시까지 도착해야 하나요?',
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.schedule),
              title: Text(_arrivalText, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
              trailing: const Text('변경'),
              onTap: _pickArrival,
            ),
          ),
          _Section(
            step: '2',
            title: '어디로 가나요?',
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.flag_outlined),
              title: Text(_destination == null ? '도착지 검색' : '${_destination!['label'] ?? _destination!['address']}'),
              subtitle: _destination == null ? null : Text('${_destination!['address'] ?? ''}'),
              trailing: const Icon(Icons.chevron_right),
              onTap: _pickDestination,
            ),
          ),
          _Section(
            step: '3',
            title: '어디서 타나요?',
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: false, icon: Icon(Icons.directions_bus_outlined), label: Text('버스')),
                  ButtonSegment(value: true, icon: Icon(Icons.subway_outlined), label: Text('지하철')),
                ],
                selected: {_subway},
                onSelectionChanged: (value) => setState(() {
                  if (_subway != value.first) {
                    _subway = value.first;
                    _boarding = null;
                    _boardingChanged = true;
                  }
                }),
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(_subway ? Icons.subway_outlined : Icons.directions_bus_outlined),
                title: Text(boardingLabel),
                subtitle: Text(_subway ? '수도권은 실시간, 그 밖의 지역은 공식 시간표 기준으로 안내해요.' : '전국 버스 정류장을 찾을 수 있어요.'),
                trailing: const Icon(Icons.chevron_right),
                onTap: _pickBoarding,
              ),
            ]),
          ),
          _Section(
            step: '4',
            title: '집에서 ${_subway ? '역' : '정류장'}까지 몇 분 걸리나요?',
            child: Row(children: [
              IconButton.filledTonal(onPressed: _accessMin > 0 ? () => setState(() => _accessMin--) : null, icon: const Icon(Icons.remove), tooltip: '1분 줄이기'),
              Expanded(child: Text('$_accessMin분', textAlign: TextAlign.center, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800))),
              IconButton.filledTonal(onPressed: _accessMin < 180 ? () => setState(() => _accessMin++) : null, icon: const Icon(Icons.add), tooltip: '1분 늘리기'),
            ]),
          ),
          if (_error.isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_error, style: TextStyle(color: scheme.error))),
          FilledButton(onPressed: _saving ? null : _save, child: Text(_saving ? '저장하는 중…' : '저장하고 오늘 알림 켜기')),
          const SizedBox(height: 8),
          Text('저장하면 오늘 하루 출발 알림이 켜져요. 매일 자동으로 받으려면 반복 일정을 등록해 주세요.',
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.step, required this.title, required this.child});
  final String step;
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              CircleAvatar(radius: 12, child: Text(step, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800))),
              const SizedBox(width: 8),
              Expanded(child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
            ]),
            const SizedBox(height: 6),
            child,
          ]),
        ),
      ),
    );
  }
}

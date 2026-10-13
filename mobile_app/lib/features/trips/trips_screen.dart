import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/format/kst_format.dart';
import '../../core/network/inochi_api.dart';
import '../../core/network/play_billing.dart';
import 'trip_editor_screen.dart';

/// Paid feature: recurring commute schedules that alarm automatically on the
/// chosen weekdays.
class TripsScreen extends StatefulWidget {
  const TripsScreen({super.key, required this.api, required this.billing, required this.onOpenSubscription});
  final InochiApi api;
  final PlayBilling? billing;
  final Future<void> Function() onOpenSubscription;

  @override
  State<TripsScreen> createState() => _TripsScreenState();
}

class _TripsScreenState extends State<TripsScreen> {
  List<Map<String, dynamic>> _trips = const [];
  bool _subscribed = false;
  bool _loading = true;
  bool _saving = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    widget.billing?.addListener(_billingChanged);
    unawaited(_load());
  }

  @override
  void didUpdateWidget(covariant TripsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.billing != widget.billing) {
      oldWidget.billing?.removeListener(_billingChanged);
      widget.billing?.addListener(_billingChanged);
    }
  }

  @override
  void dispose() {
    widget.billing?.removeListener(_billingChanged);
    super.dispose();
  }

  void _billingChanged() {
    final active = widget.billing?.active == true;
    if (active != _subscribed) unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.trips();
      if (!mounted) return;
      setState(() {
        _trips = (data['trips'] is List ? data['trips'] as List : const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
        final subscription = data['subscription'] is Map ? data['subscription'] as Map : const {};
        _subscribed = subscription['active'] == true || widget.billing?.active == true;
        _error = '';
      });
    } catch (error) {
      if (mounted) setState(() => _error = error is InochiApiException ? error.message : '일정을 불러오지 못했습니다.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save(List<Map<String, dynamic>> next, String done) async {
    setState(() => _saving = true);
    try {
      final data = await widget.api.saveTrips(next);
      if (!mounted) return;
      setState(() => _trips = (data['trips'] is List ? data['trips'] as List : const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList());
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(done)));
    } catch (error) {
      if (!mounted) return;
      if (error is InochiApiException && error.subscriptionRequired) {
        await widget.onOpenSubscription();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error is InochiApiException ? error.message : '저장하지 못했습니다.')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _edit([int? index]) async {
    if (!_subscribed) {
      await widget.onOpenSubscription();
      return;
    }
    if (index == null && _trips.length >= 10) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('일정은 최대 10개까지 만들 수 있어요.')));
      return;
    }
    final result = await Navigator.of(context).push<TripEditResult>(
      MaterialPageRoute(builder: (_) => TripEditorScreen(api: widget.api, initial: index == null ? null : _trips[index])),
    );
    if (result == null) return;
    final next = [..._trips];
    if (result.deleted && index != null) {
      next.removeAt(index);
    } else if (result.trip != null) {
      if (index == null) {
        next.add(result.trip!);
      } else {
        next[index] = result.trip!;
      }
    }
    await _save(next, result.deleted ? '일정을 삭제했어요.' : '일정을 저장했어요.');
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('반복 일정', style: TextStyle(fontWeight: FontWeight.w800))),
      floatingActionButton: _loading ? null : FloatingActionButton.extended(
        onPressed: _saving ? null : () => _edit(),
        icon: const Icon(Icons.add),
        label: const Text('일정 추가'),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
          children: [
            if (_loading) const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator())),
            if (_error.isNotEmpty) Text(_error, style: TextStyle(color: scheme.error)),
            if (!_loading && !_subscribed)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('요일마다 자동으로 알려드려요', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 8),
                    Text('출근·등교처럼 반복되는 길을 등록하면 매번 켜지 않아도 정해진 요일에 출발 알림이 와요. 월 5,000원 구독 기능이에요. 오늘 하루 알림은 무료예요.',
                        style: TextStyle(color: scheme.onSurfaceVariant)),
                    const SizedBox(height: 16),
                    FilledButton(onPressed: widget.onOpenSubscription, child: const Text('구독 알아보기')),
                  ]),
                ),
              ),
            if (_saving) const LinearProgressIndicator(),
            const SizedBox(height: 12),
            if (!_loading && _trips.isEmpty) Padding(
              padding: const EdgeInsets.all(24),
              child: Text('등록한 일정이 없어요.', textAlign: TextAlign.center, style: TextStyle(color: scheme.onSurfaceVariant)),
            ),
            for (var index = 0; index < _trips.length; index++) ...[
              _TripTile(
                trip: _trips[index],
                enabled: _subscribed && !_saving,
                onTap: () => _edit(index),
                onToggle: (value) {
                  final next = [..._trips];
                  next[index] = {...next[index], 'enabled': value};
                  _save(next, value ? '일정 알림을 켰어요.' : '일정 알림을 껐어요.');
                },
              ),
              const SizedBox(height: 8),
            ],
          ],
        ),
      ),
    );
  }
}

class _TripTile extends StatelessWidget {
  const _TripTile({required this.trip, required this.enabled, required this.onTap, required this.onToggle});
  final Map<String, dynamic> trip;
  final bool enabled;
  final VoidCallback onTap;
  final ValueChanged<bool> onToggle;

  @override
  Widget build(BuildContext context) {
    final days = (trip['daysOfWeek'] is List ? trip['daysOfWeek'] as List : const []).whereType<num>().map((d) => d.toInt()).toList()..sort();
    final departure = trip['departure'] is Map ? trip['departure'] as Map : const {};
    final live = departure['live'] is Map ? departure['live'] as Map : const {};
    final destination = trip['destination'] is Map ? trip['destination'] as Map : const {};
    final dayText = days.length == 7 ? '매일' : days.join() == '12345' ? '평일' : days.map((d) => weekdayLabels[d]).join(' ');
    return Card(
      child: ListTile(
        onTap: enabled ? onTap : null,
        title: Text('${trip['name'] ?? '일정'} · ${trip['requiredArrivalTime'] ?? ''} 도착', style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Text('$dayText\n${live['stationName'] ?? '-'} → ${destination['address'] ?? '-'}', maxLines: 3),
        isThreeLine: true,
        trailing: Switch(value: trip['enabled'] == true, onChanged: enabled ? onToggle : null),
      ),
    );
  }
}

import 'dart:async';

import 'package:flutter/material.dart';

import '../../app/inochi_theme.dart';
import '../../core/device/local_alarm_scheduler.dart';
import '../../core/device/push_registration.dart';
import '../../core/format/kst_format.dart';
import '../../core/network/inochi_api.dart';
import '../setup/commute_setup_screen.dart';

/// "오늘" tab: when to leave home today, the trains/buses that still get the
/// user there on time, and the switch for today's (free) departure alarm.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.api, required this.onOpenTrips});

  final InochiApi api;
  final VoidCallback onOpenTrips;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  Map<String, dynamic>? _data;
  String _error = '';
  bool _loading = true;
  bool _busy = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_load());
    _timer = Timer.periodic(const Duration(seconds: 60), (_) {
      if (!_busy) unawaited(_load(quiet: true));
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_load(quiet: true));
  }

  Future<void> _load({bool quiet = false}) async {
    if (!quiet) setState(() => _loading = true);
    try {
      final data = await widget.api.home();
      if (!mounted) return;
      setState(() {
        _data = data;
        _error = '';
        _loading = false;
      });
      await _syncBackup(data);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error is InochiApiException ? error.message : '정보를 불러오지 못했습니다.';
        _loading = false;
      });
    }
  }

  Future<void> _syncBackup(Map<String, dynamic> data) async {
    final today = _map(data['today']);
    final forecast = _map(data['forecast']);
    final leaveAt = DateTime.tryParse('${forecast['leaveAt'] ?? ''}');
    try {
      if (today['armed'] == true && leaveAt != null) {
        final route = '${forecast['routeNumber'] ?? ''}'.trim();
        await LocalAlarmScheduler.instance.scheduleDepartureBackup(
          atUtc: leaveAt.toUtc(),
          title: '지금 출발하세요',
          body: route.isEmpty ? '지금 나가야 제시간에 도착할 수 있어요.' : '$route ${kstClock(forecast['boardingAt'])} 탑승을 놓치면 늦어요.',
        );
      } else {
        await LocalAlarmScheduler.instance.cancelDepartureBackup();
      }
    } catch (_) {
      // The server push remains the primary alarm.
    }
  }

  Future<void> _run(Future<Map<String, dynamic>> Function() action, {String? done}) async {
    setState(() => _busy = true);
    try {
      final data = await action();
      if (!mounted) return;
      if (data['setup'] != null) {
        setState(() => _data = data);
        await _syncBackup(data);
      } else {
        await _load(quiet: true);
      }
      if (done != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(done)));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(error is InochiApiException ? error.message : '처리하지 못했습니다. 다시 시도해 주세요.')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _departed() async {
    await LocalAlarmScheduler.instance.cancelDepartureBackup();
    await _run(widget.api.departed, done: '오늘 남은 알람을 멈췄어요. 잘 다녀오세요!');
  }

  Future<void> _openSetup() async {
    final setup = _map(_data?['setup']);
    final saved = await Navigator.of(context).push<Map<String, dynamic>>(
      MaterialPageRoute(builder: (_) => CommuteSetupScreen(api: widget.api, initial: setup)),
    );
    if (saved != null && mounted) {
      setState(() => _data = saved);
      await _syncBackup(saved);
      // The alarm is useless without push; ask right after the first setup.
      try {
        final problem = await PushRegistration.register(widget.api);
        if (problem != null && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(problem)));
        }
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('알림 연결은 설정 탭에서 다시 시도해 주세요.')));
        }
      }
    }
  }

  static Map<String, dynamic> _map(Object? value) => value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

  @override
  Widget build(BuildContext context) {
    final data = _data;
    return Scaffold(
      appBar: AppBar(title: const Text('이거 놓치면 지각', style: TextStyle(fontWeight: FontWeight.w800))),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            if (_loading && data == null) const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator())),
            if (_error.isNotEmpty) _Notice(text: _error, color: InochiColors.danger, action: TextButton(onPressed: _load, child: const Text('다시 시도'))),
            if (data != null) ..._content(context, data),
          ],
        ),
      ),
    );
  }

  List<Widget> _content(BuildContext context, Map<String, dynamic> data) {
    final setup = _map(data['setup']);
    if (setup['complete'] != true) {
      return [
        _WelcomeCard(onStart: _openSetup),
      ];
    }
    final today = _map(data['today']);
    final forecast = _map(data['forecast']);
    final rows = (forecast['rows'] is List ? forecast['rows'] as List : const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    final armed = today['armed'] == true;
    return [
      _DepartureCard(forecast: forecast, armed: armed, forecastError: '${data['forecastError'] ?? ''}'),
      const SizedBox(height: 12),
      Card(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('오늘 출발 알림', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                Text(armed ? '나갈 시각 20·10·5·3분 전에 알려드려요.' : today['departedToday'] == true ? '오늘은 출발 완료로 알림을 멈췄어요.' : '꺼져 있어요. 켜면 오늘 하루 알려드려요.',
                    style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
              ]),
            ),
            Switch(value: armed, onChanged: _busy ? null : (value) => _run(() => widget.api.setToday(value), done: value ? '오늘 출발 알림을 켰어요.' : '오늘 출발 알림을 껐어요.')),
          ]),
        ),
      ),
      if (armed) ...[
        const SizedBox(height: 12),
        FilledButton.icon(onPressed: _busy ? null : _departed, icon: const Icon(Icons.directions_walk), label: const Text('출발했어요')),
      ],
      const SizedBox(height: 20),
      if (rows.isNotEmpty) ...[
        Text('곧 오는 교통편', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        Card(child: Column(children: [for (final row in rows) _VehicleRow(row: row)])),
        const SizedBox(height: 8),
        Text('도착 예정 시각은 탑승 후 이동시간 기준 예상입니다. 환승 대기와 지연은 달라질 수 있어요.',
            style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
        const SizedBox(height: 20),
      ],
      _SetupSummary(setup: setup, onEdit: _busy ? null : _openSetup),
      const SizedBox(height: 12),
      OutlinedButton.icon(onPressed: widget.onOpenTrips, icon: const Icon(Icons.event_repeat), label: const Text('매일 자동으로 알림 받기 (반복 일정)')),
    ];
  }
}

class _DepartureCard extends StatelessWidget {
  const _DepartureCard({required this.forecast, required this.armed, required this.forecastError});
  final Map<String, dynamic> forecast;
  final bool armed;
  final String forecastError;

  @override
  Widget build(BuildContext context) {
    final status = '${forecast['status'] ?? ''}';
    final scheme = Theme.of(context).colorScheme;
    if (status != 'ready') {
      final title = status == 'no-catchable' ? '제시간에 도착할 교통편을 찾지 못했어요' : '경로와 도착정보를 확인하고 있어요';
      final detail = forecastError.isNotEmpty ? forecastError
          : status == 'no-catchable' ? '도착 목표 시각이 지났거나 운행이 끝났을 수 있어요. 설정을 확인해 주세요.'
          : '${forecast['warning'] ?? ''}'.isNotEmpty ? '${forecast['warning']}' : '잠시 후 화면을 당겨 새로고침해 주세요.';
      return Card(child: Padding(padding: const EdgeInsets.all(20), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        Text(detail, style: TextStyle(color: scheme.onSurfaceVariant)),
      ])));
    }
    final minutes = forecast['leaveInMinutes'] is num ? (forecast['leaveInMinutes'] as num).toInt() : null;
    final overdue = forecast['overdue'] == true;
    final headline = overdue ? '지금 바로 출발하세요' : minutes == 0 ? '지금 출발하세요' : '${minutes ?? '-'}분 뒤 출발';
    final color = overdue || (minutes ?? 99) <= 3 ? InochiColors.danger : (minutes ?? 99) <= 10 ? InochiColors.warn : InochiColors.ok;
    final route = '${forecast['routeNumber'] ?? ''}';
    final direction = '${forecast['direction'] ?? ''}';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('집에서 나갈 시각', style: TextStyle(color: scheme.onSurfaceVariant)),
          const SizedBox(height: 4),
          Text(kstClockKorean(forecast['leaveAt']), style: const TextStyle(fontSize: 40, fontWeight: FontWeight.w900, height: 1.1)),
          const SizedBox(height: 6),
          Text(headline, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: color)),
          const SizedBox(height: 14),
          Row(children: [
            const Icon(Icons.train_outlined, size: 18),
            const SizedBox(width: 6),
            Expanded(child: Text('$route ${direction.isEmpty ? '' : '· $direction'}', overflow: TextOverflow.ellipsis)),
          ]),
          const SizedBox(height: 4),
          Row(children: [
            Text('${kstClock(forecast['boardingAt'])} 탑승', style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(width: 8),
            BasisChip(basis: '${forecast['basis'] ?? ''}'),
          ]),
          if (forecast['urgent'] == true) ...[
            const SizedBox(height: 10),
            const Text('이 차가 제시간에 도착하는 마지막 교통편이에요.', style: TextStyle(color: InochiColors.danger, fontWeight: FontWeight.w700)),
          ],
          if (!armed) ...[
            const SizedBox(height: 10),
            Text('오늘 출발 알림이 꺼져 있어요.', style: TextStyle(color: scheme.onSurfaceVariant)),
          ],
        ]),
      ),
    );
  }
}

/// Makes clear where a time comes from. Timetable/estimated values must never
/// look like real-time data.
class BasisChip extends StatelessWidget {
  const BasisChip({super.key, required this.basis});
  final String basis;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (basis) {
      'realtime' => ('실시간', InochiColors.ok),
      'timetable' => ('시간표 기준', InochiColors.warn),
      'estimate' => ('배차간격 예상', InochiColors.muted),
      _ => ('', InochiColors.muted),
    };
    if (label.isEmpty) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(999), border: Border.all(color: color)),
      child: Text(label, style: TextStyle(fontSize: 12, color: color, fontWeight: FontWeight.w700)),
    );
  }
}

class _VehicleRow extends StatelessWidget {
  const _VehicleRow({required this.row});
  final Map<String, dynamic> row;

  @override
  Widget build(BuildContext context) {
    final onTime = row['onTime'] == true;
    final target = row['target'] == true;
    final catchable = row['catchable'] == true;
    return ListTile(
      leading: SizedBox(
        width: 56,
        child: Text(kstClock(row['boardingAt']),
            style: TextStyle(fontSize: 18, fontWeight: target ? FontWeight.w900 : FontWeight.w600)),
      ),
      title: Text('${row['routeNumber'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Wrap(spacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
        if ('${row['direction'] ?? ''}'.isNotEmpty) Text('${row['direction']}', maxLines: 1, overflow: TextOverflow.ellipsis),
        BasisChip(basis: '${row['basis'] ?? ''}'),
      ]),
      trailing: Text(
        !onTime ? '지각' : !catchable ? '서둘러야 함' : target ? '추천' : '정시 도착',
        style: TextStyle(fontWeight: FontWeight.w700, color: !onTime ? InochiColors.danger : target ? InochiColors.accent : InochiColors.ok),
      ),
    );
  }
}

class _SetupSummary extends StatelessWidget {
  const _SetupSummary({required this.setup, required this.onEdit});
  final Map<String, dynamic> setup;
  final VoidCallback? onEdit;

  @override
  Widget build(BuildContext context) {
    final boarding = setup['boarding'] is Map ? Map<String, dynamic>.from(setup['boarding'] as Map) : <String, dynamic>{};
    final destination = setup['destination'] is Map ? Map<String, dynamic>.from(setup['destination'] as Map) : <String, dynamic>{};
    final line = '${boarding['lineName'] ?? ''}';
    final mode = boarding['mode'] == 'subway' ? '역' : '정류장';
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('내 출근길', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              Text('출발 $mode · ${boarding['stationName'] ?? ''}${line.isEmpty ? '' : ' ($line)'}'),
              Text('도착지 · ${destination['label'] ?? destination['address'] ?? ''}', maxLines: 2, overflow: TextOverflow.ellipsis),
              Text('${setup['requiredArrivalTime'] ?? ''}까지 도착 · $mode까지 도보 ${setup['boardingAccessMin'] ?? '-'}분'),
            ]),
          ),
          TextButton(onPressed: onEdit, child: const Text('변경')),
        ]),
      ),
    );
  }
}

class _WelcomeCard extends StatelessWidget {
  const _WelcomeCard({required this.onStart});
  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('놓치면 늦는 버스·지하철,\n미리 알려드릴게요', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, height: 1.3)),
          const SizedBox(height: 12),
          Text('도착해야 하는 시각과 출발 정류장·역, 도착지를 알려 주시면 집에서 나가야 할 시각을 계산해 알림으로 알려드려요. 전국 버스와 지하철을 지원해요.',
              style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
          const SizedBox(height: 20),
          FilledButton(onPressed: onStart, child: const Text('출근길 설정하기')),
        ]),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text, required this.color, this.action});
  final String text;
  final Color color;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Row(children: [
          Icon(Icons.error_outline, color: color),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: TextStyle(color: color))),
          if (action != null) action!,
        ]),
      );
}

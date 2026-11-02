import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../app/inochi_theme.dart';
import '../../core/device/local_alarm_scheduler.dart';
import '../../core/format/kst_format.dart';
import '../../core/network/inochi_api.dart';
import '../../core/network/play_billing.dart';
import '../common/basis_chip.dart';
import '../settings/settings_screen.dart';
import '../setup/onboarding_screen.dart';
import '../stops/stop_widgets.dart';

enum Urgency { relaxed, soon, now, idle }

/// >10분 여유, 4–10분 곧 출발, 3분 이하·지남 지금 출발.
Urgency urgencyFor(int? minutes, {bool overdue = false}) {
  if (minutes == null) return Urgency.idle;
  if (overdue || minutes <= 3) return Urgency.now;
  if (minutes <= 10) return Urgency.soon;
  return Urgency.relaxed;
}

/// "18분", "1시간 5분" → the big countdown text.
String countdownText(int minutes) => minutes < 100 ? '$minutes분' : '${minutes ~/ 60}시간';

/// 오늘 화면 (C안): the colour field and the big number say how long until
/// the user must leave; the sheet below lists the next vehicles.
class TodayScreen extends StatefulWidget {
  const TodayScreen({super.key, required this.api, required this.billing, required this.onOpenSubscription, required this.onSignedOut});
  final InochiApi api;
  final PlayBilling? billing;
  final Future<void> Function() onOpenSubscription;
  final Future<void> Function() onSignedOut;

  @override
  State<TodayScreen> createState() => _TodayScreenState();
}

class _TodayScreenState extends State<TodayScreen> with WidgetsBindingObserver {
  Map<String, dynamic>? _data;
  String _error = '';
  bool _busy = false;
  Timer? _refresh;
  Timer? _tick;
  DateTime _now = DateTime.now();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_load());
    _refresh = Timer.periodic(const Duration(seconds: 60), (_) {
      if (!_busy) unawaited(_load());
    });
    _tick = Timer.periodic(const Duration(seconds: 15), (_) {
      if (mounted) setState(() => _now = DateTime.now());
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _refresh?.cancel();
    _tick?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.home();
      if (!mounted) return;
      _apply(data);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error is InochiApiException ? error.message : '정보를 불러오지 못했습니다.');
    }
  }

  void _apply(Map<String, dynamic> data) {
    setState(() {
      _data = data;
      _error = '';
      _now = DateTime.now();
    });
    unawaited(_syncBackup(data));
  }

  // A local notification at the leave time backs up the server push.
  Future<void> _syncBackup(Map<String, dynamic> data) async {
    final today = asMap(data['today']);
    final forecast = asMap(data['forecast']);
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

  Future<void> _run(Future<Map<String, dynamic>> Function() action, String done) async {
    setState(() => _busy = true);
    try {
      final data = await action();
      if (!mounted) return;
      if (data['setup'] != null) {
        _apply(data);
      } else {
        await _load();
      }
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(done)));
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
    await _run(() async {
      try {
        await widget.api.departed();
      } catch (_) {
        // No alarm ringing right now; pausing today below is what matters.
      }
      return widget.api.setToday(false);
    }, '오늘 남은 알림을 멈췄어요. 잘 다녀오세요!');
  }

  Future<void> _toggleToday(bool armed) =>
      _run(() => widget.api.setToday(!armed), armed ? '오늘 출발 알림을 껐어요.' : '오늘 출발 알림을 켰어요.');

  Future<void> _openSettings() async {
    final data = _data;
    if (data == null) return;
    await Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => SettingsScreen(
        api: widget.api,
        initial: data,
        billing: widget.billing,
        onOpenSubscription: widget.onOpenSubscription,
        onSignedOut: widget.onSignedOut,
        onChanged: (next) {
          if (mounted) _apply(next);
        },
      ),
    ));
    if (mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final p = InochiPalette.of(context);
    if (data == null) {
      return Scaffold(
        body: Center(
          child: _error.isEmpty
              ? const CircularProgressIndicator()
              : Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Text(_error, textAlign: TextAlign.center, style: TextStyle(color: p.danger)),
                    const SizedBox(height: 12),
                    OutlinedButton(onPressed: _load, child: const Text('다시 시도')),
                  ]),
                ),
        ),
      );
    }
    if (asMap(data['setup'])['complete'] != true) {
      return OnboardingScreen(api: widget.api, initial: asMap(data['setup']), onDone: _apply);
    }
    return _countdown(context, data);
  }

  Widget _countdown(BuildContext context, Map<String, dynamic> data) {
    final p = InochiPalette.of(context);
    final setup = asMap(data['setup']);
    final today = asMap(data['today']);
    final repeat = asMap(data['repeat']);
    final forecast = asMap(data['forecast']);
    final boarding = asMap(setup['boarding']);
    final destination = asMap(setup['destination']);
    final ready = forecast['status'] == 'ready';
    final departed = today['departedToday'] == true;
    final armed = today['armed'] == true;
    final leaveAt = DateTime.tryParse('${forecast['leaveAt'] ?? ''}');
    final remaining = leaveAt?.difference(_now);
    final minutes = ready && remaining != null ? math.max(0, (remaining.inSeconds / 60).ceil()) : null;
    final overdue = remaining != null && remaining.isNegative;
    final urgency = departed ? Urgency.relaxed : urgencyFor(minutes, overdue: overdue);
    final (ground, tone) = switch (urgency) {
      Urgency.relaxed => (p.relaxedGround, p.relaxedTone),
      Urgency.soon => (p.soonGround, p.soonTone),
      Urgency.now => (p.nowGround, p.nowTone),
      Urgency.idle => (p.ground, p.ink),
    };
    final label = departed
        ? '오늘은 출발했어요'
        : !ready
            ? '오늘 출발 시각'
            : urgency == Urgency.now
                ? '지금 나가야 해요'
                : '출발까지';
    final count = departed ? '완료' : minutes == null ? '--' : countdownText(minutes);
    final stationLine = [
      stopTitle(boarding),
      if ('${boarding['lineName'] ?? ''}'.trim().isNotEmpty) '${boarding['lineName']}',
    ].join(' ');
    final route = '${forecast['routeNumber'] ?? ''}'.trim();
    final detail = ready
        ? '$stationLine ${route.isEmpty ? '' : '$route '}${kstClock(forecast['boardingAt'])} 탑승 · ${destination['label'] ?? '도착지'} ${setup['requiredArrivalTime']}까지'
        : _notReadyText(forecast, '${data['forecastError'] ?? ''}');
    final rows = asMapList(forecast['rows']).take(3).toList();
    final basis = '${forecast['basis'] ?? (rows.isNotEmpty ? rows.first['basis'] : '')}';
    final days = (repeat['days'] is List ? repeat['days'] as List : const []).map((d) => d is num ? d.toInt() : -1).toList();
    final repeatLabel = repeat['enabled'] == true ? _daysLabel(days) : '오늘 하루';
    final mode = boarding['mode'] == 'subway' ? '역' : '정류장';
    final vehicles = boarding['mode'] == 'subway' ? '곧 오는 열차' : '곧 오는 버스';
    final textTheme = TextStyle(color: p.ink);

    return AnimatedContainer(
      duration: motion(context, 300),
      curve: motionCurve,
      color: ground,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          bottom: false,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 8, 0),
              child: Row(children: [
                Text('이노치', style: textTheme.copyWith(fontSize: 18, fontWeight: FontWeight.w700)),
                const SizedBox(width: 8),
                Text('지금 ${kstClock(_now.toUtc().toIso8601String())}',
                    style: textTheme.copyWith(fontSize: 13, fontWeight: FontWeight.w500, fontFeatures: tabular)),
                const Spacer(),
                IconButton(
                  tooltip: '설정',
                  onPressed: _openSettings,
                  icon: Icon(Icons.settings_outlined, color: p.ink),
                  iconSize: 24,
                  constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                ),
              ]),
            ),
            if (_busy) const LinearProgressIndicator(minHeight: 2),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
                child: Semantics(
                  container: true,
                  label: '출발까지 남은 시간',
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(label, style: textTheme.copyWith(fontSize: 17, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 6),
                    AnimatedSwitcher(
                      duration: motion(context),
                      switchInCurve: motionCurve,
                      switchOutCurve: motionCurve,
                      transitionBuilder: (child, animation) => FadeTransition(
                        opacity: animation,
                        child: SlideTransition(
                          position: Tween(begin: const Offset(0, 0.06), end: Offset.zero).animate(animation),
                          child: child,
                        ),
                      ),
                      child: FittedBox(
                        key: ValueKey(count),
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerLeft,
                        child: Text(
                          count,
                          maxLines: 1,
                          style: TextStyle(
                            fontFamily: countdownFont,
                            fontSize: 150,
                            height: 0.95,
                            letterSpacing: -3,
                            color: tone,
                            fontFeatures: tabular,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    if (ready && !departed)
                      Text('${kstClock(forecast['leaveAt'])}에 나가세요',
                          style: textTheme.copyWith(fontSize: 22, fontWeight: FontWeight.w700, fontFeatures: tabular)),
                    const SizedBox(height: 4),
                    Text(detail, style: textTheme.copyWith(fontSize: 15, fontWeight: FontWeight.w500, fontFeatures: tabular)),
                    if (ready && forecast['urgent'] == true && !departed) ...[
                      const SizedBox(height: 8),
                      Text('이 차가 제시간에 도착하는 마지막 교통편이에요.', style: textTheme.copyWith(fontSize: 14, fontWeight: FontWeight.w700)),
                    ],
                    if (_error.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(_error, style: textTheme.copyWith(fontSize: 13)),
                    ],
                  ]),
                ),
              ),
            ),
            _Sheet(
              title: vehicles,
              basis: basis,
              rows: rows,
              busy: _busy,
              armed: armed,
              departed: departed,
              onDeparted: armed ? _departed : null,
              onToggle: () => _toggleToday(armed),
              footer: '$repeatLabel · 도착 ${setup['requiredArrivalTime'] ?? ''} · $mode까지 걸어서 ${setup['boardingAccessMin'] ?? '-'}분'
                  '${!armed && !departed ? ' · 오늘 알림 꺼짐' : ''}',
            ),
          ]),
        ),
      ),
    );
  }

  static String _notReadyText(Map<String, dynamic> forecast, String forecastError) {
    if (forecastError.isNotEmpty) return forecastError;
    if (forecast['status'] == 'no-catchable') return '지금은 제시간에 도착할 교통편이 없어요. 도착 시각이 지났거나 운행이 끝났을 수 있어요.';
    final warning = '${forecast['warning'] ?? ''}'.trim();
    return warning.isNotEmpty ? warning : '경로와 도착정보를 확인하고 있어요. 잠시 후 다시 보여 드릴게요.';
  }

  static String _daysLabel(List<int> days) {
    final set = days.toSet();
    if (set.length == 5 && set.containsAll([1, 2, 3, 4, 5])) return '평일 반복';
    if (set.length == 7) return '매일 반복';
    const order = [1, 2, 3, 4, 5, 6, 0];
    return '${order.where(set.contains).map((d) => weekdayLabels[d]).join('·')} 반복';
  }
}

class _Sheet extends StatelessWidget {
  const _Sheet({
    required this.title,
    required this.basis,
    required this.rows,
    required this.busy,
    required this.armed,
    required this.departed,
    required this.onDeparted,
    required this.onToggle,
    required this.footer,
  });

  final String title;
  final String basis;
  final List<Map<String, dynamic>> rows;
  final bool busy;
  final bool armed;
  final bool departed;
  final VoidCallback? onDeparted;
  final VoidCallback onToggle;
  final String footer;

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    return Container(
      decoration: BoxDecoration(
        color: p.sheet,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.10), blurRadius: 24, offset: const Offset(0, -6))],
      ),
      padding: EdgeInsets.fromLTRB(20, 20, 20, MediaQuery.paddingOf(context).bottom + 16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        Row(children: [
          Expanded(child: Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700))),
          BasisChip(basis: basis),
        ]),
        const SizedBox(height: 6),
        if (rows.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text('표시할 교통편이 아직 없어요.', style: TextStyle(fontSize: 14, color: p.muted)),
          )
        else
          for (var i = 0; i < rows.length; i++) _VehicleRow(row: rows[i], last: i == rows.length - 1),
        const SizedBox(height: 14),
        Row(children: [
          Expanded(
            child: FilledButton(
              onPressed: busy || departed ? null : onDeparted,
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(54)),
              child: Text(departed ? '오늘은 출발 완료' : '출발했어요'),
            ),
          ),
          const SizedBox(width: 10),
          Semantics(
            toggled: armed,
            label: '오늘 출발 알림',
            child: SizedBox(
              width: 54,
              height: 54,
              child: OutlinedButton(
                style: OutlinedButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(54, 54)),
                onPressed: busy ? null : onToggle,
                child: Icon(armed ? Icons.notifications_active_outlined : Icons.notifications_off_outlined,
                    color: armed ? p.ink : p.muted, size: 22),
              ),
            ),
          ),
        ]),
        const SizedBox(height: 12),
        Text(footer, textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: p.muted, fontFeatures: tabular)),
      ]),
    );
  }
}

class _VehicleRow extends StatelessWidget {
  const _VehicleRow({required this.row, required this.last});
  final Map<String, dynamic> row;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    final onTime = row['onTime'] == true;
    final target = row['target'] == true;
    final catchable = row['catchable'] == true;
    final (status, color, weight) = !onTime
        ? ('지각', p.danger, FontWeight.w700)
        : target
            ? ('추천', p.recommend, FontWeight.w700)
            : !catchable
                ? ('서둘러야', p.muted, FontWeight.w500)
                : ('정시', p.ok, FontWeight.w500);
    final faded = !onTime;
    final direction = '${row['direction'] ?? ''}'.trim();
    final route = '${row['routeNumber'] ?? ''}'.trim();
    return Container(
      constraints: const BoxConstraints(minHeight: 46),
      decoration: BoxDecoration(border: last ? null : Border(bottom: BorderSide(color: p.line))),
      child: Row(children: [
        SizedBox(
          width: 64,
          child: Text(kstClock(row['boardingAt']),
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: faded ? p.muted : p.ink, fontFeatures: tabular)),
        ),
        Expanded(
          child: Text(
            [route, direction].where((part) => part.isNotEmpty).join(' · '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 14, color: p.muted),
          ),
        ),
        const SizedBox(width: 8),
        Text(status, style: TextStyle(fontSize: 13, fontWeight: weight, color: color)),
      ]),
    );
  }
}

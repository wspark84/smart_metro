import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../app/inochi_theme.dart';
import '../../core/device/alarm_log.dart';
import '../../core/device/alarm_voice.dart';
import '../../core/device/local_alarm_scheduler.dart';
import '../../core/device/push_registration.dart';
import '../../core/format/kst_format.dart';
import '../../core/network/inochi_api.dart';
import '../../core/network/play_billing.dart';
import '../common/basis_chip.dart';
import '../settings/settings_screen.dart';
import '../setup/commute_inputs.dart';
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

/// "18분", "1시간 52분" → the big countdown text.
String countdownText(int minutes) {
  if (minutes < 60) return '$minutes분';
  final rest = minutes % 60;
  return rest == 0 ? '${minutes ~/ 60}시간' : '${minutes ~/ 60}시간 $rest분';
}

/// The big countdown: digits large, units (시간·분) small, so the number
/// is what the eye reads first. "1시간 52분" → 1 / 시간 / 52 / 분.
class CountdownNumber extends StatelessWidget {
  const CountdownNumber({super.key, required this.text, required this.color});
  final String text;
  final Color color;

  static const digitSize = 168.0;
  static const unitSize = 46.0;

  @override
  Widget build(BuildContext context) {
    final parts = RegExp(r'\d+|\D+').allMatches(text).map((m) => m.group(0)!).toList();
    // The display font has digits and Hangul only; anything else uses the system font.
    final display = RegExp(r'[0-9가-힣]').hasMatch(text);
    TextStyle style(double size) => TextStyle(
          fontFamily: display ? countdownFont : null,
          fontWeight: FontWeight.w900,
          fontSize: size,
          height: 1.0,
          letterSpacing: size > 100 ? -4 : 0,
          color: color,
          fontFeatures: tabular,
        );
    // "--" or "완료" (no digits) stays at full size.
    final hasDigits = RegExp(r'\d').hasMatch(text);
    return Text.rich(
      TextSpan(children: [
        for (var i = 0; i < parts.length; i++)
          RegExp(r'^\d+$').hasMatch(parts[i]) || !hasDigits
              ? TextSpan(text: parts[i], style: style(digitSize))
              : TextSpan(text: ' ${parts[i].trim()}${i < parts.length - 1 ? '  ' : ''}', style: style(unitSize)),
      ]),
      maxLines: 1,
      semanticsLabel: text,
    );
  }
}

/// "1번 버스" / "신분당선" / "대중교통".
String vehicleLabel(String route, {required bool subway}) {
  if (route.isEmpty) return '대중교통';
  if (subway) return route;
  return RegExp(r'^[0-9A-Za-z-]+$').hasMatch(route) ? '$route번 버스' : route;
}

/// Row status: 추천 / n분 여유 / 놓쳐요 / n분 늦음.
String rowStatus(Map<String, dynamic> row) {
  final slack = row['slackMinutes'] is num ? (row['slackMinutes'] as num).toInt() : null;
  if (row['onTime'] != true) return slack == null ? '지각' : '${-slack}분 늦음';
  if (row['target'] == true) return '추천';
  if (row['catchable'] != true) return '놓쳐요';
  return slack == null ? '정시' : '$slack분 여유';
}

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
  // Manual arrival check (no automatic checks when the leave time is unknown).
  bool _checking = false;
  DateTime? _manualAvailableAt;
  Timer? _manualTimer;
  Timer? _refresh;
  Timer? _tick;
  DateTime _now = DateTime.now();
  // Notifications are turned off on this phone: alarms cannot arrive.
  bool _pushOff = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Opening the app (also from the alarm notification) answers a ringing alarm.
    AlarmVoice.stop();
    unawaited(Future<void>.delayed(const Duration(seconds: 1), AlarmVoice.restoreVolume));
    unawaited(_load());
    unawaited(_syncPush());
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
    _manualTimer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      // Opening the app answers a ringing alarm and puts the volume back.
      AlarmVoice.stop();
      unawaited(Future<void>.delayed(const Duration(seconds: 1), AlarmVoice.restoreVolume));
      unawaited(_load());
      unawaited(_syncPush());
    }
  }

  // Sends this phone's current push token so alarms keep arriving after a
  // reinstall or a token change; notes when notifications are off.
  Future<void> _syncPush() async {
    unawaited(AlarmLog.upload(widget.api));
    try {
      final ok = await PushRegistration.sync(widget.api);
      if (ok != null && mounted) setState(() => _pushOff = !ok);
    } catch (_) {
      // Tried again on the next open.
    }
  }

  Future<void> _turnOnPush() async {
    final problem = await PushRegistration.register(widget.api).catchError((_) => '알림 연결에 실패했습니다. 다시 시도해 주세요.');
    if (!mounted) return;
    setState(() => _pushOff = problem != null);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(problem ?? '알림을 켰어요. 나갈 시각에 알려 드릴게요.')));
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
    _setManualAvailable(DateTime.tryParse('${asMap(data['refresh'])['manualAvailableAt'] ?? ''}'));
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

  void _setManualAvailable(DateTime? at) {
    _manualAvailableAt = at;
    _manualTimer?.cancel();
    final wait = at?.difference(DateTime.now());
    if (wait != null && !wait.isNegative) {
      _manualTimer = Timer(wait + const Duration(seconds: 1), () {
        if (mounted) setState(() {});
      });
    }
  }

  Future<void> _manualRefresh() async {
    if (_checking) return;
    setState(() => _checking = true);
    try {
      final data = await widget.api.refresh();
      if (mounted) _apply(data);
    } on InochiApiException catch (error) {
      if (!mounted) return;
      if (error.code == 'REFRESH_TOO_SOON') setState(() => _setManualAvailable(error.retryAt));
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('확인하지 못했습니다. 잠시 후 다시 눌러 주세요.')));
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  Future<void> _departed() async {
    AlarmVoice.stop();
    await LocalAlarmScheduler.instance.cancelDepartureBackup();
    await _run(() async {
      try {
        await widget.api.departed();
      } catch (_) {
        // No alarm ringing right now; pausing today below is what matters.
      }
      return widget.api.setToday(false, departed: true);
    }, '오늘 남은 알림을 멈췄어요. 잘 다녀오세요!');
  }

  Future<void> _toggleToday(bool armed) {
    // Turning today's alarms off also silences one that is ringing now.
    if (armed) AlarmVoice.stop();
    return _run(() => widget.api.setToday(!armed), armed ? '오늘 출발 알림을 껐어요.' : '오늘 출발 알림을 켰어요.');
  }

  Future<void> _changeArrival(Map<String, dynamic> setup) async {
    final current = parseHhmm('${setup['requiredArrivalTime'] ?? ''}') ?? const TimeOfDay(hour: 9, minute: 0);
    final picked = await showTimePicker(context: context, initialTime: current, helpText: '도착해야 하는 시각');
    if (picked == null || !mounted) return;
    await _run(() => widget.api.saveSetup({'requiredArrivalTime': formatHhmm(picked)}), '도착 시각을 바꿨어요 · ${koreanTime(picked)}');
  }

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
    final ready = forecast['status'] == 'ready';
    final departed = today['departedToday'] == true;
    final armed = today['armed'] == true;
    final leaveAt = DateTime.tryParse('${forecast['leaveAt'] ?? ''}');
    final remaining = leaveAt?.difference(_now);
    final minutes = ready && remaining != null ? math.max(0, (remaining.inSeconds / 60).ceil()) : null;
    final overdue = remaining != null && remaining.isNegative;
    // "지금 출발하면 N분 지각이에요" uses the red field like any must-go-now moment.
    final urgency = departed ? Urgency.relaxed : forecast['status'] == 'too-late' ? Urgency.now : urgencyFor(minutes, overdue: overdue);
    final (ground, tone) = switch (urgency) {
      Urgency.relaxed => (p.relaxedGround, p.relaxedTone),
      Urgency.soon => (p.soonGround, p.soonTone),
      Urgency.now => (p.nowGround, p.nowTone),
      Urgency.idle => (p.ground, p.ink),
    };
    final status = '${forecast['status'] ?? ''}';
    // Leave time unknown and no automatic checks: the person refreshes.
    // The arrival time has passed, or leaving now is already too late.
    final goalIssue = !departed && (status == 'goal-passed' || status == 'too-late');
    // A bus is still possible but live arrivals have not come yet (e.g. it is
    // waiting at the turnaround): no "0분", checks continue automatically.
    final awaitingLive = !departed && status == 'awaiting-live';
    final needsManual = !ready && !departed && !goalIssue && !awaitingLive &&
        (status == 'not-checked' || status == 'no-live' || asMap(data['refresh'])['state'] == 'unknown');
    final label = departed
        ? '오늘은 출발했어요'
        : goalIssue
            ? '${forecast['title'] ?? (status == 'too-late' ? '지금 출발해도 지각이에요' : '시간을 다시 설정해 보세요.')}'
            : awaitingLive
            ? '${forecast['title'] ?? '아직 실시간 정보가 확인되지 않았습니다.'}'
            : needsManual
            ? '현재 시간이 조회되지 않습니다'
            : !ready
            ? (status == 'no-catchable' ? '제시간 도착이 어려워요' : '경로를 확인하고 있어요')
            : urgency == Urgency.now
                ? '지금 나가야 해요'
                : '출발까지';
    // No number at all beats a placeholder that looks like a value.
    final count = departed ? '완료' : minutes == null ? '' : countdownText(minutes);
    final route = '${forecast['routeNumber'] ?? ''}'.trim();
    final subwayMode = boarding['mode'] == 'subway';
    final slack = forecast['slackMinutes'] is num ? (forecast['slackMinutes'] as num).toInt() : null;
    final rows = asMapList(forecast['rows']);
    final basis = '${forecast['basis'] ?? (rows.isNotEmpty ? rows.first['basis'] : '')}';
    final basisText = BasisChip.sentence('${forecast['basis'] ?? ''}');
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
              padding: const EdgeInsets.fromLTRB(24, 12, 8, 0),
              child: Row(children: [
                Text('이거 놓치면 지각', style: textTheme.copyWith(fontSize: 18, fontWeight: FontWeight.w700)),
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
              // No scrolling: the big number shrinks to leave room for the lines below it.
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 8, 24, 16),
                child: Semantics(
                  container: true,
                  label: '출발까지 남은 시간',
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    // Without a number the label is the headline: one line, shrunk to fit.
                    count.isEmpty
                        ? FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerLeft,
                            child: Text(label, maxLines: 1, style: textTheme.copyWith(fontSize: 26, fontWeight: FontWeight.w700)),
                          )
                        : Text(label, style: textTheme.copyWith(fontSize: 17, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 4),
                    Flexible(
                      child: Align(
                      alignment: Alignment.centerLeft,
                      heightFactor: 1,
                      child: AnimatedSwitcher(
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
                        // The display font's digits sit slightly left of their box; nudge them onto the text edge.
                        child: count.isEmpty ? const SizedBox(height: 24) : Padding(
                          padding: const EdgeInsets.only(left: 3),
                          child: CountdownNumber(text: count, color: tone),
                        ),
                      ),
                    ),
                    ),
                    ),
                    const SizedBox(height: 8),
                    if (ready && !departed)
                      Text('${kstClock(forecast['leaveAt'])}에 나가세요',
                          style: textTheme.copyWith(fontSize: 30, fontWeight: FontWeight.w800, fontFeatures: tabular)),
                    // Always say whether the time is live or estimated.
                    if (ready && !departed && basisText.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(basisText, style: textTheme.copyWith(fontSize: 10, fontWeight: FontWeight.w600)),
                    ],
                    const SizedBox(height: 10),
                    if (ready && !departed) ...[
                      _InfoLine(label: '출발', parts: [
                        (vehicleLabel(route, subway: subwayMode), false),
                        (kstClock(forecast['boardingAt']), true),
                        ('탑승', false),
                      ]),
                      const SizedBox(height: 4),
                      _InfoLine(label: '도착', parts: [
                        (kstClock(forecast['arriveAt']), true),
                        if (slack != null) (slack > 0 ? '$slack분 여유' : slack < 0 ? '${-slack}분 늦음' : '딱 맞게 도착', false),
                      ]),
                    ] else if (goalIssue) ...[
                      Text('${forecast['message'] ?? ''}', style: textTheme.copyWith(fontSize: 17, fontWeight: FontWeight.w700)),
                      if ('${forecast['detail'] ?? ''}'.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Text('${forecast['detail']}', style: textTheme.copyWith(fontSize: 15, fontWeight: FontWeight.w500, fontFeatures: tabular)),
                      ],
                      if (status == 'goal-passed') ...[
                      const SizedBox(height: 12),
                      SizedBox(
                        height: 52,
                        child: FilledButton.icon(
                          style: FilledButton.styleFrom(minimumSize: const Size(0, 52), padding: const EdgeInsets.symmetric(horizontal: 20)),
                          onPressed: _busy ? null : () => _changeArrival(setup),
                          icon: const Icon(Icons.schedule),
                          label: const Text('도착 시각 바꾸기', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                        ),
                      ),
                      ],
                    ] else if (awaitingLive) ...[
                      Text('${forecast['message'] ?? '실시간 정보가 확인되는 대로 다시 알려드릴게요.'}',
                          style: textTheme.copyWith(fontSize: 17, fontWeight: FontWeight.w700)),
                    ] else ...[
                      if (!needsManual || status == 'no-live')
                        Text(_notReadyText(forecast, '${data['forecastError'] ?? ''}'),
                            style: textTheme.copyWith(fontSize: 15, fontWeight: FontWeight.w500)),
                      if (needsManual) ...[
                        const SizedBox(height: 12),
                        _ManualRefresh(checking: _checking, availableAt: _manualAvailableAt, onPressed: _manualRefresh),
                      ],
                    ],
                    if (ready && forecast['urgent'] == true && !departed) ...[
                      const SizedBox(height: 8),
                      Text('이 차가 제시간에 도착하는 마지막 교통편이에요.', style: textTheme.copyWith(fontSize: 14, fontWeight: FontWeight.w700)),
                    ],
                    if (_error.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(_error, style: textTheme.copyWith(fontSize: 13)),
                    ],
                    if (_pushOff) ...[
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48), side: BorderSide(color: p.ink)),
                        onPressed: _turnOnPush,
                        icon: Icon(Icons.notifications_off_outlined, color: p.ink),
                        label: Text('휴대폰 알림 권한 꺼짐 · 눌러서 허용', style: TextStyle(color: p.ink, fontWeight: FontWeight.w700)),
                      ),
                    ],
                  ]),
                ),
              ),
            ),
            _Sheet(
              title: vehicles,
              basis: basis,
              rows: rows,
              subway: subwayMode,
              busy: _busy,
              armed: armed,
              departed: departed,
              // 출발했어요 ends the day even after the bell silenced the alarms.
              onDeparted: departed ? null : _departed,
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

/// "출발  1번 버스 21:22 탑승" — times in the emphasis red.
class _InfoLine extends StatelessWidget {
  const _InfoLine({required this.label, required this.parts});
  final String label;
  final List<(String, bool)> parts;

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    return Text.rich(
      TextSpan(children: [
        TextSpan(text: '$label  ', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: p.ink)),
        for (final (text, time) in parts)
          TextSpan(
            text: '$text ',
            style: time
                ? TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: p.emphasis, fontFeatures: tabular)
                : TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: p.ink),
          ),
      ]),
    );
  }
}

/// Bottom sheet: the next vehicles (swipe the list, or pull the sheet up for
/// more), 출발했어요 and today's alarm switch.
class _Sheet extends StatefulWidget {
  const _Sheet({
    required this.title,
    required this.basis,
    required this.rows,
    required this.subway,
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
  final bool subway;
  final bool busy;
  final bool armed;
  final bool departed;
  final VoidCallback? onDeparted;
  final VoidCallback onToggle;
  final String footer;

  @override
  State<_Sheet> createState() => _SheetState();
}

class _SheetState extends State<_Sheet> {
  static const _rowHeight = 48.0;

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    final rows = widget.rows;
    // Fixed height for three rows; scroll inside it for later vehicles.
    final int visible = math.min(rows.length, 3);
    return Container(
      decoration: BoxDecoration(
        color: p.sheet,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.10), blurRadius: 24, offset: const Offset(0, -6))],
      ),
      // Same 24dp left edge as the text above.
      padding: EdgeInsets.fromLTRB(24, 20, 24, MediaQuery.paddingOf(context).bottom + 16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        Row(children: [
          Expanded(child: Text(widget.title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700))),
          BasisChip(basis: widget.basis),
        ]),
        const SizedBox(height: 6),
        if (rows.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text('표시할 교통편이 아직 없어요.', style: TextStyle(fontSize: 14, color: p.muted)),
          )
        else
          SizedBox(
            height: visible * _rowHeight,
            child: ListView.builder(
              padding: EdgeInsets.zero,
              physics: const ClampingScrollPhysics(),
              itemCount: rows.length,
              itemExtent: _rowHeight,
              itemBuilder: (context, index) =>
                  _VehicleRow(row: rows[index], subway: widget.subway, last: index == rows.length - 1),
            ),
          ),
        const SizedBox(height: 14),
        Row(children: [
          Expanded(
            child: FilledButton(
              onPressed: widget.busy || widget.departed ? null : widget.onDeparted,
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(54)),
              child: Text(widget.departed ? '오늘은 출발 완료' : '출발했어요'),
            ),
          ),
          const SizedBox(width: 10),
          Semantics(
            toggled: widget.armed,
            label: '오늘 출발 알림',
            child: SizedBox(
              width: 54,
              height: 54,
              child: OutlinedButton(
                style: OutlinedButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(54, 54)),
                onPressed: widget.busy ? null : widget.onToggle,
                child: Icon(widget.armed ? Icons.notifications_active_outlined : Icons.notifications_off_outlined,
                    color: widget.armed ? p.ink : p.muted, size: 22),
              ),
            ),
          ),
        ]),
        const SizedBox(height: 12),
        Text(widget.footer, textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: p.muted, fontFeatures: tabular)),
      ]),
    );
  }
}

class _VehicleRow extends StatelessWidget {
  const _VehicleRow({required this.row, required this.subway, required this.last});
  final Map<String, dynamic> row;
  final bool subway;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    final onTime = row['onTime'] == true;
    final target = row['target'] == true;
    final catchable = row['catchable'] == true;
    final status = rowStatus(row);
    final (color, weight) = !onTime
        ? (p.danger, FontWeight.w700)
        : target
            ? (p.emphasis, FontWeight.w800)
            : !catchable
                ? (p.muted, FontWeight.w500)
                : (p.ok, FontWeight.w600);
    final faded = !onTime || !catchable;
    final route = vehicleLabel('${row['routeNumber'] ?? ''}'.trim(), subway: subway);
    final arrive = kstClock(row['arriveAt']);
    return Container(
      decoration: BoxDecoration(border: last ? null : Border(bottom: BorderSide(color: p.line))),
      child: Row(children: [
        SizedBox(
          width: 64,
          child: Text(kstClock(row['boardingAt']),
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: faded ? p.muted : p.ink, fontFeatures: tabular)),
        ),
        Expanded(
          child: Text(
            arrive == '--:--' ? route : '$route · $arrive 도착',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 14, color: p.muted, fontFeatures: tabular),
          ),
        ),
        const SizedBox(width: 8),
        if (BasisChip.short('${row['basis'] ?? ''}').isNotEmpty) ...[
          Text(BasisChip.short('${row['basis']}'),
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: row['basis'] == 'realtime' ? p.ok : p.muted)),
          const SizedBox(width: 6),
        ],
        Text(status, style: TextStyle(fontSize: 13, fontWeight: weight, color: color)),
      ]),
    );
  }
}

/// "새로고침": checks arrivals once on request; then waits 3 minutes.
class _ManualRefresh extends StatelessWidget {
  const _ManualRefresh({required this.checking, required this.availableAt, required this.onPressed});
  final bool checking;
  final DateTime? availableAt;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    final waitSeconds = availableAt?.difference(DateTime.now()).inSeconds ?? 0;
    final waiting = !checking && waitSeconds > 0;
    final text = checking
        ? '지금 확인 중입니다'
        : waiting
            ? '${(waitSeconds / 60).ceil()}분 뒤 다시 확인할 수 있어요'
            : '새로고침';
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SizedBox(
        height: 52,
        child: FilledButton.icon(
          style: FilledButton.styleFrom(minimumSize: const Size(0, 52), padding: const EdgeInsets.symmetric(horizontal: 20)),
          onPressed: checking || waiting ? null : onPressed,
          icon: checking
              ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: p.muted))
              : const Icon(Icons.refresh),
          label: Text(text, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
        ),
      ),
      const SizedBox(height: 6),
      Text('누르면 지금 도착정보를 확인해요. 3분에 한 번 확인할 수 있어요.', style: TextStyle(fontSize: 13, color: p.ink)),
    ]);
  }
}

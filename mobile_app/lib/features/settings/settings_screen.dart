import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/inochi_theme.dart';
import '../../app/theme_mode_store.dart';
import '../../core/device/alarm_style.dart';
import '../../core/device/push_registration.dart';
import '../../core/format/kst_format.dart';
import '../../core/network/inochi_api.dart';
import '../../core/network/mobile_social_auth.dart';
import '../../core/network/play_billing.dart';
import '../setup/commute_inputs.dart';
import '../setup/place_search_screen.dart';
import '../stops/stop_picker_screen.dart';
import '../stops/stop_widgets.dart';
import 'account_delete_screen.dart';

/// 설정: every commute input lives here (출발 정류장·역, 도착지, 도착 시각,
/// 걸어서 몇 분), plus the paid repeat, 화면 모드, alerts and account.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    required this.api,
    required this.initial,
    required this.billing,
    required this.onOpenSubscription,
    required this.onSignedOut,
    required this.onChanged,
  });

  final InochiApi api;
  final Map<String, dynamic> initial;
  final PlayBilling? billing;
  final Future<void> Function() onOpenSubscription;
  final Future<void> Function() onSignedOut;
  final void Function(Map<String, dynamic> data) onChanged;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late Map<String, dynamic> _data = widget.initial;
  bool _busy = false;
  int? _walk;
  Timer? _walkSave;

  Map<String, dynamic> get _setup => asMap(_data['setup']);
  Map<String, dynamic> get _repeat => asMap(_data['repeat']);
  bool get _subscribed => asMap(_data['subscription'])['active'] == true || widget.billing?.active == true;

  @override
  void dispose() {
    _walkSave?.cancel();
    super.dispose();
  }

  void _toast(String message) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<bool> _save(Map<String, dynamic> patch, {String? done}) async {
    setState(() => _busy = true);
    try {
      final data = await widget.api.saveSetup(patch);
      if (!mounted) return true;
      setState(() => _data = data);
      widget.onChanged(data);
      if (done != null) _toast(done);
      return true;
    } on InochiApiException catch (error) {
      if (error.subscriptionRequired) {
        _toast('매일 자동 알림은 구독 후 켤 수 있어요.');
        await widget.onOpenSubscription();
      } else {
        _toast(error.message);
      }
      return false;
    } catch (_) {
      _toast('저장하지 못했습니다. 다시 시도해 주세요.');
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _withBusy(Future<String?> Function() action) async {
    setState(() => _busy = true);
    try {
      final message = await action();
      if (message != null) _toast(message);
    } catch (error) {
      _toast(error is InochiApiException ? error.message : '처리하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickStop() async {
    final boarding = asMap(_setup['boarding']);
    final stop = await Navigator.of(context).push<Map<String, dynamic>>(
      MaterialPageRoute(builder: (_) => StopPickerScreen(api: widget.api, initial: boarding.isEmpty ? null : boarding)),
    );
    if (stop != null && mounted) await _save({'boarding': boardingPayload(stop)}, done: '출발 정류장·역을 바꿨어요.');
  }

  Future<void> _pickDestination() async {
    final place = await Navigator.of(context).push<Map<String, dynamic>>(
      MaterialPageRoute(builder: (_) => PlaceSearchScreen(api: widget.api)),
    );
    if (place != null && mounted) await _save({'destination': place}, done: '도착지를 바꿨어요.');
  }

  Future<void> _pickTime() async {
    final current = parseHhmm('${_setup['requiredArrivalTime'] ?? ''}') ?? const TimeOfDay(hour: 9, minute: 0);
    final picked = await showTimePicker(context: context, initialTime: current, helpText: '도착해야 하는 시각');
    if (picked != null && mounted) await _save({'requiredArrivalTime': formatHhmm(picked)}, done: '도착 시각을 바꿨어요.');
  }

  void _changeWalk(int minutes) {
    setState(() => _walk = minutes);
    _walkSave?.cancel();
    _walkSave = Timer(const Duration(milliseconds: 700), () => unawaited(_save({'boardingAccessMin': minutes})));
  }

  Future<void> _setRepeat({bool? enabled, List<int>? days, bool? skipHolidays}) async {
    if (enabled == true && !_subscribed) {
      await widget.onOpenSubscription();
      if (!mounted || !_subscribed) return;
    }
    await _save({
      'repeat': {
        if (enabled != null) 'enabled': enabled,
        if (days != null) 'days': days,
        if (skipHolidays != null) 'skipHolidays': skipHolidays,
      },
    }, done: enabled == null ? null : enabled ? '매일 자동 알림을 켰어요.' : '매일 자동 알림을 껐어요. 오늘 하루만 알려 드려요.');
  }

  List<int> get _alertMinutes {
    final alerts = asMap(_data['alerts']);
    return (alerts['minutes'] is List ? alerts['minutes'] as List : const [10, 5, 0]).map((m) => m is num ? m.toInt() : -1).where((m) => m >= 0).toList();
  }

  bool get _lateAlert => asMap(_data['alerts'])['late'] == true;

  Future<void> _saveAlerts(List<int> minutes, bool lateAlert) async {
    if (minutes.isEmpty && !lateAlert) {
      _toast('알림을 하나 이상 골라 주세요.');
      return;
    }
    // Show the choice at once; the server answer replaces it.
    setState(() => _data = {..._data, 'alerts': {...asMap(_data['alerts']), 'minutes': minutes, 'late': lateAlert}});
    await _save({'alerts': {'minutes': minutes, 'late': lateAlert}});
  }

  Future<void> _open(String path) async {
    final ok = await launchUrl(Uri.parse('${MobileSocialAuth.origin}$path'), mode: LaunchMode.externalApplication);
    if (!ok) _toast('브라우저를 열지 못했습니다.');
  }

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    final setup = _setup;
    final boarding = asMap(setup['boarding']);
    final destination = asMap(setup['destination']);
    final repeatOn = _repeat['enabled'] == true;
    final days = (_repeat['days'] is List ? _repeat['days'] as List : const [1, 2, 3, 4, 5]).map((d) => d is num ? d.toInt() : -1).toSet();
    final skipHolidays = _repeat['skipHolidays'] != false;
    final walk = _walk ?? (setup['boardingAccessMin'] is num ? (setup['boardingAccessMin'] as num).toInt() : 5);
    final mode = boarding['mode'] == 'subway' ? '역' : '정류장';
    final arrival = parseHhmm('${setup['requiredArrivalTime'] ?? ''}');
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(tooltip: '오늘 화면으로', icon: const Icon(Icons.arrow_back), onPressed: () => Navigator.of(context).maybePop()),
        title: const Text('설정'),
        bottom: _busy ? const PreferredSize(preferredSize: Size.fromHeight(2), child: LinearProgressIndicator(minHeight: 2)) : null,
      ),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 32), children: [
        const _Header('내 출근길'),
        _Group(children: [
          _Item(
            title: '출발 정류장·역',
            value: boarding.isEmpty ? '선택해 주세요' : [stopTitle(boarding), if ('${boarding['lineName'] ?? ''}'.isNotEmpty) '${boarding['lineName']}'].join(' · '),
            onTap: _busy ? null : _pickStop,
          ),
          _Item(
            title: '도착지',
            value: destination.isEmpty ? '선택해 주세요' : '${destination['label'] ?? ''}',
            detail: '${destination['address'] ?? ''}' == '${destination['label'] ?? ''}' ? null : '${destination['address'] ?? ''}',
            onTap: _busy ? null : _pickDestination,
          ),
          _Item(title: '도착 시각', value: arrival == null ? '선택해 주세요' : '${koreanTime(arrival)}까지', onTap: _busy ? null : _pickTime),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('$mode까지 걸어서', style: TextStyle(fontSize: 13, color: p.muted)),
                  Text('$walk분', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, fontFeatures: tabular)),
                ]),
              ),
              WalkStepper(minutes: walk, onChanged: _changeWalk, compact: true),
            ]),
          ),
        ]),
        const _Header('반복'),
        _Group(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 8, 10),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    const Text('매일 자동 알림', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                    const SizedBox(width: 6),
                    Pill(text: '유료', color: p.badge, filled: true),
                  ]),
                  const SizedBox(height: 2),
                  Text('끄면 오늘 하루만 알려 드려요', style: TextStyle(fontSize: 13, color: p.muted)),
                ]),
              ),
              Switch(value: repeatOn, onChanged: _busy ? null : (value) => _setRepeat(enabled: value)),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 4),
            child: Semantics(
              label: '반복 요일',
              child: Row(children: [
                for (final day in const [1, 2, 3, 4, 5, 6, 0])
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.all(2),
                      child: _DayButton(
                        label: weekdayLabels[day],
                        selected: days.contains(day),
                        onTap: !repeatOn || _busy
                            ? null
                            : () {
                                final next = {...days};
                                if (!next.remove(day)) next.add(day);
                                if (next.isEmpty) {
                                  _toast('반복할 요일을 하나 이상 골라 주세요.');
                                  return;
                                }
                                unawaited(_setRepeat(days: next.toList()..sort()));
                              },
                      ),
                    ),
                  ),
              ]),
            ),
          ),
          SwitchListTile(
            value: skipHolidays,
            onChanged: !repeatOn || _busy ? null : (value) => _setRepeat(skipHolidays: value),
            title: const Text('공휴일에는 쉬어요', style: TextStyle(fontSize: 15)),
            subtitle: Text(_subscribed ? '월 5,000원 구독 중' : '월 5,000원 · 구독하면 켤 수 있어요', style: TextStyle(fontSize: 13, color: p.muted)),
          ),
        ]),
        const _Header('화면'),
        ValueListenableBuilder<ThemeMode>(
          valueListenable: ThemeModeStore.instance.mode,
          builder: (context, mode, _) => SegmentedButton<ThemeMode>(
            showSelectedIcon: false,
            style: SegmentedButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
              selectedBackgroundColor: p.ink,
              selectedForegroundColor: p.ground,
              foregroundColor: p.ink,
              backgroundColor: p.card,
              side: BorderSide(color: p.line),
            ),
            segments: const [
              ButtonSegment(value: ThemeMode.system, label: Text('시스템')),
              ButtonSegment(value: ThemeMode.light, label: Text('라이트')),
              ButtonSegment(value: ThemeMode.dark, label: Text('다크')),
            ],
            selected: {mode},
            onSelectionChanged: (value) => unawaited(ThemeModeStore.instance.set(value.first)),
          ),
        ),
        const _Header('알림 시간'),
        _AlarmTimes(
          minutes: _alertMinutes,
          lateAlert: _lateAlert,
          busy: _busy,
          onChanged: (minutes, lateAlert) => _saveAlerts(minutes, lateAlert),
        ),
        const _Header('알람 방식'),
        ValueListenableBuilder<AlarmStyle>(
          valueListenable: AlarmStyleStore.instance.style,
          builder: (context, style, _) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SegmentedButton<AlarmStyle>(
              showSelectedIcon: false,
              style: SegmentedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
                selectedBackgroundColor: p.ink,
                selectedForegroundColor: p.ground,
                foregroundColor: p.ink,
                backgroundColor: p.card,
                side: BorderSide(color: p.line),
              ),
              segments: const [
                ButtonSegment(value: AlarmStyle.sound, label: Text('소리 + 음성 안내')),
                ButtonSegment(value: AlarmStyle.vibrate, label: Text('진동만')),
              ],
              selected: {style},
              onSelectionChanged: (value) => unawaited(AlarmStyleStore.instance.set(value.first)),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 10, 4, 0),
              child: Text(
                style == AlarmStyle.sound
                    ? '알람 음량을 최대로 올려 울리고 남은 시간을 읽어 드려요. 무음 모드에서도 울려요.'
                    : '소리 없이 3초 동안 길게 진동하고, 남은 시간은 알림 글로 보여 드려요.',
                style: TextStyle(fontSize: 13, color: p.muted),
              ),
            ),
            if (style == AlarmStyle.sound) ...[
              const SizedBox(height: 16),
              const _AlarmTonePicker(),
            ],
          ]),
        ),
        const _Header('알림'),
        _Group(children: [
          _Item(
            title: '이 휴대폰으로 알림 받기',
            detail: '출발 알림이 오려면 꼭 켜 주세요',
            onTap: _busy ? null : () => _withBusy(() async => await PushRegistration.register(widget.api) ?? '이 휴대폰으로 알림을 받을 수 있어요.'),
          ),
          _Item(
            title: '정확한 시각 알림 허용',
            detail: '절전 중에도 제때 울리도록 안드로이드 설정에서 허용해 주세요',
            onTap: _busy
                ? null
                : () => _withBusy(() async {
                      await PushRegistration.requestAlarmPermissions();
                      return null;
                    }),
          ),
          _Item(
            title: '시험 알림 보내기',
            onTap: _busy
                ? null
                : () => _withBusy(() async {
                      await widget.api.testPush();
                      return '시험 알림을 보냈어요. 잠시 후 도착하는지 확인해 주세요.';
                    }),
          ),
        ]),
        const _Header('계정'),
        _Group(children: [
          _Item(title: '구독 관리', trailing: _subscribed ? '이용 중' : '미이용', onTap: widget.onOpenSubscription),
          _Item(title: '로그아웃', detail: _email.isEmpty ? null : _email, onTap: _busy ? null : _signOut),
          _Item(
            title: '회원 탈퇴',
            danger: true,
            onTap: _busy
                ? null
                : () async {
                    final deleted = await Navigator.of(context).push<bool>(
                      MaterialPageRoute(builder: (_) => AccountDeleteScreen(api: widget.api, subscribed: _subscribed)),
                    );
                    if (deleted == true) await _signOut();
                  },
          ),
        ]),
        const SizedBox(height: 20),
        Wrap(alignment: WrapAlignment.center, children: [
          TextButton(onPressed: () => _open('/terms'), child: const Text('이용약관')),
          TextButton(onPressed: () => _open('/privacy'), child: const Text('개인정보처리방침')),
          TextButton(
            onPressed: () => launchUrl(Uri.parse('mailto:lifelogics@naver.com?subject=%EC%9D%B4%EB%85%B8%EC%B9%98%20%EB%AC%B8%EC%9D%98')),
            child: const Text('고객 문의'),
          ),
        ]),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: Text(
            '교통정보: 국토교통부(TAGO), 서울특별시, 경기도, 카카오. 지하철은 수도권 실시간, 그 밖의 지역은 공식 시간표 기준이에요.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: p.muted),
          ),
        ),
      ]),
    );
  }

  String get _email => MobileSocialAuth.ready ? MobileSocialAuth.client.auth.currentUser?.email ?? '' : '';

  Future<void> _signOut() async {
    final navigator = Navigator.of(context);
    await widget.onSignedOut();
    if (navigator.mounted) navigator.popUntil((route) => route.isFirst);
  }
}

class _Header extends StatelessWidget {
  const _Header(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 24, 4, 8),
        child: Text(text, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: InochiPalette.of(context).muted)),
      );
}

/// 알람 소리: pick one; ▶ plays a short preview at the current media volume.
class _AlarmTonePicker extends StatefulWidget {
  const _AlarmTonePicker();

  @override
  State<_AlarmTonePicker> createState() => _AlarmTonePickerState();
}

class _AlarmTonePickerState extends State<_AlarmTonePicker> {
  final AudioPlayer _preview = AudioPlayer();
  String? _playing;

  @override
  void initState() {
    super.initState();
    _preview.onPlayerComplete.listen((_) {
      if (mounted) setState(() => _playing = null);
    });
  }

  @override
  void dispose() {
    unawaited(_preview.dispose());
    super.dispose();
  }

  Future<void> _toggle(AlarmTone tone) async {
    await _preview.stop();
    if (_playing == tone.id) {
      setState(() => _playing = null);
      return;
    }
    setState(() => _playing = tone.id);
    try {
      await _preview.play(AssetSource('audio/${tone.file}'));
    } catch (_) {
      if (mounted) setState(() => _playing = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    return ValueListenableBuilder<AlarmTone>(
      valueListenable: AlarmToneStore.instance.tone,
      builder: (context, selected, _) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
          child: Text('알람 소리', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: p.ink)),
        ),
        _Group(children: [
          for (final tone in AlarmTone.all)
            InkWell(
              onTap: () => unawaited(AlarmToneStore.instance.set(tone)),
              child: Semantics(
                selected: selected.id == tone.id,
                button: true,
                label: '알람 소리 ${tone.label}',
                child: Container(
                constraints: const BoxConstraints(minHeight: 52),
                padding: const EdgeInsets.fromLTRB(8, 2, 8, 2),
                child: Row(children: [
                  SizedBox(
                    width: 40,
                    child: Icon(selected.id == tone.id ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                        color: selected.id == tone.id ? p.ink : p.muted, size: 22),
                  ),
                  Expanded(
                    child: Text(tone.label,
                        style: TextStyle(fontSize: 16, fontWeight: selected.id == tone.id ? FontWeight.w700 : FontWeight.w500, color: p.ink)),
                  ),
                  IconButton(
                    tooltip: _playing == tone.id ? '미리듣기 멈춤' : '미리듣기',
                    onPressed: () => unawaited(_toggle(tone)),
                    icon: Icon(_playing == tone.id ? Icons.stop_circle_outlined : Icons.play_circle_outline, color: p.ink),
                    constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                  ),
                ]),
              ),
              ),
            ),
        ]),
      ]),
    );
  }
}

class _Group extends StatelessWidget {
  const _Group({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(color: p.card, borderRadius: BorderRadius.circular(16)),
      child: Column(children: [
        for (var i = 0; i < children.length; i++) ...[
          if (i > 0) Divider(height: 1, indent: 16, color: p.line),
          children[i],
        ],
      ]),
    );
  }
}

class _Item extends StatelessWidget {
  const _Item({required this.title, this.value, this.detail, this.trailing, this.onTap, this.danger = false});
  final String title;
  final String? value;
  final String? detail;
  final String? trailing;
  final VoidCallback? onTap;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    final hasValue = value != null && value!.isNotEmpty;
    return InkWell(
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 56),
        padding: const EdgeInsets.fromLTRB(16, 10, 12, 10),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text(title,
                  style: hasValue
                      ? TextStyle(fontSize: 13, color: p.muted)
                      : TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: danger ? p.danger : p.ink)),
              if (hasValue) Text(value!, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              if (detail != null && detail!.isNotEmpty) Text(detail!, style: TextStyle(fontSize: 13, color: p.muted)),
            ]),
          ),
          if (trailing != null) Text(trailing!, style: TextStyle(fontSize: 14, color: p.muted)),
          if (!danger) Icon(Icons.chevron_right, color: p.muted, size: 20),
        ]),
      ),
    );
  }
}

class _DayButton extends StatelessWidget {
  const _DayButton({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    final enabled = onTap != null;
    return Semantics(
      button: true,
      selected: selected,
      label: '$label요일',
      child: Pressable(
        onTap: onTap,
        child: AnimatedContainer(
          duration: motion(context, 150),
          curve: motionCurve,
          height: 48,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected ? (enabled ? p.ink : p.muted) : p.card,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: selected ? Colors.transparent : p.line),
          ),
          child: Text(label,
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: selected ? p.ground : (enabled ? p.ink : p.muted))),
        ),
      ),
    );
  }
}

/// 알림 시간: minutes before the leave time, the leave time itself, and the
/// "지각 위험" alert after it.
class _AlarmTimes extends StatelessWidget {
  const _AlarmTimes({required this.minutes, required this.lateAlert, required this.busy, required this.onChanged});
  final List<int> minutes;
  final bool lateAlert;
  final bool busy;
  final void Function(List<int> minutes, bool lateAlert) onChanged;

  static const leads = [30, 20, 15, 10, 5, 3, 1];

  void _toggle(int lead) {
    final next = {...minutes};
    if (!next.remove(lead)) next.add(lead);
    onChanged(next.toList()..sort((a, b) => b.compareTo(a)), lateAlert);
  }

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    return _Group(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('나갈 시각 전에', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          Text('여러 개를 고를 수 있어요', style: TextStyle(fontSize: 13, color: p.muted)),
          const SizedBox(height: 10),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final lead in leads)
              Semantics(
                button: true,
                selected: minutes.contains(lead),
                label: '$lead분 전 알림',
                child: Pressable(
                  onTap: busy ? null : () => _toggle(lead),
                  child: AnimatedContainer(
                    duration: motion(context, 150),
                    curve: motionCurve,
                    constraints: const BoxConstraints(minWidth: 64, minHeight: 44),
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: minutes.contains(lead) ? p.ink : p.card,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: minutes.contains(lead) ? Colors.transparent : p.line),
                    ),
                    child: Text('$lead분 전',
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, fontFeatures: tabular,
                            color: minutes.contains(lead) ? p.ground : p.ink)),
                  ),
                ),
              ),
          ]),
        ]),
      ),
      SwitchListTile(
        value: minutes.contains(0),
        onChanged: busy ? null : (_) => _toggle(0),
        title: const Text('나갈 시각에', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
        subtitle: Text('"지금 집에서 출발하세요"', style: TextStyle(fontSize: 13, color: p.muted)),
      ),
      SwitchListTile(
        value: lateAlert,
        onChanged: busy ? null : (value) => onChanged(minutes, value),
        title: const Text('지각 위험 알림', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
        subtitle: Text('나갈 시각이 2분 지나도 출발하지 않으면 "바로 뛰어나가세요"', style: TextStyle(fontSize: 13, color: p.muted)),
      ),
    ]);
  }
}

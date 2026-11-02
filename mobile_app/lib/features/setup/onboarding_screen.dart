import 'package:flutter/material.dart';

import '../../app/inochi_theme.dart';
import '../../core/device/push_registration.dart';
import '../../core/network/inochi_api.dart';
import '../stops/stop_picker_screen.dart';
import '../stops/stop_widgets.dart';
import 'commute_inputs.dart';
import 'place_search_screen.dart';

/// First-run setup, one question per screen:
/// 출발 정류장·역 → 도착지 → 도착 시각 → 걸어서 몇 분 → 알림 허용.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, required this.api, required this.initial, required this.onDone});
  final InochiApi api;
  final Map<String, dynamic> initial;
  final void Function(Map<String, dynamic> data) onDone;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  static const _steps = 5;
  int _step = 0;
  Map<String, dynamic>? _boarding;
  Map<String, dynamic>? _destination;
  TimeOfDay _arrival = const TimeOfDay(hour: 9, minute: 0);
  int _walk = 5;
  bool _saving = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    final initial = widget.initial;
    if (initial['boarding'] is Map) _boarding = asMap(initial['boarding']);
    if (initial['destination'] is Map) _destination = asMap(initial['destination']);
    _arrival = parseHhmm('${initial['requiredArrivalTime'] ?? ''}') ?? _arrival;
    if (initial['boardingAccessMin'] is num) _walk = (initial['boardingAccessMin'] as num).toInt();
  }

  bool get _canContinue => switch (_step) {
        0 => _boarding != null,
        1 => _destination != null,
        _ => true,
      };

  Future<void> _pickStop() async {
    final stop = await Navigator.of(context).push<Map<String, dynamic>>(
      MaterialPageRoute(builder: (_) => StopPickerScreen(api: widget.api, initial: _boarding)),
    );
    if (stop != null && mounted) setState(() => _boarding = stop);
  }

  Future<void> _pickDestination() async {
    final place = await Navigator.of(context).push<Map<String, dynamic>>(
      MaterialPageRoute(builder: (_) => PlaceSearchScreen(api: widget.api)),
    );
    if (place != null && mounted) setState(() => _destination = place);
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(context: context, initialTime: _arrival, helpText: '도착해야 하는 시각');
    if (picked != null && mounted) setState(() => _arrival = picked);
  }

  Future<void> _finish({required bool allowAlerts}) async {
    setState(() {
      _saving = true;
      _error = '';
    });
    try {
      final data = await widget.api.saveSetup({
        'boarding': boardingPayload(_boarding!),
        'destination': _destination,
        'requiredArrivalTime': formatHhmm(_arrival),
        'boardingAccessMin': _walk,
      });
      String? problem;
      if (allowAlerts) {
        try {
          problem = await PushRegistration.register(widget.api);
        } catch (_) {
          problem = '알림 연결은 설정에서 다시 시도해 주세요.';
        }
      }
      if (!mounted) return;
      if (problem != null) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(problem)));
      widget.onDone(data);
    } catch (error) {
      if (mounted) setState(() => _error = error is InochiApiException ? error.message : '저장하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    return PopScope(
      canPop: _step == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _step > 0) setState(() => _step--);
      },
      child: Scaffold(
        appBar: AppBar(
          leading: _step == 0 ? null : IconButton(tooltip: '이전', icon: const Icon(Icons.arrow_back), onPressed: () => setState(() => _step--)),
          title: Text('출근길 설정 ${_step + 1}/$_steps', style: TextStyle(fontSize: 15, color: p.muted, fontWeight: FontWeight.w500)),
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(3),
            child: TweenAnimationBuilder<double>(
              tween: Tween(end: (_step + 1) / _steps),
              duration: motion(context, 250),
              curve: motionCurve,
              builder: (context, value, _) => LinearProgressIndicator(value: value, minHeight: 3),
            ),
          ),
        ),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Expanded(
                child: AnimatedSwitcher(
                  duration: motion(context),
                  switchInCurve: motionCurve,
                  switchOutCurve: motionCurve,
                  child: KeyedSubtree(key: ValueKey(_step), child: _body(p)),
                ),
              ),
              if (_error.isNotEmpty) Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(_error, style: TextStyle(color: p.danger)),
              ),
              if (_step < _steps - 1)
                FilledButton(onPressed: _canContinue ? () => setState(() => _step++) : null, child: const Text('다음'))
              else ...[
                FilledButton(onPressed: _saving ? null : () => _finish(allowAlerts: true), child: const Text('알림 허용하고 시작하기')),
                const SizedBox(height: 4),
                TextButton(onPressed: _saving ? null : () => _finish(allowAlerts: false), child: const Text('나중에 할게요')),
              ],
            ]),
          ),
        ),
      ),
    );
  }

  Widget _body(InochiPalette p) {
    switch (_step) {
      case 0:
        return _Question(
          title: '어디서 버스·지하철을\n타세요?',
          hint: '집에서 가장 먼저 타는 정류장이나 역이에요. 버스는 길 건너편과 헷갈리지 않게 방향까지 확인해요.',
          child: _Choice(
            value: _boarding == null ? null : '${stopTitle(_boarding!)} · ${stopKindLabel(_boarding!)}',
            empty: '정류장·역 찾기',
            onTap: _pickStop,
          ),
        );
      case 1:
        return _Question(
          title: '어디로 가세요?',
          hint: '회사나 학교 이름, 주소로 찾을 수 있어요.',
          child: _Choice(
            value: _destination == null ? null : '${_destination!['label'] ?? _destination!['address'] ?? ''}',
            empty: '도착지 찾기',
            onTap: _pickDestination,
          ),
        );
      case 2:
        return _Question(
          title: '몇 시까지\n도착해야 하나요?',
          hint: '이 시각에 맞춰 집에서 나갈 시각을 계산해요.',
          child: _Choice(value: koreanTime(_arrival), empty: '', onTap: _pickTime, big: true),
        );
      case 3:
        return _Question(
          title: '정류장·역까지\n걸어서 몇 분인가요?',
          hint: '집 문을 나서서 타는 곳에 도착할 때까지예요.',
          child: WalkStepper(minutes: _walk, onChanged: (value) => setState(() => _walk = value)),
        );
      default:
        return const _Question(
          title: '나갈 시각에\n알려 드릴게요',
          hint: '알림을 허용하면 집에서 나갈 시각 전에 휴대폰으로 알려 드려요. 알림이 없으면 이 앱은 제 역할을 못 해요.',
          child: SizedBox.shrink(),
        );
    }
  }
}

class _Question extends StatelessWidget {
  const _Question({required this.title, required this.hint, required this.child});
  final String title;
  final String hint;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    return ListView(children: [
      Text(title, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700, height: 1.3)),
      const SizedBox(height: 10),
      Text(hint, style: TextStyle(fontSize: 15, color: p.muted, height: 1.5)),
      const SizedBox(height: 28),
      child,
    ]);
  }
}

class _Choice extends StatelessWidget {
  const _Choice({required this.value, required this.empty, required this.onTap, this.big = false});
  final String? value;
  final String empty;
  final VoidCallback onTap;
  final bool big;

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    final chosen = value != null && value!.isNotEmpty;
    return Pressable(
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 64),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: p.card,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: chosen ? p.line : p.ink, width: chosen ? 1 : 2),
        ),
        child: Row(children: [
          Expanded(
            child: Text(
              chosen ? value! : empty,
              style: TextStyle(fontSize: big ? 28 : 17, fontWeight: FontWeight.w700, fontFeatures: tabular),
            ),
          ),
          Text(chosen ? '바꾸기' : '', style: TextStyle(fontSize: 14, color: p.muted)),
          Icon(chosen ? Icons.chevron_right : Icons.search, color: p.muted),
        ]),
      ),
    );
  }
}

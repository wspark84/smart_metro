import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/device/local_alarm_scheduler.dart';
import '../../core/network/inochi_api.dart';

/// In-app account deletion (required by Google Play and the App Store).
/// Pops `true` after the account is deleted on the server.
class AccountDeleteScreen extends StatefulWidget {
  const AccountDeleteScreen({super.key, required this.api, required this.subscribed});
  final InochiApi api;
  final bool subscribed;

  @override
  State<AccountDeleteScreen> createState() => _AccountDeleteScreenState();
}

class _AccountDeleteScreenState extends State<AccountDeleteScreen> {
  final _confirm = TextEditingController();
  bool _acknowledged = false;
  bool _needsAcknowledgement = false;
  bool _busy = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _needsAcknowledgement = widget.subscribed;
    _confirm.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _delete() async {
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      await widget.api.deleteAccount(acknowledgeSubscription: _acknowledged);
      await LocalAlarmScheduler.instance.cancelDepartureBackup();
      if (!mounted) return;
      await showDialog<void>(context: context, builder: (context) => AlertDialog(
        title: const Text('탈퇴가 완료되었어요'),
        content: const Text('계정과 저장된 정보를 삭제했어요. 이용해 주셔서 감사합니다.'),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('확인'))],
      ));
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        if (error is InochiApiException && error.code == 'SUBSCRIPTION_ACTIVE') _needsAcknowledgement = true;
        _error = error is InochiApiException ? error.message : '탈퇴하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final ready = _confirm.text.trim() == '탈퇴' && (!_needsAcknowledgement || _acknowledged) && !_busy;
    return Scaffold(
      appBar: AppBar(title: const Text('회원 탈퇴')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text('탈퇴하면 되돌릴 수 없어요', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          const Text('삭제되는 정보: 로그인 정보, 출발지·도착지와 통근 일정, 알림 설정과 기록, 휴대폰 알림 연결 정보'),
          const SizedBox(height: 8),
          const Text('유료 구독 결제 기록은 법령에 따라 개인을 알아볼 수 없는 형태로 5년간 보관한 뒤 파기해요.'),
          const SizedBox(height: 16),
          Card(
            color: scheme.errorContainer,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('구독 중이라면 먼저 해지해 주세요', style: TextStyle(fontWeight: FontWeight.w800, color: scheme.onErrorContainer)),
                const SizedBox(height: 4),
                Text('탈퇴만으로는 Google Play 결제가 멈추지 않아요.', style: TextStyle(color: scheme.onErrorContainer)),
                TextButton(
                  onPressed: () => launchUrl(Uri.parse('https://play.google.com/store/account/subscriptions'), mode: LaunchMode.externalApplication),
                  child: const Text('Google Play 구독 관리 열기'),
                ),
              ]),
            ),
          ),
          if (_needsAcknowledgement)
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _acknowledged,
              onChanged: (value) => setState(() => _acknowledged = value == true),
              title: const Text('구독을 해지했거나, 해지하지 않으면 결제가 계속될 수 있음을 확인했어요.'),
            ),
          const SizedBox(height: 12),
          TextField(controller: _confirm, decoration: const InputDecoration(labelText: "확인을 위해 '탈퇴'를 입력해 주세요")),
          if (_error.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error, style: TextStyle(color: scheme.error))),
          const SizedBox(height: 20),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: scheme.error, foregroundColor: scheme.onError),
            onPressed: ready ? _delete : null,
            child: Text(_busy ? '삭제하는 중…' : '계정 영구 삭제'),
          ),
        ],
      ),
    );
  }
}

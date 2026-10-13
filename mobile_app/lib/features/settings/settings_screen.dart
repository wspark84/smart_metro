import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/device/push_registration.dart';
import '../../core/network/inochi_api.dart';
import '../../core/network/mobile_social_auth.dart';
import '../../core/network/play_billing.dart';
import 'account_delete_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, required this.api, required this.billing, required this.onOpenSubscription, required this.onSignedOut});
  final InochiApi api;
  final PlayBilling? billing;
  final Future<void> Function() onOpenSubscription;
  final Future<void> Function() onSignedOut;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _busy = false;

  Future<void> _withBusy(Future<String?> Function() action) async {
    setState(() => _busy = true);
    try {
      final message = await action();
      if (mounted && message != null) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error is InochiApiException ? error.message : '처리하지 못했습니다. 다시 시도해 주세요.')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _open(String path) async {
    final ok = await launchUrl(Uri.parse('${MobileSocialAuth.origin}$path'), mode: LaunchMode.externalApplication);
    if (!ok && mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('브라우저를 열지 못했습니다.')));
  }

  @override
  Widget build(BuildContext context) {
    final email = MobileSocialAuth.ready ? MobileSocialAuth.client.auth.currentUser?.email ?? '' : '';
    final subscribed = widget.billing?.active == true;
    return Scaffold(
      appBar: AppBar(title: const Text('설정', style: TextStyle(fontWeight: FontWeight.w800))),
      body: ListView(
        children: [
          if (_busy) const LinearProgressIndicator(),
          const _Header('알림'),
          ListTile(
            leading: const Icon(Icons.notifications_active_outlined),
            title: const Text('이 휴대폰으로 알림 받기'),
            subtitle: const Text('출발 알림이 오려면 꼭 켜 주세요. 처음 한 번만 하면 돼요.'),
            onTap: _busy ? null : () => _withBusy(() async => await PushRegistration.register(widget.api) ?? '이 휴대폰으로 알림을 받을 수 있어요.'),
          ),
          ListTile(
            leading: const Icon(Icons.alarm_on_outlined),
            title: const Text('정확한 시각 알림·잠금화면 알림 허용'),
            subtitle: const Text('안드로이드 설정 화면에서 허용하면 절전 중에도 제때 울려요.'),
            onTap: _busy ? null : () => _withBusy(() async {
              await PushRegistration.requestAlarmPermissions();
              return null;
            }),
          ),
          ListTile(
            leading: const Icon(Icons.campaign_outlined),
            title: const Text('시험 알림 보내기'),
            onTap: _busy ? null : () => _withBusy(() async {
              await widget.api.testPush();
              return '시험 알림을 보냈어요. 잠시 후 도착하는지 확인해 주세요.';
            }),
          ),
          const _Header('구독'),
          ListTile(
            leading: const Icon(Icons.workspace_premium_outlined),
            title: Text(subscribed ? '반복 일정 구독 중' : '반복 일정 구독 (월 5,000원)'),
            subtitle: const Text('구독 확인·구매 복원·해지'),
            onTap: widget.onOpenSubscription,
          ),
          const _Header('계정'),
          if (email.isNotEmpty) ListTile(leading: const Icon(Icons.person_outline), title: Text(email)),
          ListTile(
            leading: const Icon(Icons.logout),
            title: const Text('로그아웃'),
            onTap: _busy ? null : widget.onSignedOut,
          ),
          ListTile(
            leading: Icon(Icons.person_remove_outlined, color: Theme.of(context).colorScheme.error),
            title: Text('회원 탈퇴', style: TextStyle(color: Theme.of(context).colorScheme.error)),
            onTap: _busy ? null : () async {
              final deleted = await Navigator.of(context).push<bool>(
                MaterialPageRoute(builder: (_) => AccountDeleteScreen(api: widget.api, subscribed: subscribed)),
              );
              if (deleted == true) await widget.onSignedOut();
            },
          ),
          const _Header('정보'),
          ListTile(leading: const Icon(Icons.description_outlined), title: const Text('이용약관'), onTap: () => _open('/terms')),
          ListTile(leading: const Icon(Icons.privacy_tip_outlined), title: const Text('개인정보처리방침'), onTap: () => _open('/privacy')),
          ListTile(
            leading: const Icon(Icons.mail_outline),
            title: const Text('고객 문의'),
            subtitle: const Text('lifelogics@naver.com'),
            onTap: () => launchUrl(Uri.parse('mailto:lifelogics@naver.com?subject=%EC%9D%B4%EB%85%B8%EC%B9%98%20%EB%AC%B8%EC%9D%98')),
          ),
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 32),
            child: Text('교통정보 제공: 국토교통부(TAGO), 서울특별시, 경기도, 카카오. 지하철은 수도권 실시간, 그 밖의 지역은 공식 시간표 기준이에요.',
                style: TextStyle(fontSize: 12)),
          ),
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
        child: Text(text, style: TextStyle(fontWeight: FontWeight.w800, color: Theme.of(context).colorScheme.primary)),
      );
}

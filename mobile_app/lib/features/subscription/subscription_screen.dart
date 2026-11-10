import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/inochi_theme.dart';
import '../../core/network/play_billing.dart';

/// 매일 자동 알림 구독 (하루 100원). Says plainly what it does, why it costs
/// money (서버 유지비) and the Play terms: price, monthly renewal, how to cancel.
class SubscriptionScreen extends StatelessWidget {
  const SubscriptionScreen({super.key, required this.billing});
  final PlayBilling billing;

  static final _manageUrl = Uri.parse(
      'https://play.google.com/store/account/subscriptions?sku=inochi_schedule_monthly&package=com.buswakeup.buswakeup_mobile');

  Future<void> _manage(BuildContext context) async {
    final opened = await launchUrl(_manageUrl, mode: LaunchMode.externalApplication);
    if (!opened && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Google Play 앱에서 구독을 관리해 주세요.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    return Scaffold(
      backgroundColor: p.ground,
      appBar: AppBar(backgroundColor: p.ground, title: const Text('매일 자동 알림')),
      body: ListenableBuilder(
        listenable: billing,
        builder: (context, _) => ListView(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
          children: billing.active ? _subscribed(context, p) : _offer(context, p),
        ),
      ),
    );
  }

  List<Widget> _offer(BuildContext context, InochiPalette p) {
    final price = billing.product?.price ?? '3,000원';
    final ready = !billing.busy && billing.product != null;
    return [
      // Hero: the price as a daily amount, in the countdown typeface.
      Container(
        padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
        decoration: BoxDecoration(color: p.relaxedGround, borderRadius: BorderRadius.circular(28)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('하루', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: p.relaxedTone)),
          Text('100원',
              style: TextStyle(fontFamily: countdownFont, fontSize: 76, height: 1.05, color: p.relaxedTone)),
          const SizedBox(height: 10),
          Text('매일 아침 지각 걱정,\n이노치가 대신 챙길게요.',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, height: 1.35, color: p.relaxedTone)),
        ]),
      ),
      const SizedBox(height: 24),
      _Benefit(icon: Icons.event_repeat, title: '고른 요일마다 알아서',
          body: '앱을 켜지 않아도 고른 요일 아침마다 나갈 시각에 맞춰 알람이 울려요. 공휴일에는 쉬어요.'),
      _Benefit(icon: Icons.directions_bus_outlined, title: '실시간 버스·지하철을 계속 확인',
          body: '출발 30분 전부터는 30초마다 도착정보를 확인해요. 버스가 일찍 오면 바로 "지금 뛰어나가세요"라고 알려 드려요.'),
      _Benefit(icon: Icons.record_voice_over_outlined, title: '크게, 놓치지 않게',
          body: '무음 모드에서도 알람 음량으로 울리고, 남은 시간을 목소리로 읽어 드려요.'),
      const SizedBox(height: 8),
      // Why it costs money, in the maker's words.
      Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(color: p.card, borderRadius: BorderRadius.circular(20), border: Border.all(color: p.line)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('왜 유료인가요?', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: p.ink)),
          const SizedBox(height: 10),
          Text(
            '이노치는 광고가 없어요. 알람 하나를 제때 보내기 위해 서버가 매일 아침 쉬지 않고 버스와 지하철 도착정보를 '
            '확인하고, 그 서버를 돌리는 데 매달 비용이 들어요.\n\n'
            '구독료는 이 서버를 유지하는 데 쓰여요. 커피 한 잔보다 적은 돈으로 한 달 내내 아침마다 이노치가 함께해요. '
            '하루 100원으로 이노치를 지켜 주세요.',
            style: TextStyle(fontSize: 15, height: 1.55, color: p.ink),
          ),
        ]),
      ),
      const SizedBox(height: 12),
      Row(children: [
        Icon(Icons.check_circle_outline, size: 18, color: p.ok),
        const SizedBox(width: 6),
        Expanded(child: Text('오늘 하루 알림은 구독하지 않아도 계속 무료예요.', style: TextStyle(fontSize: 14, color: p.muted))),
      ]),
      const SizedBox(height: 28),
      // Price and Play terms, then the button.
      Text('월 $price · 매월 자동 갱신', textAlign: TextAlign.center,
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: p.ink, fontFeatures: tabular)),
      const SizedBox(height: 4),
      Text('Google Play에서 언제든 해지할 수 있고, 해지해도 결제한 기간까지는 그대로 쓸 수 있어요.',
          textAlign: TextAlign.center, style: TextStyle(fontSize: 13, height: 1.4, color: p.muted)),
      const SizedBox(height: 14),
      SizedBox(
        height: 58,
        child: FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: p.ink,
            foregroundColor: p.ground,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
          ),
          onPressed: ready ? billing.buy : null,
          child: const Text('하루 100원으로 시작하기', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
        ),
      ),
      if (billing.busy) ...[const SizedBox(height: 12), const LinearProgressIndicator()],
      if (billing.message.isNotEmpty) ...[
        const SizedBox(height: 12),
        Text(billing.message, textAlign: TextAlign.center, style: TextStyle(fontSize: 14, color: p.danger)),
      ],
      const SizedBox(height: 16),
      _links(context, p, restore: true),
    ];
  }

  List<Widget> _subscribed(BuildContext context, InochiPalette p) => [
        Container(
          padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
          decoration: BoxDecoration(color: p.relaxedGround, borderRadius: BorderRadius.circular(28)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('매일 자동 알림 구독 중', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: p.relaxedTone)),
            const SizedBox(height: 8),
            Text('함께해 주셔서 고맙습니다. 구독료는 매일 아침 알람을 보내는 서버를 지키는 데 쓰여요.',
                style: TextStyle(fontSize: 15, height: 1.5, color: p.relaxedTone)),
            const SizedBox(height: 12),
            Text('이용 기한: ${billing.status['expiresAt'] ?? ''}',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: p.relaxedTone, fontFeatures: tabular)),
          ]),
        ),
        if (billing.message.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text(billing.message, textAlign: TextAlign.center, style: TextStyle(fontSize: 14, color: p.muted)),
        ],
        const SizedBox(height: 16),
        _links(context, p, restore: false),
      ];

  Widget _links(BuildContext context, InochiPalette p, {required bool restore}) {
    final style = TextButton.styleFrom(foregroundColor: p.muted, minimumSize: const Size(48, 44));
    return Wrap(alignment: WrapAlignment.center, spacing: 4, children: [
      if (restore) TextButton(style: style, onPressed: billing.busy ? null : billing.restore, child: const Text('구매 복원')),
      TextButton(style: style, onPressed: billing.busy ? null : billing.refresh, child: const Text('구독 상태 다시 확인')),
      TextButton(style: style, onPressed: () => _manage(context), child: const Text('구독 관리 · 해지')),
    ]);
  }
}

class _Benefit extends StatelessWidget {
  const _Benefit({required this.icon, required this.title, required this.body});
  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final p = InochiPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(color: p.card, borderRadius: BorderRadius.circular(12), border: Border.all(color: p.line)),
          child: Icon(icon, size: 22, color: p.ink),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: p.ink)),
            const SizedBox(height: 3),
            Text(body, style: TextStyle(fontSize: 14, height: 1.45, color: p.muted)),
          ]),
        ),
      ]),
    );
  }
}

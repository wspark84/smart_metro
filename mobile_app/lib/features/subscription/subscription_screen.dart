import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/network/play_billing.dart';

class SubscriptionScreen extends StatelessWidget {
  const SubscriptionScreen({super.key, required this.billing});
  final PlayBilling billing;
  @override Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('매일 자동 알림 구독')),
    body: ListenableBuilder(listenable: billing, builder: (context, _) => ListView(
      padding: const EdgeInsets.all(24), children: [
        const Text('출근 준비에 집중하세요', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
        const SizedBox(height: 16),
        const Text('고른 요일마다 아침에 따로 켜지 않아도 나갈 시각에 맞춰 자동으로 알려 드려요. 공휴일에는 쉬어요.'),
        const SizedBox(height: 16),
        const Text('오늘 하루 알림은 로그인만 하면 무료예요.'),
        const SizedBox(height: 24),
        if (billing.active) ...[
          const Text('매일 자동 알림 구독 중'),
          Text('이용 기한: ${billing.status['expiresAt'] ?? ''}'),
        ] else ...[
          Text('월 ${billing.product?.price ?? '3,000원'}'),
          const Text('매월 자동 갱신됩니다. Google Play에서 언제든 해지할 수 있으며, 해지 후에도 결제한 기간까지 이용할 수 있습니다.'),
          const SizedBox(height: 16),
          const Text('유료 구독을 하시겠어요?'),
          FilledButton(onPressed: billing.busy || billing.product == null ? null : billing.buy, child: const Text('Google Play로 구독하기')),
        ],
        if (billing.busy) const LinearProgressIndicator(),
        if (billing.message.isNotEmpty) Text(billing.message),
        TextButton(onPressed: billing.busy ? null : billing.restore, child: const Text('구매 복원')),
        TextButton(onPressed: billing.busy ? null : billing.refresh, child: const Text('구독 상태 다시 확인')),
        TextButton(onPressed: () async {
          final opened=await launchUrl(Uri.parse('https://play.google.com/store/account/subscriptions?sku=inochi_schedule_monthly&package=com.buswakeup.buswakeup_mobile'),mode:LaunchMode.externalApplication);
          if(!opened && context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Google Play 앱에서 구독을 관리해 주세요.')));
        }, child: const Text('구독 관리 · 해지')),
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('돌아가기')),
      ],
    )),
  );
}

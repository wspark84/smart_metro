import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';
import 'package:buswakeup_mobile/core/network/mobile_api_client.dart';
import 'package:buswakeup_mobile/core/network/play_billing.dart';
import 'package:buswakeup_mobile/features/subscription/subscription_screen.dart';

void main() {
  setUp(() { SharedPreferencesAsyncPlatform.instance=InMemorySharedPreferencesAsync.empty(); });
  tearDown(() { SharedPreferencesAsyncPlatform.instance=null; });
  testWidgets('unconfigured subscription explains free home and cannot charge', (tester) async {
    final billing=PlayBilling(MobileApiClient(),'test');
    await tester.pumpWidget(MaterialApp(home:SubscriptionScreen(billing:billing)));
    expect(find.text('홈의 일회성 알림은 로그인만 하면 무료입니다.'),findsOneWidget);
    expect(find.text('유료 구독을 하시겠어요?'),findsOneWidget);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,isNull);
    await tester.pumpWidget(const SizedBox());billing.dispose();
  });
  testWidgets('verified subscriber does not see a duplicate purchase button', (tester) async {
    final billing=PlayBilling(MobileApiClient(),'test')..status={'active':true,'expiresAt':'2026-11-04'};
    await tester.pumpWidget(MaterialApp(home:SubscriptionScreen(billing:billing)));
    expect(find.text('일정 자동 알림 구독 중'),findsOneWidget);
    expect(find.byType(FilledButton),findsNothing);
    expect(find.text('구독 관리 · 해지'),findsOneWidget);
    await tester.pumpWidget(const SizedBox());billing.dispose();
  });
}

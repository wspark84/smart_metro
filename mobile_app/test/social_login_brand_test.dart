import 'package:buswakeup_mobile/features/auth/social_login_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('login screen uses the Korean brand without Smart Metro', (tester) async {
    await tester.pumpWidget(MaterialApp(home: SocialLoginScreen(error: '', onRetry: () async {})));
    expect(find.descendant(of: find.byType(AppBar), matching: find.text('이노치')), findsOneWidget);
    expect(find.text('이거 놓치면 지각'), findsOneWidget);
    expect(find.textContaining('Smart Metro'), findsNothing);
  });
}

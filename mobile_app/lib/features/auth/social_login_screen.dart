import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/inochi_theme.dart';
import '../../core/network/mobile_social_auth.dart';

class SocialLoginScreen extends StatefulWidget {
  const SocialLoginScreen({super.key, required this.error, required this.onRetry});
  final String error;
  final Future<void> Function() onRetry;
  @override
  State<SocialLoginScreen> createState() => _SocialLoginScreenState();
}

class _SocialLoginScreenState extends State<SocialLoginScreen> {
  bool _busy = false;
  String _error = '';

  Future<void> _login(OAuthProvider provider) async {
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      await MobileSocialAuth.login(provider);
    } catch (_) {
      if (mounted) setState(() => _error = '로그인을 시작하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _emailLogin() async {
    final email = TextEditingController(), password = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('이메일로 로그인'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: email, keyboardType: TextInputType.emailAddress, autofillHints: const [AutofillHints.email],
              decoration: const InputDecoration(labelText: '이메일')),
          TextField(controller: password, obscureText: true, autofillHints: const [AutofillHints.password],
              decoration: const InputDecoration(labelText: '비밀번호')),
          const SizedBox(height: 8),
          const Text('안내받은 계정만 이용할 수 있어요. 처음이시면 구글·카카오로 시작해 주세요.', style: TextStyle(fontSize: 12)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('취소')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('로그인')),
        ],
      ),
    );
    final address = email.text, secret = password.text;
    email.dispose();
    password.dispose();
    if (ok != true || address.trim().isEmpty || secret.isEmpty) return;
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      await MobileSocialAuth.loginWithEmail(address, secret);
    } on AuthException catch (_) {
      if (mounted) setState(() => _error = '이메일 또는 비밀번호가 맞지 않습니다.');
    } catch (_) {
      if (mounted) setState(() => _error = '로그인하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _open(String path) => launchUrl(Uri.parse('${MobileSocialAuth.origin}$path'), mode: LaunchMode.externalApplication);

  @override
  Widget build(BuildContext context) {
    final message = _error.isNotEmpty ? _error : widget.error;
    return Scaffold(
      appBar: AppBar(title: const Text('이노치')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Icon(Icons.directions_run, size: 56, color: InochiPalette.of(context).ink),
                const SizedBox(height: 16),
                const Text('이거 놓치면 지각', textAlign: TextAlign.center, style: TextStyle(fontSize: 30, fontWeight: FontWeight.w900)),
                const SizedBox(height: 8),
                Text('집에서 나갈 시각을 버스·지하철 도착에 맞춰 알려드려요.', textAlign: TextAlign.center,
                    style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
                const SizedBox(height: 32),
                FilledButton(onPressed: _busy ? null : () => _login(OAuthProvider.google), child: const Text('구글로 시작하기')),
                const SizedBox(height: 10),
                FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: const Color(0xFFFEE500), foregroundColor: const Color(0xFF191600)),
                  onPressed: _busy ? null : () => _login(OAuthProvider.kakao),
                  child: const Text('카카오로 시작하기'),
                ),
                if (message.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Text(message, textAlign: TextAlign.center, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ],
                TextButton(onPressed: _busy ? null : widget.onRetry, child: const Text('연결 다시 확인')),
                TextButton(onPressed: _busy ? null : _emailLogin, child: const Text('이메일로 로그인', style: TextStyle(fontSize: 13))),
                const SizedBox(height: 16),
                Wrap(alignment: WrapAlignment.center, crossAxisAlignment: WrapCrossAlignment.center, children: [
                  const Text('시작하면 ', style: TextStyle(fontSize: 12)),
                  GestureDetector(onTap: () => _open('/terms'), child: const Text('이용약관', style: TextStyle(fontSize: 12, decoration: TextDecoration.underline))),
                  const Text('에 동의하고 ', style: TextStyle(fontSize: 12)),
                  GestureDetector(onTap: () => _open('/privacy'), child: const Text('개인정보처리방침', style: TextStyle(fontSize: 12, decoration: TextDecoration.underline))),
                  const Text('을 확인한 것으로 봅니다. 만 14세 이상만 가입할 수 있어요.', style: TextStyle(fontSize: 12)),
                ]),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../../core/network/mobile_social_auth.dart';

class SocialLoginScreen extends StatefulWidget {
  const SocialLoginScreen({super.key, required this.error, required this.onRetry});
  final String error;
  final Future<void> Function() onRetry;
  @override State<SocialLoginScreen> createState() => _SocialLoginScreenState();
}
class _SocialLoginScreenState extends State<SocialLoginScreen> {
  bool _busy = false;
  String _error = '';
  Future<void> _login(OAuthProvider provider) async {
    setState(() { _busy = true; _error = ''; });
    try { await MobileSocialAuth.login(provider); }
    catch (_) { if (mounted) setState(() { _error = '로그인을 시작하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.'; }); }
    finally { if (mounted) setState(() { _busy = false; }); }
  }
  @override Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('이노치')),
    body: Center(child: SingleChildScrollView(padding: const EdgeInsets.all(24), child: Column(
      mainAxisSize: MainAxisSize.min, children: [
        const Text('이거 놓치면 지각', style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold)),
        const SizedBox(height: 16), const Text('이노치 계정으로 로그인하세요.'),
        const SizedBox(height: 24),
        FilledButton(onPressed: _busy ? null : () => _login(OAuthProvider.google), child: const Text('구글로 시작하기')),
        FilledButton(onPressed: _busy ? null : () => _login(OAuthProvider.kakao), child: const Text('카카오로 시작하기')),
        if (_error.isNotEmpty || widget.error.isNotEmpty) Text(_error.isNotEmpty ? _error : widget.error),
        TextButton(onPressed: _busy ? null : widget.onRetry, child: const Text('연결 다시 확인')),
      ]))));
}

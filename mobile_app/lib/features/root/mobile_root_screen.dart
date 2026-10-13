import 'dart:async';
import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/network/mobile_api_client.dart';
import '../../core/device/local_alarm_scheduler.dart';
import '../auth/social_login_screen.dart';
import '../../core/network/mobile_social_auth.dart';
import '../operations/mobile_operations_screen.dart';
import '../../core/network/play_billing.dart';
import '../subscription/subscription_screen.dart';

class MobileRootScreen extends StatefulWidget {
  const MobileRootScreen({super.key});

  @override
  State<MobileRootScreen> createState() => _MobileRootScreenState();
}

class _MobileRootScreenState extends State<MobileRootScreen> {
  final MobileApiClient _apiClient = MobileApiClient();

  Map<String, dynamic>? _sessionPayload;
  bool _checkingSession = true;
  String _sessionError = '';
  StreamSubscription<AuthState>? _authSubscription;
  StreamSubscription<Uri>? _links;
  PlayBilling? _billing;
  bool _subscriptionRequested = false;
  bool _subscriptionOpen = false;

  void _onLink(Uri uri) {
    if(uri.scheme=='inochi' && uri.host=='subscription') {
      _subscriptionRequested=true;
      if(_sessionPayload?['authenticated']==true) _openSubscription();
    }
  }

  Future<void> _openSubscription() async {
    if(_billing==null || _subscriptionOpen || !mounted) return;
    _subscriptionRequested=false; _subscriptionOpen=true;
    await Navigator.of(context).push(MaterialPageRoute<void>(builder:(_)=>SubscriptionScreen(billing:_billing!)));
    _subscriptionOpen=false;
  }

  @override
  void dispose() {
    _authSubscription?.cancel();
    _links?.cancel();
    _billing?.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    final appLinks=AppLinks();
    _links=appLinks.uriLinkStream.listen(_onLink,onError:(_){ });
    unawaited(appLinks.getInitialLink().then((uri){if(uri!=null && mounted)_onLink(uri);}));
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    try {
      await LocalAlarmScheduler.instance.cancelLocalBackup();
      await MobileSocialAuth.initialize();
      if (!mounted) return;
      _authSubscription ??= MobileSocialAuth.client.auth.onAuthStateChange.listen((event) {
        if (mounted && (event.event == AuthChangeEvent.signedIn || event.event == AuthChangeEvent.signedOut)) {
          unawaited(_refreshSession());
        }
      }, onError: (_) { if (mounted) setState(() { _sessionError = '로그인 연결을 다시 확인해 주세요.'; }); });
    } catch (_) {
      if (mounted) setState(() { _checkingSession = false; _sessionError = '로그인 서버에 연결하지 못했습니다. 다시 시도해 주세요.'; });
      return;
    }
    await _refreshSession();
  }

  Future<void> _refreshSession() async {
    setState(() {
      _checkingSession = true;
      _sessionError = '';
    });

    try {
      final payload = await _apiClient.fetchAuthSession();
      if (payload['authenticated'] != true) {
        await LocalAlarmScheduler.instance.cancelLocalBackup();
      }
      if (!mounted) {
        return;
      }
      final userId=MobileSocialAuth.client.auth.currentUser?.id;
      if(payload['authenticated']==true && userId!=null && _billing?.userId!=userId) {
        _billing?.dispose(); _billing=PlayBilling(_apiClient,userId); unawaited(_billing!.initialize());
      }
      setState(() {
        _sessionPayload = payload;
        _checkingSession = false;
      });
      if(_subscriptionRequested) WidgetsBinding.instance.addPostFrameCallback((_){if(mounted)_openSubscription();});
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _sessionPayload = <String, dynamic>{'authenticated': false};
        _sessionError = error.toString();
        _checkingSession = false;
      });
    }
  }

  Future<void> _logout() async {
    await _apiClient.logout();
    _billing?.dispose(); _billing=null;
    await LocalAlarmScheduler.instance.cancelLocalBackup();
    if (!mounted) {
      return;
    }
    setState(() {
      _sessionPayload = <String, dynamic>{'authenticated': false};
      _sessionError = '';
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_checkingSession) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final authenticated = _sessionPayload?['authenticated'] == true;
    if (!authenticated) {
      return SocialLoginScreen(
        error: _sessionError,
        onRetry: _bootstrap,
      );
    }

    return MobileOperationsScreen(
      apiClient: _apiClient,
      sessionPayload: _sessionPayload ?? <String, dynamic>{},
      onLoggedOut: _logout,
      onSessionExpired: _refreshSession,
      onSubscription: _openSubscription,
    );
  }
}

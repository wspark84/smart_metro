import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/device/local_alarm_scheduler.dart';
import '../../core/network/inochi_api.dart';
import '../../core/network/mobile_api_client.dart';
import '../../core/network/mobile_social_auth.dart';
import '../../core/network/play_billing.dart';
import '../auth/social_login_screen.dart';
import '../home/home_screen.dart';
import '../settings/settings_screen.dart';
import '../subscription/subscription_screen.dart';
import '../trips/trips_screen.dart';

/// Signs the user in, then shows the three consumer tabs.
class InochiRoot extends StatefulWidget {
  const InochiRoot({super.key});

  @override
  State<InochiRoot> createState() => _InochiRootState();
}

class _InochiRootState extends State<InochiRoot> {
  final InochiApi _api = InochiApi();
  final MobileApiClient _legacyClient = MobileApiClient();
  StreamSubscription<AuthState>? _authSubscription;
  StreamSubscription<Uri>? _links;
  PlayBilling? _billing;
  bool _checking = true;
  bool _signedIn = false;
  String _error = '';
  int _tab = 0;
  bool _subscriptionRequested = false;

  @override
  void initState() {
    super.initState();
    final appLinks = AppLinks();
    _links = appLinks.uriLinkStream.listen(_onLink, onError: (_) {});
    unawaited(appLinks.getInitialLink().then((uri) {
      if (uri != null && mounted) _onLink(uri);
    }));
    unawaited(_bootstrap());
  }

  @override
  void dispose() {
    _authSubscription?.cancel();
    _links?.cancel();
    _billing?.dispose();
    super.dispose();
  }

  void _onLink(Uri uri) {
    if (uri.scheme == 'inochi' && uri.host == 'subscription') {
      _subscriptionRequested = true;
      if (_signedIn) unawaited(openSubscription());
    }
  }

  Future<void> _bootstrap() async {
    setState(() {
      _checking = true;
      _error = '';
    });
    try {
      await MobileSocialAuth.initialize();
      _authSubscription ??= MobileSocialAuth.client.auth.onAuthStateChange.listen((event) {
        if (event.event == AuthChangeEvent.signedIn || event.event == AuthChangeEvent.signedOut) {
          unawaited(_refreshSession());
        }
      }, onError: (_) {});
    } catch (_) {
      if (mounted) {
        setState(() {
          _checking = false;
          _error = '로그인 서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.';
        });
      }
      return;
    }
    await _refreshSession();
  }

  Future<void> _refreshSession() async {
    try {
      final session = await _api.session();
      final authenticated = session['authenticated'] == true;
      final userId = MobileSocialAuth.client.auth.currentUser?.id;
      if (authenticated && userId != null && _billing?.userId != userId) {
        _billing?.dispose();
        _billing = PlayBilling(_legacyClient, userId);
        unawaited(_billing!.initialize());
      }
      if (!authenticated) {
        await LocalAlarmScheduler.instance.cancelDepartureBackup();
      }
      if (!mounted) return;
      setState(() {
        _signedIn = authenticated;
        _checking = false;
        _error = '';
      });
      if (authenticated && _subscriptionRequested) {
        WidgetsBinding.instance.addPostFrameCallback((_) => unawaited(openSubscription()));
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _signedIn = false;
        _checking = false;
        _error = error is InochiApiException ? error.message : '로그인 상태를 확인하지 못했습니다.';
      });
    }
  }

  Future<void> openSubscription() async {
    _subscriptionRequested = false;
    final billing = _billing;
    if (billing == null || !mounted) return;
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => SubscriptionScreen(billing: billing)));
  }

  Future<void> signOut() async {
    await LocalAlarmScheduler.instance.cancelDepartureBackup();
    try {
      await MobileSocialAuth.client.auth.signOut(scope: SignOutScope.local);
    } catch (_) {
      // Local sign-out still clears this phone.
    }
    _billing?.dispose();
    _billing = null;
    if (mounted) {
      setState(() {
        _signedIn = false;
        _tab = 0;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_checking) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (!_signedIn) {
      return SocialLoginScreen(error: _error, onRetry: _bootstrap);
    }
    final pages = <Widget>[
      HomeScreen(api: _api, onOpenTrips: () => setState(() => _tab = 1)),
      TripsScreen(api: _api, billing: _billing, onOpenSubscription: openSubscription),
      SettingsScreen(api: _api, billing: _billing, onOpenSubscription: openSubscription, onSignedOut: signOut),
    ];
    return Scaffold(
      body: IndexedStack(index: _tab, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (index) => setState(() => _tab = index),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.directions_bus_outlined), selectedIcon: Icon(Icons.directions_bus), label: '오늘'),
          NavigationDestination(icon: Icon(Icons.event_repeat_outlined), selectedIcon: Icon(Icons.event_repeat), label: '반복 일정'),
          NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: '설정'),
        ],
      ),
    );
  }
}

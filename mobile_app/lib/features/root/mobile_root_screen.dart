import 'package:flutter/material.dart';

import '../../core/network/mobile_api_client.dart';
import '../../core/device/local_alarm_scheduler.dart';
import '../auth/auth_workspace_screen.dart';
import '../operations/mobile_operations_screen.dart';

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

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    try {
      await _apiClient.restorePersistedBaseUrl();
    } catch (_) {
      // Keep the default server URL when persisted mobile settings are unavailable.
    }
    try {
      await _apiClient.restorePersistedSession();
    } catch (_) {
      // Keep sign-in available when secure storage is unavailable on a test host.
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
        await _apiClient.clearSession();
        await LocalAlarmScheduler.instance.cancelLocalBackup();
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _sessionPayload = payload;
        _checkingSession = false;
      });
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
      return AuthWorkspaceScreen(
        apiClient: _apiClient,
        sessionError: _sessionError,
        onAuthenticated: _refreshSession,
      );
    }

    return MobileOperationsScreen(
      apiClient: _apiClient,
      sessionPayload: _sessionPayload ?? <String, dynamic>{},
      onLoggedOut: _logout,
      onSessionExpired: _refreshSession,
    );
  }
}

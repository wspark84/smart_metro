import 'package:flutter/material.dart';

import 'dart:async';
import 'dart:convert';

import '../../core/device/native_alarm_preview_service.dart';
import '../../core/device/native_alarm_preview_spec.dart';
import '../../core/device/local_alarm_scheduler.dart';
import '../../core/device/mobile_push_runtime.dart';
import '../../core/network/mobile_api_client.dart';
import '../../core/storage/mobile_client_settings_store.dart';

class MobileOperationsScreen extends StatefulWidget {
  const MobileOperationsScreen({
    super.key,
    required this.apiClient,
    required this.sessionPayload,
    required this.onLoggedOut,
    required this.onSessionExpired,
  });

  final MobileApiClient apiClient;
  final Map<String, dynamic> sessionPayload;
  final Future<void> Function() onLoggedOut;
  final Future<void> Function() onSessionExpired;

  @override
  State<MobileOperationsScreen> createState() => _MobileOperationsScreenState();
}

class _MobileOperationsScreenState extends State<MobileOperationsScreen> {
  int _tabIndex = 0;
  bool _loading = true;
  String _error = '';
  String _leaderboardRegion = 'gyeonggi';
  String _setupStatus = '';
  bool _savingSetup = false;
  bool _changingTodayAlarm = false;
  bool _searchingHomeAddress = false;
  bool _searchingWorkAddress = false;
  bool _searchingStations = false;
  bool _searchingRoutes = false;
  bool _estimatingCommute = false;

  String _homeSearchStatus = '';
  String _workSearchStatus = '';
  String _stationSearchStatus = '';
  String _routeSearchStatus = '';
  String _commuteEstimateStatus = '';
  String _deviceStatus = '';
  String _tokenRegisterStatus = '';
  String _pushToolStatus = '';
  String _overviewStatus = '';
  String _serverConnectionStatus = '';
  String _realDeviceFlowStatus = '';
  String _nativeAlarmPreviewStatus = '';
  final MobileClientSettingsStore _clientSettingsStore =
      MobileClientSettingsStore();
  final NativeAlarmPreviewService _nativeAlarmPreviewService =
      NativeAlarmPreviewService();
  final LocalAlarmScheduler _localAlarmScheduler = LocalAlarmScheduler.instance;
  final MobilePushRuntime _mobilePushRuntime = MobilePushRuntime.instance;
  StreamSubscription<String>? _pushTokenRefreshSubscription;
  MobilePushRuntimeStatus _mobilePushRuntimeStatus =
      MobilePushRuntimeStatus.notStarted();

  Map<String, dynamic>? _account;
  Map<String, dynamic>? _profile;
  Map<String, dynamic>? _route;
  Map<String, dynamic>? _schedule;
  Map<String, dynamic>? _notificationSettings;
  Map<String, dynamic>? _alarmRuntime;
  Map<String, dynamic>? _deviceProfile;
  Map<String, dynamic>? _accuracyLeaderboard;
  Map<String, dynamic>? _placeConfig;
  Map<String, dynamic>? _busConfig;
  Map<String, dynamic>? _mobileHealth;
  Map<String, dynamic>? _deviceTokenHealth;
  Map<String, dynamic>? _pushGatewayConfig;
  Map<String, dynamic>? _fcmAuthStatus;
  Map<String, dynamic>? _pushPreview;
  Map<String, dynamic>? _pushGatewayAttempts;
  Map<String, dynamic>? _homeLocation;
  Map<String, dynamic>? _workLocation;
  Map<String, dynamic>? _selectedStopLocation;
  Map<String, dynamic>? _commuteEstimate;
  String _transitQuerySnapshot = '';
  Map<String, dynamic>? _realDeviceFlowCheckpoint;
  Map<String, dynamic>? _realDeviceFlowResetBaseline;

  List<Map<String, dynamic>> _homeAddressResults = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _workAddressResults = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _stationResults = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _routeResults = <Map<String, dynamic>>[];

  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _homeAddressController = TextEditingController();
  final TextEditingController _workAddressController = TextEditingController();
  final TextEditingController _arrivalTimeController = TextEditingController();
  final TextEditingController _stationKeywordController =
      TextEditingController();
  final TextEditingController _stationNameController = TextEditingController();
  final TextEditingController _stopIdController = TextEditingController();
  final TextEditingController _lineIdsController = TextEditingController();
  final TextEditingController _primaryLineController = TextEditingController();
  final TextEditingController _providerController = TextEditingController();
  final TextEditingController _stationIdController = TextEditingController();
  final TextEditingController _arsIdController = TextEditingController();
  final TextEditingController _routeIdController = TextEditingController();
  final TextEditingController _routeNumberController = TextEditingController();
  final TextEditingController _orderController = TextEditingController();
  final TextEditingController _cityCodeController = TextEditingController();
  final TextEditingController _nodeIdController = TextEditingController();
  final TextEditingController _busRideMinController = TextEditingController();
  final TextEditingController _alightWalkMinController =
      TextEditingController();
  final TextEditingController _scheduleStartController =
      TextEditingController();
  final TextEditingController _scheduleEndController = TextEditingController();
  final TextEditingController _scheduleIntervalController =
      TextEditingController();
  final TextEditingController _repeatPresetController = TextEditingController();
  final TextEditingController _soundPresetController = TextEditingController();
  final TextEditingController _ttsVoiceController = TextEditingController();
  final TextEditingController _deviceNameController = TextEditingController();
  final TextEditingController _pushTokenController = TextEditingController();
  final TextEditingController _serverBaseUrlController =
      TextEditingController();

  bool _skipHolidays = true;
  bool _escalationEnabled = true;
  bool _dndBypass = false;
  bool _savingDeviceProfile = false;
  bool _registeringDeviceToken = false;
  bool _devicePushEnabled = false;
  bool _deviceFullScreenEnabled = false;
  bool _deviceDndOverrideGranted = false;
  bool _deviceBatteryOptimizationIgnored = false;
  bool _deviceLocalBackupEnabled = true;
  bool _deviceSoundEnabled = true;
  bool _deviceVibrationEnabled = true;
  bool _deviceTtsEnabled = true;
  String _devicePlatform = 'android';
  bool _runningTestPush = false;
  bool _runningGatewayDispatch = false;
  bool _runningRetrySimulation = false;
  bool _applyingServerBaseUrl = false;
  bool _checkingServerHealth = false;
  bool _runningNativeAlarmPreview = false;
  bool _requestingAndroidAlarmPermissions = false;
  bool _schedulingLocalBackup = false;
  String _localAlarmStatus = '';
  String _testPushRiskLevel = 'RED';

  @override
  void dispose() {
    _pushTokenRefreshSubscription?.cancel();
    unawaited(_nativeAlarmPreviewService.dispose());
    _nameController.dispose();
    _homeAddressController.dispose();
    _workAddressController.dispose();
    _arrivalTimeController.dispose();
    _stationKeywordController.dispose();
    _stationNameController.dispose();
    _stopIdController.dispose();
    _lineIdsController.dispose();
    _primaryLineController.dispose();
    _providerController.dispose();
    _stationIdController.dispose();
    _arsIdController.dispose();
    _routeIdController.dispose();
    _routeNumberController.dispose();
    _orderController.dispose();
    _cityCodeController.dispose();
    _nodeIdController.dispose();
    _busRideMinController.dispose();
    _alightWalkMinController.dispose();
    _scheduleStartController.dispose();
    _scheduleEndController.dispose();
    _scheduleIntervalController.dispose();
    _repeatPresetController.dispose();
    _soundPresetController.dispose();
    _ttsVoiceController.dispose();
    _deviceNameController.dispose();
    _pushTokenController.dispose();
    _serverBaseUrlController.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _serverBaseUrlController.text = widget.apiClient.baseUrl;
    _bootstrapOperations();
  }

  Future<void> _bootstrapOperations() async {
    try {
      _realDeviceFlowCheckpoint =
          await _clientSettingsStore.loadRealDeviceFlowCheckpoint();
      _realDeviceFlowResetBaseline =
          await _clientSettingsStore.loadRealDeviceFlowResetBaseline();
    } catch (_) {
      _realDeviceFlowCheckpoint = null;
      _realDeviceFlowResetBaseline = null;
    }
    await _loadAll();
    await _initializeMobilePushRuntime();
  }

  Future<void> _initializeMobilePushRuntime() async {
    final status = await _mobilePushRuntime.initialize();
    if (!mounted) {
      return;
    }
    setState(() {
      _mobilePushRuntimeStatus = status;
    });
    _pushTokenRefreshSubscription ??=
        _mobilePushRuntime.tokenRefreshes.listen((token) {
      unawaited(_handlePushTokenRefresh(token));
    });
  }

  Future<void> _handlePushTokenRefresh(String token) async {
    if (!mounted || token.trim().isEmpty) {
      return;
    }
    _pushTokenController.text = token.trim();
    if (!_devicePushEnabled || _registeringDeviceToken) {
      setState(() {
        _tokenRegisterStatus =
            'FCM issued a refreshed token. Register device token to save it to the server.';
      });
      return;
    }
    await _registerCurrentToken();
  }

  Future<void> _loadAll() async {
    setState(() {
      _loading = true;
      _error = '';
    });

    try {
      final payloads = await Future.wait<
          Map<String, dynamic>>(<Future<Map<String, dynamic>>>[
        widget.apiClient.fetchAccountSummary(),
        widget.apiClient.fetchProfile(),
        widget.apiClient.fetchRoute(),
        widget.apiClient.fetchSchedule(),
        widget.apiClient.fetchNotificationSettings(),
        widget.apiClient.fetchAlarmRuntime(),
        widget.apiClient.fetchDeviceProfile(),
        widget.apiClient.fetchAccuracyLeaderboard(region: _leaderboardRegion),
        widget.apiClient.fetchPlaceConfig(),
        widget.apiClient.fetchBusConfig(),
        widget.apiClient.fetchCommuteConfig(),
        widget.apiClient.fetchMobileHealth(),
        widget.apiClient.fetchDeviceTokenHealth(),
        widget.apiClient.fetchPushGatewayConfig(),
        widget.apiClient.fetchFcmAuthStatus(),
        widget.apiClient.fetchPushPreview(),
        widget.apiClient.fetchPushGatewayAttempts(limit: 6),
      ]);

      if (!mounted) {
        return;
      }

      setState(() {
        _account = payloads[0];
        _profile = payloads[1];
        _route = payloads[2];
        _schedule = payloads[3];
        _notificationSettings = payloads[4];
        _alarmRuntime = payloads[5];
        _deviceProfile = payloads[6];
        _accuracyLeaderboard = payloads[7];
        _placeConfig = payloads[8];
        _busConfig = payloads[9];
        _mobileHealth = payloads[11];
        _deviceTokenHealth = _map(payloads[12]['health']);
        _pushGatewayConfig = _map(payloads[13]['config']);
        _fcmAuthStatus = _map(payloads[14]['status']);
        _pushPreview = payloads[15];
        _pushGatewayAttempts = payloads[16];
        _loading = false;
      });
      _syncSetupControllers();
      _syncDeviceControllers();
      await _syncRealDeviceCheckpointFromState();
      if (_deviceLocalBackupEnabled) {
        await _localAlarmScheduler.scheduleNextDailyBackup(
          time: _readString(_map(_schedule), 'startTime', fallback: '07:00'),
          schedule: _map(_schedule),
          fullScreenRequested: _deviceFullScreenEnabled,
          dndBypassRequested: _deviceDndOverrideGranted,
          routeNumber: _routeNumberController.text.trim(),
        );
      } else {
        await _localAlarmScheduler.cancelLocalBackup();
      }
    } on MobileApiException catch (error) {
      if (error.statusCode == 401) {
        await widget.onSessionExpired();
        return;
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _error = error.message;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  void _syncSetupControllers() {
    final profile = _map(_profile);
    final route = _map(_route);
    _selectedStopLocation = _coordinateMap(route['stopLocation']);
    final liveBinding = _map(route['liveBinding']);
    final schedule = _map(_schedule);
    final notificationSettings = _map(_notificationSettings);

    _homeLocation = _coordinateMap(profile['homeLocation']);
    _workLocation = _coordinateMap(profile['workLocation']);

    _nameController.text = _readString(profile, 'name', fallback: '');
    _homeAddressController.text =
        _readString(profile, 'homeAddress', fallback: '');
    _workAddressController.text =
        _readString(profile, 'workAddress', fallback: '');
    _arrivalTimeController.text =
        _readString(profile, 'requiredArrivalTime', fallback: '');
    _stationKeywordController.text =
        _readString(liveBinding, 'stationName', fallback: '');
    _stationNameController.text =
        _readString(liveBinding, 'stationName', fallback: '');
    _stopIdController.text = _readString(route, 'selectedStopId', fallback: '');
    _lineIdsController.text = _joinList(route['selectedLineIds']);
    _primaryLineController.text =
        _readString(route, 'primaryLineId', fallback: '');
    _providerController.text = _normalizeProvider(
        _readString(liveBinding, 'provider', fallback: 'gyeonggi'));
    _stationIdController.text =
        _readString(liveBinding, 'stationId', fallback: '');
    _arsIdController.text = _readString(liveBinding, 'arsId', fallback: '');
    _routeIdController.text = _readString(liveBinding, 'routeId', fallback: '');
    _routeNumberController.text =
        _readString(liveBinding, 'routeNumber', fallback: '');
    _orderController.text = _readString(liveBinding, 'order', fallback: '');
    _cityCodeController.text =
        _readString(liveBinding, 'cityCode', fallback: '');
    _nodeIdController.text = _readString(liveBinding, 'nodeId', fallback: '');
    _busRideMinController.text =
        _readString(route, 'busRideMin', fallback: '0');
    _alightWalkMinController.text =
        _readString(route, 'alightToWorkWalkMin', fallback: '0');
    _scheduleStartController.text =
        _readString(schedule, 'startTime', fallback: '');
    _scheduleEndController.text =
        _readString(schedule, 'endTime', fallback: '');
    _scheduleIntervalController.text =
        _readString(schedule, 'repeatIntervalMin', fallback: '');
    _repeatPresetController.text =
        _readString(schedule, 'repeatPreset', fallback: '');
    _soundPresetController.text =
        _readString(notificationSettings, 'soundPresetId', fallback: '');
    _ttsVoiceController.text =
        _readString(notificationSettings, 'ttsVoiceId', fallback: '');
    _skipHolidays = schedule['skipHolidays'] == true;
    _escalationEnabled = notificationSettings['escalationEnabled'] != false;
    _dndBypass = notificationSettings['dndBypass'] == true;
  }

  void _syncDeviceControllers() {
    final deviceProfile = _map(_deviceProfile?['profile']);

    _deviceNameController.text = _readString(
      deviceProfile,
      'deviceName',
      fallback: '',
    );
    _pushTokenController.text = _readString(
      deviceProfile,
      'pushToken',
      fallback: '',
    );
    _devicePlatform = _normalizeDevicePlatform(
      _readString(deviceProfile, 'platform', fallback: 'android'),
    );
    _devicePushEnabled = deviceProfile['pushEnabled'] == true;
    _deviceFullScreenEnabled = deviceProfile['fullScreenEnabled'] == true;
    _deviceDndOverrideGranted = deviceProfile['dndOverrideGranted'] == true;
    _deviceBatteryOptimizationIgnored =
        deviceProfile['batteryOptimizationIgnored'] == true;
    _deviceLocalBackupEnabled = deviceProfile['localBackupEnabled'] != false;
    _deviceSoundEnabled = deviceProfile['soundEnabled'] != false;
    _deviceVibrationEnabled = deviceProfile['vibrationEnabled'] != false;
    _deviceTtsEnabled = deviceProfile['ttsEnabled'] != false;
  }

  Future<void> _changeRegion(String region) async {
    if (region == _leaderboardRegion) {
      return;
    }
    setState(() {
      _leaderboardRegion = region;
    });
    await _loadAll();
  }

  Future<void> _refreshDeviceTab() async {
    try {
      final payloads = await Future.wait<Map<String, dynamic>>(
        <Future<Map<String, dynamic>>>[
          widget.apiClient.fetchDeviceProfile(),
          widget.apiClient.fetchDeviceTokenHealth(),
          widget.apiClient.fetchPushGatewayConfig(),
          widget.apiClient.fetchFcmAuthStatus(),
          widget.apiClient.fetchMobileHealth(),
          widget.apiClient.fetchAlarmRuntime(),
          widget.apiClient.fetchPushPreview(),
          widget.apiClient.fetchPushGatewayAttempts(limit: 6),
        ],
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _deviceProfile = payloads[0];
        _deviceTokenHealth = _map(payloads[1]['health']);
        _pushGatewayConfig = _map(payloads[2]['config']);
        _fcmAuthStatus = _map(payloads[3]['status']);
        _mobileHealth = payloads[4];
        _alarmRuntime = payloads[5];
        _pushPreview = payloads[6];
        _pushGatewayAttempts = payloads[7];
      });
      _syncDeviceControllers();
      await _syncRealDeviceCheckpointFromState();
    } on MobileApiException catch (error) {
      if (error.statusCode == 401) {
        await widget.onSessionExpired();
        return;
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _deviceStatus = error.message;
      });
    }
  }

  Future<void> _saveDeviceSettings() async {
    setState(() {
      _savingDeviceProfile = true;
      _deviceStatus = '';
    });

    try {
      final payload =
          await widget.apiClient.saveDeviceProfile(<String, dynamic>{
        'deviceName': _deviceNameController.text.trim(),
        'platform': _devicePlatform,
        'pushEnabled': _devicePushEnabled,
        'fullScreenEnabled': _deviceFullScreenEnabled,
        'dndOverrideGranted': _deviceDndOverrideGranted,
        'batteryOptimizationIgnored': _deviceBatteryOptimizationIgnored,
        'localBackupEnabled': _deviceLocalBackupEnabled,
        'soundEnabled': _deviceSoundEnabled,
        'vibrationEnabled': _deviceVibrationEnabled,
        'ttsEnabled': _deviceTtsEnabled,
      });

      if (!mounted) {
        return;
      }

      setState(() {
        _deviceProfile = payload;
        _deviceTokenHealth = _map(payload['tokenHealth']);
        _deviceStatus = 'Device settings saved.';
      });
      _syncDeviceControllers();
      await _refreshDeviceTab();
    } on MobileApiException catch (error) {
      if (error.statusCode == 401) {
        await widget.onSessionExpired();
        return;
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _deviceStatus = error.message;
      });
    } finally {
      if (mounted) {
        setState(() {
          _savingDeviceProfile = false;
        });
      }
    }
  }

  Future<void> _runManualTestPush() async {
    setState(() {
      _runningTestPush = true;
      _pushToolStatus = '';
    });

    try {
      final payload = await widget.apiClient.runTestPushDispatch(
        <String, dynamic>{
          'routeNumber': _routeNumberController.text.trim().isEmpty
              ? _primaryLineController.text.trim()
              : _routeNumberController.text.trim(),
          'stopName': _stationNameController.text.trim(),
          'riskLevel': _testPushRiskLevel,
        },
      );

      if (!mounted) {
        return;
      }

      final attempt = _map(payload['attempt']);
      setState(() {
        _pushToolStatus =
            'Test push ${_readString(attempt, 'status', fallback: 'done')}: ${_readString(attempt, 'reason', fallback: 'No reason returned.')}';
      });
      final attemptStatus =
          _readString(attempt, 'status', fallback: '').toUpperCase();
      if (_isSuccessfulRealDevicePushStatus(attemptStatus)) {
        await _storeRealDeviceCheckpoint(
          stepNumber: 4,
          stepLabel: 'Step 4 - Run test push',
          status: attemptStatus,
          detail: _pushToolStatus.isEmpty
              ? 'A device push test completed.'
              : _pushToolStatus,
          evidenceKey: _readString(attempt, 'createdAt', fallback: ''),
        );
      }
      await _refreshDeviceTab();
    } on MobileApiException catch (error) {
      if (error.statusCode == 401) {
        await widget.onSessionExpired();
        return;
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _pushToolStatus = error.message;
      });
    } finally {
      if (mounted) {
        setState(() {
          _runningTestPush = false;
        });
      }
    }
  }

  Future<void> _runCurrentGatewayDispatch() async {
    setState(() {
      _runningGatewayDispatch = true;
      _pushToolStatus = '';
    });

    try {
      final dispatchKey = _readString(
        _map(_pushPreview?['preview']),
        'dispatchKey',
        fallback: '',
      );
      final payload = await widget.apiClient.runGatewayDispatch(
        dispatchKey == '-' || dispatchKey.isEmpty
            ? <String, dynamic>{}
            : <String, dynamic>{'dispatchKey': dispatchKey},
      );

      if (!mounted) {
        return;
      }

      final attempt = _map(payload['attempt']);
      setState(() {
        _pushToolStatus =
            'Gateway dispatch ${_readString(attempt, 'status', fallback: 'done')}: ${_readString(attempt, 'reason', fallback: 'No reason returned.')}';
      });
      await _refreshDeviceTab();
    } on MobileApiException catch (error) {
      if (error.statusCode == 401) {
        await widget.onSessionExpired();
        return;
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _pushToolStatus = error.message;
      });
    } finally {
      if (mounted) {
        setState(() {
          _runningGatewayDispatch = false;
        });
      }
    }
  }

  Future<void> _runRetrySimulationAction(
    String action, {
    String outcome = 'success',
  }) async {
    setState(() {
      _runningRetrySimulation = true;
      _pushToolStatus = '';
    });

    try {
      final payload =
          await widget.apiClient.runRetrySimulation(<String, dynamic>{
        'action': action,
        'outcome': outcome,
        'routeNumber': _routeNumberController.text.trim().isEmpty
            ? _primaryLineController.text.trim()
            : _routeNumberController.text.trim(),
        'stopName': _stationNameController.text.trim(),
        'riskLevel': _testPushRiskLevel,
      });

      if (!mounted) {
        return;
      }

      final attempt = _map(payload['attempt']);
      final pushGateway = _map(payload['pushGateway']);
      final retryPolicy = _map(pushGateway['retryPolicy']);
      setState(() {
        if (action == 'clear-simulation') {
          _pushToolStatus = 'Simulation queue cleared.';
        } else {
          _pushToolStatus =
              'Retry simulation ${payload['action']} -> ${_readString(attempt, 'status', fallback: outcome)} (pending retries: ${_readString(retryPolicy, 'pendingRetries', fallback: '0')}).';
        }
      });
      await _refreshDeviceTab();
    } on MobileApiException catch (error) {
      if (error.statusCode == 401) {
        await widget.onSessionExpired();
        return;
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _pushToolStatus = error.message;
      });
    } finally {
      if (mounted) {
        setState(() {
          _runningRetrySimulation = false;
        });
      }
    }
  }

  Future<void> _registerCurrentToken() async {
    setState(() {
      _registeringDeviceToken = true;
      _tokenRegisterStatus = '';
    });

    try {
      var rawToken = _pushTokenController.text.trim();
      // Always ask Firebase for its current token when the runtime is ready.
      // A token that the server marked UNREGISTERED may still be displayed in
      // this field, so re-posting the field value would keep sending a stale
      // token instead of recovering the phone's current registration.
      if (_mobilePushRuntime.status.firebaseReady || rawToken.isEmpty) {
        final result = await _mobilePushRuntime.requestPermissionAndGetToken();
        if (!result.ready) {
          if (!_mobilePushRuntime.status.firebaseReady && rawToken.isNotEmpty) {
            // Keep an explicitly entered token usable for manual QA when this
            // particular build has not been connected to Firebase yet.
            _tokenRegisterStatus = result.message;
          } else if (mounted) {
            setState(() {
              _mobilePushRuntimeStatus = _mobilePushRuntime.status;
              _tokenRegisterStatus = result.message;
            });
            return;
          } else {
            return;
          }
        } else {
          rawToken = result.token;
          _pushTokenController.text = rawToken;
          _devicePlatform = result.platform;
          _devicePushEnabled = true;
        }
      }
      final payload = await widget.apiClient.registerDeviceToken(
        <String, dynamic>{
          'deviceName': _deviceNameController.text.trim(),
          'platform': _devicePlatform,
          'pushEnabled': _devicePushEnabled,
          'pushToken': rawToken,
        },
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _deviceProfile = <String, dynamic>{
          'profile': payload['profile'],
          'tokenHealth': payload['tokenHealth'],
        };
        _deviceTokenHealth = _map(payload['tokenHealth']);
        _tokenRegisterStatus = _readString(
          _deviceTokenHealth,
          'reason',
          fallback: 'Device token registered.',
        );
        _mobilePushRuntimeStatus = _mobilePushRuntime.status;
        _realDeviceFlowStatus = '';
      });
      _syncDeviceControllers();
      await _storeRealDeviceCheckpoint(
        stepNumber: 1,
        stepLabel: 'Step 1 - Register token',
        status: 'DONE',
        detail: _tokenRegisterStatus.isEmpty
            ? 'Device token registered successfully.'
            : _tokenRegisterStatus,
      );
      await _refreshDeviceTab();
    } on MobileApiException catch (error) {
      if (error.statusCode == 401) {
        await widget.onSessionExpired();
        return;
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _tokenRegisterStatus = error.message;
      });
    } finally {
      if (mounted) {
        setState(() {
          _registeringDeviceToken = false;
        });
      }
    }
  }

  Future<void> _startNativeLateAlarmPreview() async {
    setState(() {
      _runningNativeAlarmPreview = true;
      _nativeAlarmPreviewStatus = '';
    });

    final routeNumber = _routeNumberController.text.trim().isEmpty
        ? _primaryLineController.text.trim()
        : _routeNumberController.text.trim();
    final spec = buildMustCatchNativeAlarmPreviewSpec(
      routeNumber: routeNumber,
      currentArrivalMin: 3,
      nextArrivalMin: 18,
    );

    final status = await _nativeAlarmPreviewService.previewMustCatchAlarm(
      spec: spec,
      soundEnabled: _deviceSoundEnabled,
      vibrationEnabled: _deviceVibrationEnabled,
      ttsEnabled: _deviceTtsEnabled,
    );

    if (!mounted) {
      return;
    }

    setState(() {
      _nativeAlarmPreviewStatus = status;
      _runningNativeAlarmPreview = false;
    });
  }

  Future<void> _stopNativeLateAlarmPreview() async {
    setState(() {
      _runningNativeAlarmPreview = true;
    });

    final status = await _nativeAlarmPreviewService.stop();
    if (!mounted) {
      return;
    }

    setState(() {
      _nativeAlarmPreviewStatus = status;
      _runningNativeAlarmPreview = false;
    });
  }

  Future<void> _openOverviewAttentionTarget(
    Map<String, dynamic> target, {
    required String sourceLabel,
  }) async {
    final buttonLabel = _readString(
      target,
      'buttonLabel',
      fallback: 'Open device details',
    );
    final panelItemId = _readString(target, 'panelItemId', fallback: '');
    final panelItemKind = _readString(target, 'panelItemKind', fallback: '');

    String deviceMessage =
        '$sourceLabel: review the matching device-delivery section.';
    if (panelItemId == 'device-push-token-input') {
      deviceMessage =
          '$sourceLabel: review the push token field, then register the current token again.';
    } else if (panelItemKind == 'push-attempt') {
      deviceMessage =
          '$sourceLabel: inspect the latest failed push gateway attempt in the recent attempts list.';
    } else if (panelItemKind == 'retry-queue') {
      deviceMessage =
          '$sourceLabel: inspect the pending retry item in the retry queue list.';
    }

    if (!mounted) {
      return;
    }

    setState(() {
      _tabIndex = 3;
      _overviewStatus = '$sourceLabel -> $buttonLabel';
      _deviceStatus = deviceMessage;
    });
  }

  Future<void> _runOverviewQuickAction(
    Map<String, dynamic> quickAction, {
    required String sourceLabel,
  }) async {
    final action = _readString(quickAction, 'action', fallback: '');
    final buttonLabel = _readString(
      quickAction,
      'buttonLabel',
      fallback: 'Run action',
    );

    if (action == '-' || action.isEmpty) {
      if (!mounted) {
        return;
      }
      setState(() {
        _overviewStatus =
            '$sourceLabel has no quick action wired for this delivery state.';
      });
      return;
    }

    if (!mounted) {
      return;
    }

    setState(() {
      _tabIndex = 3;
      _overviewStatus = '$sourceLabel -> $buttonLabel';
    });

    if (action == 'register-device-token') {
      await _registerCurrentToken();
      return;
    }
    if (action == 'run-push-gateway') {
      await _runCurrentGatewayDispatch();
      return;
    }
    if (action == 'run-push-retry-simulation') {
      await _runRetrySimulationAction('run-due-retry');
      return;
    }

    if (!mounted) {
      return;
    }

    setState(() {
      _overviewStatus =
          '$sourceLabel quick action is not wired on mobile yet: $action';
    });
  }

  void _openOverviewAccuracyWatchlist() {
    if (!mounted) {
      return;
    }
    setState(() {
      _tabIndex = 2;
      _overviewStatus =
          'Instability watch -> Accuracy tab. Review the watchlist and ETA leaderboard for today.';
    });
  }

  void _openOverviewDeviceHealth() {
    if (!mounted) {
      return;
    }
    setState(() {
      _tabIndex = 3;
      _overviewStatus =
          'Reinforced monitoring -> Device tab. Review token health, gateway status, and recent push attempts.';
    });
  }

  Future<void> _applyServerBaseUrl() async {
    final raw = _serverBaseUrlController.text.trim();
    if (raw.isEmpty) {
      if (!mounted) {
        return;
      }
      setState(() {
        _serverConnectionStatus = 'Enter a server URL before applying it.';
      });
      return;
    }

    setState(() {
      _applyingServerBaseUrl = true;
      _serverConnectionStatus = 'Applying and checking $raw ...';
    });

    await widget.apiClient.updateBaseUrlAndPersist(raw);

    if (!mounted) {
      return;
    }

    await _loadAll();

    if (!mounted) {
      return;
    }

    setState(() {
      _applyingServerBaseUrl = false;
      _serverConnectionStatus = _error.isEmpty
          ? 'Connected to ${widget.apiClient.baseUrl}.'
          : 'Connection check failed for ${widget.apiClient.baseUrl}: $_error';
    });
  }

  Future<void> _runServerHealthCheck() async {
    setState(() {
      _checkingServerHealth = true;
      _serverConnectionStatus =
          'Running server health check for ${widget.apiClient.baseUrl} ...';
      _realDeviceFlowStatus = '';
    });

    try {
      final payload = await widget.apiClient.fetchMobileHealth();
      if (!mounted) {
        return;
      }

      setState(() {
        _mobileHealth = payload;
        _serverConnectionStatus =
            'BusWakeUp server reachable at ${widget.apiClient.baseUrl}. Mobile launch focus: ${_readList(payload['launchFocus']).join(', ')}.';
        _realDeviceFlowStatus = '';
      });
      await _syncRealDeviceCheckpointFromState();
    } on MobileApiException catch (error) {
      if (error.statusCode == 401) {
        await widget.onSessionExpired();
        return;
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _serverConnectionStatus = error.message;
      });
    } finally {
      if (mounted) {
        setState(() {
          _checkingServerHealth = false;
        });
      }
    }
  }

  Future<void> _runServerVerdictPrimaryAction(
    Map<String, dynamic> verdict,
  ) async {
    final action = _readString(verdict, 'primaryAction', fallback: '');
    if (action.isEmpty || action == '-') {
      return;
    }

    if (action == 'run-health-check') {
      await _runServerHealthCheck();
      return;
    }
    if (action == 'refresh-device-health') {
      await _refreshDeviceTab();
      return;
    }
    if (action == 'run-test-push') {
      await _runManualTestPush();
      return;
    }
    if (action == 'show-lan-checklist') {
      if (!mounted) {
        return;
      }
      setState(() {
        _serverConnectionStatus =
            'LAN checklist: 1) Find your server PC LAN IP. 2) Replace localhost with that IP. 3) Keep phone and PC on the same Wi-Fi. 4) Run server health check again.';
      });
    }
  }

  Future<void> _runRealDeviceFlowPrimaryAction(
    Map<String, dynamic> flow,
  ) async {
    final action = _readString(flow, 'primaryAction', fallback: '');
    if (action.isEmpty || action == '-') {
      return;
    }

    if (action == 'register-token') {
      await _registerCurrentToken();
      return;
    }
    if (action == 'refresh-device-health') {
      await _refreshDeviceTab();
      return;
    }
    if (action == 'run-health-check') {
      await _runServerHealthCheck();
      return;
    }
    if (action == 'run-test-push') {
      await _runManualTestPush();
      return;
    }
  }

  Future<void> _resetRealDeviceFlowCheckpoint() async {
    final baseline = _buildRealDeviceCheckpointCandidate(
      flow: _buildCurrentRealDeviceFlow(),
      deviceProfile: _map(_deviceProfile?['profile']),
      mobileHealth: _map(_mobileHealth),
      latestAttempt: _currentLatestPushAttempt(),
    );

    await _clientSettingsStore.clearRealDeviceFlowCheckpoint();
    if (baseline == null) {
      await _clientSettingsStore.clearRealDeviceFlowResetBaseline();
    } else {
      await _clientSettingsStore.saveRealDeviceFlowResetBaseline(baseline);
    }

    if (!mounted) {
      return;
    }
    setState(() {
      _realDeviceFlowCheckpoint = null;
      _realDeviceFlowResetBaseline = baseline;
      _realDeviceFlowStatus =
          'Saved real-device flow progress was cleared. Live token, permission, and gateway state were not changed.';
    });
  }

  Map<String, dynamic> _buildCurrentRealDeviceFlow() {
    return _buildRealDeviceTestFlow(
      tokenHealth: _deviceTokenHealth ?? _map(_deviceProfile?['tokenHealth']),
      launchReadiness: _buildPushLaunchReadiness(
        tokenHealth: _deviceTokenHealth ?? _map(_deviceProfile?['tokenHealth']),
        fcmAuthStatus: _fcmAuthStatus,
        selectedAdapter: _map(
          _map(_pushGatewayConfig?['adapters'])[
              _readString(_deviceTokenHealth, 'adapter', fallback: 'fcm')],
        ),
        pushPreview: _map(_pushPreview?['preview']),
        latestAttempt: _currentLatestPushAttempt(),
      ),
      launchBlockers: _buildLaunchBlockers(
        tokenHealth: _deviceTokenHealth ?? _map(_deviceProfile?['tokenHealth']),
        fcmAuthStatus: _fcmAuthStatus,
        selectedAdapter: _map(
          _map(_pushGatewayConfig?['adapters'])[
              _readString(_deviceTokenHealth, 'adapter', fallback: 'fcm')],
        ),
      ),
      mobileHealth: _mobileHealth,
      latestAttempt: _currentLatestPushAttempt(),
    );
  }

  Map<String, dynamic> _currentLatestPushAttempt() {
    final attempts = _mapList(_pushGatewayAttempts?['attempts']);
    return _map(attempts.isNotEmpty ? attempts.first : null);
  }

  Future<void> _syncRealDeviceCheckpointFromState() async {
    final realDeviceFlow = _buildCurrentRealDeviceFlow();
    final candidate = _buildRealDeviceCheckpointCandidate(
      flow: realDeviceFlow,
      deviceProfile: _map(_deviceProfile?['profile']),
      mobileHealth: _map(_mobileHealth),
      latestAttempt: _currentLatestPushAttempt(),
    );

    if (candidate == null || _matchesRealDeviceResetBaseline(candidate)) {
      return;
    }

    await _storeRealDeviceCheckpoint(
      stepNumber: candidate['stepNumber'] is num
          ? (candidate['stepNumber'] as num).toInt()
          : 0,
      stepLabel: _readString(candidate, 'stepLabel', fallback: '-'),
      status: _readString(candidate, 'status', fallback: '-'),
      detail: _readString(candidate, 'detail', fallback: '-'),
      evidenceKey: _readString(candidate, 'evidenceKey', fallback: ''),
    );
  }

  Map<String, dynamic>? _buildRealDeviceCheckpointCandidate({
    required Map<String, dynamic> flow,
    required Map<String, dynamic> deviceProfile,
    required Map<String, dynamic> mobileHealth,
    required Map<String, dynamic> latestAttempt,
  }) {
    final currentStep = _readString(flow, 'currentStep', fallback: '');
    final step2Status = _readString(flow, 'step2', fallback: '');
    final deviceUpdatedAt = _readString(
      deviceProfile,
      'updatedAt',
      fallback: _readString(deviceProfile, 'registeredAt', fallback: ''),
    );
    final healthEvidence =
        _readString(mobileHealth, 'serverTime', fallback: '');

    if (currentStep == 'Step 2 - Check permissions' &&
        _readString(flow, 'step1', fallback: '') == 'DONE') {
      return <String, dynamic>{
        'stepNumber': 1,
        'stepLabel': 'Step 1 - Register token',
        'status': 'DONE',
        'detail': 'Token registration is already complete on this device.',
        'evidenceKey': deviceUpdatedAt,
      };
    }

    if (currentStep == 'Step 3 - Confirm readiness' &&
        _isRealDeviceFlowStep2Complete(step2Status)) {
      return <String, dynamic>{
        'stepNumber': 2,
        'stepLabel': 'Step 2 - Check permissions',
        'status': step2Status,
        'detail': step2Status == 'DONE WITH WARNINGS'
            ? 'Hard blockers are cleared. Warning items are still visible in the blocker card.'
            : 'Hard blockers are cleared on this device profile.',
        'evidenceKey': deviceUpdatedAt,
      };
    }

    if (currentStep == 'Step 4 - Run test push' &&
        _readString(flow, 'step3', fallback: '') == 'DONE') {
      final step4Status = _readString(flow, 'step4', fallback: '');
      if (_isSuccessfulRealDevicePushStatus(step4Status)) {
        return <String, dynamic>{
          'stepNumber': 4,
          'stepLabel': 'Step 4 - Run test push',
          'status': step4Status,
          'detail': 'A recent device push test already completed.',
          'evidenceKey': _readString(latestAttempt, 'createdAt', fallback: ''),
        };
      }

      return <String, dynamic>{
        'stepNumber': 3,
        'stepLabel': 'Step 3 - Confirm readiness',
        'status': 'DONE',
        'detail': 'Server and push readiness checks reached test-ready state.',
        'evidenceKey': healthEvidence,
      };
    }

    return null;
  }

  bool _matchesRealDeviceResetBaseline(Map<String, dynamic> candidate) {
    final baseline = _realDeviceFlowResetBaseline;
    if (baseline == null || baseline.isEmpty) {
      return false;
    }

    final baselineStep = baseline['stepNumber'] is num
        ? (baseline['stepNumber'] as num).toInt()
        : 0;
    final candidateStep = candidate['stepNumber'] is num
        ? (candidate['stepNumber'] as num).toInt()
        : 0;

    return baselineStep == candidateStep &&
        _readString(baseline, 'stepLabel', fallback: '') ==
            _readString(candidate, 'stepLabel', fallback: '') &&
        _readString(baseline, 'status', fallback: '') ==
            _readString(candidate, 'status', fallback: '') &&
        _readString(baseline, 'detail', fallback: '') ==
            _readString(candidate, 'detail', fallback: '') &&
        _readString(baseline, 'evidenceKey', fallback: '') ==
            _readString(candidate, 'evidenceKey', fallback: '');
  }

  Future<void> _storeRealDeviceCheckpoint({
    required int stepNumber,
    required String stepLabel,
    required String status,
    required String detail,
    String evidenceKey = '',
  }) async {
    final existingMap = _realDeviceFlowCheckpoint ?? <String, dynamic>{};
    final existingStep = existingMap['stepNumber'] is num
        ? (existingMap['stepNumber'] as num).toInt()
        : 0;

    if (existingStep > stepNumber) {
      return;
    }

    if (existingStep == stepNumber &&
        _readString(existingMap, 'status', fallback: '') == status &&
        _readString(existingMap, 'detail', fallback: '') == detail &&
        _readString(existingMap, 'evidenceKey', fallback: '') == evidenceKey) {
      return;
    }

    final checkpoint = <String, dynamic>{
      'stepNumber': stepNumber,
      'stepLabel': stepLabel,
      'status': status,
      'detail': detail,
      if (evidenceKey.isNotEmpty) 'evidenceKey': evidenceKey,
      'recordedAt': DateTime.now().toIso8601String(),
    };
    await _clientSettingsStore.saveRealDeviceFlowCheckpoint(checkpoint);
    await _clientSettingsStore.clearRealDeviceFlowResetBaseline();
    if (!mounted) {
      return;
    }
    setState(() {
      _realDeviceFlowCheckpoint = checkpoint;
      _realDeviceFlowResetBaseline = null;
    });
  }

  Future<void> _searchAddress(String role) async {
    final query = role == 'home'
        ? _homeAddressController.text.trim()
        : _workAddressController.text.trim();
    if (query.isEmpty) {
      setState(() {
        if (role == 'home') {
          _homeSearchStatus = 'Enter an address before searching.';
          _homeAddressResults = <Map<String, dynamic>>[];
        } else {
          _workSearchStatus = 'Enter an address before searching.';
          _workAddressResults = <Map<String, dynamic>>[];
        }
      });
      return;
    }

    setState(() {
      if (role == 'home') {
        _searchingHomeAddress = true;
        _homeSearchStatus = '';
      } else {
        _searchingWorkAddress = true;
        _workSearchStatus = '';
      }
    });

    try {
      final payload = await widget.apiClient.searchPlaces(query: query);
      final results = _mapList(payload['results']);

      if (!mounted) {
        return;
      }

      setState(() {
        if (role == 'home') {
          _homeAddressResults = results;
          _homeSearchStatus = results.isEmpty
              ? 'No address matches came back.'
              : 'Loaded ${results.length} address matches.';
        } else {
          _workAddressResults = results;
          _workSearchStatus = results.isEmpty
              ? 'No address matches came back.'
              : 'Loaded ${results.length} address matches.';
        }
      });
    } on MobileApiException catch (error) {
      if (error.statusCode == 401) {
        await widget.onSessionExpired();
        return;
      }
      if (!mounted) {
        return;
      }
      setState(() {
        if (role == 'home') {
          _homeSearchStatus = error.message;
        } else {
          _workSearchStatus = error.message;
        }
      });
    } finally {
      if (mounted) {
        setState(() {
          if (role == 'home') {
            _searchingHomeAddress = false;
          } else {
            _searchingWorkAddress = false;
          }
        });
      }
    }
  }

  void _selectAddressResult(String role, Map<String, dynamic> result) {
    final label = _readString(result, 'label', fallback: '');
    final location = _coordinateMap(result);
    setState(() {
      if (role == 'home') {
        _homeAddressController.text = label;
        _homeLocation = location;
        _homeSearchStatus = 'Home address selected.';
      } else {
        _workAddressController.text = label;
        _workLocation = location;
        _workSearchStatus = 'Work address selected.';
      }
    });
  }

  Future<void> _searchStations() async {
    final provider = _activeProvider;
    final keyword = _stationKeywordController.text.trim();

    if (!_supportsLiveStationSearch(provider)) {
      setState(() {
        _stationSearchStatus =
            'Station search is ready for Seoul and Gyeonggi launch sources. TAGO still uses manual IDs here.';
        _stationResults = <Map<String, dynamic>>[];
      });
      return;
    }

    if (keyword.isEmpty) {
      setState(() {
        _stationSearchStatus = 'Enter a stop name before searching stations.';
        _stationResults = <Map<String, dynamic>>[];
      });
      return;
    }

    setState(() {
      _searchingStations = true;
      _stationSearchStatus = '';
      _routeSearchStatus = '';
      _routeResults = <Map<String, dynamic>>[];
    });

    try {
      final payload = await widget.apiClient.searchStations(
        provider: provider,
        keyword: keyword,
      );
      final results = _mapList(payload['stations']);

      if (!mounted) {
        return;
      }

      setState(() {
        _stationResults = results;
        _stationSearchStatus = results.isEmpty
            ? 'No live stations matched that keyword.'
            : 'Loaded ${results.length} station candidates.';
      });
    } on MobileApiException catch (error) {
      if (error.statusCode == 401) {
        await widget.onSessionExpired();
        return;
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _stationSearchStatus = error.message;
        _stationResults = <Map<String, dynamic>>[];
      });
    } finally {
      if (mounted) {
        setState(() {
          _searchingStations = false;
        });
      }
    }
  }

  void _selectStation(Map<String, dynamic> station) {
    final stationName = _readString(station, 'stationName', fallback: '');
    final stationId = _readString(station, 'stationId', fallback: '');
    final arsId = _readString(
      station,
      'arsId',
      fallback: _readString(station, 'stationNumber', fallback: ''),
    );
    final stopLocation = _coordinateMap(<String, dynamic>{
      'lat': station['posY'] ?? station['lat'],
      'lng': station['posX'] ?? station['lng'],
    });

    setState(() {
      _stationNameController.text = stationName;
      _stationKeywordController.text = stationName;
      _stationIdController.text = stationId;
      _arsIdController.text = arsId;
      _stopIdController.text = stationId;
      _selectedStopLocation = stopLocation;
      _stationSearchStatus = stopLocation == null
          ? 'Station selected. This source did not expose stop coordinates yet.'
          : 'Station selected with stop coordinates.';
      _routeSearchStatus = 'Load route candidates for this station next.';
      _routeResults = <Map<String, dynamic>>[];
    });
  }

  Future<void> _loadRouteCandidates() async {
    final provider = _activeProvider;
    final stationId = _stationIdController.text.trim();
    final arsId = _arsIdController.text.trim();

    if (!_supportsLiveStationRouteSearch(provider)) {
      setState(() {
        _routeSearchStatus =
            'Route lookup is ready for Seoul and Gyeonggi launch sources. TAGO still needs manual route IDs here.';
        _routeResults = <Map<String, dynamic>>[];
      });
      return;
    }

    if (stationId.isEmpty && arsId.isEmpty) {
      setState(() {
        _routeSearchStatus =
            'Choose a station first so the app knows which live stop to inspect.';
        _routeResults = <Map<String, dynamic>>[];
      });
      return;
    }

    setState(() {
      _searchingRoutes = true;
      _routeSearchStatus = '';
    });

    try {
      final payload = await widget.apiClient.searchStationRoutes(
        provider: provider,
        stationId: stationId,
        arsId: arsId,
        routeNumber: _routeNumberController.text.trim(),
      );
      final results = _mapList(payload['routes']);

      if (!mounted) {
        return;
      }

      setState(() {
        _routeResults = results;
        _routeSearchStatus = results.isEmpty
            ? 'No official routes matched this station filter.'
            : 'Loaded ${results.length} route candidates.';
      });
    } on MobileApiException catch (error) {
      if (error.statusCode == 401) {
        await widget.onSessionExpired();
        return;
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _routeSearchStatus = error.message;
        _routeResults = <Map<String, dynamic>>[];
      });
    } finally {
      if (mounted) {
        setState(() {
          _searchingRoutes = false;
        });
      }
    }
  }

  void _selectRouteCandidate(Map<String, dynamic> route) {
    final routeId = _readString(route, 'routeId', fallback: '');
    final routeNumber = _readString(
      route,
      'routeNumber',
      fallback: _readString(route, 'routeName', fallback: ''),
    );
    final order = _readString(route, 'order', fallback: '');
    final stationId = _readString(route, 'stationId', fallback: '');
    final stationName = _readString(
      route,
      'stationName',
      fallback: _stationNameController.text.trim(),
    );

    setState(() {
      _routeIdController.text = routeId;
      _routeNumberController.text = routeNumber;
      _primaryLineController.text = routeNumber;
      _lineIdsController.text = routeNumber;
      _orderController.text = order;
      if (stationId.isNotEmpty) {
        _stationIdController.text = stationId;
      }
      if (stationName.isNotEmpty) {
        _stationNameController.text = stationName;
      }
      _routeSearchStatus = 'Route candidate selected and wired into setup.';
    });
  }

  Map<String, dynamic> _transitQuery() {
    return <String, dynamic>{
      'workLocation': _workLocation,
      'stopLocation': _selectedStopLocation,
      'stationName': _stationNameController.text.trim(),
      'routeNumber': _routeNumberController.text.trim(),
      'provider': _activeProvider,
      'stationId': _stationIdController.text.trim().isEmpty
          ? _nodeIdController.text.trim() : _stationIdController.text.trim(),
      'routeId': _routeIdController.text.trim(),
      'order': _orderController.text.trim(),
      'cityCode': _cityCodeController.text.trim(),
      'nodeId': _nodeIdController.text.trim(),
      'arsId': _arsIdController.text.trim(),
    };
  }

  Future<void> _estimateCommute() async {
    if (_workLocation == null || _selectedStopLocation == null) {
      setState(() {
        _commuteEstimateStatus = '탑승 정류장과 목적지를 선택해 주세요. 집 좌표는 필요하지 않습니다.';
      });
      return;
    }
    final query = _transitQuery();
    final querySnapshot = jsonEncode(query);
    setState(() {
      _estimatingCommute = true;
      _commuteEstimateStatus = '';
    });
    try {
      final payload = await widget.apiClient.estimateCommute(query);
      if (!mounted || jsonEncode(_transitQuery()) != querySnapshot) return;
      setState(() {
        _commuteEstimate = payload;
        _transitQuerySnapshot = querySnapshot;
        _commuteEstimateStatus = '경로의 탑승 지점과 방향을 확인한 뒤 선택하고 설정을 저장해 주세요.';
      });
    } on MobileApiException catch (error) {
      if (error.statusCode == 401) {
        await widget.onSessionExpired();
        return;
      }
      if (mounted) setState(() { _commuteEstimateStatus = error.message; });
    } finally {
      if (mounted) setState(() { _estimatingCommute = false; });
    }
  }

  Widget _buildTransitChoices() {
    final choices = _transitQuerySnapshot == jsonEncode(_transitQuery())
        ? _mapList(_commuteEstimate?['routes']) : <Map<String, dynamic>>[];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const Text('집 → 탑승 지점의 이동시간은 제외합니다. 경로 시간은 예상치이며 실제 환승 대기·운행 지연은 달라질 수 있습니다.'),
        for (final choice in choices)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(_readString(choice, 'guidance', fallback: '대중교통 경로')),
            subtitle: Text(
              '${choice['boardingStation']} → ${choice['nextStation']} · 탑승 후 약 ${((choice['onboardDurationSec'] as num) / 60).ceil()}분\n'
              '${choice['compatible'] == true ? choice['warning'] : choice['unavailableReason']}',
            ),
            trailing: TextButton(
              onPressed: choice['compatible'] != true ? null : () {
                if (_transitQuerySnapshot != jsonEncode(_transitQuery())) return;
                setState(() {
                  _route = <String, dynamic>{..._map(_route),
                    'transitJourney': <String, dynamic>{...choice, 'boardingConfirmed': true}};
                  _commuteEstimateStatus = '이 탑승 지점·방향의 경로를 선택했습니다. 아래 설정 저장을 눌러 주세요.';
                });
              },
              child: const Text('방향 확인·선택'),
            ),
          ),
      ],
    );
  }

  Future<void> _saveSetup() async {
    setState(() {
      _savingSetup = true;
      _setupStatus = '';
    });

    try {
      await Future.wait<Map<String, dynamic>>(<Future<Map<String, dynamic>>>[
        widget.apiClient.saveProfile(<String, dynamic>{
          'name': _nameController.text.trim(),
          'homeAddress': _homeAddressController.text.trim(),
          'workAddress': _workAddressController.text.trim(),
          'requiredArrivalTime': _arrivalTimeController.text.trim(),
          'homeLocation': _homeLocation,
          'workLocation': _workLocation,
        }),
        widget.apiClient.saveRoute(<String, dynamic>{
          'stopLocation': _selectedStopLocation,
          'transitJourney': _route?['transitJourney'],
          'selectedStopId': _stopIdController.text.trim(),
          'selectedLineIds': _splitCsv(_lineIdsController.text),
          'primaryLineId': _primaryLineController.text.trim(),
          'busRideMin': int.tryParse(_busRideMinController.text.trim()) ?? 0,
          'homeToStopWalkMin': int.tryParse(
                _readString(
                    _map(_commuteEstimate?['homeToStop']), 'walkMinutes',
                    fallback: ''),
              ) ??
              int.tryParse(
                  _readString(_route, 'homeToStopWalkMin', fallback: '0')) ??
              0,
          'alightToWorkWalkMin':
              int.tryParse(_alightWalkMinController.text.trim()) ?? 0,
          'liveBinding': <String, dynamic>{
            'provider': _activeProvider,
            'stationId': _stationIdController.text.trim(),
            'stationName': _stationNameController.text.trim(),
            'arsId': _arsIdController.text.trim(),
            'routeId': _routeIdController.text.trim(),
            'routeNumber': _routeNumberController.text.trim(),
            'order': _orderController.text.trim(),
            'cityCode': _cityCodeController.text.trim(),
            'nodeId': _nodeIdController.text.trim(),
          },
        }),
        widget.apiClient.saveSchedule(<String, dynamic>{
          'startTime': _scheduleStartController.text.trim(),
          'endTime': _scheduleEndController.text.trim(),
          'repeatIntervalMin':
              int.tryParse(_scheduleIntervalController.text.trim()) ?? 3,
          'repeatPreset': _repeatPresetController.text.trim(),
          'skipHolidays': _skipHolidays,
        }),
        widget.apiClient.saveNotificationSettings(<String, dynamic>{
          'soundPresetId': _soundPresetController.text.trim(),
          'ttsVoiceId': _ttsVoiceController.text.trim(),
          'escalationEnabled': _escalationEnabled,
          'dndBypass': _dndBypass,
        }),
      ]);

      if (!mounted) {
        return;
      }

      LocalAlarmScheduleResult? localAlarmResult;
      if (_deviceLocalBackupEnabled) {
        localAlarmResult = await _localAlarmScheduler.scheduleNextDailyBackup(
          time: _scheduleStartController.text.trim(),
          schedule: {
            ..._map(_schedule),
            'repeatPreset': _repeatPresetController.text.trim(),
            'skipHolidays': _skipHolidays,
          },
          fullScreenRequested: _deviceFullScreenEnabled,
          dndBypassRequested: _deviceDndOverrideGranted,
          routeNumber: _routeNumberController.text.trim().isEmpty
              ? _primaryLineController.text.trim()
              : _routeNumberController.text.trim(),
        );
      } else {
        await _localAlarmScheduler.cancelLocalBackup();
      }

      setState(() {
        _setupStatus =
            'Saved setup, coordinates, and live binding to the server.${localAlarmResult == null ? ' Local backup is disabled.' : ' ${localAlarmResult.message}'}';
      });
      await _loadAll();
    } on MobileApiException catch (error) {
      if (error.statusCode == 401) {
        await widget.onSessionExpired();
        return;
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _setupStatus = error.message;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _setupStatus = error.toString();
      });
    } finally {
      if (mounted) {
        setState(() {
          _savingSetup = false;
        });
      }
    }
  }

  Future<void> _requestAndroidAlarmPermissions() async {
    setState(() {
      _requestingAndroidAlarmPermissions = true;
      _localAlarmStatus = '';
    });
    try {
      final message = await _localAlarmScheduler.requestAndroidAlarmPermissions();
      if (!mounted) {
        return;
      }
      setState(() {
        _localAlarmStatus = message;
      });
    } finally {
      if (mounted) {
        setState(() {
          _requestingAndroidAlarmPermissions = false;
        });
      }
    }
  }

  Future<void> _scheduleLocalBackupAlarm() async {
    setState(() {
      _schedulingLocalBackup = true;
      _localAlarmStatus = '';
    });
    try {
      final result = await _localAlarmScheduler.scheduleNextDailyBackup(
        time: _scheduleStartController.text.trim(),
        schedule: {
          ..._map(_schedule),
          'repeatPreset': _repeatPresetController.text.trim(),
          'skipHolidays': _skipHolidays,
        },
        fullScreenRequested: _deviceFullScreenEnabled,
        dndBypassRequested: _deviceDndOverrideGranted,
        routeNumber: _routeNumberController.text.trim().isEmpty
            ? _primaryLineController.text.trim()
            : _routeNumberController.text.trim(),
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _localAlarmStatus = result.message;
      });
    } finally {
      if (mounted) {
        setState(() {
          _schedulingLocalBackup = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('BusWakeUp Ops'),
        actions: <Widget>[
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _loadAll,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Logout',
            onPressed: widget.onLoggedOut,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error.isNotEmpty
              ? _ErrorState(message: _error, onRetry: _loadAll)
              : RefreshIndicator(
                  onRefresh: _loadAll,
                  child: IndexedStack(
                    index: _tabIndex,
                    children: <Widget>[
                      _buildOverviewTab(),
                      _buildSetupTab(),
                      _buildAccuracyTab(),
                      _buildDeviceTab(),
                    ],
                  ),
                ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tabIndex,
        onDestinationSelected: (index) {
          setState(() {
            _tabIndex = index;
          });
        },
        destinations: const <NavigationDestination>[
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Overview',
          ),
          NavigationDestination(
            icon: Icon(Icons.edit_outlined),
            selectedIcon: Icon(Icons.edit),
            label: 'Setup',
          ),
          NavigationDestination(
            icon: Icon(Icons.track_changes_outlined),
            selectedIcon: Icon(Icons.track_changes),
            label: 'Accuracy',
          ),
          NavigationDestination(
            icon: Icon(Icons.notifications_outlined),
            selectedIcon: Icon(Icons.notifications),
            label: 'Device',
          ),
        ],
      ),
    );
  }

  Future<void> _setTodayAlarmsPaused(bool paused) async {
    setState(() => _changingTodayAlarm = true);
    try {
      if (paused) {
        await widget.apiClient.performAlarmAction('ACK_DEPARTED');
        await _nativeAlarmPreviewService.stop();
        await _localAlarmScheduler.cancelLocalBackup();
      } else {
        await widget.apiClient.saveSchedule(<String, dynamic>{'snoozeDate': null});
      }
      await _loadAll();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(paused ? '오늘 남은 알람을 종료했습니다. 다음 예정일의 알람은 유지됩니다.' : '오늘 알람을 다시 켰습니다.'),
      ));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('알람 설정을 변경하지 못했습니다. 연결 상태를 확인해 주세요: $error'),
      ));
    } finally {
      if (mounted) setState(() => _changingTodayAlarm = false);
    }
  }

  Widget _buildOverviewTab() {
    final account = _map(_account);
    final runtime = _map(_alarmRuntime?['runtime']);
    final plan = _map(_alarmRuntime?['plan']);
    final session = _map(widget.sessionPayload['session']);
    final deliveryIntensity = _map(_alarmRuntime?['deliveryIntensity']);
    final topAlert = _map(deliveryIntensity['topAlert']);
    final topAlertSignal = _map(topAlert['topSignal']);
    final topAttention = _map(deliveryIntensity['topAttentionAlert']);
    final topIssue = _map(deliveryIntensity['topAttentionCause']);
    final conservativeReliability =
        _map(_alarmRuntime?['conservativeReliability']);
    final watchlist = _mapList(conservativeReliability['watchlist']);
    final stabilityWatch = _map(plan['stabilityWatch']);
    final nextTrigger = _map(plan['nextTrigger']);
    final watchLevel = _readString(stabilityWatch, 'level', fallback: 'none');
    final precheckTriggerCount =
        _readString(plan, 'precheckTriggerCount', fallback: '0');
    final remainingPrecheckTriggers =
        _readString(plan, 'remainingPrecheckTriggers', fallback: '0');
    final nextTriggerKind =
        _readString(nextTrigger, 'triggerKind', fallback: '-');
    final nextPriorityClass =
        _readString(nextTrigger, 'deliveryPriorityClass', fallback: 'normal');
    final topAttentionTarget = _map(topAttention['attentionTarget']);
    final topAttentionQuickAction = _map(topAttention['attentionQuickAction']);
    final topIssueTarget = _map(topIssue['attentionTarget']);
    final topIssueQuickAction = _map(topIssue['attentionQuickAction']);
    final koreaNow = DateTime.now().toUtc().add(const Duration(hours: 9));
    final todayKey = '${koreaNow.year}-${koreaNow.month.toString().padLeft(2, '0')}-${koreaNow.day.toString().padLeft(2, '0')}';
    final todayPaused = _schedule?['snoozeDate'] == todayKey;

    return ListView(
      padding: const EdgeInsets.all(20),
      children: <Widget>[
        const _SectionTitle(
          title: 'Launch overview',
          subtitle:
              'First mobile operations view for the Seoul and Gyeonggi iPhone and Android launch.',
        ),
        const SizedBox(height: 16),
        FilledButton.icon(
          onPressed: _changingTodayAlarm ? null : () => _setTodayAlarmsPaused(!todayPaused),
          icon: Icon(todayPaused ? Icons.notifications_active : Icons.check_circle),
          label: Text(todayPaused ? '오늘 알람 다시 켜기' : '출발했어요 - 오늘 알람 종료'),
        ),
        const Text('오늘만 쉬고 싶을 때도 알람 종료를 누르세요. 다른 날짜의 반복 설정은 유지됩니다.'),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Reinforced watch today',
          rows: <_InfoRow>[
            _InfoRow(
              'Mode',
              _describeMonitoringMode(
                watchLevel: watchLevel,
                nextPriorityClass: nextPriorityClass,
              ),
            ),
            _InfoRow(
              'Current route',
              '${_readString(account['workspace'], 'primaryRouteNumber', fallback: '-')} - ${_readString(plan['stop'], 'name', fallback: _readString(plan['stop'], 'stopName', fallback: '-'))}',
            ),
            _InfoRow('Watch level', watchLevel.toUpperCase()),
            _InfoRow('Precheck scheduled', precheckTriggerCount),
            _InfoRow('Precheck remaining', remainingPrecheckTriggers),
            _InfoRow(
              'Next trigger',
              '${_readString(nextTrigger, 'triggerLabel', fallback: nextTriggerKind)} @ ${_formatIso(_readString(nextTrigger, 'triggerAt', fallback: ''))}',
            ),
            _InfoRow('Delivery priority', nextPriorityClass.toUpperCase()),
            _InfoRow(
              'Strongest alert',
              '${_readString(topAlert, 'routeNumber', fallback: '-')} - ${_readString(topAlert, 'stopName', fallback: '-')}',
            ),
            _InfoRow(
              'Playback plan',
              _formatPlaybackPlan(topAlertSignal),
            ),
            _InfoRow(
              'Strongest outcome',
              _formatStrongestAlertOutcome(
                topAlert,
                topAlertSignal,
              ),
            ),
            _InfoRow(
              'Immediate issue',
              _readString(topAttention, 'deliveryOutcomeLabel', fallback: '-'),
            ),
            _InfoRow(
              'Immediate action',
              _readString(
                topAttention,
                'attentionActionLabel',
                fallback: '-',
              ),
            ),
            _InfoRow(
              'Immediate status',
              _readNestedLabel(topAttention['attentionStatus']),
            ),
          ],
          footer: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: <Widget>[
                  ElevatedButton(
                    onPressed: _openOverviewAccuracyWatchlist,
                    child: const Text('Open accuracy watchlist'),
                  ),
                  OutlinedButton(
                    onPressed: _openOverviewDeviceHealth,
                    child: const Text('Open device push health'),
                  ),
                ],
              ),
              if (topAttentionTarget.isNotEmpty ||
                  topAttentionQuickAction.isNotEmpty) ...<Widget>[
                const SizedBox(height: 12),
                _buildOverviewActionFooter(
                  sourceLabel: 'Reinforced watch',
                  target: topAttentionTarget,
                  quickAction: topAttentionQuickAction,
                )!,
              ],
            ],
          ),
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Account',
          rows: <_InfoRow>[
            _InfoRow('User', _readString(account['user'], 'name')),
            _InfoRow('Email', _readString(account['user'], 'email')),
            _InfoRow(
              'Session expires',
              _formatIso(_readString(session, 'expiresAt', fallback: '')),
            ),
            _InfoRow(
              'Primary route',
              _readString(
                account['workspace'],
                'primaryRouteNumber',
                fallback: '-',
              ),
            ),
            _InfoRow(
                'Retry pending',
                _readString(account['workspace'], 'retryPending',
                    fallback: '0')),
          ],
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Today\'s alarm runtime',
          rows: <_InfoRow>[
            _InfoRow('Status', _readString(runtime, 'status')),
            _InfoRow(
                'Next trigger',
                _formatIso(
                    _readString(runtime, 'nextTriggerAt', fallback: ''))),
            _InfoRow('Plan status', _readString(plan, 'todayStatus')),
            _InfoRow('Remaining triggers',
                _readString(plan, 'remainingTriggers', fallback: '0')),
          ],
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Instability watch',
          rows: <_InfoRow>[
            _InfoRow('Watch level', watchLevel.toUpperCase()),
            _InfoRow(
              'Route traces',
              _readString(stabilityWatch, 'routeTraceCount', fallback: '0'),
            ),
            _InfoRow(
              'Weekday traces',
              _readString(stabilityWatch, 'weekdayTraceCount', fallback: '0'),
            ),
            _InfoRow(
              'Precheck lead',
              '${_readString(stabilityWatch, 'precheckLeadMin', fallback: '0')} min',
            ),
            _InfoRow(
                'Precheck trigger',
                _formatIso(_readString(stabilityWatch, 'precheckTriggerAt',
                    fallback: ''))),
            _InfoRow(
              'Top watch pair',
              watchlist.isNotEmpty
                  ? '${_readString(watchlist.first, 'routeNumber', fallback: 'Route')} - ${_readString(watchlist.first, 'stopName', fallback: 'Stop')}'
                  : '-',
            ),
            _InfoRow(
              'Top watch severity',
              watchlist.isNotEmpty
                  ? _readString(watchlist.first, 'severityLabel', fallback: '-')
                  : '-',
            ),
          ],
          footer: ElevatedButton(
            onPressed: _openOverviewAccuracyWatchlist,
            child: const Text('Open accuracy watchlist'),
          ),
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Strongest alert',
          rows: <_InfoRow>[
            _InfoRow(
                'Route', _readString(topAlert, 'routeNumber', fallback: '-')),
            _InfoRow('Stop', _readString(topAlert, 'stopName', fallback: '-')),
            _InfoRow(
              'Outcome',
              _readString(topAlert, 'deliveryOutcomeLabel', fallback: '-'),
            ),
            _InfoRow(
              'Intensity',
              _readString(topAlert, 'maxScore', fallback: '0'),
            ),
            _InfoRow('Playback plan', _formatPlaybackPlan(topAlertSignal)),
            _InfoRow('Delivery path',
                _formatStrongestAlertOutcome(topAlert, topAlertSignal)),
            _InfoRow('Recorded from',
                _readString(topAlertSignal, 'sourceLabel', fallback: '-')),
          ],
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Top attention',
          rows: <_InfoRow>[
            _InfoRow(
              'Route',
              '${_readString(topAttention, 'routeNumber', fallback: '-')} - ${_readString(topAttention, 'stopName', fallback: '-')}',
            ),
            _InfoRow(
                'Outcome',
                _readString(topAttention, 'deliveryOutcomeLabel',
                    fallback: '-')),
            _InfoRow('Cause', _readNestedLabel(topAttention['attentionCause'])),
            _InfoRow(
                'Action',
                _readString(topAttention, 'attentionActionLabel',
                    fallback: '-')),
            _InfoRow(
                'Status', _readNestedLabel(topAttention['attentionStatus'])),
            _InfoRow(
                'Playbook',
                _readString(topAttention, 'attentionActionCopy',
                    fallback: '-')),
          ],
          footer: _buildOverviewActionFooter(
            sourceLabel: 'Top attention',
            target: topAttentionTarget,
            quickAction: topAttentionQuickAction,
          ),
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Top issue',
          rows: <_InfoRow>[
            _InfoRow('Issue', _readString(topIssue, 'label', fallback: '-')),
            _InfoRow('Spread', _readNestedLabel(topIssue['spreadSummary'])),
            _InfoRow(
              'Commute pairs',
              _readString(topIssue, 'routeStopCount', fallback: '0'),
            ),
            _InfoRow(
              'Most severe outcome',
              _readString(topIssue, 'highestOutcomeLabel', fallback: '-'),
            ),
            _InfoRow(
              'Top routes',
              _formatTopRouteStops(topIssue['topRouteStops']),
            ),
            _InfoRow('Outcome mix', _formatOutcomeMix(topIssue['outcomeMix'])),
            _InfoRow('Playbook',
                _readString(topIssue, 'attentionActionCopy', fallback: '-')),
          ],
          footer: _buildOverviewActionFooter(
            sourceLabel: 'Top issue',
            target: topIssueTarget,
            quickAction: topIssueQuickAction,
          ),
        ),
        if (_overviewStatus.isNotEmpty) ...<Widget>[
          const SizedBox(height: 16),
          _InfoCard(
            title: 'Overview action status',
            rows: <_InfoRow>[
              _InfoRow('Latest action', _overviewStatus),
            ],
          ),
        ],
      ],
    );
  }

  Widget _buildSetupTab() {
    final kakaoProvider = _map(_placeConfig?['providers'])['kakao'];
    final busPolicy = _map(_busConfig?['policy']);
    final supportsLiveStationSearch =
        _supportsLiveStationSearch(_activeProvider);
    final supportsLiveStationRouteSearch =
        _supportsLiveStationRouteSearch(_activeProvider);
    final bindingModeLabel = _providerBindingModeLabel(_activeProvider);

    return ListView(
      padding: const EdgeInsets.all(20),
      children: <Widget>[
        const _SectionTitle(
          title: 'Commute setup',
          subtitle:
              'Search addresses, choose a live stop, load official route candidates, and save the mobile launch setup.',
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Search readiness',
          rows: <_InfoRow>[
            _InfoRow('Address provider', _readNestedLabel(kakaoProvider)),
            _InfoRow(
                'Bus policy',
                _readString(busPolicy, 'objective',
                    fallback: 'accuracy-first')),
            _InfoRow('Provider', _activeProvider),
            _InfoRow('Binding mode', bindingModeLabel),
          ],
        ),
        const SizedBox(height: 16),
        _FormCard(
          title: 'Profile',
          children: <Widget>[
            _buildTextField(_nameController, 'Name'),
            _buildAddressSearchField(
              controller: _homeAddressController,
              label: 'Home address',
              status: _homeSearchStatus,
              busy: _searchingHomeAddress,
              onSearch: () => _searchAddress('home'),
            ),
            _buildCoordinateSummary('Home coordinates', _homeLocation),
            _buildResultList(
              title: 'Home address matches',
              emptyLabel: 'Search for a home address to see candidates.',
              results: _homeAddressResults,
              actionLabel: 'Use this home',
              titleBuilder: (item) =>
                  _readString(item, 'label', fallback: 'Address'),
              subtitleBuilder: (item) =>
                  '${_readString(item, 'provider', fallback: 'provider')} - ${_readString(item, 'placeName', fallback: 'address')}',
              onTap: (item) => _selectAddressResult('home', item),
            ),
            const SizedBox(height: 12),
            _buildAddressSearchField(
              controller: _workAddressController,
              label: 'Work address',
              status: _workSearchStatus,
              busy: _searchingWorkAddress,
              onSearch: () => _searchAddress('work'),
            ),
            _buildCoordinateSummary('Work coordinates', _workLocation),
            _buildResultList(
              title: 'Work address matches',
              emptyLabel: 'Search for a work address to see candidates.',
              results: _workAddressResults,
              actionLabel: 'Use this work',
              titleBuilder: (item) =>
                  _readString(item, 'label', fallback: 'Address'),
              subtitleBuilder: (item) =>
                  '${_readString(item, 'provider', fallback: 'provider')} - ${_readString(item, 'placeName', fallback: 'address')}',
              onTap: (item) => _selectAddressResult('work', item),
            ),
            const SizedBox(height: 12),
            _buildTextField(
                _arrivalTimeController, 'Required arrival time (HH:MM)'),
          ],
        ),
        const SizedBox(height: 16),
        _FormCard(
          title: 'Route',
          children: <Widget>[
            SegmentedButton<String>(
              segments: const <ButtonSegment<String>>[
                ButtonSegment<String>(
                    value: 'gyeonggi', label: Text('Gyeonggi')),
                ButtonSegment<String>(value: 'seoul', label: Text('Seoul')),
                ButtonSegment<String>(value: 'tago', label: Text('TAGO')),
              ],
              selected: <String>{_activeProvider},
              onSelectionChanged: (selection) {
                setState(() {
                  _providerController.text = selection.first;
                  _stationSearchStatus = '';
                  _routeSearchStatus = '';
                });
              },
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(_providerRouteGuidance(_activeProvider)),
            ),
            _buildSearchField(
              controller: _stationKeywordController,
              label: 'Station search keyword',
              status: _stationSearchStatus,
              busy: _searchingStations,
              actionLabel: 'Search stations',
              enabled: supportsLiveStationSearch,
              idleStatus: _stationSearchIdleHint(_activeProvider),
              onAction: _searchStations,
            ),
            _buildResultList(
              title: 'Station candidates',
              emptyLabel: _stationSearchEmptyLabel(_activeProvider),
              results: _stationResults,
              actionLabel: 'Use station',
              titleBuilder: (item) =>
                  _readString(item, 'stationName', fallback: 'Station'),
              subtitleBuilder: (item) =>
                  '${_readString(item, 'stationId', fallback: 'no station id')} - ${_readString(item, 'arsId', fallback: _readString(item, 'stationNumber', fallback: 'no code'))}',
              onTap: _selectStation,
            ),
            _buildTextField(_stationNameController, 'Selected station name'),
            _buildTextField(_stopIdController, 'Selected stop id'),
            _buildTextField(_stationIdController, 'Official station id'),
            _buildTextField(_arsIdController, 'ARS or station number'),
            _buildCoordinateSummary(
                'Selected stop coordinates', _selectedStopLocation),
            _buildSearchField(
              controller: _routeNumberController,
              label: 'Route number filter',
              status: _routeSearchStatus,
              busy: _searchingRoutes,
              actionLabel: 'Load route candidates',
              enabled: supportsLiveStationRouteSearch,
              idleStatus: _routeSearchIdleHint(_activeProvider),
              onAction: _loadRouteCandidates,
            ),
            _buildResultList(
              title: 'Route candidates',
              emptyLabel: _routeSearchEmptyLabel(_activeProvider),
              results: _routeResults,
              actionLabel: 'Use route',
              titleBuilder: (item) => _readString(item, 'routeNumber',
                  fallback: _readString(item, 'routeName', fallback: 'Route')),
              subtitleBuilder: (item) =>
                  'Order ${_readString(item, 'order', fallback: 'no order')} - ${_readString(item, 'direction', fallback: _readString(item, 'destinationName', fallback: '-'))}',
              onTap: _selectRouteCandidate,
            ),
            _buildTextField(_primaryLineController, 'Primary line id'),
            _buildTextField(
                _lineIdsController, 'Selected line ids (comma separated)'),
            _buildTextField(_routeIdController, 'Official route id'),
            _buildTextField(_orderController, 'Station order on route'),
            _buildTextField(_cityCodeController, 'TAGO city code (optional)'),
            _buildTextField(_nodeIdController, 'TAGO node id (optional)'),
            if (_activeProvider == 'none') ...<Widget>[
              _buildTextField(_busRideMinController, '데모: 탑승 시간 (분)'),
              _buildTextField(_alightWalkMinController, '데모: 하차 후 도보 (분)'),
            ],
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _estimatingCommute ? null : _estimateCommute,
                child: Text(
                  _estimatingCommute
                      ? 'Estimating commute...'
                      : '정류장·역 → 목적지 경로 조회',
                ),
              ),
            ),
            if (_commuteEstimateStatus.isNotEmpty) ...<Widget>[
              const SizedBox(height: 8),
              Text(_commuteEstimateStatus),
            ],
            if (_commuteEstimate != null) ...<Widget>[
              const SizedBox(height: 12),
              _buildTransitChoices(),
            ],
          ],
        ),
        const SizedBox(height: 16),
        _FormCard(
          title: 'Schedule',
          children: <Widget>[
            _buildTextField(_scheduleStartController, 'Start time'),
            _buildTextField(_scheduleEndController, 'End time'),
            _buildTextField(
                _scheduleIntervalController, 'Repeat interval minutes'),
            _buildTextField(_repeatPresetController, 'Repeat preset'),
            SwitchListTile(
              value: _skipHolidays,
              onChanged: (value) {
                setState(() {
                  _skipHolidays = value;
                });
              },
              title: const Text('Skip holidays'),
              contentPadding: EdgeInsets.zero,
            ),
          ],
        ),
        const SizedBox(height: 16),
        _FormCard(
          title: 'Notification settings',
          children: <Widget>[
            _buildTextField(_soundPresetController, 'Sound preset id'),
            _buildTextField(_ttsVoiceController, 'TTS voice id'),
            SwitchListTile(
              value: _escalationEnabled,
              onChanged: (value) {
                setState(() {
                  _escalationEnabled = value;
                });
              },
              title: const Text('Escalation enabled'),
              contentPadding: EdgeInsets.zero,
            ),
            SwitchListTile(
              value: _dndBypass,
              onChanged: (value) {
                setState(() {
                  _dndBypass = value;
                });
              },
              title: const Text('DND bypass'),
              contentPadding: EdgeInsets.zero,
            ),
          ],
        ),
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: _savingSetup ? null : _saveSetup,
            child: Text(_savingSetup ? 'Saving...' : 'Save mobile setup'),
          ),
        ),
        if (_setupStatus.isNotEmpty) ...<Widget>[
          const SizedBox(height: 12),
          Text(_setupStatus),
        ],
      ],
    );
  }

  Widget _buildAccuracyTab() {
    final leaderboard = _map(_accuracyLeaderboard);
    final entries = _mapList(leaderboard['entries']);
    final reliability = _map(_alarmRuntime?['conservativeReliability']);
    final watchlist = _mapList(reliability['watchlist']);

    return ListView(
      padding: const EdgeInsets.all(20),
      children: <Widget>[
        const _SectionTitle(
          title: 'Accuracy monitor',
          subtitle:
              'Review ETA winners and recent instability for the Seoul and Gyeonggi launch.',
        ),
        const SizedBox(height: 16),
        SegmentedButton<String>(
          segments: const <ButtonSegment<String>>[
            ButtonSegment<String>(value: 'gyeonggi', label: Text('Gyeonggi')),
            ButtonSegment<String>(value: 'seoul', label: Text('Seoul')),
          ],
          selected: <String>{_leaderboardRegion},
          onSelectionChanged: (selection) {
            _changeRegion(selection.first);
          },
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Leaderboard summary',
          rows: <_InfoRow>[
            _InfoRow('Region', _leaderboardRegion),
            _InfoRow('Tracked routes',
                _readString(leaderboard, 'totalRoutes', fallback: '0')),
            _InfoRow('Time slice', _readNestedLabel(leaderboard['timeSlice'])),
          ],
        ),
        const SizedBox(height: 16),
        ...entries.map((entry) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _InfoCard(
              title:
                  '${_readString(entry, 'routeNumber', fallback: 'Route')} - ${_readString(entry, 'stopName', fallback: 'Stop')}',
              rows: <_InfoRow>[
                _InfoRow(
                  'Recommended provider',
                  _readString(entry, 'recommendedProvider', fallback: '-'),
                ),
                _InfoRow(
                  'Basis',
                  _readString(entry, 'recommendationBasis', fallback: '-'),
                ),
                _InfoRow(
                  'Confidence',
                  _readString(entry, 'recommendationConfidence', fallback: '-'),
                ),
                _InfoRow(
                  'Samples',
                  _readString(entry, 'sampleCount', fallback: '0'),
                ),
              ],
            ),
          );
        }),
        const SizedBox(height: 8),
        _InfoCard(
          title: 'Recent instability watchlist',
          rows: <_InfoRow>[
            _InfoRow('Tracked watch routes', '${watchlist.length}'),
            _InfoRow(
              'Top watch pair',
              watchlist.isNotEmpty
                  ? '${_readString(watchlist.first, 'routeNumber', fallback: 'Route')} - ${_readString(watchlist.first, 'stopName', fallback: 'Stop')}'
                  : '-',
            ),
            _InfoRow(
              'Top severity',
              watchlist.isNotEmpty
                  ? _readString(watchlist.first, 'severityLabel', fallback: '-')
                  : '-',
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildDeviceTab() {
    final deviceProfile = _map(_deviceProfile?['profile']);
    final tokenHealth =
        _deviceTokenHealth ?? _map(_deviceProfile?['tokenHealth']);
    final pushGateway = _map(_alarmRuntime?['pushGateway']);
    final pushGatewayConfig = _map(_pushGatewayConfig);
    final gatewayAdapters = _map(pushGatewayConfig['adapters']);
    final fcmAdapter = _map(gatewayAdapters['fcm']);
    final apnsAdapter = _map(gatewayAdapters['apns']);
    final selectedAdapter = _map(
      gatewayAdapters[_readString(tokenHealth, 'adapter', fallback: 'fcm')],
    );
    final fcmAuthStatus = _map(_fcmAuthStatus);
    final recentAttempts = _mapList(_pushGatewayAttempts?['attempts']);
    final retryQueue = _mapList(_pushGatewayAttempts?['retryQueue']);
    final pushPreview = _map(_pushPreview?['preview']);
    final latestAttempt = _map(
      recentAttempts.isNotEmpty ? recentAttempts.first : null,
    );
    final nativeAlarmPreviewSpec = buildMustCatchNativeAlarmPreviewSpec(
      routeNumber: _routeNumberController.text.trim().isEmpty
          ? _primaryLineController.text.trim()
          : _routeNumberController.text.trim(),
      currentArrivalMin: 3,
      nextArrivalMin: 18,
    );
    final attemptSummary = _map(_pushGatewayAttempts);
    final launchReadiness = _buildPushLaunchReadiness(
      tokenHealth: tokenHealth,
      fcmAuthStatus: fcmAuthStatus,
      selectedAdapter: selectedAdapter,
      pushPreview: pushPreview,
      latestAttempt: latestAttempt,
    );
    final launchBlockers = _buildLaunchBlockers(
      tokenHealth: tokenHealth,
      fcmAuthStatus: fcmAuthStatus,
      selectedAdapter: selectedAdapter,
    );
    final serverLaunchVerdict = _buildServerLaunchVerdict(
      baseUrl: widget.apiClient.baseUrl,
      mobileHealth: _mobileHealth,
    );
    final realDeviceFlow = _buildRealDeviceTestFlow(
      tokenHealth: tokenHealth,
      launchReadiness: launchReadiness,
      launchBlockers: launchBlockers,
      mobileHealth: _mobileHealth,
      latestAttempt: latestAttempt,
    );

    return ListView(
      padding: const EdgeInsets.all(20),
      children: <Widget>[
        const _SectionTitle(
          title: 'Device and push health',
          subtitle:
              'Track token readiness and delivery-pipeline health for the real app rollout.',
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Phone notification runtime',
          rows: <_InfoRow>[
            _InfoRow('Runtime state', _mobilePushRuntimeStatus.state),
            _InfoRow('Current platform', _mobilePushRuntimeStatus.platform),
            _InfoRow(
              'Firebase configured',
              _readBool(_mobilePushRuntimeStatus.firebaseReady),
            ),
            _InfoRow(
              'System permission',
              _readBool(_mobilePushRuntimeStatus.permissionGranted),
            ),
            _InfoRow('Current status', _mobilePushRuntimeStatus.message),
          ],
          footer: Wrap(
            spacing: 12,
            runSpacing: 12,
            children: <Widget>[
              OutlinedButton(
                onPressed: _initializeMobilePushRuntime,
                child: const Text('Refresh phone push status'),
              ),
              ElevatedButton(
                onPressed:
                    _registeringDeviceToken ? null : _registerCurrentToken,
                child: Text(
                  _registeringDeviceToken
                      ? 'Registering phone...'
                      : 'Enable and register this phone',
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _FormCard(
          title: 'Server endpoint',
          children: <Widget>[
            _buildTextField(_serverBaseUrlController, 'API base URL'),
            Text('Current: ${widget.apiClient.baseUrl}'),
            const SizedBox(height: 8),
            Text(_describeBaseUrlReachability(widget.apiClient.baseUrl)),
            const SizedBox(height: 12),
            _buildLabeledValue(
              'Server health',
              _readString(_mobileHealth, 'ok', fallback: '') == 'true'
                  ? 'REACHABLE'
                  : 'CHECK NEEDED',
            ),
            _buildLabeledValue(
              'Server time',
              _readString(_mobileHealth, 'serverTime', fallback: '-'),
            ),
            _buildLabeledValue(
              'Launch focus',
              _readList(_mobileHealth?['launchFocus']).join(', ').isEmpty
                  ? '-'
                  : _readList(_mobileHealth?['launchFocus']).join(', '),
            ),
            _buildLabeledValue(
              'Push lane',
              _readString(_map(_mobileHealth?['pushGateway']), 'adapter',
                  fallback: '-'),
            ),
            _buildLabeledValue(
              'Launch verdict',
              _readString(serverLaunchVerdict, 'state', fallback: '-'),
            ),
            _buildLabeledValue(
              'Immediate server fix',
              _readString(serverLaunchVerdict, 'nextStep', fallback: '-'),
            ),
            _buildLabeledValue(
              'Why this matters',
              _readString(serverLaunchVerdict, 'reason', fallback: '-'),
            ),
            _buildLabeledValue(
              'Launch checklist',
              _readList(serverLaunchVerdict['checklist']).join(' | ').isEmpty
                  ? '-'
                  : _readList(serverLaunchVerdict['checklist']).join(' | '),
            ),
            if (_serverConnectionStatus.isNotEmpty) ...<Widget>[
              const SizedBox(height: 8),
              Text(_serverConnectionStatus),
            ],
            const SizedBox(height: 12),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: <Widget>[
                ElevatedButton(
                  onPressed:
                      _applyingServerBaseUrl ? null : _applyServerBaseUrl,
                  child: Text(
                    _applyingServerBaseUrl
                        ? 'Applying server URL...'
                        : 'Apply server URL',
                  ),
                ),
                OutlinedButton(
                  onPressed: _applyingServerBaseUrl ? null : _loadAll,
                  child: const Text('Reload from server'),
                ),
                OutlinedButton(
                  onPressed: _applyingServerBaseUrl || _checkingServerHealth
                      ? null
                      : _runServerHealthCheck,
                  child: Text(
                    _checkingServerHealth
                        ? 'Running health check...'
                        : 'Run server health check',
                  ),
                ),
                if (_readString(serverLaunchVerdict, 'primaryActionLabel',
                            fallback: '-')
                        .isNotEmpty &&
                    _readString(serverLaunchVerdict, 'primaryActionLabel',
                            fallback: '-') !=
                        '-') ...<Widget>[
                  OutlinedButton(
                    onPressed: _applyingServerBaseUrl ||
                            _checkingServerHealth ||
                            _runningTestPush
                        ? null
                        : () =>
                            _runServerVerdictPrimaryAction(serverLaunchVerdict),
                    child: Text(_readString(
                        serverLaunchVerdict, 'primaryActionLabel',
                        fallback: 'Continue')),
                  ),
                ],
              ],
            ),
          ],
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Push launch readiness',
          rows: <_InfoRow>[
            _InfoRow(
              'Readiness state',
              _readString(launchReadiness, 'state', fallback: '-'),
            ),
            _InfoRow(
              'Next step',
              _readString(launchReadiness, 'nextStep', fallback: '-'),
            ),
            _InfoRow(
              'Adapter lane',
              _readString(launchReadiness, 'adapterLane', fallback: '-'),
            ),
            _InfoRow(
              'Preview state',
              _readString(launchReadiness, 'previewState', fallback: '-'),
            ),
            _InfoRow(
              'Gateway attempt',
              _readString(launchReadiness, 'attemptState', fallback: '-'),
            ),
            _InfoRow(
              'Why',
              _readString(launchReadiness, 'reason', fallback: '-'),
            ),
          ],
          footer: Wrap(
            spacing: 12,
            runSpacing: 12,
            children: <Widget>[
              ElevatedButton(
                onPressed:
                    _registeringDeviceToken ? null : _registerCurrentToken,
                child: Text(
                  _registeringDeviceToken
                      ? 'Registering...'
                      : 'Register current token',
                ),
              ),
              OutlinedButton(
                onPressed: _refreshDeviceTab,
                child: const Text('Refresh readiness'),
              ),
              OutlinedButton(
                onPressed: _runningTestPush ? null : _runManualTestPush,
                child: Text(
                  _runningTestPush ? 'Running test push...' : 'Run test push',
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Launch blockers',
          rows: <_InfoRow>[
            _InfoRow('Hard blockers',
                _readString(launchBlockers, 'hardBlockerCount', fallback: '0')),
            _InfoRow('Warnings',
                _readString(launchBlockers, 'warningCount', fallback: '0')),
            _InfoRow('Top blocker',
                _readString(launchBlockers, 'topBlocker', fallback: '-')),
            _InfoRow('Next fix',
                _readString(launchBlockers, 'nextFix', fallback: '-')),
            _InfoRow('Fallback safety',
                _readString(launchBlockers, 'fallbackSafety', fallback: '-')),
            _InfoRow('Warning summary',
                _readString(launchBlockers, 'warningSummary', fallback: '-')),
          ],
          footer: Wrap(
            spacing: 12,
            runSpacing: 12,
            children: <Widget>[
              OutlinedButton(
                onPressed: _refreshDeviceTab,
                child: const Text('Refresh blockers'),
              ),
              OutlinedButton(
                onPressed:
                    _registeringDeviceToken ? null : _registerCurrentToken,
                child: Text(
                  _registeringDeviceToken
                      ? 'Registering...'
                      : 'Fix token first',
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Real-device push test flow',
          rows: <_InfoRow>[
            _InfoRow('Step 1 - Register token',
                _readString(realDeviceFlow, 'step1', fallback: '-')),
            _InfoRow('Step 2 - Check permissions',
                _readString(realDeviceFlow, 'step2', fallback: '-')),
            _InfoRow('Step 3 - Confirm readiness',
                _readString(realDeviceFlow, 'step3', fallback: '-')),
            _InfoRow('Step 4 - Run test push',
                _readString(realDeviceFlow, 'step4', fallback: '-')),
            _InfoRow('Current step',
                _readString(realDeviceFlow, 'currentStep', fallback: '-')),
            _InfoRow('Next action',
                _readString(realDeviceFlow, 'nextAction', fallback: '-')),
            _InfoRow('Why paused',
                _readString(realDeviceFlow, 'pauseReason', fallback: '-')),
            _InfoRow('Operator hint',
                _readString(realDeviceFlow, 'operatorHint', fallback: '-')),
            _InfoRow(
              'Resume guide',
              _buildRealDeviceResumeGuide(
                flow: realDeviceFlow,
                checkpoint: _realDeviceFlowCheckpoint,
              ),
            ),
            _InfoRow(
              'Last completed step',
              _readString(_realDeviceFlowCheckpoint, 'stepLabel',
                  fallback: '-'),
            ),
            _InfoRow(
              'Last completed status',
              _readString(_realDeviceFlowCheckpoint, 'status', fallback: '-'),
            ),
            _InfoRow(
              'Completed at',
              _formatIso(_readString(_realDeviceFlowCheckpoint, 'recordedAt',
                  fallback: '')),
            ),
            _InfoRow(
              'Checkpoint detail',
              _readString(_realDeviceFlowCheckpoint, 'detail', fallback: '-'),
            ),
          ],
          footer: Wrap(
            spacing: 12,
            runSpacing: 12,
            children: <Widget>[
              if (_readString(realDeviceFlow, 'primaryActionLabel',
                          fallback: '-')
                      .isNotEmpty &&
                  _readString(realDeviceFlow, 'primaryActionLabel',
                          fallback: '-') !=
                      '-') ...<Widget>[
                ElevatedButton(
                  onPressed: _registeringDeviceToken ||
                          _checkingServerHealth ||
                          _runningTestPush ||
                          _applyingServerBaseUrl
                      ? null
                      : () => _runRealDeviceFlowPrimaryAction(realDeviceFlow),
                  child: Text(
                    _buildRealDevicePrimaryActionLabel(
                      flow: realDeviceFlow,
                      checkpoint: _realDeviceFlowCheckpoint,
                    ),
                  ),
                ),
              ],
              OutlinedButton(
                onPressed: _refreshDeviceTab,
                child: const Text('Refresh flow status'),
              ),
              if (_realDeviceFlowCheckpoint != null)
                OutlinedButton(
                  onPressed: _resetRealDeviceFlowCheckpoint,
                  child: const Text('Reset saved progress'),
                ),
              if (_realDeviceFlowStatus.isNotEmpty) Text(_realDeviceFlowStatus),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Device profile',
          rows: <_InfoRow>[
            _InfoRow('Device name',
                _readString(deviceProfile, 'deviceName', fallback: '-')),
            _InfoRow('Platform',
                _readString(deviceProfile, 'platform', fallback: '-')),
            _InfoRow('Push enabled', _readBool(_devicePushEnabled)),
            _InfoRow(
              'Push token health',
              _readString(tokenHealth, 'deliveryReadiness', fallback: '-'),
            ),
            _InfoRow(
              'Token reason',
              _readString(tokenHealth, 'reason', fallback: '-'),
            ),
            _InfoRow(
              'Registered at',
              _formatIso(
                _readString(deviceProfile, 'registeredAt', fallback: ''),
              ),
            ),
            _InfoRow(
                'Updated at',
                _formatIso(
                    _readString(deviceProfile, 'updatedAt', fallback: ''))),
          ],
        ),
        const SizedBox(height: 16),
        _FormCard(
          title: 'Device registration',
          children: <Widget>[
            _buildTextField(_deviceNameController, 'Device name'),
            SegmentedButton<String>(
              segments: const <ButtonSegment<String>>[
                ButtonSegment<String>(
                  value: 'android',
                  label: Text('Android'),
                ),
                ButtonSegment<String>(value: 'ios', label: Text('iPhone')),
                ButtonSegment<String>(value: 'web', label: Text('Web')),
              ],
              selected: <String>{_devicePlatform},
              onSelectionChanged: (selection) {
                setState(() {
                  _devicePlatform = _normalizeDevicePlatform(selection.first);
                });
              },
            ),
            const SizedBox(height: 12),
            _buildTextField(
              _pushTokenController,
              'Current push token (FCM or APNs)',
              maxLines: 4,
            ),
            SwitchListTile(
              value: _devicePushEnabled,
              onChanged: (value) {
                setState(() {
                  _devicePushEnabled = value;
                });
              },
              title: const Text('Push delivery enabled'),
              contentPadding: EdgeInsets.zero,
            ),
            SwitchListTile(
              value: _deviceFullScreenEnabled,
              onChanged: (value) {
                setState(() {
                  _deviceFullScreenEnabled = value;
                });
              },
              title: const Text('Full-screen alarm enabled'),
              contentPadding: EdgeInsets.zero,
            ),
            SwitchListTile(
              value: _deviceDndOverrideGranted,
              onChanged: (value) {
                setState(() {
                  _deviceDndOverrideGranted = value;
                });
              },
              title: const Text('DND override granted'),
              contentPadding: EdgeInsets.zero,
            ),
            SwitchListTile(
              value: _deviceBatteryOptimizationIgnored,
              onChanged: (value) {
                setState(() {
                  _deviceBatteryOptimizationIgnored = value;
                });
              },
              title: const Text('Battery optimization ignored'),
              contentPadding: EdgeInsets.zero,
            ),
            SwitchListTile(
              value: _deviceLocalBackupEnabled,
              onChanged: (value) {
                setState(() {
                  _deviceLocalBackupEnabled = value;
                });
              },
              title: const Text('Local backup enabled'),
              contentPadding: EdgeInsets.zero,
            ),
            SwitchListTile(
              value: _deviceSoundEnabled,
              onChanged: (value) {
                setState(() {
                  _deviceSoundEnabled = value;
                });
              },
              title: const Text('Sound enabled'),
              contentPadding: EdgeInsets.zero,
            ),
            SwitchListTile(
              value: _deviceVibrationEnabled,
              onChanged: (value) {
                setState(() {
                  _deviceVibrationEnabled = value;
                });
              },
              title: const Text('Vibration enabled'),
              contentPadding: EdgeInsets.zero,
            ),
            SwitchListTile(
              value: _deviceTtsEnabled,
              onChanged: (value) {
                setState(() {
                  _deviceTtsEnabled = value;
                });
              },
              title: const Text('TTS enabled'),
              contentPadding: EdgeInsets.zero,
            ),
            const SizedBox(height: 8),
            Row(
              children: <Widget>[
                Expanded(
                  child: ElevatedButton(
                    onPressed:
                        _savingDeviceProfile ? null : _saveDeviceSettings,
                    child: Text(
                      _savingDeviceProfile
                          ? 'Saving...'
                          : 'Save device settings',
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed:
                        _registeringDeviceToken ? null : _registerCurrentToken,
                    child: Text(
                      _registeringDeviceToken
                          ? 'Registering...'
                          : 'Register device token',
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: _refreshDeviceTab,
                child: const Text('Refresh device health'),
              ),
            ),
            if (_deviceStatus.isNotEmpty) ...<Widget>[
              const SizedBox(height: 8),
              Text(_deviceStatus),
            ],
            if (_tokenRegisterStatus.isNotEmpty) ...<Widget>[
              const SizedBox(height: 8),
              Text(_tokenRegisterStatus),
            ],
          ],
        ),
        const SizedBox(height: 16),
        _FormCard(
          title: 'Exact local backup alarm',
          children: <Widget>[
            const Text(
              '앞으로 30일 중 선택한 요일과 휴일 설정에 맞춰 시작 시각 보조 알람을 예약합니다. 앱을 열면 갱신됩니다. 정확한 시각과 전체 화면 알림은 휴대폰의 권한 허용이 필요합니다. iPhone은 운영체제가 알림 표시 방식을 제한합니다.',
            ),
            const SizedBox(height: 12),
            _buildLabeledValue(
              'Backup time',
              _scheduleStartController.text.trim().isEmpty
                  ? 'Set a schedule start time first'
                  : '${_scheduleStartController.text.trim()} Asia/Seoul',
            ),
            _buildLabeledValue(
              'Requested escalation',
              'Full screen: ${_deviceFullScreenEnabled ? 'requested' : 'off'} / DND bypass: ${_deviceDndOverrideGranted ? 'requested' : 'off'}',
            ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: _requestingAndroidAlarmPermissions
                    ? null
                    : _requestAndroidAlarmPermissions,
                child: Text(
                  _requestingAndroidAlarmPermissions
                      ? 'Opening Android permissions...'
                      : 'Request Android alarm permissions',
                ),
              ),
            ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _schedulingLocalBackup
                    ? null
                    : _scheduleLocalBackupAlarm,
                child: Text(
                  _schedulingLocalBackup
                      ? 'Scheduling local backup...'
                      : '설정에 맞춰 보조 알람 예약',
                ),
              ),
            ),
            if (_localAlarmStatus.isNotEmpty) ...<Widget>[
              const SizedBox(height: 8),
              Text(_localAlarmStatus),
            ],
          ],
        ),
        const SizedBox(height: 16),
        _FormCard(
          title: 'Local late-alarm preview',
          children: <Widget>[
            const Text(
              'Run this on the real phone to verify the mechanical alarm sound, strong vibration, and repeated Korean late-warning phrase. Background FCM notifications use the native mechanical sound and vibration channel after Firebase setup.',
            ),
            const SizedBox(height: 12),
            _buildLabeledValue(
              'Preview route',
              '${nativeAlarmPreviewSpec.routeNumber}번 버스 / ${nativeAlarmPreviewSpec.currentArrivalMin} min',
            ),
            _buildLabeledValue(
              'Late phrase',
              nativeAlarmPreviewSpec.repeatedLateWarningPhrase,
            ),
            _buildLabeledValue(
              'Sound preset',
              '${nativeAlarmPreviewSpec.soundPresetId} (${nativeAlarmPreviewSpec.mechanicalLoopCount} loops)',
            ),
            _buildLabeledValue(
              'Vibration plan',
              '${nativeAlarmPreviewSpec.vibrationPattern.join(' / ')} ms x ${nativeAlarmPreviewSpec.vibrationRepeats}',
            ),
            _buildLabeledValue(
              'Preview scope',
              'Foreground only while the app is open. Background FCM notifications use native sound and vibration; device background TTS is not guaranteed by Android or iPhone.',
            ),
            const SizedBox(height: 8),
            Row(
              children: <Widget>[
                Expanded(
                  child: ElevatedButton(
                    onPressed: _runningNativeAlarmPreview
                        ? null
                        : _startNativeLateAlarmPreview,
                    child: Text(
                      _runningNativeAlarmPreview
                          ? 'Starting preview...'
                          : 'Preview must-catch late alarm',
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton(
                    onPressed: _runningNativeAlarmPreview
                        ? null
                        : _stopNativeLateAlarmPreview,
                    child: const Text('Stop local preview'),
                  ),
                ),
              ],
            ),
            if (_nativeAlarmPreviewStatus.isNotEmpty) ...<Widget>[
              const SizedBox(height: 8),
              Text(_nativeAlarmPreviewStatus),
            ],
          ],
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Token health',
          rows: <_InfoRow>[
            _InfoRow(
                'Adapter', _readString(tokenHealth, 'adapter', fallback: '-')),
            _InfoRow('Readiness',
                _readString(tokenHealth, 'deliveryReadiness', fallback: '-')),
            _InfoRow('Format status',
                _readString(tokenHealth, 'formatStatus', fallback: '-')),
            _InfoRow('Token kind',
                _readString(tokenHealth, 'tokenKind', fallback: '-')),
            _InfoRow('Masked token',
                _readString(tokenHealth, 'tokenMasked', fallback: '-')),
            _InfoRow('Recommended action',
                _readString(tokenHealth, 'recommendedAction', fallback: '-')),
          ],
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'FCM auth health',
          rows: <_InfoRow>[
            _InfoRow(
              'Auth strategy',
              _readString(fcmAuthStatus, 'authStrategy', fallback: '-'),
            ),
            _InfoRow(
              'Project id',
              _readString(fcmAuthStatus, 'projectId', fallback: '-'),
            ),
            _InfoRow(
              'Access token status',
              _readString(fcmAuthStatus, 'accessTokenStatus', fallback: '-'),
            ),
            _InfoRow(
              'Token source',
              _readString(fcmAuthStatus, 'accessTokenSource', fallback: '-'),
            ),
            _InfoRow(
              'Cache status',
              _readString(
                fcmAuthStatus,
                'accessTokenCacheStatus',
                fallback: '-',
              ),
            ),
            _InfoRow(
                'Expires at',
                _formatIso(_readString(fcmAuthStatus, 'accessTokenExpiresAt',
                    fallback: ''))),
            _InfoRow(
                'Reason', _readString(fcmAuthStatus, 'reason', fallback: '-')),
          ],
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Push provider config',
          rows: <_InfoRow>[
            _InfoRow('Gateway mode',
                _readString(pushGatewayConfig, 'mode', fallback: '-')),
            _InfoRow(
              'Selected adapter configured',
              _readBool(selectedAdapter['configured'] == true),
            ),
            _InfoRow(
              'Selected adapter execute supported',
              _readBool(selectedAdapter['executeSupported'] == true),
            ),
            _InfoRow(
              'Selected adapter source',
              _readString(selectedAdapter, 'credentialSource', fallback: '-'),
            ),
            _InfoRow(
              'Selected adapter note',
              _readString(selectedAdapter, 'limitation', fallback: '-'),
            ),
            _InfoRow(
              'FCM configured',
              _readBool(fcmAdapter['configured'] == true),
            ),
            _InfoRow(
              'APNs configured',
              _readBool(apnsAdapter['configured'] == true),
            ),
          ],
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Push gateway',
          rows: <_InfoRow>[
            _InfoRow('Mode', _readString(pushGateway, 'mode', fallback: '-')),
            _InfoRow('Attempts today',
                _readString(pushGateway, 'total', fallback: '0')),
            _InfoRow(
              'Pending retries',
              _readNestedString(pushGateway['retryPolicy'], 'pendingRetries',
                  fallback: '0'),
            ),
            _InfoRow(
              'Next retry',
              _formatIso(_readNestedString(
                  pushGateway['retryPolicy'], 'nextRetryAt',
                  fallback: '')),
            ),
          ],
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Current push preview',
          rows: <_InfoRow>[
            _InfoRow(
              'Preview status',
              _readString(pushPreview, 'status', fallback: '-'),
            ),
            _InfoRow(
              'Adapter',
              _readString(pushPreview, 'adapter', fallback: '-'),
            ),
            _InfoRow(
              'Dispatch key',
              _readString(pushPreview, 'dispatchKey', fallback: '-'),
            ),
            _InfoRow(
              'Route',
              _readString(pushPreview, 'routeNumber', fallback: '-'),
            ),
            _InfoRow(
              'Stop',
              _readString(pushPreview, 'stopName', fallback: '-'),
            ),
            _InfoRow(
              'Reason',
              _readString(pushPreview, 'reason', fallback: '-'),
            ),
            _InfoRow(
              'Queue total',
              _readString(_pushPreview, 'queueTotal', fallback: '0'),
            ),
          ],
        ),
        const SizedBox(height: 16),
        _FormCard(
          title: 'Gateway tools',
          children: <Widget>[
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed:
                    _runningGatewayDispatch ? null : _runCurrentGatewayDispatch,
                child: Text(
                  _runningGatewayDispatch
                      ? 'Dispatching current bundle...'
                      : 'Dispatch current live bundle',
                ),
              ),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: <Widget>[
                ElevatedButton(
                  onPressed: _runningRetrySimulation
                      ? null
                      : () => _runRetrySimulationAction(
                            'seed-retryable-failure',
                          ),
                  child: const Text('Seed retryable failure'),
                ),
                ElevatedButton(
                  onPressed: _runningRetrySimulation
                      ? null
                      : () => _runRetrySimulationAction(
                            'run-due-retry',
                            outcome: 'success',
                          ),
                  child: const Text('Run due retry'),
                ),
                ElevatedButton(
                  onPressed: _runningRetrySimulation
                      ? null
                      : () => _runRetrySimulationAction(
                            'run-due-retry',
                            outcome: 'hard-failure',
                          ),
                  child: const Text('Run hard failure retry'),
                ),
                OutlinedButton(
                  onPressed: _runningRetrySimulation
                      ? null
                      : () => _runRetrySimulationAction('clear-simulation'),
                  child: const Text('Clear simulation'),
                ),
              ],
            ),
            if (_pushToolStatus.isNotEmpty) ...<Widget>[
              const SizedBox(height: 8),
              Text(_pushToolStatus),
            ],
          ],
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Latest push gateway attempt',
          rows: <_InfoRow>[
            _InfoRow(
              'Status',
              _readString(latestAttempt, 'status', fallback: '-'),
            ),
            _InfoRow(
              'Origin',
              _readString(latestAttempt, 'origin', fallback: '-'),
            ),
            _InfoRow(
              'Target readiness',
              _readString(latestAttempt, 'targetReadiness', fallback: '-'),
            ),
            _InfoRow(
              'Retry profile',
              _readString(latestAttempt, 'retryProfileLabel', fallback: '-'),
            ),
            _InfoRow(
              'Provider category',
              _readNestedString(
                latestAttempt['response'],
                'failureCategory',
                fallback: '-',
              ),
            ),
            _InfoRow(
              'Provider error code',
              _readNestedString(
                latestAttempt['response'],
                'providerErrorCode',
                fallback: '-',
              ),
            ),
            _InfoRow(
              'Token action',
              _readNestedString(
                latestAttempt['response'],
                'tokenAction',
                fallback: '-',
              ),
            ),
            _InfoRow(
              'Reason',
              _readString(latestAttempt, 'reason', fallback: '-'),
            ),
            _InfoRow(
              'Created at',
              _formatIso(_readString(latestAttempt, 'createdAt', fallback: '')),
            ),
            _InfoRow(
              'Attempt count today',
              _readString(attemptSummary, 'total', fallback: '0'),
            ),
          ],
          footer: _readNestedString(
                    latestAttempt['response'],
                    'tokenAction',
                    fallback: '',
                  ) ==
                  'RE_REGISTER'
              ? ElevatedButton(
                  onPressed:
                      _registeringDeviceToken ? null : _registerCurrentToken,
                  child: const Text('Refresh and register this phone token'),
                )
              : null,
        ),
        const SizedBox(height: 16),
        _InfoCard(
          title: 'Retry queue summary',
          rows: <_InfoRow>[
            _InfoRow(
              'Pending retries',
              _readNestedString(
                attemptSummary['retryPolicy'],
                'pendingRetries',
                fallback: '0',
              ),
            ),
            _InfoRow(
              'Boosted retries',
              _readNestedString(
                attemptSummary['retryPolicy'],
                'boostedPendingRetries',
                fallback: '0',
              ),
            ),
            _InfoRow(
              'Next retry at',
              _formatIso(
                _readNestedString(
                  attemptSummary['retryPolicy'],
                  'nextRetryAt',
                  fallback: '',
                ),
              ),
            ),
            _InfoRow(
              'Next priority class',
              _readNestedString(
                attemptSummary['retryPolicy'],
                'nextRetryDeliveryPriorityClass',
                fallback: '-',
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        _FormCard(
          title: 'Manual test push',
          children: <Widget>[
            SegmentedButton<String>(
              segments: const <ButtonSegment<String>>[
                ButtonSegment<String>(value: 'GREEN', label: Text('GREEN')),
                ButtonSegment<String>(value: 'YELLOW', label: Text('YELLOW')),
                ButtonSegment<String>(value: 'ORANGE', label: Text('ORANGE')),
                ButtonSegment<String>(value: 'RED', label: Text('RED')),
              ],
              selected: <String>{_testPushRiskLevel},
              onSelectionChanged: (selection) {
                setState(() {
                  _testPushRiskLevel = selection.first;
                });
              },
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _runningTestPush ? null : _runManualTestPush,
                child: Text(
                  _runningTestPush
                      ? 'Running test push...'
                      : 'Run manual test push',
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        _buildResultList(
          title: 'Recent push attempts',
          emptyLabel: 'No push gateway attempts recorded yet.',
          results: recentAttempts,
          actionLabel: 'Inspect',
          titleBuilder: (item) =>
              '${_readString(item, 'status', fallback: 'STATUS')} - ${_readString(item, 'routeNumber', fallback: 'Route')}',
          subtitleBuilder: (item) =>
              '${_readString(item, 'stopName', fallback: 'Stop')} | ${_readString(item, 'reason', fallback: '-')}',
          onTap: (item) {
            setState(() {
              _pushToolStatus =
                  'Attempt ${_readString(item, 'status', fallback: 'status')} at ${_formatIso(_readString(item, 'createdAt', fallback: ''))}: ${_readString(item, 'reason', fallback: '-')}';
            });
          },
        ),
        _buildResultList(
          title: 'Retry queue',
          emptyLabel: 'No retry item is waiting right now.',
          results: retryQueue,
          actionLabel: 'Inspect',
          titleBuilder: (item) =>
              '${_readString(item, 'retryProfileLabel', fallback: 'Retry')} - ${_readString(item, 'routeNumber', fallback: 'Route')}',
          subtitleBuilder: (item) =>
              '${_readString(item, 'stopName', fallback: 'Stop')} | next ${_formatIso(_readString(item, 'scheduledAt', fallback: ''))}',
          onTap: (item) {
            setState(() {
              _pushToolStatus =
                  'Retry ${_readString(item, 'retryAttempt', fallback: '0')} for ${_readString(item, 'routeNumber', fallback: 'route')} runs at ${_formatIso(_readString(item, 'scheduledAt', fallback: ''))}.';
            });
          },
        ),
      ],
    );
  }

  Widget _buildAddressSearchField({
    required TextEditingController controller,
    required String label,
    required String status,
    required bool busy,
    required VoidCallback onSearch,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        _buildTextField(controller, label),
        Row(
          children: <Widget>[
            ElevatedButton(
              onPressed: busy ? null : onSearch,
              child: Text(busy ? 'Searching...' : 'Search'),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(status.isEmpty ? 'No search run yet.' : status),
            ),
          ],
        ),
        const SizedBox(height: 12),
      ],
    );
  }

  Widget _buildLabeledValue(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(
            width: 140,
            child: Text(
              label,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }

  Widget _buildSearchField({
    required TextEditingController controller,
    required String label,
    required String status,
    required bool busy,
    required String actionLabel,
    required VoidCallback onAction,
    bool enabled = true,
    String idleStatus = 'No search run yet.',
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        _buildTextField(controller, label),
        Row(
          children: <Widget>[
            ElevatedButton(
              onPressed: !enabled || busy ? null : onAction,
              child: Text(busy ? 'Loading...' : actionLabel),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(status.isEmpty ? idleStatus : status),
            ),
          ],
        ),
        const SizedBox(height: 12),
      ],
    );
  }

  Widget _buildCoordinateSummary(String label, Map<String, dynamic>? location) {
    if (location == null) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Text('$label: not selected yet.'),
      );
    }

    final lat = _readString(location, 'lat', fallback: '');
    final lng = _readString(location, 'lng', fallback: '');
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text('$label: $lat, $lng'),
    );
  }

  Widget _buildResultList({
    required String title,
    required String emptyLabel,
    required List<Map<String, dynamic>> results,
    required String actionLabel,
    required String Function(Map<String, dynamic>) titleBuilder,
    required String Function(Map<String, dynamic>) subtitleBuilder,
    required void Function(Map<String, dynamic>) onTap,
  }) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(title, style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        if (results.isEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(emptyLabel),
          )
        else
          ...results.map((item) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Card(
                child: ListTile(
                  title: Text(titleBuilder(item)),
                  subtitle: Text(subtitleBuilder(item)),
                  trailing: TextButton(
                    onPressed: () => onTap(item),
                    child: Text(actionLabel),
                  ),
                ),
              ),
            );
          }),
      ],
    );
  }

  Widget? _buildOverviewActionFooter({
    required String sourceLabel,
    required Map<String, dynamic> target,
    required Map<String, dynamic> quickAction,
  }) {
    final hasTarget = target.isNotEmpty;
    final hasQuickAction = quickAction.isNotEmpty;

    if (!hasTarget && !hasQuickAction) {
      return null;
    }

    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: <Widget>[
        if (hasTarget)
          OutlinedButton(
            onPressed: () => _openOverviewAttentionTarget(
              target,
              sourceLabel: sourceLabel,
            ),
            child: Text(
              _readString(
                target,
                'buttonLabel',
                fallback: 'Open device details',
              ),
            ),
          ),
        if (hasQuickAction)
          ElevatedButton(
            onPressed: () => _runOverviewQuickAction(
              quickAction,
              sourceLabel: sourceLabel,
            ),
            child: Text(
              _readString(
                quickAction,
                'buttonLabel',
                fallback: 'Run action',
              ),
            ),
          ),
      ],
    );
  }

  String get _activeProvider =>
      _normalizeProvider(_providerController.text.trim()).isEmpty
          ? 'gyeonggi'
          : _normalizeProvider(_providerController.text.trim());

  Map<String, dynamic> _providerConfig(String provider) {
    final providers = _map(_busConfig?['providers']);
    return _map(providers[_normalizeProvider(provider)]);
  }

  Map<String, dynamic> _providerSetupConfig(String provider) {
    return _map(_providerConfig(provider)['setup']);
  }

  bool _supportsLiveStationSearch(String provider) {
    final setup = _providerSetupConfig(provider);
    final configured = setup['stationSearchSupported'];
    if (configured is bool) {
      return configured;
    }
    return provider == 'seoul' || provider == 'gyeonggi';
  }

  bool _supportsLiveStationRouteSearch(String provider) {
    final setup = _providerSetupConfig(provider);
    final configured = setup['stationRouteSearchSupported'];
    if (configured is bool) {
      return configured;
    }
    return _supportsLiveStationSearch(provider);
  }

  String _providerBindingMode(String provider) {
    final setup = _providerSetupConfig(provider);
    final mode = _readString(setup, 'bindingMode', fallback: '');
    if (mode.isNotEmpty) {
      return mode;
    }
    return _supportsLiveStationSearch(provider) ? 'search-assisted' : 'manual';
  }

  String _providerBindingModeLabel(String provider) {
    final mode = _providerBindingMode(provider);
    if (mode == 'search-assisted') {
      return 'Search-assisted';
    }
    if (mode == 'manual') {
      return 'Manual IDs';
    }
    return mode.isEmpty ? '-' : mode;
  }

  String _providerRouteGuidance(String provider) {
    final setup = _providerSetupConfig(provider);
    final guidance = _readString(setup, 'guidance', fallback: '');
    if (guidance.isNotEmpty) {
      return guidance;
    }
    if (provider == 'seoul') {
      return 'Search the official Seoul stop first so the app can fill station id, ARS number, route id, and stop order for you.';
    }
    if (provider == 'gyeonggi') {
      return 'Search the official Gyeonggi stop first, then compare accuracy against the provider currently winning for that route-stop pair.';
    }
    return 'Accuracy matters more than API ownership. If TAGO is the most accurate source for this commute, keep it selected and enter city code, node id, route id, route number, and stop order manually below.';
  }

  String _stationSearchIdleHint(String provider) {
    final setup = _providerSetupConfig(provider);
    final hint = _readString(setup, 'stationSearchIdleHint', fallback: '');
    if (hint.isNotEmpty) {
      return hint;
    }
    if (_supportsLiveStationSearch(provider)) {
      return 'No search run yet.';
    }
    return 'Manual TAGO binding: station search is disabled for this provider in the current mobile shell.';
  }

  String _stationSearchEmptyLabel(String provider) {
    final setup = _providerSetupConfig(provider);
    final label = _readString(setup, 'stationSearchEmptyLabel', fallback: '');
    if (label.isNotEmpty) {
      return label;
    }
    if (_supportsLiveStationSearch(provider)) {
      return 'Search stations to load official stop candidates.';
    }
    return 'TAGO does not load station candidates here. Enter the live binding fields manually below.';
  }

  String _routeSearchIdleHint(String provider) {
    final setup = _providerSetupConfig(provider);
    final hint = _readString(setup, 'routeSearchIdleHint', fallback: '');
    if (hint.isNotEmpty) {
      return hint;
    }
    if (_supportsLiveStationRouteSearch(provider)) {
      return 'No search run yet.';
    }
    return 'Manual TAGO binding: route candidate lookup is disabled for this provider in the current mobile shell.';
  }

  String _routeSearchEmptyLabel(String provider) {
    final setup = _providerSetupConfig(provider);
    final label = _readString(setup, 'routeSearchEmptyLabel', fallback: '');
    if (label.isNotEmpty) {
      return label;
    }
    if (_supportsLiveStationRouteSearch(provider)) {
      return 'Load official route candidates after choosing a station.';
    }
    return 'TAGO does not load route candidates here. Enter route id, route number, stop order, city code, and node id manually below.';
  }

  Map<String, dynamic> _map(dynamic value) {
    if (value is Map<String, dynamic>) {
      return value;
    }
    return <String, dynamic>{};
  }

  Map<String, dynamic>? _coordinateMap(dynamic value) {
    final source = value is Map<String, dynamic> ? value : _map(value);
    if (source.isEmpty) {
      return null;
    }

    final lat = _parseDouble(source['lat']);
    final lng = _parseDouble(source['lng']);
    if (lat == null || lng == null) {
      return null;
    }

    return <String, dynamic>{
      'lat': lat,
      'lng': lng,
    };
  }

  List<Map<String, dynamic>> _mapList(dynamic value) {
    if (value is List) {
      return value
          .whereType<Map>()
          .map((item) => item.cast<String, dynamic>())
          .toList();
    }
    return <Map<String, dynamic>>[];
  }

  List<String> _readList(dynamic value) {
    if (value is List) {
      return value
          .map((item) => '$item'.trim())
          .where((item) => item.isNotEmpty)
          .toList();
    }
    return <String>[];
  }

  double? _parseDouble(dynamic value) {
    if (value is num) {
      return value.toDouble();
    }
    return double.tryParse('$value');
  }

  String _readString(dynamic source, String key, {String fallback = '-'}) {
    if (source is Map<String, dynamic>) {
      final value = source[key];
      if (value == null) {
        return fallback;
      }
      final text = '$value'.trim();
      return text.isEmpty ? fallback : text;
    }
    return fallback;
  }

  String _readNestedString(dynamic source, String key,
      {String fallback = '-'}) {
    if (source is Map<String, dynamic>) {
      final value = source[key];
      if (value == null) {
        return fallback;
      }
      final text = '$value'.trim();
      return text.isEmpty ? fallback : text;
    }
    return fallback;
  }

  String _readNestedLabel(dynamic source) {
    if (source is Map<String, dynamic>) {
      final label = _readString(source, 'label', fallback: '-');
      final value = _readString(source, 'value', fallback: '');
      if (value == '-' || value.isEmpty) {
        return label;
      }
      return '$label - $value';
    }
    return '-';
  }

  String _normalizeProvider(String value) {
    final lower = value.trim().toLowerCase();
    if (lower == 'seoul' || lower == 'gyeonggi' || lower == 'tago') {
      return lower;
    }
    return lower;
  }

  String _normalizeDevicePlatform(String value) {
    final lower = value.trim().toLowerCase();
    if (lower == 'android' || lower == 'ios' || lower == 'web') {
      return lower;
    }
    return 'android';
  }

  String _readBool(bool value) {
    return value ? 'ON' : 'OFF';
  }

  String _formatIso(String value) {
    if (value.isEmpty || value == '-') {
      return '-';
    }
    final parsed = DateTime.tryParse(value);
    if (parsed == null) {
      return value;
    }
    final local = parsed.toLocal();
    final month = local.month.toString().padLeft(2, '0');
    final day = local.day.toString().padLeft(2, '0');
    final hour = local.hour.toString().padLeft(2, '0');
    final minute = local.minute.toString().padLeft(2, '0');
    return '$month-$day $hour:$minute';
  }

  String _joinList(dynamic value) {
    if (value is List) {
      return value
          .map((item) => '$item'.trim())
          .where((item) => item.isNotEmpty)
          .join(', ');
    }
    return '';
  }

  String _formatTopRouteStops(dynamic value) {
    final items = _mapList(value);
    if (items.isEmpty) {
      return '-';
    }

    return items.take(3).map((item) {
      final routeNumber = _readString(item, 'routeNumber', fallback: 'Route');
      final stopName = _readString(item, 'stopName', fallback: 'Stop');
      final count = _readString(item, 'count', fallback: '0');
      return '$routeNumber - $stopName ($count)';
    }).join(', ');
  }

  String _formatOutcomeMix(dynamic value) {
    final items = _mapList(value);
    if (items.isEmpty) {
      return '-';
    }

    return items.take(3).map((item) {
      final label = _readString(item, 'label', fallback: 'Outcome');
      final count = _readString(item, 'count', fallback: '0');
      return '$label $count';
    }).join(', ');
  }

  String _formatPlaybackPlan(dynamic source) {
    final signal = _map(source);
    if (signal.isEmpty) {
      return '-';
    }

    final volumePercent =
        int.tryParse(_readString(signal, 'volumePercent', fallback: '0')) ?? 0;
    final vibrationRepeats =
        int.tryParse(_readString(signal, 'vibrationRepeats', fallback: '0')) ??
            0;
    final mechanicalLoopBoost = int.tryParse(
            _readString(signal, 'mechanicalLoopBoost', fallback: '0')) ??
        0;
    final speechRepeatCount =
        int.tryParse(_readString(signal, 'speechRepeatCount', fallback: '1')) ??
            1;

    final parts = <String>[];
    if (volumePercent > 0) {
      parts.add('sound $volumePercent%');
    }
    if (vibrationRepeats > 0) {
      parts.add('vibration x$vibrationRepeats');
    }
    if (mechanicalLoopBoost > 0) {
      parts.add('mechanical +$mechanicalLoopBoost loops');
    }
    if (speechRepeatCount > 1) {
      parts.add('voice x$speechRepeatCount');
    }

    return parts.isEmpty ? 'standard playback' : parts.join(' | ');
  }

  String _formatStrongestAlertOutcome(dynamic alert, dynamic signal) {
    final alertMap = _map(alert);
    final signalMap = _map(signal);

    final outcome =
        _readString(alertMap, 'deliveryOutcomeLabel', fallback: '-');
    final priority =
        _readString(signalMap, 'deliveryPriorityClass', fallback: 'normal')
            .toUpperCase();
    final sourceLabel = _readString(signalMap, 'sourceLabel', fallback: '-');

    return '$priority | $outcome | $sourceLabel';
  }

  Map<String, dynamic> _buildPushLaunchReadiness({
    required dynamic tokenHealth,
    required dynamic fcmAuthStatus,
    required dynamic selectedAdapter,
    required dynamic pushPreview,
    required dynamic latestAttempt,
  }) {
    final tokenMap = _map(tokenHealth);
    final authMap = _map(fcmAuthStatus);
    final adapterMap = _map(selectedAdapter);
    final previewMap = _map(pushPreview);
    final attemptMap = _map(latestAttempt);
    final attemptResponse = _map(attemptMap['response']);

    final deliveryReadiness =
        _readString(tokenMap, 'deliveryReadiness', fallback: 'unknown')
            .toLowerCase();
    final authStatus =
        _readString(authMap, 'accessTokenStatus', fallback: 'unknown')
            .toLowerCase();
    final adapterConfigured = adapterMap['configured'] == true;
    final adapterExecuteSupported = adapterMap['executeSupported'] == true;
    final previewStatus = _readString(previewMap, 'status', fallback: '-');
    final latestAttemptStatus =
        _readString(attemptMap, 'status', fallback: '-');
    final tokenAction =
        _readString(attemptResponse, 'tokenAction', fallback: 'NONE');

    if (tokenAction == 'RE_REGISTER') {
      return <String, dynamic>{
        'state': 'TOKEN REFRESH REQUIRED',
        'nextStep': 'Register this phone again to store its current FCM token',
        'adapterLane':
            _readString(tokenMap, 'adapter', fallback: '-').toUpperCase(),
        'previewState': previewStatus,
        'attemptState': latestAttemptStatus,
        'reason': _readString(
          attemptResponse,
          'reason',
          fallback: _readString(
            attemptMap,
            'reason',
            fallback: 'FCM rejected the previous device token.',
          ),
        ),
      };
    }

    if (deliveryReadiness == 'blocked') {
      return <String, dynamic>{
        'state': 'TOKEN BLOCKED',
        'nextStep': 'Register a valid device token first',
        'adapterLane':
            _readString(tokenMap, 'adapter', fallback: '-').toUpperCase(),
        'previewState': previewStatus,
        'attemptState': latestAttemptStatus,
        'reason': _readString(tokenMap, 'reason',
            fallback: 'The current token cannot be sent yet.'),
      };
    }

    if (!adapterConfigured ||
        !adapterExecuteSupported ||
        authStatus == 'blocked') {
      return <String, dynamic>{
        'state': 'GATEWAY NOT READY',
        'nextStep': 'Fix push credentials before device rollout',
        'adapterLane':
            _readString(adapterMap, 'credentialSource', fallback: '-'),
        'previewState': previewStatus,
        'attemptState': latestAttemptStatus,
        'reason': _readString(authMap, 'reason',
            fallback: _readString(adapterMap, 'limitation',
                fallback: 'Gateway credentials are missing or blocked.')),
      };
    }

    if (latestAttemptStatus.toUpperCase() == 'BLOCKED') {
      return <String, dynamic>{
        'state': 'ATTEMPT BLOCKED',
        'nextStep': 'Inspect the latest gateway block before launch',
        'adapterLane':
            _readString(tokenMap, 'adapter', fallback: '-').toUpperCase(),
        'previewState': previewStatus,
        'attemptState': latestAttemptStatus,
        'reason': _readString(attemptMap, 'reason',
            fallback: 'The latest gateway attempt is blocked.'),
      };
    }

    if (latestAttemptStatus.toUpperCase() == 'FAILED') {
      return <String, dynamic>{
        'state': 'ATTEMPT FAILED',
        'nextStep': 'Run test push again after checking the last failure',
        'adapterLane':
            _readString(tokenMap, 'adapter', fallback: '-').toUpperCase(),
        'previewState': previewStatus,
        'attemptState': latestAttemptStatus,
        'reason': _readString(attemptMap, 'reason',
            fallback: 'The latest gateway attempt failed.'),
      };
    }

    if (previewStatus.toLowerCase() == 'ready') {
      return <String, dynamic>{
        'state': 'READY FOR TEST PUSH',
        'nextStep': 'Run a manual test push on a real phone now',
        'adapterLane':
            _readString(tokenMap, 'adapter', fallback: '-').toUpperCase(),
        'previewState': previewStatus,
        'attemptState': latestAttemptStatus,
        'reason':
            'Token format, adapter setup, and preview path all look ready.',
      };
    }

    return <String, dynamic>{
      'state': 'CHECK DEVICE HEALTH',
      'nextStep': 'Refresh token health and preview before rollout',
      'adapterLane':
          _readString(tokenMap, 'adapter', fallback: '-').toUpperCase(),
      'previewState': previewStatus,
      'attemptState': latestAttemptStatus,
      'reason': _readString(previewMap, 'reason',
          fallback:
              'The device pipeline still needs one more readiness check.'),
    };
  }

  Map<String, dynamic> _buildLaunchBlockers({
    required dynamic tokenHealth,
    required dynamic fcmAuthStatus,
    required dynamic selectedAdapter,
  }) {
    final tokenMap = _map(tokenHealth);
    final authMap = _map(fcmAuthStatus);
    final adapterMap = _map(selectedAdapter);

    final hardBlockers = <String>[];
    final warnings = <String>[];

    final deliveryReadiness =
        _readString(tokenMap, 'deliveryReadiness', fallback: 'unknown')
            .toLowerCase();
    final authStatus =
        _readString(authMap, 'accessTokenStatus', fallback: 'unknown')
            .toLowerCase();

    if (!_devicePushEnabled) {
      hardBlockers.add('Push delivery is turned off on this device.');
    }
    if (deliveryReadiness == 'blocked') {
      hardBlockers.add(
        _readString(tokenMap, 'reason',
            fallback: 'The current device token is blocked.'),
      );
    }
    if (adapterMap['configured'] != true ||
        adapterMap['executeSupported'] != true ||
        authStatus == 'blocked') {
      hardBlockers.add(
        _readString(
          authMap,
          'reason',
          fallback: _readString(
            adapterMap,
            'limitation',
            fallback:
                'Push gateway credentials are not ready for live delivery.',
          ),
        ),
      );
    }

    if (!_deviceFullScreenEnabled) {
      warnings.add('Full-screen alarm is off, so late alerts may look weaker.');
    }
    if (!_deviceDndOverrideGranted) {
      warnings.add('DND override is not granted yet.');
    }
    if (!_deviceBatteryOptimizationIgnored) {
      warnings.add('Battery optimization is still on.');
    }
    if (!_deviceLocalBackupEnabled) {
      warnings.add('Local backup alarm is off.');
    }
    if (!_deviceSoundEnabled) {
      warnings.add('Sound is off on this rollout profile.');
    }
    if (!_deviceVibrationEnabled) {
      warnings.add('Vibration is off on this rollout profile.');
    }
    if (!_deviceTtsEnabled) {
      warnings.add('Voice guidance is off on this rollout profile.');
    }

    final topBlocker = hardBlockers.isNotEmpty
        ? hardBlockers.first
        : 'No hard blocker is visible right now.';
    String nextFix = 'Run a manual test push on a real device.';
    if (hardBlockers.isNotEmpty) {
      if (!_devicePushEnabled) {
        nextFix = 'Turn on push delivery and save the device settings.';
      } else if (deliveryReadiness == 'blocked') {
        nextFix = 'Register a valid FCM or APNs token again.';
      } else {
        nextFix = 'Fix push credentials, then refresh device health.';
      }
    } else if (warnings.isNotEmpty) {
      nextFix = 'Clear the warnings before launch to make alarms stronger.';
    }

    String fallbackSafety = 'No fallback risk detected.';
    if (!_deviceLocalBackupEnabled) {
      fallbackSafety =
          'Local backup alarm is off, so server push is the only path.';
    } else if (!_deviceBatteryOptimizationIgnored) {
      fallbackSafety =
          'Local backup exists, but battery optimization can still delay it.';
    }

    final warningSummary = warnings.isEmpty
        ? 'No warning is visible right now.'
        : warnings.take(2).join(' | ');

    return <String, dynamic>{
      'hardBlockerCount': '${hardBlockers.length}',
      'warningCount': '${warnings.length}',
      'topBlocker': topBlocker,
      'nextFix': nextFix,
      'fallbackSafety': fallbackSafety,
      'warningSummary': warningSummary,
    };
  }

  Map<String, dynamic> _buildRealDeviceTestFlow({
    required dynamic tokenHealth,
    required dynamic launchReadiness,
    required dynamic launchBlockers,
    required dynamic mobileHealth,
    required dynamic latestAttempt,
  }) {
    final tokenMap = _map(tokenHealth);
    final readinessMap = _map(launchReadiness);
    final blockersMap = _map(launchBlockers);
    final healthMap = _map(mobileHealth);
    final attemptMap = _map(latestAttempt);
    final attemptResponse = _map(attemptMap['response']);

    final deliveryReadiness = _readString(
      tokenMap,
      'deliveryReadiness',
      fallback: 'unknown',
    ).toLowerCase();
    final hardBlockers = int.tryParse(
          _readString(blockersMap, 'hardBlockerCount', fallback: '0'),
        ) ??
        0;
    final warnings = int.tryParse(
          _readString(blockersMap, 'warningCount', fallback: '0'),
        ) ??
        0;
    final readinessState = _readString(
      readinessMap,
      'state',
      fallback: 'CHECK DEVICE HEALTH',
    );
    final healthOk = healthMap['ok'] == true;
    final latestAttemptStatus = _readString(
      attemptMap,
      'status',
      fallback: '-',
    ).toUpperCase();
    final tokenRefreshRequired =
        _readString(attemptResponse, 'tokenAction', fallback: 'NONE') ==
            'RE_REGISTER';
    final tokenReason = _readString(
      tokenMap,
      'reason',
      fallback: 'A valid live token is not registered on this device yet.',
    );
    final blockerReason = hardBlockers > 0
        ? _readString(
            blockersMap,
            'topBlocker',
            fallback: 'A hard rollout blocker is still active.',
          )
        : _readString(
            blockersMap,
            'warningSummary',
            fallback: 'Review the remaining warning items before launch.',
          );
    final readinessReason = !healthOk
        ? 'The saved server host has not passed the BusWakeUp mobile health check yet.'
        : _readString(
            readinessMap,
            'reason',
            fallback: 'Push readiness has not reached READY FOR TEST PUSH yet.',
          );
    final attemptReason = _readString(
      attemptMap,
      'reason',
      fallback: latestAttemptStatus == '-'
          ? 'No device push attempt has been recorded yet.'
          : 'The latest device push attempt still needs review.',
    );

    final step1 = deliveryReadiness == 'ready' && !tokenRefreshRequired
        ? 'DONE'
        : 'ACTION NEEDED';
    final step2 = hardBlockers > 0
        ? 'BLOCKED'
        : warnings > 0
            ? 'DONE WITH WARNINGS'
            : 'DONE';
    final step3 = healthOk && readinessState == 'READY FOR TEST PUSH'
        ? 'DONE'
        : readinessState;

    String step4 = 'READY TO RUN';
    if (_isSuccessfulRealDevicePushStatus(latestAttemptStatus)) {
      step4 = latestAttemptStatus;
    } else if (latestAttemptStatus != '-') {
      step4 = latestAttemptStatus;
    }

    final readinessHint = warnings > 0
        ? 'Health check, token health, gateway credentials, and preview readiness must all line up before Step 4. Warning reminder: ${_readString(blockersMap, 'warningSummary', fallback: 'Review the warning items in the blocker card.')}.'
        : 'Health check, token health, gateway credentials, and preview readiness must all line up before Step 4.';

    if (step1 != 'DONE') {
      return <String, dynamic>{
        'step1': step1,
        'step2': step2,
        'step3': step3,
        'step4': step4,
        'currentStep': 'Step 1 - Register token',
        'nextAction': tokenRefreshRequired
            ? 'Register this phone again so the server receives its current FCM token.'
            : 'Paste the live FCM or APNs token, then register it on this device profile.',
        'pauseReason': tokenRefreshRequired
            ? _readString(
                attemptResponse,
                'reason',
                fallback: 'FCM rejected the previous device token.',
              )
            : tokenReason,
        'operatorHint':
            'Use the token currently issued by Firebase or APNs on this phone, not an old demo token.',
        'primaryAction': 'register-token',
        'primaryActionLabel': 'Register current token',
      };
    }

    if (hardBlockers > 0) {
      return <String, dynamic>{
        'step1': step1,
        'step2': step2,
        'step3': step3,
        'step4': step4,
        'currentStep': 'Step 2 - Check permissions',
        'nextAction': 'Clear the hard blockers before trying a real push test.',
        'pauseReason': blockerReason,
        'operatorHint': _readString(
          blockersMap,
          'nextFix',
          fallback:
              'Review the blocker card and clear the remaining launch issues.',
        ),
        'primaryAction': 'refresh-device-health',
        'primaryActionLabel': 'Refresh device health',
      };
    }

    if (step3 != 'DONE') {
      return <String, dynamic>{
        'step1': step1,
        'step2': step2,
        'step3': step3,
        'step4': step4,
        'currentStep': 'Step 3 - Confirm readiness',
        'nextAction':
            'Run the server and readiness checks until this device is ready for a push test.',
        'pauseReason': readinessReason,
        'operatorHint': readinessHint,
        'primaryAction': 'run-health-check',
        'primaryActionLabel': 'Run readiness checks',
      };
    }

    return <String, dynamic>{
      'step1': step1,
      'step2': step2,
      'step3': step3,
      'step4': step4,
      'currentStep': 'Step 4 - Run test push',
      'nextAction': _isSuccessfulRealDevicePushStatus(latestAttemptStatus)
          ? 'A recent test push already completed. Run another one if you need to confirm again.'
          : 'This device looks ready. Run the real-device test push now.',
      'pauseReason': attemptReason,
      'operatorHint': _isSuccessfulRealDevicePushStatus(latestAttemptStatus)
          ? 'You can repeat the push only if you want another confirmation on the same phone.'
          : 'If the phone is ready, this is the first step that should actually try to reach the device.',
      'primaryAction': 'run-test-push',
      'primaryActionLabel': 'Run test push now',
    };
  }

  bool _isRealDeviceFlowStep2Complete(String status) {
    final normalized = status.trim().toUpperCase();
    return normalized == 'DONE' || normalized == 'DONE WITH WARNINGS';
  }

  bool _isSuccessfulRealDevicePushStatus(String status) {
    return status == 'SENT' ||
        status == 'SIMULATED_SENT' ||
        status == 'DRY_RUN_READY';
  }

  int _detectRealDeviceFlowStepNumber(String label) {
    if (label.contains('Register token')) {
      return 1;
    }
    if (label.contains('Check permissions')) {
      return 2;
    }
    if (label.contains('Confirm readiness')) {
      return 3;
    }
    if (label.contains('Run test push')) {
      return 4;
    }
    return 0;
  }

  String _buildRealDeviceResumeGuide({
    required Map<String, dynamic> flow,
    required Map<String, dynamic>? checkpoint,
  }) {
    final currentStep = _readString(flow, 'currentStep', fallback: '-');
    final nextAction = _readString(flow, 'nextAction', fallback: '-');
    final checkpointMap = checkpoint ?? <String, dynamic>{};
    final checkpointStep = checkpointMap['stepNumber'] is num
        ? (checkpointMap['stepNumber'] as num).toInt()
        : 0;
    final checkpointLabel = _readString(
      checkpointMap,
      'stepLabel',
      fallback: '',
    );
    final checkpointDetail = _readString(
      checkpointMap,
      'detail',
      fallback: '',
    );
    final currentStepNumber = _detectRealDeviceFlowStepNumber(currentStep);

    if (checkpointStep <= 0 ||
        checkpointLabel.isEmpty ||
        checkpointLabel == '-') {
      return 'No saved progress yet. Start with $currentStep. $nextAction';
    }

    if (checkpointStep >= 4 &&
        currentStepNumber == 4 &&
        _readString(checkpointMap, 'status', fallback: '').toUpperCase() !=
            'FAILED') {
      return 'Saved progress already reached a successful push test. Repeat Step 4 only if you want another confirmation.';
    }

    if (checkpointStep >= currentStepNumber && currentStepNumber > 0) {
      return checkpointDetail.isEmpty || checkpointDetail == '-'
          ? 'Saved progress already covers this stage. Resume from $currentStep.'
          : 'Saved progress already covers this stage. Resume from $currentStep. Last note: $checkpointDetail';
    }

    return checkpointDetail.isEmpty || checkpointDetail == '-'
        ? 'Saved progress ended at $checkpointLabel. Continue with $currentStep.'
        : 'Saved progress ended at $checkpointLabel. Continue with $currentStep. Last note: $checkpointDetail';
  }

  String _buildRealDevicePrimaryActionLabel({
    required Map<String, dynamic> flow,
    required Map<String, dynamic>? checkpoint,
  }) {
    final fallbackLabel = _readString(
      flow,
      'primaryActionLabel',
      fallback: 'Continue',
    );
    final currentStep = _readString(flow, 'currentStep', fallback: '');
    final checkpointMap = checkpoint ?? <String, dynamic>{};
    final checkpointStep = checkpointMap['stepNumber'] is num
        ? (checkpointMap['stepNumber'] as num).toInt()
        : 0;
    final currentStepNumber = _detectRealDeviceFlowStepNumber(currentStep);

    if (currentStepNumber <= 0) {
      return fallbackLabel;
    }

    if (checkpointStep <= 0) {
      return fallbackLabel;
    }

    if (currentStepNumber == 4) {
      return checkpointStep >= 4
          ? 'Repeat Step 4 test push'
          : 'Continue with Step 4 test push';
    }

    if (currentStepNumber == 3) {
      return checkpointStep >= 2
          ? 'Continue with Step 3 readiness checks'
          : fallbackLabel;
    }

    if (currentStepNumber == 2) {
      return checkpointStep >= 1
          ? 'Continue with Step 2 permission review'
          : fallbackLabel;
    }

    return fallbackLabel;
  }

  Map<String, dynamic> _buildServerLaunchVerdict({
    required String baseUrl,
    required dynamic mobileHealth,
  }) {
    final normalized = baseUrl.trim().toLowerCase();
    final healthMap = _map(mobileHealth);
    final pushGateway = _map(healthMap['pushGateway']);
    final healthOk = healthMap['ok'] == true;
    final executeSupported = pushGateway['executeSupported'] == true;
    final accessTokenStatus = _readString(
      pushGateway,
      'accessTokenStatus',
      fallback: 'unknown',
    ).toLowerCase();

    if (!healthOk) {
      return <String, dynamic>{
        'state': 'HEALTH CHECK NEEDED',
        'nextStep': 'Run the server health check against the saved host.',
        'reason':
            'The app has not confirmed yet that this address is a reachable BusWakeUp server.',
        'primaryAction': 'run-health-check',
        'primaryActionLabel': 'Run health check now',
        'checklist': <String>[
          'Save the host you want to test',
          'Run the server health check',
          'Confirm launch focus and push lane',
        ],
      };
    }

    if (normalized.contains('127.0.0.1') || normalized.contains('localhost')) {
      return <String, dynamic>{
        'state': 'LOCALHOST MISMATCH RISK',
        'nextStep':
            'Replace localhost with your PC LAN IP before testing on a real phone.',
        'reason':
            'A real iPhone or Android device usually cannot reach the mobile app server through localhost.',
        'primaryAction': 'show-lan-checklist',
        'primaryActionLabel': 'Use LAN host checklist',
        'checklist': <String>[
          'Find your PC LAN IP',
          'Replace localhost with that IP',
          'Keep phone and PC on the same Wi-Fi',
          'Run the health check again',
        ],
      };
    }

    if (!executeSupported || accessTokenStatus == 'blocked') {
      return <String, dynamic>{
        'state': 'GATEWAY AUTH BLOCKED',
        'nextStep':
            'Fix Firebase or push-gateway credentials, then run the health check again.',
        'reason':
            'The server is reachable, but the push gateway cannot execute a real device handoff yet.',
        'primaryAction': 'refresh-device-health',
        'primaryActionLabel': 'Refresh gateway health',
        'checklist': <String>[
          'Check Firebase or APNs credentials',
          'Refresh device and gateway health',
          'Confirm push lane is no longer blocked',
        ],
      };
    }

    if (normalized.startsWith('http://')) {
      return <String, dynamic>{
        'state': 'LAN TEST MODE',
        'nextStep':
            'Keep the phone and server PC on the same network during the rollout test.',
        'reason':
            'The server is reachable over LAN and the push gateway looks ready for local device testing.',
        'primaryAction': 'run-health-check',
        'primaryActionLabel': 'Re-check LAN readiness',
        'checklist': <String>[
          'Keep phone and server PC on one network',
          'Run token registration from the device',
          'Start a dry-run push test',
        ],
      };
    }

    if (normalized.startsWith('https://')) {
      return <String, dynamic>{
        'state': 'READY FOR REAL-DEVICE TEST',
        'nextStep':
            'Run a real token registration and test push from this device.',
        'reason':
            'The server is reachable over HTTPS and the push path looks ready for mobile rollout checks.',
        'primaryAction': 'run-test-push',
        'primaryActionLabel': 'Start real test push flow',
        'checklist': <String>[
          'Register the current device token',
          'Refresh push readiness',
          'Run a test push from this phone',
        ],
      };
    }

    return <String, dynamic>{
      'state': 'CUSTOM HOST CHECK',
      'nextStep':
          'Verify that this custom address is reachable from the phone, then run a test push.',
      'reason':
          'The server answered the health check, but the host shape is unusual for standard mobile rollout.',
      'primaryAction': 'run-health-check',
      'primaryActionLabel': 'Verify custom host again',
      'checklist': <String>[
        'Confirm the custom host opens from the phone',
        'Run the server health check again',
        'Then move on to token and push testing',
      ],
    };
  }

  String _describeBaseUrlReachability(String baseUrl) {
    final normalized = baseUrl.trim().toLowerCase();
    if (normalized.contains('127.0.0.1') || normalized.contains('localhost')) {
      return 'This localhost address works on the same machine, but a real phone usually needs your PC LAN IP instead.';
    }
    if (normalized.startsWith('http://')) {
      return 'This is a local-network style address. Check that your phone and server PC are on the same network.';
    }
    if (normalized.startsWith('https://')) {
      return 'This looks like a remote HTTPS server, which is the best shape for real iPhone and Android rollout tests.';
    }
    return 'Check that this server URL is reachable from your simulator or real phone.';
  }

  String _describeMonitoringMode({
    required String watchLevel,
    required String nextPriorityClass,
  }) {
    final normalizedWatchLevel = watchLevel.trim().toLowerCase();
    final normalizedPriority = nextPriorityClass.trim().toLowerCase();

    if (normalizedPriority == 'boosted') {
      return 'BOOSTED FIRST ALARM';
    }
    if (normalizedPriority == 'precheck') {
      return 'PRECHECK ACTIVE';
    }
    if (normalizedWatchLevel == 'high') {
      return 'HIGH WATCH';
    }
    if (normalizedWatchLevel == 'elevated') {
      return 'ELEVATED WATCH';
    }
    return 'STANDARD WATCH';
  }

  List<String> _splitCsv(String raw) {
    return raw
        .split(',')
        .map((item) => item.trim())
        .where((item) => item.isNotEmpty)
        .toList();
  }

  Widget _buildTextField(
    TextEditingController controller,
    String label, {
    int maxLines = 1,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: controller,
        maxLines: maxLines,
        decoration: InputDecoration(labelText: label),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({
    required this.title,
    required this.subtitle,
  });

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(title, style: theme.textTheme.headlineSmall),
        const SizedBox(height: 8),
        Text(subtitle, style: theme.textTheme.bodyLarge),
      ],
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({
    required this.title,
    required this.rows,
    this.footer,
  });

  final String title;
  final List<_InfoRow> rows;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(title, style: theme.textTheme.titleLarge),
            const SizedBox(height: 14),
            ...rows.map(
              (row) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    SizedBox(
                      width: 132,
                      child: Text(
                        row.label,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                    Expanded(
                      child: Text(
                        row.value,
                        style: theme.textTheme.bodyLarge,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (footer != null) ...<Widget>[
              const SizedBox(height: 8),
              footer!,
            ],
          ],
        ),
      ),
    );
  }
}

class _FormCard extends StatelessWidget {
  const _FormCard({
    required this.title,
    required this.children,
  });

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(title, style: theme.textTheme.titleLarge),
            const SizedBox(height: 14),
            ...children,
          ],
        ),
      ),
    );
  }
}

class _InfoRow {
  const _InfoRow(this.label, this.value);

  final String label;
  final String value;
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({
    required this.message,
    required this.onRetry,
  });

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Icon(Icons.error_outline, size: 48),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: onRetry,
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

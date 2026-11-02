import 'package:flutter/material.dart';

import 'app/bus_wakeup_app.dart';
import 'app/theme_mode_store.dart';
import 'core/device/mobile_push_runtime.dart';
import 'features/stops/stop_map.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Future.wait([
    MobilePushRuntime.instance.initialize(),
    ThemeModeStore.instance.load(),
    KakaoMapSetup.initialize(),
  ]);
  runApp(const BusWakeUpApp());
}

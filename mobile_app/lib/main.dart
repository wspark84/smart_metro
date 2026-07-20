import 'package:flutter/material.dart';

import 'app/bus_wakeup_app.dart';
import 'core/device/mobile_push_runtime.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await MobilePushRuntime.instance.initialize();
  runApp(const BusWakeUpApp());
}

import 'package:flutter/material.dart';

import '../features/root/mobile_root_screen.dart';
import 'bus_wakeup_theme.dart';

class BusWakeUpApp extends StatelessWidget {
  const BusWakeUpApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'BusWakeUp Mobile',
      debugShowCheckedModeBanner: false,
      theme: buildBusWakeUpTheme(),
      home: const MobileRootScreen(),
    );
  }
}

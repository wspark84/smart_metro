import 'package:flutter/material.dart';

import '../features/root/inochi_root.dart';
import 'inochi_theme.dart';

class BusWakeUpApp extends StatelessWidget {
  const BusWakeUpApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '이노치',
      debugShowCheckedModeBanner: false,
      theme: buildInochiTheme(Brightness.light),
      darkTheme: buildInochiTheme(Brightness.dark),
      home: const InochiRoot(),
    );
  }
}

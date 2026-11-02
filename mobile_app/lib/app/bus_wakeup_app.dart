import 'package:flutter/material.dart';

import '../features/root/inochi_root.dart';
import 'inochi_theme.dart';
import 'theme_mode_store.dart';

class BusWakeUpApp extends StatelessWidget {
  const BusWakeUpApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<ThemeMode>(
      valueListenable: ThemeModeStore.instance.mode,
      builder: (context, mode, _) => MaterialApp(
        title: '이노치',
        debugShowCheckedModeBanner: false,
        theme: buildInochiTheme(Brightness.light),
        darkTheme: buildInochiTheme(Brightness.dark),
        themeMode: mode,
        home: const InochiRoot(),
      ),
    );
  }
}

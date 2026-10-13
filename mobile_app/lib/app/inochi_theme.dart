import 'package:flutter/material.dart';

/// Brand colours for 이노치 (이거 놓치면 지각): warm paper background with a
/// signal-orange accent, matching the web app.
class InochiColors {
  static const accent = Color(0xFFD94A1E);
  static const ink = Color(0xFF1D1B1A);
  static const muted = Color(0xFF6B635E);
  static const paper = Color(0xFFF6F4F3);
  static const card = Colors.white;
  static const ok = Color(0xFF1F7A4D);
  static const warn = Color(0xFFB26A00);
  static const danger = Color(0xFFB3261E);
}

ThemeData buildInochiTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(seedColor: InochiColors.accent, brightness: brightness,
      surface: dark ? const Color(0xFF141210) : InochiColors.paper);
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: scheme.surface,
    appBarTheme: AppBarTheme(backgroundColor: scheme.surface, surfaceTintColor: Colors.transparent, centerTitle: false),
    cardTheme: CardThemeData(
      elevation: 0,
      color: dark ? const Color(0xFF1F1C1A) : InochiColors.card,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      margin: EdgeInsets.zero,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: dark ? const Color(0xFF1F1C1A) : Colors.white,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
  );
}

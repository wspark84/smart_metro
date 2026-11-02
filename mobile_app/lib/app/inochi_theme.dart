import 'package:flutter/material.dart';

/// Design tokens for 이노치 (C안 "남은 시간 한눈에"), light and dark.
/// Screens read them with `InochiPalette.of(context)`.
@immutable
class InochiPalette extends ThemeExtension<InochiPalette> {
  const InochiPalette({
    required this.ground,
    required this.card,
    required this.ink,
    required this.muted,
    required this.line,
    required this.ok,
    required this.danger,
    required this.badge,
    required this.subway,
    required this.sheet,
    required this.relaxedGround,
    required this.soonGround,
    required this.nowGround,
    required this.relaxedTone,
    required this.soonTone,
    required this.nowTone,
    required this.recommend,
    required this.timetable,
  });

  final Color ground;
  final Color card;
  final Color ink;
  final Color muted;
  final Color line;
  final Color ok;
  final Color danger;
  final Color badge;
  final Color subway;
  final Color sheet;
  // Urgency fields for the countdown screen.
  final Color relaxedGround;
  final Color soonGround;
  final Color nowGround;
  // Countdown number colour on that field (dark mode tints it; light keeps ink).
  final Color relaxedTone;
  final Color soonTone;
  final Color nowTone;
  final Color recommend;
  final Color timetable;

  static const light = InochiPalette(
    ground: Color(0xFFF4F2EE),
    card: Color(0xFFFFFFFF),
    ink: Color(0xFF1B1A17),
    muted: Color(0xFF5F5B54),
    line: Color(0xFFE7E3DC),
    ok: Color(0xFF1F6B45),
    danger: Color(0xFFB3261E),
    badge: Color(0xFFF4C14F),
    subway: Color(0xFF3A5BA0),
    sheet: Color(0xFFFFFFFF),
    relaxedGround: Color(0xFF9FD9B4),
    soonGround: Color(0xFFF4C14F),
    nowGround: Color(0xFFF49A82),
    relaxedTone: Color(0xFF1B1A17),
    soonTone: Color(0xFF1B1A17),
    nowTone: Color(0xFF1B1A17),
    recommend: Color(0xFFB8360F),
    timetable: Color(0xFF6B4F00),
  );

  static const dark = InochiPalette(
    ground: Color(0xFF141311),
    card: Color(0xFF1F1E1B),
    ink: Color(0xFFF2EFEA),
    muted: Color(0xFFABA59C),
    line: Color(0xFF34322E),
    ok: Color(0xFF8FE0B0),
    danger: Color(0xFFFF9C8A),
    badge: Color(0xFFF4C14F),
    subway: Color(0xFF8FA9E0),
    sheet: Color(0xFF1E1D1B),
    relaxedGround: Color(0xFF0F2A1E),
    soonGround: Color(0xFF2B2108),
    nowGround: Color(0xFF35140E),
    relaxedTone: Color(0xFF8FE0B0),
    soonTone: Color(0xFFF4C14F),
    nowTone: Color(0xFFFF9C8A),
    recommend: Color(0xFFFFB59E),
    timetable: Color(0xFFF4C14F),
  );

  static InochiPalette of(BuildContext context) => Theme.of(context).extension<InochiPalette>() ?? light;

  @override
  InochiPalette copyWith() => this;

  @override
  InochiPalette lerp(ThemeExtension<InochiPalette>? other, double t) {
    if (other is! InochiPalette) return this;
    Color mix(Color a, Color b) => Color.lerp(a, b, t)!;
    return InochiPalette(
      ground: mix(ground, other.ground),
      card: mix(card, other.card),
      ink: mix(ink, other.ink),
      muted: mix(muted, other.muted),
      line: mix(line, other.line),
      ok: mix(ok, other.ok),
      danger: mix(danger, other.danger),
      badge: mix(badge, other.badge),
      subway: mix(subway, other.subway),
      sheet: mix(sheet, other.sheet),
      relaxedGround: mix(relaxedGround, other.relaxedGround),
      soonGround: mix(soonGround, other.soonGround),
      nowGround: mix(nowGround, other.nowGround),
      relaxedTone: mix(relaxedTone, other.relaxedTone),
      soonTone: mix(soonTone, other.soonTone),
      nowTone: mix(nowTone, other.nowTone),
      recommend: mix(recommend, other.recommend),
      timetable: mix(timetable, other.timetable),
    );
  }
}

/// Font used only for the big countdown number (bundled, SIL OFL 1.1).
const countdownFont = 'BlackHanSans';

/// Figures that do not jump around while counting down.
const tabular = [FontFeature.tabularFigures()];

/// Emil-style motion: short ease-out, none when the system asks for less.
Duration motion(BuildContext context, [int ms = 200]) =>
    MediaQuery.maybeDisableAnimationsOf(context) == true ? Duration.zero : Duration(milliseconds: ms);
const motionCurve = Curves.easeOutCubic;

ThemeData buildInochiTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final p = dark ? InochiPalette.dark : InochiPalette.light;
  final scheme = ColorScheme(
    brightness: brightness,
    primary: p.ink,
    onPrimary: p.ground,
    secondary: p.ok,
    onSecondary: p.ground,
    error: p.danger,
    onError: p.ground,
    surface: p.ground,
    onSurface: p.ink,
    onSurfaceVariant: p.muted,
    surfaceContainerLowest: p.card,
    surfaceContainerLow: p.card,
    surfaceContainer: p.card,
    surfaceContainerHigh: p.card,
    surfaceContainerHighest: p.line,
    outline: p.line,
    outlineVariant: p.line,
  );
  final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(16));
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: p.ground,
    extensions: [p],
    appBarTheme: AppBarTheme(
      backgroundColor: p.ground,
      foregroundColor: p.ink,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(color: p.ink, fontSize: 20, fontWeight: FontWeight.w700),
    ),
    cardTheme: CardThemeData(elevation: 0, color: p.card, shape: shape, margin: EdgeInsets.zero),
    dividerTheme: DividerThemeData(color: p.line, space: 1, thickness: 1),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: p.card,
      hintStyle: TextStyle(color: p.muted),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: p.ink, width: 2)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: p.ink, width: 2)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: p.ink, width: 2)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 15),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: p.ink,
        foregroundColor: p.ground,
        disabledBackgroundColor: p.line,
        disabledForegroundColor: p.muted,
        minimumSize: const Size.fromHeight(56),
        shape: shape,
        textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: p.ink,
        minimumSize: const Size.fromHeight(52),
        side: BorderSide(color: p.line),
        shape: shape,
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
      ),
    ),
    textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(foregroundColor: p.ink, minimumSize: const Size(48, 48))),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((states) => states.contains(WidgetState.selected) ? p.ground : p.muted),
      trackColor: WidgetStateProperty.resolveWith((states) => states.contains(WidgetState.selected) ? p.ink : p.line),
      trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: p.ink,
      contentTextStyle: TextStyle(color: p.ground, fontSize: 15),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: p.ink, linearTrackColor: p.line),
    bottomSheetTheme: BottomSheetThemeData(backgroundColor: p.sheet, surfaceTintColor: Colors.transparent),
    dialogTheme: DialogThemeData(backgroundColor: p.card, surfaceTintColor: Colors.transparent),
    timePickerTheme: TimePickerThemeData(backgroundColor: p.card),
  );
}

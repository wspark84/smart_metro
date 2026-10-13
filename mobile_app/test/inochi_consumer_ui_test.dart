import 'package:buswakeup_mobile/core/format/kst_format.dart';
import 'package:buswakeup_mobile/features/home/home_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('times are shown in Korea time regardless of the phone time zone', () {
    expect(kstClock('2026-10-12T23:13:00Z'), '08:13');
    expect(kstClockKorean('2026-10-12T23:13:00Z'), '오전 8:13');
    expect(kstClockKorean('2026-10-13T05:05:00Z'), '오후 2:05');
    expect(kstClock(null), '--:--');
  });

  testWidgets('timetable and estimated times never look real-time', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: Column(children: [
      BasisChip(basis: 'realtime'),
      BasisChip(basis: 'timetable'),
      BasisChip(basis: 'estimate'),
    ]))));
    expect(find.text('실시간'), findsOneWidget);
    expect(find.text('시간표 기준'), findsOneWidget);
    expect(find.text('배차간격 예상'), findsOneWidget);
  });
}

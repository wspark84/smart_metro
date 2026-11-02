import 'package:buswakeup_mobile/app/inochi_theme.dart';
import 'package:buswakeup_mobile/core/format/kst_format.dart';
import 'package:buswakeup_mobile/core/network/inochi_api.dart';
import 'package:buswakeup_mobile/features/common/basis_chip.dart';
import 'package:buswakeup_mobile/features/setup/commute_inputs.dart';
import 'package:buswakeup_mobile/features/stops/stop_confirm_screen.dart';
import 'package:buswakeup_mobile/features/stops/stop_widgets.dart';
import 'package:buswakeup_mobile/features/today/today_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('times are shown in Korea time regardless of the phone time zone', () {
    expect(kstClock('2026-10-12T23:13:00Z'), '08:13');
    expect(kstClockKorean('2026-10-12T23:13:00Z'), '오전 8:13');
    expect(kstClockKorean('2026-10-13T05:05:00Z'), '오후 2:05');
    expect(kstClock(null), '--:--');
  });

  test('countdown colour follows the minutes left (C안)', () {
    expect(urgencyFor(18), Urgency.relaxed);
    expect(urgencyFor(11), Urgency.relaxed);
    expect(urgencyFor(10), Urgency.soon);
    expect(urgencyFor(4), Urgency.soon);
    expect(urgencyFor(3), Urgency.now);
    expect(urgencyFor(0), Urgency.now);
    expect(urgencyFor(25, overdue: true), Urgency.now);
    expect(urgencyFor(null), Urgency.idle);
    expect(countdownText(7), '7분');
    expect(countdownText(130), '2시간');
  });

  test('commute inputs round-trip and read naturally in Korean', () {
    expect(formatHhmm(parseHhmm('08:50')!), '08:50');
    expect(parseHhmm('25:00'), isNull);
    expect(koreanTime(const TimeOfDay(hour: 9, minute: 0)), '오전 9:00');
    expect(koreanTime(const TimeOfDay(hour: 13, minute: 5)), '오후 1:05');
    expect(stopKindLabel({'mode': 'bus', 'stationNumber': '05712'}), '버스 · 05712');
    expect(stopKindLabel({'provider': 'subway', 'lineName': '부산 2호선'}), '지하철 · 부산 2호선');
    expect(stopTitle({'provider': 'subway', 'stationName': '서면'}), '서면역');
    final payload = boardingPayload({'provider': 'tago', 'stationId': 'BSB1', 'stationName': '서면역', 'cityCode': '21', 'nodeId': 'BSB1', 'lat': '35.15', 'lng': 129.05, 'key': 'x'});
    expect(payload['lat'], 35.15);
    expect(payload.containsKey('key'), isFalse);
  });

  test('light and dark themes carry the design tokens', () {
    expect(buildInochiTheme(Brightness.light).extension<InochiPalette>()!.soonGround, const Color(0xFFF4C14F));
    expect(buildInochiTheme(Brightness.dark).extension<InochiPalette>()!.ground, const Color(0xFF141311));
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

  testWidgets('stop confirm shows the direction and switches to the opposite stop', (tester) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final north = {'key': 'tago:21:A', 'mode': 'bus', 'provider': 'tago', 'stationId': 'A', 'nodeId': 'A', 'cityCode': '21',
      'stationName': '서면역', 'stationNumber': '05712', 'lat': 35.1578, 'lng': 129.0592, 'oppositeKey': 'tago:21:B'};
    final south = {...north, 'key': 'tago:21:B', 'stationId': 'B', 'nodeId': 'B', 'stationNumber': '05713', 'lat': 35.1575, 'oppositeKey': 'tago:21:A'};
    final descriptions = <String, Map<String, dynamic>>{
      'tago:21:A': {'heading': '부전역', 'nextStop': '서면시장', 'routes': [{'routeNumber': '10'}, {'routeNumber': '57'}]},
      'tago:21:B': {'heading': '범내골역', 'nextStop': '범내골', 'routes': [{'routeNumber': '29'}]},
    };
    Map<String, dynamic>? popped;
    await tester.pumpWidget(MaterialApp(
      theme: buildInochiTheme(Brightness.light),
      home: Builder(builder: (context) => Scaffold(body: Center(child: TextButton(
        onPressed: () async {
          popped = await Navigator.of(context).push<Map<String, dynamic>>(MaterialPageRoute(builder: (_) =>
              StopConfirmScreen(api: InochiApi(), stop: north, nearby: [north, south], descriptions: descriptions)));
        },
        child: const Text('open'),
      )))),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('→ 부전역 방면으로 가는 쪽'), findsOneWidget);
    expect(find.text('반대 방향이에요'), findsOneWidget);
    expect(find.text('57'), findsOneWidget);
    await tester.tap(find.text('반대 방향이에요'));
    await tester.pumpAndSettle();
    expect(find.text('→ 범내골역 방면으로 가는 쪽'), findsOneWidget);
    await tester.tap(find.text('이 정류장에서 출발'));
    await tester.pumpAndSettle();
    expect(popped?['stationId'], 'B');
    expect(popped?['lat'], 35.1575);
  });
}

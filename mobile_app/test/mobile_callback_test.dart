import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:buswakeup_mobile/core/network/mobile_social_auth.dart';

void main() {
  test('mobile callback is an absolute valid URI matching Android intent filter', () {
    final uri = Uri.parse(MobileSocialAuth.callback);
    expect(uri.hasScheme, isTrue);
    expect(uri.scheme, matches(RegExp(r'^[a-z][a-z0-9+.-]*$')));
    expect(uri.host, 'login-callback');
    expect(uri.path, '/');
    final manifest = File('android/app/src/main/AndroidManifest.xml').readAsStringSync();
    expect(manifest, contains('android:scheme="${uri.scheme}"'));
    expect(manifest, contains('android:host="${uri.host}"'));
  });
  test('callback accepts only the app callback origin and path', () {
    expect(MobileSocialAuth.acceptsCallback(Uri.parse('${MobileSocialAuth.callback}?code=test')), isTrue);
    for (final value in ['https://smart-metro.vercel.app/', 'com.smartmetro.app://wrong/',
      'com.smartmetro.app://login-callback/other', 'com.smartmetro.app://user@login-callback/',
      'com.smartmetro.app://login-callback:123/']) {
      expect(MobileSocialAuth.acceptsCallback(Uri.parse(value)), isFalse);
    }
  });
}

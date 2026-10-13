import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:in_app_purchase_android/in_app_purchase_android.dart';
import 'mobile_api_client.dart';
import 'mobile_social_auth.dart';

class PlayBilling extends ChangeNotifier {
  PlayBilling(this.api, this.userId);
  static const productId = 'inochi_schedule_monthly';
  final MobileApiClient api;
  final String userId;
  final _store = InAppPurchase.instance;
  StreamSubscription<List<PurchaseDetails>>? _stream;
  Map<String, dynamic> status = {};
  ProductDetails? product;
  bool busy = false;
  bool _disposed = false;
  String message = '';
  final Set<String> _processing = {};
  bool get active => status['active'] == true;
  bool get sameAccount => MobileSocialAuth.ready && MobileSocialAuth.client.auth.currentUser?.id == userId;
  void _notify() { if (!_disposed) notifyListeners(); }
  Future<void> initialize() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) {
      message = '구독 결제는 안드로이드 앱에서 지원합니다.'; _notify(); return;
    }
    _stream ??= _store.purchaseStream.listen((items) { unawaited(_handle(items)); }, onError: (_) {
      message = '결제 정보를 확인하지 못했습니다. 구매 복원을 눌러 주세요.'; busy = false; _notify();
    });
    await refresh();
  }
  Future<void> refresh() async {
    busy = true; _notify();
    try {
      status = await api.fetchSubscription();
      if (!sameAccount) return;
      if (status['available'] != true) { message = '구독 결제 연결을 준비 중입니다. 아직 결제되지 않습니다.'; return; }
      if (!await _store.isAvailable()) { message = 'Google Play에 연결하지 못했습니다.'; return; }
      final result = await _store.queryProductDetails({productId});
      product = null;
      for (final item in result.productDetails.whereType<GooglePlayProductDetails>()) {
        final index = item.subscriptionIndex;
        if (index == null) continue;
        final offer = item.productDetails.subscriptionOfferDetails![index];
        if (offer.basePlanId == 'monthly' && offer.offerId == null &&
            offer.pricingPhases.length == 1 && offer.pricingPhases.first.billingPeriod == 'P1M' &&
            item.currencyCode == 'KRW' && item.rawPrice == 5000) { product = item; break; }
      }
      message = product == null ? '월 5,000원 구독 상품을 불러오지 못했습니다. Play 스토어 설치와 상품 등록 상태를 확인해 주세요.' : '';
    } catch (_) { message = '구독 상태를 확인하지 못했습니다. 다시 확인해 주세요.'; status = {}; }
    finally { busy = false; _notify(); }
  }
  Future<void> buy() async {
    if (busy || !sameAccount || product == null || active) return;
    busy = true; message = ''; _notify();
    try {
      final launched = await _store.buyNonConsumable(purchaseParam: PurchaseParam(
        productDetails: product!, applicationUserName: status['accountId'] as String));
      if (!launched) { busy = false; message = '결제창을 열지 못했습니다.'; _notify(); }
    } catch (_) { busy = false; message = '결제를 시작하지 못했습니다. 다시 시도해 주세요.'; _notify(); }
  }
  Future<void> restore() async {
    if (busy || !sameAccount) return;
    busy = true; _notify();
    try { await _store.restorePurchases(applicationUserName: status['accountId'] as String?); message = '구매 복원을 요청했습니다.'; }
    catch (_) { message = '구매 복원에 실패했습니다. 다시 시도해 주세요.'; }
    finally { busy = false; _notify(); }
  }
  Future<void> _handle(List<PurchaseDetails> items) async {
    for (final purchase in items) {
      if (!sameAccount || _disposed || purchase.productID != productId) continue;
      if (purchase.status == PurchaseStatus.pending) { busy = true; message = 'Google Play 결제 승인을 기다리고 있습니다.'; _notify(); continue; }
      if (purchase.status == PurchaseStatus.canceled || purchase.status == PurchaseStatus.error) {
        busy = false; message = purchase.status == PurchaseStatus.canceled ? '결제를 취소했습니다.' : '결제에 실패했습니다.'; _notify(); continue;
      }
      if (purchase.status != PurchaseStatus.purchased && purchase.status != PurchaseStatus.restored) continue;
      final token = purchase.verificationData.serverVerificationData;
      if (!_processing.add(token)) continue;
      try {
        final verified = await api.verifySubscription(token);
        if (!sameAccount || _disposed) continue;
        status = verified;
        if (purchase.pendingCompletePurchase) await _store.completePurchase(purchase);
        message = active ? '구독이 확인되었습니다. 일정 자동 알림을 사용할 수 있습니다.' : '현재 이용 가능한 구독이 없습니다.';
      } catch (_) { message = '결제 확인이 지연되고 있습니다. 다시 결제하지 말고 구매 복원을 눌러 주세요.'; }
      finally { _processing.remove(token); busy = false; _notify(); }
    }
  }
  @override void dispose() { _disposed = true; _stream?.cancel(); super.dispose(); }
}

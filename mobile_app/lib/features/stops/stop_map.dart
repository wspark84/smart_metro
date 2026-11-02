import 'dart:async';

import 'package:flutter/material.dart';
import 'package:kakao_map_sdk/kakao_map_sdk.dart' as kakao;

import '../../app/inochi_theme.dart';

/// Kakao map setup. The native app key comes from the build:
/// `--dart-define=KAKAO_NATIVE_APP_KEY=...`. Without it the stop screens
/// still work as lists (no map), so a missing key never blocks setup.
class KakaoMapSetup {
  static const appKey = String.fromEnvironment('KAKAO_NATIVE_APP_KEY');
  static bool ready = false;

  static Future<void> initialize() async {
    if (appKey.isEmpty) return;
    try {
      await kakao.KakaoMapSdk.instance.initialize(appKey);
      ready = true;
    } catch (_) {
      ready = false;
    }
  }
}

enum PinKind { bus, busAlt, subway, here, opposite }

class MapPin {
  const MapPin({required this.id, required this.lat, required this.lng, required this.kind, this.label = ''});
  final String id;
  final double lat;
  final double lng;
  final PinKind kind;
  final String label;

  @override
  bool operator ==(Object other) =>
      other is MapPin && other.id == id && other.lat == lat && other.lng == lng && other.kind == kind && other.label == label;
  @override
  int get hashCode => Object.hash(id, lat, lng, kind, label);
}

/// Map with numbered stop pins. [onMoved] fires when the *user* finishes
/// panning (not when the app moves the camera), with the new centre.
class StopMap extends StatefulWidget {
  const StopMap({
    super.key,
    required this.lat,
    required this.lng,
    required this.pins,
    this.zoomLevel = 17,
    this.onPinTap,
    this.onMoved,
    this.fitPins = false,
  });

  final double lat;
  final double lng;
  final List<MapPin> pins;
  final int zoomLevel;
  final void Function(String id)? onPinTap;
  final void Function(double lat, double lng)? onMoved;
  final bool fitPins;

  static bool get available => KakaoMapSetup.ready;

  @override
  State<StopMap> createState() => _StopMapState();
}

class _StopMapState extends State<StopMap> {
  kakao.KakaoMapController? _controller;
  final List<kakao.Poi> _pois = [];
  int _drawGeneration = 0;
  bool _failed = false;

  @override
  void didUpdateWidget(covariant StopMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    final controller = _controller;
    if (controller == null) return;
    if (oldWidget.lat != widget.lat || oldWidget.lng != widget.lng) {
      unawaited(_moveCamera(controller));
    }
    if (!_samePins(oldWidget.pins, widget.pins)) unawaited(_drawPins(controller));
  }

  static bool _samePins(List<MapPin> a, List<MapPin> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }

  Future<void> _moveCamera(kakao.KakaoMapController controller) async {
    try {
      final reduce = MediaQuery.maybeDisableAnimationsOf(context) == true;
      if (widget.fitPins && widget.pins.length > 1) {
        await controller.moveCamera(
          kakao.CameraUpdate.fitMapPoints([for (final pin in widget.pins) kakao.LatLng(pin.lat, pin.lng)], padding: 80),
          animation: reduce ? null : const kakao.CameraAnimation(250),
        );
      } else {
        await controller.moveCamera(
          kakao.CameraUpdate.newCenterPosition(kakao.LatLng(widget.lat, widget.lng), zoomLevel: widget.zoomLevel),
          animation: reduce ? null : const kakao.CameraAnimation(250),
        );
      }
    } catch (_) {
      // Camera moves are best effort.
    }
  }

  Future<void> _drawPins(kakao.KakaoMapController controller) async {
    final generation = ++_drawGeneration;
    final palette = InochiPalette.of(context);
    for (final poi in List<kakao.Poi>.from(_pois)) {
      try {
        await controller.labelLayer.removePoi(poi);
      } catch (_) {}
    }
    _pois.clear();
    for (final pin in widget.pins) {
      if (generation != _drawGeneration || !mounted) return;
      try {
        final size = pin.kind == PinKind.here ? const Size(104, 64) : pin.kind == PinKind.opposite ? const Size(96, 40) : const Size(34, 44);
        final icon = await kakao.KImage.fromWidget(_PinGraphic(pin: pin, palette: palette), size);
        if (generation != _drawGeneration || !mounted) return;
        final poi = await controller.labelLayer.addPoi(
          kakao.LatLng(pin.lat, pin.lng),
          style: kakao.PoiStyle(icon: icon, anchor: kakao.KPoint(0.5, pin.kind == PinKind.opposite ? 0.2 : 1.0)),
          onClick: widget.onPinTap == null ? null : () => widget.onPinTap?.call(pin.id),
        );
        _pois.add(poi);
      } catch (_) {
        // A pin that fails to draw is still in the list below the map.
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!StopMap.available || _failed) return _MapUnavailable(palette: InochiPalette.of(context));
    return Stack(children: [
      Positioned.fill(
        child: kakao.KakaoMap(
          option: kakao.KakaoMapOption(position: kakao.LatLng(widget.lat, widget.lng), zoomLevel: widget.zoomLevel),
          onMapReady: (controller) {
            _controller = controller;
            if (widget.fitPins) unawaited(_moveCamera(controller));
            unawaited(_drawPins(controller));
          },
          onMapError: (_) {
            if (mounted) setState(() => _failed = true);
          },
          onCameraMoveEnd: (position, gesture) {
            if (gesture == kakao.GestureType.unknown) return;
            widget.onMoved?.call(position.position.latitude, position.position.longitude);
          },
        ),
      ),
      Positioned(
        right: 8,
        bottom: 6,
        child: IgnorePointer(child: Text('지도: 카카오맵', style: TextStyle(fontSize: 10, color: InochiPalette.of(context).muted))),
      ),
    ]);
  }
}

class _MapUnavailable extends StatelessWidget {
  const _MapUnavailable({required this.palette});
  final InochiPalette palette;

  @override
  Widget build(BuildContext context) => ColoredBox(
        color: palette.line,
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Text('지도를 표시할 수 없어요. 아래 목록의 정류장 번호와 방면으로 확인해 주세요.',
                textAlign: TextAlign.center, style: TextStyle(color: palette.muted)),
          ),
        ),
      );
}

/// Pin artwork rendered to an image for the map (same look as the list).
class _PinGraphic extends StatelessWidget {
  const _PinGraphic({required this.pin, required this.palette});
  final MapPin pin;
  final InochiPalette palette;

  @override
  Widget build(BuildContext context) {
    final label = Text(pin.label,
        style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: pin.kind == PinKind.busAlt ? palette.ink : palette.ground));
    switch (pin.kind) {
      case PinKind.here:
        return Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(color: palette.ink, borderRadius: BorderRadius.circular(10)),
            child: Text('여기서 타요', style: TextStyle(color: palette.ground, fontSize: 13, fontWeight: FontWeight.w700)),
          ),
          Container(width: 2, height: 12, color: palette.ink),
          Container(
            width: 16,
            height: 16,
            decoration: BoxDecoration(color: palette.ink, shape: BoxShape.circle, border: Border.all(color: palette.ground, width: 3)),
          ),
        ]);
      case PinKind.opposite:
        return Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 12,
            height: 12,
            decoration: BoxDecoration(color: palette.card, shape: BoxShape.circle, border: Border.all(color: palette.muted, width: 2)),
          ),
          const SizedBox(height: 4),
          Text(pin.label, style: TextStyle(fontSize: 12, color: palette.muted)),
        ]);
      case PinKind.subway:
        return Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: palette.subway, borderRadius: BorderRadius.circular(8)),
            child: Text(pin.label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Colors.white)),
          ),
          const SizedBox(height: 14),
        ]);
      case PinKind.bus:
      case PinKind.busAlt:
        return Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: pin.kind == PinKind.bus ? palette.ink : palette.card,
              shape: BoxShape.circle,
              border: Border.all(color: palette.ink, width: 2),
            ),
            child: label,
          ),
          Container(width: 2, height: 10, color: palette.ink),
        ]);
    }
  }
}

import 'package:flutter/material.dart';

import '../../core/network/inochi_api.dart';
import '../home/home_screen.dart' show BasisChip;

/// Finds the stop or station where the user boards. Returns the fields the
/// server needs: `{provider, stationId, stationName, arsId, cityCode, nodeId,
/// lineName, lat, lng}`.
class StopSearchScreen extends StatefulWidget {
  const StopSearchScreen({super.key, required this.api, required this.subway, this.initialCityId = ''});
  final InochiApi api;
  final bool subway;
  final String initialCityId;

  @override
  State<StopSearchScreen> createState() => _StopSearchScreenState();
}

class _StopSearchScreenState extends State<StopSearchScreen> {
  final _controller = TextEditingController();
  List<Map<String, dynamic>> _cities = const [];
  Map<String, dynamic>? _city;
  List<Map<String, dynamic>> _results = const [];
  List<String> _warnings = const [];
  bool _loading = false;
  String _message = '';

  bool get _subway => widget.subway;

  @override
  void initState() {
    super.initState();
    _message = _subway ? '역 이름을 입력해 주세요. 예: 서면, 강남, 반월당' : '먼저 도시를 고른 뒤 정류장 이름이나 번호를 입력해 주세요.';
    if (!_subway) _loadCities();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _loadCities() async {
    setState(() => _loading = true);
    try {
      final cities = await widget.api.busCities();
      if (!mounted) return;
      setState(() {
        _cities = cities.where((city) => city['available'] == true).toList();
        _city = _cities.cast<Map<String, dynamic>?>().firstWhere((city) => city?['id'] == widget.initialCityId, orElse: () => null);
      });
    } catch (error) {
      if (mounted) setState(() => _message = error is InochiApiException ? error.message : '도시 목록을 불러오지 못했습니다.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickCity() async {
    final picked = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _CityPicker(cities: _cities),
    );
    if (picked != null) setState(() => _city = picked);
  }

  Future<void> _search() async {
    final keyword = _controller.text.trim();
    if (keyword.isEmpty) return;
    if (!_subway && _city == null) {
      setState(() => _message = '도시를 먼저 선택해 주세요.');
      return;
    }
    setState(() {
      _loading = true;
      _message = '';
      _warnings = const [];
    });
    try {
      final result = _subway
          ? await widget.api.searchSubwayStations(keyword)
          : await widget.api.searchBusStops(cityId: '${_city!['id']}', keyword: keyword);
      final stations = (result['stations'] is List ? result['stations'] as List : const [])
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .where((item) => _lat(item) != null && _lng(item) != null)
          .toList();
      if (!mounted) return;
      setState(() {
        _results = stations;
        _warnings = (result['warnings'] is List ? result['warnings'] as List : const []).map((e) => '$e').toList();
        _message = stations.isEmpty ? '찾는 ${_subway ? '역' : '정류장'}이 없어요. 이름을 다시 확인해 주세요.' : '';
      });
    } catch (error) {
      if (mounted) setState(() => _message = error is InochiApiException ? error.message : '검색하지 못했습니다.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  static double? _lat(Map<String, dynamic> item) => double.tryParse('${item['posY'] ?? item['lat'] ?? ''}');
  static double? _lng(Map<String, dynamic> item) => double.tryParse('${item['posX'] ?? item['lng'] ?? ''}');

  Future<void> _confirm(Map<String, dynamic> candidate) async {
    final provider = '${candidate['provider'] ?? (_subway ? 'subway' : '')}';
    final stop = <String, dynamic>{...candidate, 'provider': provider};
    final chosen = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _StopPreview(api: widget.api, stop: stop, subway: _subway),
    );
    if (chosen == null || !mounted) return;
    Navigator.of(context).pop(<String, dynamic>{
      'provider': '${chosen['provider'] ?? provider}',
      'stationId': '${chosen['stationId'] ?? ''}',
      'stationName': '${chosen['stationName'] ?? ''}',
      'arsId': '${chosen['arsId'] ?? ''}',
      'cityCode': '${chosen['cityCode'] ?? ''}',
      'nodeId': '${chosen['nodeId'] ?? ''}',
      'lineName': _subway ? '${chosen['lineName'] ?? ''}' : '',
      'cityId': '${chosen['cityId'] ?? _city?['id'] ?? ''}',
      'lat': _lat(chosen) ?? _lat(stop),
      'lng': _lng(chosen) ?? _lng(stop),
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_subway ? '출발 지하철역 찾기' : '출발 버스 정류장 찾기')),
      body: Column(children: [
        if (!_subway)
          ListTile(
            leading: const Icon(Icons.location_city_outlined),
            title: Text(_city == null ? '도시 선택' : '${_city!['cityName']}'),
            subtitle: _city != null && _city!['arrivalSupport'] == 'unavailable' ? const Text('이 지역은 실시간 도착정보가 없어 배차간격 기준으로 예상해요.') : null,
            trailing: const Icon(Icons.expand_more),
            onTap: _cities.isEmpty ? null : _pickCity,
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: TextField(
            controller: _controller,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _search(),
            decoration: InputDecoration(
              hintText: _subway ? '역 이름' : '정류장 이름 또는 번호',
              suffixIcon: IconButton(icon: const Icon(Icons.search), onPressed: _loading ? null : _search, tooltip: '검색'),
            ),
          ),
        ),
        if (_loading) const LinearProgressIndicator(),
        if (_message.isNotEmpty) Padding(padding: const EdgeInsets.all(16), child: Text(_message)),
        for (final warning in _warnings)
          Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4), child: Text(warning, style: const TextStyle(fontSize: 12))),
        Expanded(
          child: ListView.separated(
            itemCount: _results.length,
            separatorBuilder: (context, index) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final item = _results[index];
              final number = '${item['stationNumber'] ?? item['arsId'] ?? ''}'.trim();
              final detail = [
                if (_subway) '${item['lineName'] ?? ''}',
                '${item['address'] ?? ''}',
                if (!_subway && number.isNotEmpty) '정류장 번호 $number',
                if (!_subway) '${item['providerLabel'] ?? ''}',
              ].where((text) => text.trim().isNotEmpty).join(' · ');
              return ListTile(
                leading: Icon(_subway ? Icons.subway_outlined : Icons.directions_bus_outlined),
                title: Text('${item['displayName'] ?? item['stationName'] ?? ''}'),
                subtitle: detail.isEmpty ? null : Text(detail),
                onTap: () => _confirm(item),
              );
            },
          ),
        ),
      ]),
    );
  }
}

class _CityPicker extends StatefulWidget {
  const _CityPicker({required this.cities});
  final List<Map<String, dynamic>> cities;

  @override
  State<_CityPicker> createState() => _CityPickerState();
}

class _CityPickerState extends State<_CityPicker> {
  String _filter = '';

  @override
  Widget build(BuildContext context) {
    final cities = widget.cities.where((city) => '${city['cityName']}'.contains(_filter)).toList();
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.75,
      child: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: TextField(
            autofocus: true,
            decoration: const InputDecoration(hintText: '도시 이름 (예: 부산, 수원, 청주)', prefixIcon: Icon(Icons.search)),
            onChanged: (value) => setState(() => _filter = value.trim()),
          ),
        ),
        Expanded(
          child: ListView.builder(
            itemCount: cities.length,
            itemBuilder: (context, index) => ListTile(
              title: Text('${cities[index]['cityName']}'),
              subtitle: cities[index]['arrivalSupport'] == 'unavailable' ? const Text('정류장 검색만 지원 · 실시간 도착정보 없음') : null,
              onTap: () => Navigator.of(context).pop(cities[index]),
            ),
          ),
        ),
      ]),
    );
  }
}

/// Shows which buses / train directions serve the stop before saving it, and
/// lets the server confirm the stop's official identity.
class _StopPreview extends StatefulWidget {
  const _StopPreview({required this.api, required this.stop, required this.subway});
  final InochiApi api;
  final Map<String, dynamic> stop;
  final bool subway;

  @override
  State<_StopPreview> createState() => _StopPreviewState();
}

class _StopPreviewState extends State<_StopPreview> {
  bool _loading = true;
  String _error = '';
  List<Map<String, dynamic>> _routes = const [];
  Map<String, dynamic>? _verified;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final stop = widget.stop;
      final result = await widget.api.stopRoutes({
        ...stop,
        'nodeId': stop['nodeId'] ?? stop['stationId'],
        'posX': stop['posX'] ?? stop['lng'],
        'posY': stop['posY'] ?? stop['lat'],
      });
      if (!mounted) return;
      setState(() {
        _routes = (result['routes'] is List ? result['routes'] as List : const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
        _verified = result['verifiedStation'] is Map ? Map<String, dynamic>.from(result['verifiedStation'] as Map) : null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error is InochiApiException ? error.message : '노선 정보를 확인하지 못했습니다.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final stop = _verified == null ? widget.stop : {...widget.stop, ..._verified!};
    final scheme = Theme.of(context).colorScheme;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${stop['displayName'] ?? stop['stationName'] ?? ''}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          if ('${stop['address'] ?? ''}'.isNotEmpty) Text('${stop['address']}', style: TextStyle(color: scheme.onSurfaceVariant)),
          const SizedBox(height: 12),
          if (_loading) const LinearProgressIndicator(),
          if (_error.isNotEmpty) Text(_error, style: TextStyle(color: scheme.error)),
          if (!_loading && _error.isEmpty && _routes.isEmpty) const Text('이 곳을 지나는 노선을 확인하지 못했어요. 다른 정류장을 선택해 보세요.'),
          if (_routes.isNotEmpty) ...[
            Text(widget.subway ? '이 역에서 탈 수 있는 방향' : '이 정류장을 지나는 버스', style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            ConstrainedBox(
              constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.35),
              child: SingleChildScrollView(
                child: widget.subway
                    ? Column(children: [
                        for (final route in _routes)
                          ListTile(
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            title: Text('${route['routeNumber'] ?? ''} · ${route['direction'] ?? ''} · ${route['destinationName'] ?? route['nextStation'] ?? ''} 방면'),
                            trailing: BasisChip(basis: '${route['basis'] ?? (route['realtime'] == false ? 'timetable' : 'realtime')}'),
                          ),
                      ])
                    : Wrap(spacing: 6, runSpacing: 6, children: [
                        for (final route in _routes) Chip(label: Text('${route['routeNumber'] ?? ''}')),
                      ]),
              ),
            ),
            const SizedBox(height: 8),
            Text('목적지까지 가는 노선과 방향은 자동으로 골라 비교해요.', style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
          ],
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _loading || _routes.isEmpty ? null : () => Navigator.of(context).pop(stop),
            child: Text(widget.subway ? '이 역에서 출발' : '이 정류장에서 출발'),
          ),
        ]),
      ),
    );
  }
}

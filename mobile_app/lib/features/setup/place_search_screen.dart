import 'package:flutter/material.dart';

import '../../core/network/inochi_api.dart';

/// Searches a destination (company, school …) and returns
/// `{address, label, lat, lng}`.
class PlaceSearchScreen extends StatefulWidget {
  const PlaceSearchScreen({super.key, required this.api, this.title = '도착지 검색'});
  final InochiApi api;
  final String title;

  @override
  State<PlaceSearchScreen> createState() => _PlaceSearchScreenState();
}

class _PlaceSearchScreenState extends State<PlaceSearchScreen> {
  final _controller = TextEditingController();
  List<Map<String, dynamic>> _results = const [];
  bool _loading = false;
  String _message = '회사·학교 이름이나 주소를 입력해 주세요.';

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    final query = _controller.text.trim();
    if (query.length < 2) {
      setState(() => _message = '두 글자 이상 입력해 주세요.');
      return;
    }
    setState(() {
      _loading = true;
      _message = '';
    });
    try {
      final results = await widget.api.searchPlaces(query);
      if (!mounted) return;
      setState(() {
        _results = results.where((item) => double.tryParse('${item['lat']}') != null && double.tryParse('${item['lng']}') != null).toList();
        _message = _results.isEmpty ? '검색 결과가 없어요. 다른 이름이나 주소로 찾아 보세요.' : '';
      });
    } catch (error) {
      if (mounted) setState(() => _message = error is InochiApiException ? error.message : '검색하지 못했습니다.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: TextField(
            controller: _controller,
            autofocus: true,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _search(),
            decoration: InputDecoration(
              hintText: '예: 센텀시티, 판교역로 166',
              suffixIcon: IconButton(icon: const Icon(Icons.search), onPressed: _loading ? null : _search, tooltip: '검색'),
            ),
          ),
        ),
        if (_loading) const LinearProgressIndicator(),
        if (_message.isNotEmpty) Padding(padding: const EdgeInsets.all(16), child: Text(_message)),
        Expanded(
          child: ListView.separated(
            itemCount: _results.length,
            separatorBuilder: (context, index) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final item = _results[index];
              final name = '${item['placeName'] ?? ''}'.trim();
              final address = '${item['roadAddress'] ?? ''}'.trim().isNotEmpty ? '${item['roadAddress']}' : '${item['jibunAddress'] ?? item['label'] ?? ''}';
              return ListTile(
                leading: const Icon(Icons.place_outlined),
                title: Text(name.isNotEmpty ? name : address),
                subtitle: name.isNotEmpty ? Text(address) : null,
                onTap: () => Navigator.of(context).pop(<String, dynamic>{
                  'address': address,
                  'label': name.isNotEmpty ? name : address,
                  'lat': double.parse('${item['lat']}'),
                  'lng': double.parse('${item['lng']}'),
                }),
              );
            },
          ),
        ),
      ]),
    );
  }
}

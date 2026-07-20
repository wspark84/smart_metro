import 'package:flutter/material.dart';

import '../../core/network/mobile_api_client.dart';

class AuthWorkspaceScreen extends StatefulWidget {
  const AuthWorkspaceScreen({
    super.key,
    required this.apiClient,
    required this.onAuthenticated,
    required this.sessionError,
  });

  final MobileApiClient apiClient;
  final Future<void> Function() onAuthenticated;
  final String sessionError;

  @override
  State<AuthWorkspaceScreen> createState() => _AuthWorkspaceScreenState();
}

class _AuthWorkspaceScreenState extends State<AuthWorkspaceScreen> {
  late final TextEditingController _baseUrlController;
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();

  bool _registerMode = false;
  bool _submitting = false;
  bool _checkingServer = false;
  String _error = '';
  String _serverStatus = '';
  Map<String, dynamic>? _serverHealth;

  @override
  void initState() {
    super.initState();
    _baseUrlController = TextEditingController(text: widget.apiClient.baseUrl);
  }

  @override
  void dispose() {
    _baseUrlController.dispose();
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _checkServerConnection() async {
    setState(() {
      _checkingServer = true;
      _serverStatus = '';
      _error = '';
    });

    try {
      await widget.apiClient.updateBaseUrlAndPersist(_baseUrlController.text);
      final payload = await widget.apiClient.fetchMobileHealth();
      if (!mounted) {
        return;
      }
      setState(() {
        _serverHealth = payload;
        _serverStatus =
            'BusWakeUp server reachable at ${widget.apiClient.baseUrl}.';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _serverHealth = null;
        _serverStatus = error.toString();
      });
    } finally {
      if (mounted) {
        setState(() {
          _checkingServer = false;
        });
      }
    }
  }

  Future<void> _submit() async {
    setState(() {
      _submitting = true;
      _error = '';
    });

    try {
      await widget.apiClient.updateBaseUrlAndPersist(_baseUrlController.text);

      if (_registerMode) {
        await widget.apiClient.register(
          name: _nameController.text.trim(),
          email: _emailController.text.trim(),
          password: _passwordController.text,
        );
      } else {
        await widget.apiClient.login(
          email: _emailController.text.trim(),
          password: _passwordController.text,
        );
      }

      await widget.onAuthenticated();
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = error.toString();
      });
    } finally {
      if (mounted) {
        setState(() {
          _submitting = false;
        });
      }
    }
  }

  Map<String, dynamic> _map(dynamic source) {
    if (source is Map<String, dynamic>) {
      return source;
    }
    return <String, dynamic>{};
  }

  String _readString(
    dynamic source,
    String key, {
    String fallback = '-',
  }) {
    final map = _map(source);
    final value = map[key];
    if (value == null) {
      return fallback;
    }
    final text = '$value'.trim();
    return text.isEmpty ? fallback : text;
  }

  List<String> _readList(dynamic value) {
    if (value is List) {
      return value
          .map((item) => '$item'.trim())
          .where((item) => item.isNotEmpty)
          .toList();
    }
    return <String>[];
  }

  String _joinList(dynamic value, {String fallback = '-'}) {
    final items = _readList(value);
    if (items.isEmpty) {
      return fallback;
    }
    return items.join(', ');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final health = _serverHealth ?? <String, dynamic>{};
    final busPolicy = _map(health['busPolicy']);
    final pushGateway = _map(health['pushGateway']);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: ListView(
              padding: const EdgeInsets.all(24),
              children: <Widget>[
                const SizedBox(height: 24),
                Text(
                  'BusWakeUp Mobile',
                  style: theme.textTheme.headlineSmall,
                ),
                const SizedBox(height: 10),
                Text(
                  'This is the first mobile shell for the Seoul and Gyeonggi launch. Check the server URL first, then sign in or create a local prototype account to open the operations dashboard.',
                  style: theme.textTheme.bodyLarge,
                ),
                const SizedBox(height: 24),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          'Server connection',
                          style: theme.textTheme.titleMedium,
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _baseUrlController,
                          keyboardType: TextInputType.url,
                          decoration: const InputDecoration(
                            labelText: 'Base URL',
                            hintText: 'http://127.0.0.1:4173',
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(
                          'Set the BusWakeUp server URL that your simulator or device can reach. You can enter 192.168.0.10:4173 and the app will add http:// automatically. For a real phone, use a LAN or HTTPS host instead of localhost.',
                          style: theme.textTheme.bodySmall,
                        ),
                        const SizedBox(height: 16),
                        Wrap(
                          spacing: 12,
                          runSpacing: 12,
                          children: <Widget>[
                            ElevatedButton(
                              onPressed: _checkingServer || _submitting
                                  ? null
                                  : _checkServerConnection,
                              child: Text(
                                _checkingServer
                                    ? 'Checking server...'
                                    : 'Save and check server',
                              ),
                            ),
                            OutlinedButton(
                              onPressed: _checkingServer || _submitting
                                  ? null
                                  : () {
                                      setState(() {
                                        _baseUrlController.text =
                                            'http://127.0.0.1:4173';
                                        _serverStatus = '';
                                        _serverHealth = null;
                                      });
                                    },
                              child: const Text('Use default local URL'),
                            ),
                          ],
                        ),
                        if (_serverStatus.isNotEmpty) ...<Widget>[
                          const SizedBox(height: 12),
                          Text(
                            _serverStatus,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: _serverHealth != null
                                  ? theme.colorScheme.primary
                                  : theme.colorScheme.error,
                            ),
                          ),
                        ],
                        if (_serverHealth != null) ...<Widget>[
                          const SizedBox(height: 16),
                          const Divider(height: 1),
                          const SizedBox(height: 16),
                          Text(
                            'Server preflight',
                            style: theme.textTheme.titleSmall,
                          ),
                          const SizedBox(height: 12),
                          _AuthInfoRow(
                            label: 'Reachability',
                            value: _readString(health, 'ok', fallback: '') == 'true'
                                ? 'REACHABLE'
                                : 'CHECK NEEDED',
                          ),
                          _AuthInfoRow(
                            label: 'Product',
                            value: _readString(health, 'product', fallback: '-'),
                          ),
                          _AuthInfoRow(
                            label: 'Launch focus',
                            value: _joinList(health['launchFocus']),
                          ),
                          _AuthInfoRow(
                            label: 'Session probe',
                            value: _readString(
                              health,
                              'sessionProbePath',
                              fallback: '-',
                            ),
                          ),
                          _AuthInfoRow(
                            label: 'Push mode',
                            value: _readString(pushGateway, 'mode', fallback: '-'),
                          ),
                          _AuthInfoRow(
                            label: 'Push lane',
                            value: _readString(
                              pushGateway,
                              'adapter',
                              fallback: '-',
                            ),
                          ),
                          _AuthInfoRow(
                            label: 'Recommended ETA order',
                            value: _joinList(
                              busPolicy['recommendedProviderOrder'],
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          _registerMode ? 'Create account' : 'Sign in',
                          style: theme.textTheme.titleMedium,
                        ),
                        const SizedBox(height: 16),
                        if (_registerMode) ...<Widget>[
                          TextField(
                            controller: _nameController,
                            decoration: const InputDecoration(
                              labelText: 'Name',
                              hintText: 'Representative name or nickname',
                            ),
                          ),
                          const SizedBox(height: 12),
                        ],
                        TextField(
                          controller: _emailController,
                          keyboardType: TextInputType.emailAddress,
                          decoration: const InputDecoration(
                            labelText: 'Email',
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _passwordController,
                          obscureText: true,
                          decoration: const InputDecoration(
                            labelText: 'Password',
                          ),
                        ),
                        const SizedBox(height: 16),
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton(
                            onPressed: _submitting || _checkingServer ? null : _submit,
                            child: Text(_registerMode ? 'Create account' : 'Sign in'),
                          ),
                        ),
                        const SizedBox(height: 10),
                        TextButton(
                          onPressed: _submitting || _checkingServer
                              ? null
                              : () {
                                  setState(() {
                                    _registerMode = !_registerMode;
                                    _error = '';
                                  });
                                },
                          child: Text(
                            _registerMode
                                ? 'Already have an account? Sign in'
                                : 'Need a local prototype account? Create one',
                          ),
                        ),
                        if (_error.isNotEmpty) ...<Widget>[
                          const SizedBox(height: 8),
                          Text(
                            _error,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.error,
                            ),
                          ),
                        ],
                        if (widget.sessionError.isNotEmpty) ...<Widget>[
                          const SizedBox(height: 8),
                          Text(
                            widget.sessionError,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.error,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AuthInfoRow extends StatelessWidget {
  const _AuthInfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(
            width: 148,
            child: Text(
              label,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Expanded(
            child: Text(value, style: theme.textTheme.bodyMedium),
          ),
        ],
      ),
    );
  }
}


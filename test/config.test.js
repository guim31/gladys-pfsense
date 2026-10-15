// -----------------------------------------------------------------------------
// Normalization of the configuration: the address in its usual forms, never
// with credentials, the lists, the numbers typed as text.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, displayUrl, normalizeConfig, parseUrl } from '../src/config.js';

test('addresses: HTTPS by default, a port, the path dropped, never credentials', () => {
  assert.deepEqual(parseUrl('192.0.2.1'), { protocol: 'https:', host: '192.0.2.1', port: null });
  assert.deepEqual(parseUrl('https://fw.home.arpa:8443/index.php'), {
    protocol: 'https:',
    host: 'fw.home.arpa',
    port: 8443,
  });
  assert.deepEqual(parseUrl(' http://192.0.2.1 '), {
    protocol: 'http:',
    host: '192.0.2.1',
    port: null,
  });
  assert.deepEqual(parseUrl('[2001:db8::1]:444'), {
    protocol: 'https:',
    host: '2001:db8::1',
    port: 444,
  });
  assert.equal(parseUrl('https://admin:pfsense@192.0.2.1'), null);
  assert.equal(parseUrl('ftp://192.0.2.1'), null);
  assert.equal(parseUrl(''), null);
  assert.equal(displayUrl(parseUrl('[2001:db8::1]:444')), 'https://[2001:db8::1]:444');
});

test('defaults, lists and numbers', () => {
  const config = normalizeConfig({});
  assert.equal(config.target, null);
  assert.equal(config.invalidUrl, false);
  assert.equal(config.pollIntervalMs, 30_000);
  assert.equal(config.awayDelayMs, DEFAULT_CONFIG.away_delay * 60_000);
  assert.equal(config.allowCommands, false);
  assert.equal(config.language, 'fr');
  const custom = normalizeConfig({
    url: 'nope://',
    api_key: '  abc  ',
    poll_interval: 15,
    away_delay: '2,6',
    gateways: 'A, B; A, C, D, E',
    firewall_rules: 'One, , Two',
    allow_commands: 'true',
    language: 'it',
  });
  assert.equal(custom.invalidUrl, true);
  assert.equal(custom.apiKey, 'abc');
  assert.equal(custom.pollIntervalMs, 15_000);
  assert.equal(custom.awayDelayMs, 3 * 60_000);
  assert.deepEqual(custom.gateways, ['A', 'B', 'C', 'D']);
  assert.deepEqual(custom.rules, ['One', 'Two']);
  assert.equal(custom.allowCommands, true);
  assert.equal(custom.language, 'fr');
  assert.equal(normalizeConfig({ away_delay: 500 }).awayDelayMs, 60 * 60_000);
  assert.equal(normalizeConfig({ poll_interval: '5' }).pollIntervalMs, 30_000);
});

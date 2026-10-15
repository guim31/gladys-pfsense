// -----------------------------------------------------------------------------
// The probe script (scripts/probe.mjs) against the fake pfSense: it reads
// only, and its report carries no key, address, MAC, serial, name nor rule.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probe } from '../scripts/probe.mjs';
import { FakePfsense, VALID_KEY } from './helpers/fakePfsense.js';

const target = { protocol: 'https:', host: '192.0.2.1', port: null };

test('without a key: pfSense refuses an invented one, once', async () => {
  const firewall = new FakePfsense();
  const lines = await probe({ target, request: firewall.request });
  assert.match(
    lines.join('\n'),
    /auth — GET \/status\/system: HTTP 401 AUTH_AUTHENTICATION_FAILED/,
  );
  assert.equal(firewall.authFailures, 1);
});

test('without the package: the answer says so', async () => {
  const firewall = new FakePfsense();
  firewall.mode = 'no_api';
  const lines = await probe({ target, request: firewall.request, apiKey: VALID_KEY });
  assert.match(lines.join('\n'), /\/status\/system: not_found/);
});

test('with a key: GET only, and nothing private in the report', async () => {
  const firewall = new FakePfsense({ fixture: 'plus-25.11' });
  const lines = await probe({ target, request: firewall.request, apiKey: VALID_KEY });
  const text = lines.join('\n');
  assert.match(text, /pfSense 25\.11\.1-RELEASE, platform Netgate 4200/);
  assert.match(text, /Gateways: 2; status online×1, down×1/);
  assert.match(text, /\/routing\/gateways: not_found/);
  assert.ok(firewall.requests.every((request) => request.method === 'GET'));
  for (const secret of [
    VALID_KEY,
    '192.0.2',
    '198.51.100',
    '203.0.113',
    '00:00:5e',
    '2117220000',
    'f0e1d2c3b4a596877869',
    'Pixel-8',
    'Block kids',
    'home.arpa',
  ]) {
    assert.ok(!text.toLowerCase().includes(secret.toLowerCase()), `"${secret}" in the report`);
  }
});

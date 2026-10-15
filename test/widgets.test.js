// -----------------------------------------------------------------------------
// The dashboard widgets (src/widgets.js): every content passes the SDK
// validator (vocabulary and budget of the core) in every language and state,
// the buttons exist only when the commands are allowed, and their actions do
// what they say. (Adapted from guim31/gladys-mikrotik.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { gatewayRow, shortDuration } from '../src/widgets.js';
import { FakePfsense, baseConfig, createAll, createWorld, later } from './helpers/world.js';

const LANGS = ['en', 'fr', 'de', 'es'];

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, key, { settings = {}, language = 'en' } = {}) {
  const ack = await w.fake.widgetGet(key, { settings, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  const result = ack.data.content;
  assert.deepEqual(validateWidgetContent(result), [], `${key} (${language}) is valid`);
  const components = result.components;
  assert.ok(components.length <= 8, 'at most 8 components');
  assert.ok(components.filter((c) => c.type === 'text').length <= 2, 'at most 2 texts');
  const keys = components.filter((c) => c.type === 'button').map((c) => c.action.key);
  assert.equal(new Set(keys).size, keys.length, 'unique button keys');
  return result;
}

const types = (result) => result.components.map((component) => component.type);

test('firewall: health tiles, WAN rates, gateways, uptime, version, packages; no button by default', async (t) => {
  const w = await world(t);
  w.firewall.traffic('wan', 75_000_000, 7_500_000);
  await later(w, 1);
  for (const language of LANGS) {
    const result = await content(w, 'firewall', { language });
    assert.deepEqual(types(result), ['value', 'value', 'value', 'value', 'status']);
    assert.equal(result.ttl_seconds, 30);
  }
  const result = await content(w, 'firewall');
  assert.deepEqual(
    result.components.slice(0, 4).map((c) => c.value),
    [5, 23, '10.0', '1.0'],
  );
  assert.deepEqual(
    result.components[4].items.map((item) => [item.label, item.value]),
    [
      ['WAN_DHCP', '8.4 ms · 0 %'],
      ['WAN_DHCP6', '9.1 ms · 0 %'],
      ['Uptime', '8 d 3 h'],
      ['pfSense', '2.8.1-RELEASE'],
      ['Package updates', 'pfSense-pkg-Avahi'],
    ],
  );
});

test('firewall: temperature on a Netgate, a gateway down in red', async (t) => {
  const w = await world(t, { firewall: new FakePfsense({ fixture: 'plus-25.11' }) });
  const result = await content(w, 'firewall', { language: 'fr' });
  assert.equal(result.components[2].label, 'Température');
  assert.equal(result.components[2].value, 51.2);
  const wan2 = result.components.find((c) => c.type === 'status').items[1];
  assert.deepEqual(wan2, {
    label: 'WAN2_DHCP',
    icon: 'x-circle',
    value: 'Coupée · 45 %',
    color: 'danger',
  });
});

test('gateway rows: degraded in orange, monitoring disabled reads "Online"', () => {
  assert.equal(
    gatewayRow('GW', { found: true, online: true, delay: 80, loss: 6, substatus: 'loss' }, 'en')
      .color,
    'warning',
  );
  assert.equal(
    gatewayRow(
      'GW',
      { found: true, online: true, delay: null, loss: null, substatus: 'none' },
      'de',
    ).value,
    'Online',
  );
  assert.equal(gatewayRow('GW', undefined, 'es').value, 'No encontrada');
});

test('firewall: the reboot button asks for a confirmation and reboots', async (t) => {
  const w = await world(t, { config: baseConfig({ allow_commands: true }) });
  const result = await content(w, 'firewall');
  const button = result.components.find((c) => c.type === 'button');
  assert.deepEqual(button.action, { key: 'reboot', confirm: true });
  assert.equal(button.style, 'danger');
  const ack = await w.fake.widgetAction('firewall', 'reboot', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.firewall.reboots, 1);
  assert.equal(ack.data.message.fr, 'Le pare-feu redémarre.');
});

test('firewall: unreachable, not configured, waiting', async (t) => {
  const w = await world(t);
  w.firewall.goOffline();
  await later(w, 1);
  for (const language of LANGS) {
    const result = await content(w, 'firewall', { language });
    assert.deepEqual(types(result), ['text', 'status']);
  }
  const empty = await world(t, { config: baseConfig({ url: '' }) });
  const result = await content(empty, 'firewall');
  assert.match(result.components[0].text, /Enter the address/);
});

test('presence: the followed devices, present first, with the time away', async (t) => {
  const w = await world(t, { config: baseConfig({ away_delay: 0 }) });
  assert.match((await content(w, 'presence')).components[0].text, /No device followed/);
  await createAll(w);
  w.firewall.leave('00:00:5E:00:53:12');
  await later(w, 1);
  await later(w, 125);
  for (const language of LANGS) {
    await content(w, 'presence', { language });
  }
  const result = await content(w, 'presence');
  assert.equal(result.components[0].value, 3);
  assert.equal(result.components[0].unit, '/ 6');
  const items = result.components[1].items;
  assert.deepEqual(
    items.slice(0, 3).map((item) => item.value),
    ['Present', 'Present', 'Present'],
  );
  assert.ok(items.some((item) => item.label === 'Kids tablet' && item.value === 'Away · 2 h'));
  const present = await content(w, 'presence', { settings: { show: 'present' } });
  assert.equal(present.components[1].items.length, 3);
});

test('rules: a status row each, a button each when the commands are allowed', async (t) => {
  const config = { firewall_rules: 'Block kids tablet, Guests offline, Not on the firewall' };
  const readOnly = await world(t, { config: baseConfig(config) });
  let result = await content(readOnly, 'firewall_rules');
  assert.deepEqual(types(result), ['status', 'text']);
  assert.deepEqual(
    result.components[0].items.map((item) => item.value),
    ['Disabled', 'Enabled', 'Not found'],
  );

  const w = await world(t, { config: baseConfig({ ...config, allow_commands: true }) });
  result = await content(w, 'firewall_rules', { language: 'de' });
  const buttons = result.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => [b.action.key, b.icon, b.action.params.active, b.style]),
    [
      ['rule_1', 'circle', true, 'secondary'],
      ['rule_2', 'check-circle', false, 'secondary'],
    ],
  );
  const ack = await w.fake.widgetAction('firewall_rules', 'rule_1', buttons[0].action.params);
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.firewall.rule(0).disabled, false);
  assert.equal(ack.data.message.de, 'Regel „Block kids tablet“ aktiviert.');
});

test('rules: no rule followed, or an unknown button', async (t) => {
  const w = await world(t, { config: baseConfig({ allow_commands: true }) });
  assert.match(
    (await content(w, 'firewall_rules')).components[0].text,
    /No firewall rule followed/,
  );
  const ack = await w.fake.widgetAction('firewall_rules', 'rule_9', { rule: 'x' });
  assert.equal(ack.success, false);
});

test('short durations in every language', () => {
  assert.equal(shortDuration(59, 'en'), '0 min');
  assert.equal(shortDuration(3 * 3600, 'fr'), '3 h');
  assert.equal(shortDuration(2 * 86400 + 3600, 'fr'), '2 j 1 h');
  assert.equal(shortDuration(86400, 'de'), '1 T');
});

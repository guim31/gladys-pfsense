// -----------------------------------------------------------------------------
// The hub end to end, against the fake pfSense: presence and its departure
// delay, the gateway and unknown-device triggers, the rates, the commands
// (off by default), the privileges a key may lack, the errors the user sees.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VALID_KEY } from './helpers/fakePfsense.js';
import { FakePfsense, baseConfig, createAll, createWorld, ids, later } from './helpers/world.js';

const PIXEL = '00:00:5E:00:53:10';
const TABLET = '00:00:5E:00:53:12';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const presenceOf = (w, mac) => w.fake.lastState(ids(w.gladys).client(mac).feature('presence'));

test('discovery: the firewall, the followed rules and the clients seen, nothing of the WAN side', async (t) => {
  const w = await world(t, { config: baseConfig({ firewall_rules: 'Block kids tablet' }) });
  const devices = w.fake.discoveredDevices;
  assert.equal(devices[0].external_id, ids(w.gladys).firewall().device);
  assert.equal(devices[0].should_poll, false);
  assert.deepEqual(devices[0].params, [
    { name: 'FIREWALL_ADDRESS', value: 'https://192.0.2.1' },
    { name: 'PLATFORM', value: 'VMware Virtual Machine' },
  ]);
  assert.equal(devices[1].name, 'Rule "Block kids tablet"');
  const macs = devices.slice(2).map((device) => device.params[0].value);
  assert.ok(macs.includes(PIXEL));
  assert.ok(macs.includes(TABLET));
  // The ISP box (ARP on WAN), the firewall itself, an incomplete entry: never clients.
  assert.ok(!macs.includes('00:00:5E:00:53:99'));
  assert.ok(!macs.includes('00:00:5E:00:53:02'));
  assert.equal(macs.length, 6);
  // The description of a static mapping names the client.
  assert.equal(devices.find((d) => d.params[0].value === TABLET).name, 'Kids tablet');
});

test('the firewall id is the Netgate device ID, never the address', async (t) => {
  const plus = new FakePfsense({ fixture: 'plus-25.11' });
  const w = await world(t, { firewall: plus });
  assert.equal(
    w.fake.discoveredDevices[0].external_id,
    w.gladys.externalIds('firewall', 'f0e1d2c3b4a596877869').device,
  );
  assert.equal(w.fake.discoveredDevices[0].name, 'pfSense fw');
});

test('presence: present at once, away after the departure delay, unknown while the firewall is down', async (t) => {
  const w = await world(t, { config: baseConfig({ away_delay: 5 }) });
  await createAll(w, (device) => device.params?.[0]?.value === PIXEL);
  assert.equal(presenceOf(w, PIXEL), 1);
  w.firewall.leave(PIXEL);
  await later(w, 3);
  assert.equal(presenceOf(w, PIXEL), 1, 'still within the delay');
  w.firewall.goOffline();
  await later(w, 10);
  assert.equal(presenceOf(w, PIXEL), 1, 'an outage of the firewall sends nobody away');
  w.firewall.goOnline();
  await later(w, 1);
  assert.equal(presenceOf(w, PIXEL), 0);
  w.firewall.join(PIXEL, { ip: '192.0.2.10' });
  await later(w, 1);
  assert.equal(presenceOf(w, PIXEL), 1);
});

test('presence: an online DHCP lease counts, an expired one does not', async (t) => {
  const w = await world(t, { config: baseConfig({ away_delay: 0 }) });
  // The iPhone has a lease, offline; the old laptop an expired lease.
  await createAll(w);
  assert.equal(presenceOf(w, '00:00:5E:00:53:11'), 0);
  assert.equal(presenceOf(w, '00:00:5E:00:53:13'), 0);
  const lease = w.firewall.data['/status/dhcp_server/leases'].find((l) => l.hostname === 'iPhone');
  lease.online_status = 'active/online';
  await later(w, 1);
  assert.equal(presenceOf(w, '00:00:5E:00:53:11'), 1);
});

test('a present client is published again every 2 minutes, a stable value at least every 12 hours', async (t) => {
  const w = await world(t);
  await createAll(w);
  const presence = ids(w.gladys).client(PIXEL).feature('presence');
  const version = ids(w.gladys).firewall().feature('pfsense_version');
  const count = (id) =>
    w.fake.requests
      .filter((r) => r.path === '/state')
      .flatMap((r) => r.body?.states ?? r.body ?? [])
      .filter((s) => s.device_feature_external_id === id).length;
  const before = { presence: count(presence), version: count(version) };
  for (let i = 0; i < 6; i += 1) {
    await later(w, 1);
  }
  assert.ok(count(presence) - before.presence >= 2, 'presence refreshed');
  assert.equal(count(version), before.version, 'an unchanged text is not sent again at once');
  for (let i = 0; i < 13; i += 1) {
    await later(w, 60);
  }
  assert.ok(count(version) - before.version >= 2, 'heartbeat within 12 hours');
});

test('gateways: state, latency, loss; down and restored fire their triggers once', async (t) => {
  const w = await world(t);
  await createAll(w);
  const gw = (what) => ids(w.gladys).firewall().feature(`gw_wan_dhcp_${what}`);
  assert.equal(w.fake.lastState(gw('online')), 1);
  assert.equal(w.fake.lastState(gw('latency')), 8.4);
  assert.equal(w.fake.lastState(gw('loss')), 0);

  w.firewall.setGateway('WAN_DHCP', { status: 'down', substatus: 'highloss', loss: 62.5 });
  await later(w, 1);
  await later(w, 1);
  assert.equal(w.fake.lastState(gw('online')), 0);
  assert.equal(w.fake.lastState(gw('loss')), 63);
  w.firewall.setGateway('WAN_DHCP', { status: 'online', substatus: 'none', loss: 0 });
  await later(w, 12);
  const events = w.fake.sceneEvents.filter((e) => e.key.startsWith('gateway_'));
  assert.deepEqual(events, [
    { key: 'gateway_down', data: { gateway: 'WAN_DHCP', reason: 'highloss' } },
    { key: 'gateway_up', data: { gateway: 'WAN_DHCP', down_minutes: 13 } },
  ]);
});

test('a gateway already down at start fires nothing until it comes back', async (t) => {
  const plus = new FakePfsense({ fixture: 'plus-25.11' });
  const w = await world(t, { firewall: plus });
  await later(w, 1);
  assert.deepEqual(
    w.fake.sceneEvents.filter((e) => e.key === 'gateway_down'),
    [],
  );
  plus.setGateway('WAN2_DHCP', { status: 'online', substatus: 'none', loss: 0 });
  await later(w, 4);
  assert.deepEqual(
    w.fake.sceneEvents.filter((e) => e.key === 'gateway_up').map((e) => e.data),
    [{ gateway: 'WAN2_DHCP', down_minutes: 5 }],
  );
});

test('WAN rates come from the interface counters, two WANs, the second found by its address', async (t) => {
  const plus = new FakePfsense({ fixture: 'plus-25.11' });
  const w = await world(t, { firewall: plus });
  await createAll(w);
  // 75 MB in a minute: 10 Mbit/s.
  plus.traffic('wan', 75_000_000, 7_500_000);
  plus.traffic('opt2', 7_500_000, 0);
  await later(w, 1);
  const rate = (name) =>
    w.fake.lastState(ids(w.gladys).firewall('f0e1d2c3b4a596877869').feature(name));
  assert.equal(rate('wan_wan_download'), 10);
  assert.equal(rate('wan_wan_upload'), 1);
  assert.equal(rate('wan_opt2_download'), 1);
  assert.equal(rate('wan_opt2_upload'), 0);
  const names = w.fake.discoveredDevices[0].features.map((f) => f.name);
  assert.ok(names.includes('Download WAN2'));
  // A counter that goes back (reboot) gives no rate, and no negative one.
  plus.data['/status/interfaces'][0].inbytes = 10;
  await later(w, 1);
  assert.equal(rate('wan_wan_download'), 10);
});

test('the followed gateways can be chosen, an unknown one shows as not found', async (t) => {
  const plus = new FakePfsense({ fixture: 'plus-25.11' });
  const w = await world(t, {
    firewall: plus,
    config: baseConfig({ gateways: 'wan2_dhcp, LTE_BACKUP' }),
  });
  const keys = w.fake.discoveredDevices[0].features.map((f) => f.external_id.split(':').pop());
  assert.ok(
    keys.includes('gw_wan2_dhcp_online'),
    'the case of pfSense is kept, the key is lowercase',
  );
  assert.ok(keys.includes('gw_lte_backup_online'));
  assert.ok(!keys.includes('gw_wan_pppoe_online'));
  const ack = await w.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /WAN2_DHCP \(down, 182.4 ms, 45 %\), LTE_BACKUP \(not found\)/);
});

test('unknown device: the first reading learns the network, a new lease fires once, even after a restart', async (t) => {
  const w = await world(t);
  assert.deepEqual(
    w.fake.sceneEvents.filter((e) => e.key === 'unknown_device_connected'),
    [],
    'nothing at the first reading',
  );
  w.firewall.join('00:00:5E:00:53:77', {
    ip: '192.0.2.150',
    hostname: 'guest-phone',
    interfaceName: 'opt1',
    label: 'IOT',
  });
  await later(w, 1);
  await later(w, 1);
  const events = () => w.fake.sceneEvents.filter((e) => e.key === 'unknown_device_connected');
  assert.deepEqual(
    events().map((e) => e.data),
    [{ mac: '00:00:5E:00:53:77', ip: '192.0.2.150', host_name: 'guest-phone', interface: 'IOT' }],
  );
  await w.app.stop();
  const saved = JSON.parse(await readFile(join(w.dataDir, 'pfsense-state.json'), 'utf8'));
  assert.ok('00:00:5E:00:53:77' in saved.knownMacs);
  assert.equal(saved.baselined, true);

  const again = await world(t, { firewall: w.firewall, dataDir: w.dataDir });
  await later(again, 1);
  assert.deepEqual(
    again.fake.sceneEvents.filter((e) => e.key === 'unknown_device_connected'),
    [],
  );
});

test('commands are off by default', async (t) => {
  const w = await world(t, { config: baseConfig({ firewall_rules: 'Block kids tablet' }) });
  const rule = ids(w.gladys).rule('block-kids-tablet').device;
  const ack = await w.fake.sceneAction('enable_firewall_rule', { rule });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Allow commands/);
  const reboot = await w.fake.sceneAction('reboot_firewall', {});
  assert.equal(reboot.success, false);
  assert.equal(w.firewall.reboots, 0);
  assert.ok(
    w.firewall.requests.every((r) => r.method === 'GET'),
    'read only',
  );
});

test('a rule is enabled and disabled by its description, every rule of it, applied once', async (t) => {
  const plus = new FakePfsense({ fixture: 'plus-25.11' });
  const w = await world(t, {
    firewall: plus,
    config: baseConfig({ firewall_rules: 'Block kids tablet', allow_commands: true }),
  });
  await createAll(w);
  const rule = ids(w.gladys).rule('block-kids-tablet');
  assert.equal(w.fake.lastState(rule.feature('active')), 1);
  let ack = await w.fake.sceneAction('disable_firewall_rule', { rule: rule.device });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { active: false });
  assert.equal(plus.rule(0).disabled, true);
  assert.equal(plus.rule(1).disabled, true);
  assert.equal(plus.applied, 1, 'the filter is reloaded once');
  assert.equal(w.fake.lastState(rule.feature('active')), 0);
  const patches = plus.requests.filter((r) => r.method === 'PATCH');
  assert.deepEqual(
    patches.map((r) => r.body),
    [
      { id: 0, disabled: true, apply: false },
      { id: 1, disabled: true, apply: true },
    ],
  );
  // Nothing else than the `disabled` flag of these rules, on this endpoint.
  assert.ok(patches.every((r) => r.path === '/firewall/rule'));

  ack = await w.fake.sceneAction('enable_firewall_rule', { rule: rule.device });
  assert.deepEqual(ack.data.outputs, { active: true });
  assert.equal(plus.rule(0).disabled, false);
  // Enabling an enabled rule writes nothing.
  const before = plus.requests.filter((r) => r.method === 'PATCH').length;
  await w.fake.sceneAction('enable_firewall_rule', { rule: rule.device });
  assert.equal(plus.requests.filter((r) => r.method === 'PATCH').length, before);
});

test('a rule moved in the list is still found by its description', async (t) => {
  const w = await world(t, {
    config: baseConfig({ firewall_rules: 'Guests offline', allow_commands: true }),
  });
  const rules = w.firewall.data['/firewall/rules'];
  rules.unshift(rules.splice(3, 1)[0]);
  rules.forEach((rule, index) => {
    rule.id = index;
  });
  const ack = await w.fake.sceneAction('disable_firewall_rule', {
    rule: ids(w.gladys).rule('guests-offline').device,
  });
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.firewall.rule(0).descr, 'Guests offline');
  assert.equal(w.firewall.rule(0).disabled, true);
});

test('a device that is not a followed rule, or a rule gone from pfSense, is refused clearly', async (t) => {
  const w = await world(t, {
    config: baseConfig({ firewall_rules: 'Not on the firewall', allow_commands: true }),
  });
  let ack = await w.fake.sceneAction('enable_firewall_rule', {
    rule: ids(w.gladys).client(PIXEL).device,
  });
  assert.match(ack.error, /not a firewall rule followed/);
  ack = await w.fake.sceneAction('enable_firewall_rule', {
    rule: ids(w.gladys).rule('not-on-the-firewall').device,
  });
  assert.match(ack.error, /No firewall rule of pfSense has this description/);
});

test('a read-only key: the commands are refused by pfSense with an explanation', async (t) => {
  const firewall = new FakePfsense({ keys: { [VALID_KEY]: { readOnly: true } } });
  const w = await world(t, {
    firewall,
    config: baseConfig({
      firewall_rules: 'Block kids tablet',
      allow_commands: true,
      language: 'fr',
    }),
  });
  const ack = await w.fake.sceneAction('enable_firewall_rule', {
    rule: ids(w.gladys).rule('block-kids-tablet').device,
  });
  assert.match(ack.error, /privilèges des commandes/);
  const reboot = await w.fake.sceneAction('reboot_firewall', {});
  assert.match(reboot.error, /privilèges des commandes/);
});

test('reboot: one POST, a hang-up counts as done', async (t) => {
  const w = await world(t, { config: baseConfig({ allow_commands: true }) });
  let ack = await w.fake.sceneAction('reboot_firewall', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.firewall.reboots, 1);
  const post = w.firewall.requests.find((r) => r.method === 'POST');
  assert.equal(post.path, '/diagnostics/reboot');
  const original = w.firewall.request;
  w.firewall.request = async (url, options) => {
    if (options.method === 'POST') {
      const error = new Error('socket hang up');
      error.code = 'ECONNRESET';
      throw error;
    }
    return original(url, options);
  };
  ack = await w.fake.sceneAction('reboot_firewall', {});
  assert.equal(ack.success, true, ack.error);
});

test('endpoints the key may not read are skipped, and listed by the connection test', async (t) => {
  const firewall = new FakePfsense({
    keys: {
      [VALID_KEY]: {
        denied: ['/diagnostics/arp_table', '/system/packages', '/routing/gateways'],
      },
    },
  });
  const w2 = await world(t, { firewall });
  const features = w2.fake.discoveredDevices[0].features.map((f) => f.external_id.split(':').pop());
  assert.ok(!features.includes('package_update_available'), 'no package feature without the list');
  assert.ok(features.includes('wan_wan_download'), 'the WAN found from the dpinger address');
  const ack = await w2.fake.action('test_connection', {});
  assert.match(
    ack.data.message.en,
    /Not readable with this key: \/routing\/gateways, \/diagnostics\/arp_table, \/system\/packages\./,
  );
  assert.equal(w2.hub.connectionStatus().connected, true, 'a missing privilege is no outage');
});

test('errors the user can act on: no package, login page, refused key, nothing at the address', async (t) => {
  const cases = [
    { setup: (fw) => (fw.mode = 'no_api'), text: /install the pfSense-pkg-RESTAPI package/ },
    { setup: (fw) => (fw.mode = 'login'), text: /install the pfSense-pkg-RESTAPI package/ },
    {
      setup: () => {},
      config: { api_key: 'not-the-key' },
      text: /API key refused by pfSense/,
    },
    { setup: (fw) => fw.goOffline(), text: /does not answer at this address/ },
  ];
  for (const { setup, config, text } of cases) {
    const firewall = new FakePfsense();
    setup(firewall);
    const w = await world(t, { firewall, config: baseConfig(config) });
    const ack = await w.fake.action('test_connection', {});
    assert.match(ack.data.message.en, text);
    const widget = await w.fake.widgetGet('firewall', { settings: {}, language: 'en' });
    assert.equal(widget.success, true);
    assert.match(JSON.stringify(widget.data), new RegExp(text.source));
  }
});

test('no address, a bad address, no key: the status says what to fill in, nothing is called', async (t) => {
  for (const [config, message] of [
    [{ url: '' }, /Enter the address of your pfSense/],
    [{ url: 'ftp://192.0.2.1' }, /Address not understood/],
    [{ url: 'https://admin:pw@192.0.2.1' }, /Address not understood/],
    [{ api_key: '' }, /Enter the API key/],
  ]) {
    const firewall = new FakePfsense();
    const w = await world(t, { firewall, config: baseConfig(config) });
    const ack = await w.fake.action('test_connection', {});
    assert.match(ack.data.message.en, message);
    assert.equal(firewall.requests.length, 0);
  }
});

test('the API key travels in the X-API-Key header only, never in the URL', async (t) => {
  const w = await world(t);
  for (const request of w.firewall.requests) {
    assert.equal(request.key, VALID_KEY);
    assert.deepEqual(request.query, {});
  }
});

test('onDeviceCreated sends the values again at once, and asks for a widget refresh', async (t) => {
  const w = await world(t);
  const refreshes = [];
  w.gladys.requestWidgetRefresh = (key) => refreshes.push(key);
  const [firewallDevice] = w.fake.discoveredDevices;
  await w.fake.deviceCreated(firewallDevice);
  const cpu = ids(w.gladys).firewall().feature('cpu_usage');
  assert.equal(w.fake.lastState(cpu), 5);
  assert.ok(refreshes.includes('firewall'));
});

test('"List the firewall rules" shows the described rules and marks the followed ones', async (t) => {
  const w = await world(t, { config: baseConfig({ firewall_rules: 'Guests offline' }) });
  const ack = await w.fake.action('list_firewall_rules', {});
  const lines = ack.data.message.en.split('\n');
  assert.match(lines[0], /^Firewall rules with a description/);
  assert.ok(lines.includes('Block kids tablet — block, LAN, disabled'));
  assert.ok(lines.includes('Guests offline ✓ — block, IOT, enabled'));
  assert.equal(lines.length, 5, 'the rule without a description is not listed');
});

test('a new key or address starts over; a new language renames the features', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.discoveredDevices[0].features[0].name, 'CPU usage');
  await w.fake.configUpdated(baseConfig({ language: 'fr' }));
  assert.equal(w.fake.discoveredDevices[0].features[0].name, 'Charge du processeur');
});

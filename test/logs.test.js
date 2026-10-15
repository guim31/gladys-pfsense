// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never the API key nor a secret of the configuration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_KEY, baseConfig, createAll, createWorld, later } from './helpers/world.js';

/** Capture the lines of the SDK logger at the given LOG_LEVEL. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  t.mock.method(console, 'warn', record('err'));
  return { lines, clear: () => lines.splice(0), texts: () => lines.map((line) => line.text) };
}

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: baseConfig({ firewall_rules: 'Block kids tablet' }) });
  assert.ok(
    logs.texts().some((text) => text.includes('connected (pfSense 2.8.1-RELEASE)')),
    'the start is logged',
  );
  await createAll(w);
  logs.clear();
  for (let i = 0; i < 5; i += 1) {
    w.firewall.traffic('wan', 1_000_000 * i, 100_000);
    w.firewall.data['/status/system'].cpu_usage = 10 + i;
    w.firewall.setGateway('WAN_DHCP', { delay: 8 + i, loss: i % 2 });
    await later(w, 30); // the packages and the structure are read again too
  }
  assert.deepEqual(logs.texts(), []);
});

test('a firewall that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.firewall.goOffline();
  for (let i = 0; i < 6; i += 1) {
    await later(w, 1);
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');
  logs.clear();
  w.firewall.goOnline();
  await later(w, 1);
  await later(w, 1);
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /connection restored/);
});

test('a refused key is logged once, tried again only every 5 minutes, and never written', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: baseConfig({ api_key: 'wrong-key-1234567890' }) });
  for (let i = 0; i < 10; i += 1) {
    await later(w, 1);
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  // The login protection of pfSense counts every failure: 1 + 2 tries in 10 minutes.
  assert.equal(w.firewall.authFailures, 3);
  assert.ok(!logs.texts().join('\n').includes('wrong-key-1234567890'));
});

test('Gladys refusing the states is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  w.gladys.publishStates = async () => {
    throw new Error('HTTP 500');
  };
  for (let i = 0; i < 4; i += 1) {
    w.firewall.data['/status/system'].cpu_usage = 20 + i;
    await later(w, 1);
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /States refused/);
});

test('one line per user command, one per gateway change', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, {
    config: baseConfig({ firewall_rules: 'Block kids tablet', allow_commands: true }),
  });
  logs.clear();
  const rule = w.gladys.externalIds('rule', 'block-kids-tablet').device;
  await w.fake.sceneAction('enable_firewall_rule', { rule });
  assert.deepEqual(logs.texts().length, 1);
  assert.match(logs.texts()[0], /Firewall rule "Block kids tablet" enabled \(1 rule\(s\)\)/);
  logs.clear();
  w.firewall.setGateway('WAN_DHCP', { status: 'down', substatus: 'highloss', loss: 60 });
  await later(w, 1);
  await later(w, 1);
  assert.deepEqual(logs.texts().length, 1);
  assert.match(logs.texts()[0], /gateway WAN_DHCP is down \(highloss\)/);
});

test('LOG_LEVEL=debug shows each problem; no secret of the configuration, ever', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t, { config: baseConfig({ allow_commands: true }) });
  await createAll(w);
  w.firewall.goOffline();
  await later(w, 1);
  await later(w, 1);
  w.firewall.goOnline();
  await later(w, 1);
  await w.fake.action('test_connection', {});
  await w.fake.action('list_firewall_rules', {});
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\].*again/);
  assert.ok(!text.includes(API_KEY), 'never the API key');
});

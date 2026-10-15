// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys never polls a device published
// with should_poll: false (and does not reliably poll external devices,
// GladysAssistant/Gladys#3198): the firewall must be read by the hub's own
// timer, with no onPoll at all.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseConfig, createAll, createClock, createWorld, ids } from './helpers/world.js';

const settle = async () => {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

test('the internal timer reads the firewall without any onPoll from Gladys', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const w = await createWorld({ clock, timers: true, config: baseConfig({ poll_interval: '30' }) });
  t.after(() => w.app.stop());
  const polled = t.mock.method(w.hub, 'pollDevice');
  await createAll(w);
  for (const device of w.fake.discoveredDevices) {
    assert.equal(device.should_poll, false, 'Gladys is not asked to poll');
    assert.equal(device.poll_frequency, undefined);
  }
  const reads = () => w.firewall.requests.filter((r) => r.path === '/status/system').length;
  const before = reads();
  const cpu = ids(w.gladys).firewall().feature('cpu_usage');
  for (const usage of [21, 22, 23]) {
    w.firewall.data['/status/system'].cpu_usage = usage;
    clock.advance(30_000);
    t.mock.timers.tick(30_000);
    await settle();
    assert.equal(w.fake.lastState(cpu), usage);
  }
  assert.equal(reads() - before, 3, 'one reading per interval');
  assert.equal(polled.mock.callCount(), 0, 'no onPoll involved');
});

test('the timer stops with the integration', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await createWorld({ timers: true });
  await w.app.stop();
  const before = w.firewall.requests.length;
  t.mock.timers.tick(10 * 60_000);
  await settle();
  assert.equal(w.firewall.requests.length, before);
});

test('a Gladys that polls anyway gets a reading, never a second timer', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  await createAll(w);
  const before = w.firewall.requests.length;
  const ack = await w.fake.poll(w.fake.discoveredDevices[0]);
  assert.equal(ack.success, true, ack.error);
  assert.ok(w.firewall.requests.length > before, 'onPoll reads when no timer runs');
});

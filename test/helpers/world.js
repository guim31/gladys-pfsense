// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake pfSense firewalls on a
// fake network, a temporary /data and a manual clock, with the integration
// wired on top through registerHandlers. No timer runs unless `timers: true`
// (with node:test mock timers): the tests read the firewall with
// `world.hub.pollAll()`. (Adapted from guim31/gladys-mikrotik.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakePfsense, VALID_KEY, createNetwork } from './fakePfsense.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const HOST = '192.0.2.1';
export const API_KEY = VALID_KEY;

/** A manual clock, shared by the hub and the tests. */
export function createClock(start = Date.UTC(2026, 9, 15, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const baseConfig = (extra = {}) => ({
  url: `https://${HOST}`,
  api_key: API_KEY,
  language: 'en',
  ...extra,
});

/**
 * @param {object} [options]
 * @param {FakePfsense} [options.firewall]
 * @param {Record<string, FakePfsense>} [options.firewalls] by host
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 */
export async function createWorld({
  clock = createClock(),
  firewall,
  firewalls,
  config = baseConfig(),
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-pfsense-')),
  timings = {},
  timers = false,
} = {}) {
  const theFirewall = firewall ?? new FakePfsense();
  const network = createNetwork(firewalls ?? { [HOST]: theFirewall });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    seams: { request: network.request },
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return {
    gladys,
    fake: gladys.fake,
    network,
    firewall: theFirewall,
    app,
    hub: app.hub,
    clock,
    dataDir,
  };
}

/** Add discovered devices in Gladys, as the user would (all of them by default). */
export async function createAll(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

/** The external ids the integration builds. */
export const ids = (gladys) => ({
  firewall: (id = '0a1b2c3d4e5f60718293') => gladys.externalIds('firewall', id),
  client: (mac) => gladys.externalIds('client', mac.toLowerCase()),
  rule: (slug) => gladys.externalIds('rule', slug),
});

/** One reading `minutes` later. */
export async function later(world, minutes = 1) {
  world.clock.advance(minutes * 60_000);
  await world.hub.pollAll();
}

export { FakePfsense };

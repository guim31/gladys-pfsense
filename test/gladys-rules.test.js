// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (test/fixtures/pfsense/): a pfSense CE and a pfSense Plus with two
// WANs, with followed rules and gateways, in every feature-name language,
// after the devices are added and read twice (rates included).
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VALID_KEY } from './helpers/fakePfsense.js';
import { FakePfsense, baseConfig, createAll, createWorld, later } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const rules = { firewall_rules: 'Block kids tablet, Guests offline, Not on the firewall' };
const scenarios = [
  { label: 'pfSense CE', fixture: 'ce-2.8.1', config: baseConfig(rules) },
  { label: 'pfSense Plus, two WANs', fixture: 'plus-25.11', config: baseConfig(rules) },
  {
    label: 'pfSense Plus, French names, gateways set by hand',
    fixture: 'plus-25.11',
    config: baseConfig({ ...rules, language: 'fr', gateways: 'wan_pppoe, WAN2_DHCP, LTE_BACKUP' }),
  },
  {
    label: 'German names, no privilege on the gateway list',
    fixture: 'ce-2.8.1',
    denied: ['/routing/gateways', '/system/packages'],
    config: baseConfig({ ...rules, language: 'de' }),
  },
  {
    label: 'Spanish names',
    fixture: 'plus-25.11',
    config: baseConfig({ ...rules, language: 'es' }),
  },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const firewall = new FakePfsense({
      fixture: scenario.fixture,
      keys: { [VALID_KEY]: { denied: scenario.denied ?? [] } },
    });
    const w = await createWorld({ firewall, config: scenario.config });
    try {
      await createAll(w);
      firewall.traffic('wan', 50_000_000, 5_000_000);
      await later(w, 1);
      const devices = w.fake.discoveredDevices;
      assert.ok(devices.length >= 5, 'firewall, rules and clients');
      const deviceIds = new Set();
      const allFeatureIds = new Set();

      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          assert.equal(feature.read_only, true, `${at}: nothing is a controllable feature`);
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.includes(feature.unit),
                `${at}: ${feature.unit} for ${feature.category}`,
              );
            }
          }

          assert.ok(!allFeatureIds.has(feature.external_id), `${at}: duplicate external_id`);
          allFeatureIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
          assert.ok(feature.name.length <= 60, `${at}: name too long`);

          // The value read from the fixtures fits the declared bounds.
          const value = w.fake.lastState(feature.external_id);
          if (value === undefined) {
            continue; // a rule or a gateway absent from the firewall
          }
          if (feature.category === 'text') {
            assert.equal(typeof value, 'string', `${at}: a text feature receives { text }`);
            assert.ok(value.length > 0, `${at}: empty text`);
            continue;
          }
          assert.equal(typeof value, 'number', `${at}: ${value} is not a number`);
          assert.ok(value >= feature.min && value <= feature.max, `${at}: ${value} out of bounds`);
          if (feature.type === 'integer' || feature.type === 'binary') {
            assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
          }
        }
      }
      // Every firewall feature has received a value, an unknown gateway excepted.
      const firewallDevice = devices[0];
      const missing = firewallDevice.features.filter(
        (f) =>
          w.fake.lastState(f.external_id) === undefined && !f.external_id.includes('lte_backup'),
      );
      assert.deepEqual(
        missing.map((f) => f.name),
        [],
      );
    } finally {
      await w.app.stop();
    }
  });
}

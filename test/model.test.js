// -----------------------------------------------------------------------------
// The readers of the REST API answers: the strings pfSense writes (uptime,
// gateway and lease states, translated or not), missing fields, odd types.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMac,
  number,
  parseArp,
  parseGatewayStatuses,
  parseLeases,
  parseRules,
  parseSystemStatus,
  parseUptime,
} from '../src/pfsense/model.js';
import { loadFixture } from './helpers/fakePfsense.js';

test('uptime texts of pfSense, translated ones too', () => {
  assert.equal(
    parseUptime('8 Days 03 Hours 26 Minutes 12 Seconds'),
    8 * 86400 + 3 * 3600 + 26 * 60 + 12,
  );
  assert.equal(parseUptime('1 Day 00 Hours 00 Minutes 07 Seconds'), 86407);
  assert.equal(parseUptime('03 Hours 26 Minutes 12 Seconds'), 3 * 3600 + 26 * 60 + 12);
  assert.equal(parseUptime('2 Jours 01 Heures 00 Minutes 00 Secondes'), 2 * 86400 + 3600);
  assert.equal(parseUptime(''), null);
  assert.equal(parseUptime(null), null);
  assert.equal(parseUptime(3600), 3600);
});

test('numbers with their units, MAC addresses in any form', () => {
  assert.equal(number('12.5ms'), 12.5);
  assert.equal(number('0.0%'), 0);
  assert.equal(number(''), null);
  assert.equal(normalizeMac('00:00:5e:00:53:01'), '00:00:5E:00:53:01');
  assert.equal(normalizeMac('00-00-5E-00-53-01'), '00:00:5E:00:53:01');
  assert.equal(normalizeMac('(incomplete)'), null);
  assert.equal(normalizeMac('ff:ff:ff:ff:ff:ff'), null);
});

test('system status: rounded percentages, no temperature on a virtual machine', () => {
  const ce = parseSystemStatus(loadFixture('ce-2.8.1')['/status/system']);
  assert.equal(ce.cpuUsage, 5);
  assert.equal(ce.temperature, null);
  assert.equal(ce.serial, null, 'an empty serial is no serial');
  const plus = parseSystemStatus(loadFixture('plus-25.11')['/status/system']);
  assert.equal(plus.temperature, 51.2);
  assert.equal(plus.netgateId, 'f0e1d2c3b4a596877869');
  assert.equal(parseSystemStatus({ temp_c: 0 }).temperature, null);
  assert.deepEqual(parseSystemStatus(null).cpuUsage, null);
});

test('gateway states: online, down (whatever the substatus), unknown', () => {
  const [up, down, unknown] = parseGatewayStatuses([
    { name: 'A', status: 'online', substatus: 'loss', delay: '12.1ms', loss: '3.0%' },
    { name: 'B', status: 'down', substatus: 'force_down' },
    { name: 'C', status: 'pending' },
    { status: 'online' },
  ]);
  assert.equal(up.online, true);
  assert.equal(up.delay, 12.1);
  assert.equal(up.loss, 3);
  assert.equal(down.online, false);
  assert.equal(unknown.online, null);
});

test('leases: active, static and online, translated or not; expired and offline are not', () => {
  const leases = parseLeases([
    { mac: '00:00:5e:00:53:01', active_status: 'active', online_status: 'active/online' },
    { mac: '00:00:5e:00:53:02', active_status: 'static', online_status: 'active/online' },
    { mac: '00:00:5e:00:53:03', active_status: 'expired', online_status: 'idle/offline' },
    { mac: '00:00:5e:00:53:04', active_status: 'active', online_status: 'idle/offline' },
    { mac: '00:00:5e:00:53:05', active_status: 'actif', online_status: 'actif/en ligne' },
    { mac: '', active_status: 'active' },
  ]);
  assert.deepEqual(
    leases.map((l) => [l.online, l.dynamic]),
    [
      [true, true],
      [true, false],
      [false, false],
      [false, true],
      [false, false],
    ],
  );
});

test('ARP: permanent entries and incomplete ones are recognised', () => {
  const arp = parseArp(loadFixture('ce-2.8.1')['/diagnostics/arp_table']);
  assert.equal(arp.length, 6, 'the incomplete entry has no MAC');
  assert.equal(arp[0].permanent, true);
  assert.equal(arp[1].expiresSeconds, 1185);
});

test('rules: position, description, state', () => {
  const rules = parseRules(loadFixture('ce-2.8.1')['/firewall/rules']);
  assert.deepEqual(rules[0], {
    id: 0,
    tracker: '1728900001',
    description: 'Block kids tablet',
    disabled: true,
    type: 'block',
    interfaces: ['lan'],
    ipprotocol: 'inet46',
    floating: false,
  });
  assert.equal(rules[4].description, null);
});

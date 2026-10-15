#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real pfSense firewall, with the very client of the
// integration: `node scripts/probe.mjs <url> [--insecure]`.
//
//   - Without PFSENSE_API_KEY, it calls the REST API with an invented key and
//     reports how pfSense refuses it: it checks that the package answers, the
//     envelope and the error reading against a real firewall. (One refused
//     key counts as one failure for the login protection of pfSense.)
//   - With PFSENSE_API_KEY in the environment, it reads every endpoint the
//     integration reads (GET only: nothing is changed, the firewall is not
//     rebooted, no rule is touched).
//
// The output never shows the key, an IP or MAC address, a serial number, a
// Netgate ID, a host name or a rule description: only versions, platforms,
// counts, states and field names, so it can be pasted in an issue.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseUrl } from '../src/config.js';
import { ENDPOINTS, PfsenseClient } from '../src/pfsense/client.js';
import {
  parseArp,
  parseGatewayStatuses,
  parseInterfaces,
  parseLeases,
  parsePackages,
  parseRules,
  parseSystemStatus,
  parseVersion,
} from '../src/pfsense/model.js';

// The read endpoints of the integration, never a command.
const READS = [
  ENDPOINTS.SYSTEM_STATUS,
  ENDPOINTS.VERSION,
  ENDPOINTS.HOSTNAME,
  ENDPOINTS.GATEWAYS_STATUS,
  ENDPOINTS.GATEWAYS,
  ENDPOINTS.INTERFACES,
  ENDPOINTS.LEASES,
  ENDPOINTS.ARP,
  ENDPOINTS.PACKAGES,
  ENDPOINTS.RULES,
];

const count = (values) => {
  const result = {};
  for (const value of values) {
    const key = String(value ?? 'null');
    result[key] = (result[key] ?? 0) + 1;
  }
  return Object.entries(result)
    .map(([key, n]) => `${key}×${n}`)
    .join(', ');
};

/**
 * @param {object} options { target, apiKey, insecure, request }
 * @returns {Promise<string[]>} the report lines
 */
export async function probe({ target, apiKey, insecure = false, request }) {
  const lines = [];
  const common = { target, insecure, timeoutMs: 30_000, ...(request ? { request } : {}) };
  if (!apiKey) {
    lines.push('No PFSENSE_API_KEY: calling the REST API with an invented key.');
    const client = new PfsenseClient({ ...common, apiKey: randomBytes(16).toString('hex') });
    try {
      await client.get(ENDPOINTS.SYSTEM_STATUS);
      lines.push('The invented key was ACCEPTED (unexpected)');
    } catch (err) {
      lines.push(`${err.kind ?? 'error'} — ${err.message}`);
    }
    return lines;
  }

  const client = new PfsenseClient({ ...common, apiKey });
  const read = {};
  for (const path of READS) {
    try {
      read[path] = await client.get(path);
      const items = Array.isArray(read[path]) ? read[path] : [read[path] ?? {}];
      const fields = [...new Set(items.flatMap((item) => Object.keys(item ?? {})))].sort();
      lines.push(`${path}: ${items.length} item(s); fields: ${fields.join(', ') || '-'}`);
    } catch (err) {
      lines.push(`${path}: ${err.kind} — ${err.message}`);
    }
  }

  const system = parseSystemStatus(read[ENDPOINTS.SYSTEM_STATUS]);
  const version = parseVersion(read[ENDPOINTS.VERSION]);
  const gateways = parseGatewayStatuses(read[ENDPOINTS.GATEWAYS_STATUS]);
  const interfaces = parseInterfaces(read[ENDPOINTS.INTERFACES]);
  const leases = parseLeases(read[ENDPOINTS.LEASES]);
  const arp = parseArp(read[ENDPOINTS.ARP]);
  const packages = parsePackages(read[ENDPOINTS.PACKAGES]);
  const rules = parseRules(read[ENDPOINTS.RULES]);
  const raw = read[ENDPOINTS.SYSTEM_STATUS] ?? {};
  lines.push(
    `pfSense ${version.version}, platform ${system.platform}`,
    `Identity: netgate_id ${system.netgateId ? 'present' : 'absent'}, serial ${system.serial ? 'present' : 'absent'}`,
    `CPU ${system.cpuUsage} %, memory ${system.memoryUsage} %, disk ${system.diskUsage} %, temperature ${system.temperature}`,
    `Uptime text "${String(raw.uptime ?? '').replace(/\d/g, '9')}" read as ${system.uptimeSeconds} s`,
    `Gateways: ${gateways.length}; status ${count(gateways.map((g) => g.status))}; substatus ${count(gateways.map((g) => g.substatus))}; delay read ${gateways.every((g) => g.delay !== null)}`,
    `Interfaces: ${interfaces.length}; status ${count(interfaces.map((i) => i.status))}; counters ${interfaces.every((i) => i.inBytes !== null) ? 'present' : 'missing'}`,
    `Leases: ${leases.length}; active_status ${count(leases.map((l) => l.activeStatus))}; online ${count(leases.map((l) => l.online))}`,
    `ARP: ${arp.length}; permanent ${arp.filter((e) => e.permanent).length}; expiry read ${arp.filter((e) => e.expiresSeconds !== null).length}`,
    `Packages: ${packages.length}; updates ${packages.filter((p) => p.updateAvailable).length}`,
    `Rules: ${rules.length}; with a description ${rules.filter((r) => r.description).length}; disabled ${rules.filter((r) => r.disabled).length}`,
  );
  return lines;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [address, ...flags] = process.argv.slice(2);
  const target = parseUrl(address ?? '');
  if (!target) {
    console.error('Usage: PFSENSE_API_KEY=… node scripts/probe.mjs <url> [--insecure]');
    process.exit(2);
  }
  const lines = await probe({
    target,
    apiKey: process.env.PFSENSE_API_KEY?.trim(),
    insecure: flags.includes('--insecure'),
  });
  console.log(lines.join('\n'));
}

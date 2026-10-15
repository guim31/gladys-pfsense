// -----------------------------------------------------------------------------
// An in-memory pfSense with the REST API package, behind the HTTP seam of
// the client (src/pfsense/http.js): the envelope, the X-API-Key check, the
// privileges per endpoint, the 404 of an endpoint the package does not have,
// the PATCH of a firewall rule and the reboot. Its data come from
// test/fixtures/pfsense/ and can be changed by the tests (traffic, gateways,
// clients joining and leaving).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const API = '/api/v2';
const HTML_404 = '<html><head><title>404 Not Found</title></head><body>nginx</body></html>';
const LOGIN_PAGE = '<!DOCTYPE html><html><head><title>pfSense - Login</title></head></html>';

export const VALID_KEY = 'f00dfeedc0ffee0123456789abcdef01';

export function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/pfsense/${name}.json`, import.meta.url)));
}

const envelope = (code, responseId, data = [], message = '') => ({
  status: code,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    code,
    status: code === 200 ? 'ok' : 'error',
    response_id: responseId,
    message,
    data,
  }),
});

export class FakePfsense {
  /**
   * @param {object} [options]
   * @param {string} [options.fixture] a file of test/fixtures/pfsense
   * @param {Record<string, { denied?: string[], readOnly?: boolean }>} [options.keys] by API key
   */
  constructor({ fixture = 'ce-2.8.1', keys = { [VALID_KEY]: {} } } = {}) {
    this.data = loadFixture(fixture);
    this.keys = keys;
    this.offline = false;
    // 'api' (the package answers), 'no_api' (nginx 404), 'login' (the webConfigurator).
    this.mode = 'api';
    /** Every request received: { method, path, query, body, key }. */
    this.requests = [];
    this.reboots = 0;
    this.applied = 0;
    this.authFailures = 0;
  }

  goOffline() {
    this.offline = true;
  }

  goOnline() {
    this.offline = false;
  }

  /** Add traffic to the counters of an interface (bytes received, bytes sent). */
  traffic(name, inBytes, outBytes = 0) {
    const item = this.data['/status/interfaces'].find((candidate) => candidate.name === name);
    item.inbytes += inBytes;
    item.outbytes += outBytes;
  }

  setGateway(name, fields) {
    const gateway = this.data['/status/gateways'].find((candidate) => candidate.name === name);
    Object.assign(gateway, fields);
  }

  /** A client joins: a dynamic lease online, and an ARP entry. */
  join(mac, { ip = '192.0.2.77', hostname = null, interfaceName = 'lan', label = 'LAN' } = {}) {
    this.leave(mac);
    const leases = this.data['/status/dhcp_server/leases'];
    leases.push({
      id: leases.length,
      ip,
      mac: mac.toLowerCase(),
      hostname,
      if: interfaceName,
      starts: '2026/10/15 10:00:00',
      ends: '2026/10/15 12:00:00',
      active_status: 'active',
      online_status: 'active/online',
      descr: null,
    });
    const arp = this.data['/diagnostics/arp_table'];
    arp.push({
      id: arp.length,
      hostname: hostname ?? '',
      ip_address: ip,
      mac_address: mac.toLowerCase(),
      interface: label,
      type: 'ethernet',
      permanent: false,
      dnsresolve: 'Z_?',
      expires: 'Expires in 1200 seconds',
    });
  }

  /** A client leaves: its ARP entry expires, its lease goes offline. */
  leave(mac) {
    const lower = mac.toLowerCase();
    this.data['/diagnostics/arp_table'] = this.data['/diagnostics/arp_table'].filter(
      (entry) => entry.mac_address.toLowerCase() !== lower,
    );
    for (const lease of this.data['/status/dhcp_server/leases']) {
      if (lease.mac.toLowerCase() === lower) {
        lease.online_status = 'idle/offline';
      }
    }
  }

  rule(id) {
    return this.data['/firewall/rules'].find((rule) => rule.id === id);
  }

  /** The HTTP seam: same signature as src/pfsense/http.js. */
  request = async (url, { method = 'GET', headers = {}, json } = {}) => {
    if (this.offline) {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    const target = new URL(url);
    const path = target.pathname.startsWith(API) ? target.pathname.slice(API.length) : null;
    const key = headers['x-api-key'];
    this.requests.push({
      method,
      path: path ?? target.pathname,
      query: Object.fromEntries(target.searchParams),
      body: json,
      key,
    });
    if (this.mode === 'login') {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: LOGIN_PAGE };
    }
    if (this.mode === 'no_api' || path === null) {
      return { status: 404, headers: { 'content-type': 'text/html' }, body: HTML_404 };
    }
    const account = this.keys[key];
    if (!account) {
      this.authFailures += 1;
      return envelope(401, 'AUTH_AUTHENTICATION_FAILED', [], 'Authentication failed.');
    }
    if (account.denied?.includes(path) || (account.readOnly && method !== 'GET')) {
      return envelope(
        403,
        'AUTH_AUTHORIZATION_FAILED',
        [],
        `Client is not authorized to access this endpoint.`,
      );
    }
    if (method === 'GET') {
      if (!(path in this.data)) {
        return { status: 404, headers: { 'content-type': 'text/html' }, body: HTML_404 };
      }
      return envelope(200, 'SUCCESS', structuredClone(this.data[path]));
    }
    if (method === 'PATCH' && path === '/firewall/rule') {
      const rule = this.rule(json?.id);
      if (!rule) {
        return envelope(404, 'MODEL_OBJECT_NOT_FOUND', [], 'Object not found.');
      }
      if (typeof json.disabled === 'boolean') {
        rule.disabled = json.disabled;
      }
      if (json.apply === true) {
        this.applied += 1;
      }
      return envelope(200, 'SUCCESS', structuredClone(rule));
    }
    if (method === 'POST' && path === '/diagnostics/reboot') {
      this.reboots += 1;
      return envelope(200, 'SUCCESS', []);
    }
    return envelope(405, 'ENDPOINT_METHOD_NOT_ALLOWED', [], 'Method not allowed.');
  };
}

/** Several firewalls by host: the seam answers ECONNREFUSED for any other host. */
export function createNetwork(firewalls) {
  return {
    request: async (url, options) => {
      const firewall = firewalls[new URL(url).hostname];
      if (!firewall) {
        const error = new Error('connect ECONNREFUSED');
        error.code = 'ECONNREFUSED';
        throw error;
      }
      return firewall.request(url, options);
    },
  };
}

// -----------------------------------------------------------------------------
// The client of the pfSense REST API v2 (package pfSense-pkg-RESTAPI,
// https://pfrest.org): HTTPS requests under /api/v2, authenticated by the
// X-API-Key header. Every answer comes in the same envelope:
//
//   { "code": 200, "status": "ok", "response_id": "SUCCESS", "message": "", "data": … }
//
// and a refusal says why in `response_id` (AUTH_AUTHENTICATION_FAILED,
// AUTH_AUTHORIZATION_FAILED…). The client returns `data`, or throws a
// PfsenseError whose message never carries the key.
//
// Why the REST API and not XML-RPC (the way of the Home Assistant custom
// integration travisghansen/hass-pfsense): XML-RPC reads the firewall through
// `exec_php`, which needs an account allowed to run any PHP code as root. An
// API key can be limited to a read-only user, endpoint by endpoint, and
// revoked on its own.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, PfsenseError, kindOfAnswer, networkError } from './errors.js';
import { httpRequest } from './http.js';

export const API_PREFIX = '/api/v2';

// Every endpoint the integration calls, and only these (see the docs: the
// privileges of the pfSense user are named after them).
export const ENDPOINTS = Object.freeze({
  SYSTEM_STATUS: '/status/system',
  VERSION: '/system/version',
  HOSTNAME: '/system/hostname',
  GATEWAYS_STATUS: '/status/gateways',
  GATEWAYS: '/routing/gateways',
  INTERFACES: '/status/interfaces',
  LEASES: '/status/dhcp_server/leases',
  ARP: '/diagnostics/arp_table',
  PACKAGES: '/system/packages',
  RULES: '/firewall/rules',
  // Commands (only when "Allow commands" is ticked).
  RULE: '/firewall/rule',
  REBOOT: '/diagnostics/reboot',
});

export class PfsenseClient {
  /**
   * @param {object} options
   * @param {{ protocol: string, host: string, port: number|null }} options.target
   * @param {string} options.apiKey
   * @param {boolean} [options.insecure] accept a certificate that does not verify
   * @param {Function} [options.request] the HTTP seam (src/pfsense/http.js)
   * @param {number} [options.timeoutMs]
   */
  constructor({ target, apiKey, insecure = false, request = httpRequest, timeoutMs = 10_000 }) {
    this.target = target;
    this.apiKey = apiKey;
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs;
    const host = target.host.includes(':') ? `[${target.host}]` : target.host;
    this.base = `${target.protocol}//${host}${target.port ? `:${target.port}` : ''}${API_PREFIX}`;
  }

  get(path, options) {
    return this.call('GET', path, options);
  }

  patch(path, json, options) {
    return this.call('PATCH', path, { ...options, json });
  }

  post(path, json, options) {
    return this.call('POST', path, { ...options, json });
  }

  /**
   * @param {string} method
   * @param {string} path one of ENDPOINTS
   * @param {object} [options] { query, json, timeoutMs }
   * @returns {Promise<unknown>} the `data` of the envelope
   */
  async call(method, path, { query, json, timeoutMs } = {}) {
    const url = new URL(`${this.base}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    const where = `${method} ${path}`;
    let response;
    try {
      response = await this.request(url.href, {
        method,
        headers: { 'x-api-key': this.apiKey },
        json,
        insecure: this.insecure,
        timeoutMs: timeoutMs ?? this.timeoutMs,
      });
    } catch (err) {
      const error = networkError(err);
      error.message = `${where}: ${error.message}`;
      throw error;
    }
    return readEnvelope(response, where);
  }
}

/**
 * The `data` of a REST API answer, or the error it describes.
 * @param {{ status: number, headers?: object, body: string }} response
 * @param {string} where e.g. "GET /status/system"
 */
export function readEnvelope({ status, body }, where) {
  let envelope;
  try {
    envelope = JSON.parse(body);
  } catch {
    envelope = null;
  }
  const isEnvelope =
    envelope && typeof envelope === 'object' && !Array.isArray(envelope) && 'code' in envelope;
  const responseId = isEnvelope ? String(envelope.response_id ?? '') : null;

  if (status >= 200 && status < 300) {
    if (!isEnvelope) {
      // The webConfigurator, or another web server, answered instead.
      throw new PfsenseError(ERROR_KINDS.NO_API, `${where}: not a REST API answer`, { status });
    }
    return envelope.data ?? null;
  }
  if (status >= 300 && status < 400) {
    // A redirection to the login page of the webConfigurator.
    throw new PfsenseError(ERROR_KINDS.NO_API, `${where}: redirected (HTTP ${status})`, {
      status,
    });
  }
  if (/REST_API_IS_NOT_ENABLED/.test(responseId ?? '')) {
    throw new PfsenseError(ERROR_KINDS.NO_API, `${where}: the REST API is disabled`, {
      status,
      responseId,
    });
  }
  // pfSense writes its own refusal in `message`: never the key we sent.
  const detail = isEnvelope && envelope.message ? ` ${String(envelope.message).slice(0, 200)}` : '';
  throw new PfsenseError(
    kindOfAnswer(status, responseId),
    `${where}: HTTP ${status}${responseId ? ` ${responseId}` : ''}${detail}`,
    { status, responseId },
  );
}

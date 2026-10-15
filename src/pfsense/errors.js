// -----------------------------------------------------------------------------
// The errors of the REST client, sorted into a few kinds the rest of the code
// (and the user) can act on. A message never carries the API key: the client
// builds it from a status, an error code or the `response_id` of pfSense.
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  // Nothing answers at this address and port (refused, timeout, no route).
  UNREACHABLE: 'unreachable',
  // HTTPS answers, but its certificate does not verify.
  TLS: 'tls',
  // Something answers, but not the REST API package (webConfigurator login
  // page, another web server, the package not installed).
  NO_API: 'no_api',
  // The REST API refused the key (unknown, revoked, or the method disabled).
  AUTH: 'auth',
  // The key is valid, but its user lacks the privilege of this endpoint.
  PERMISSION: 'permission',
  // The endpoint does not exist in this version of the package.
  NOT_FOUND: 'not_found',
  // Any other refusal or unexpected answer.
  PROTOCOL: 'protocol',
});

export class PfsenseError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message safe to log: never the API key
   * @param {object} [details] { status, responseId }
   */
  constructor(kind, message, { status = null, responseId = null } = {}) {
    super(message);
    this.name = 'PfsenseError';
    this.kind = kind;
    this.status = status;
    this.responseId = responseId;
  }
}

// Node error codes of a peer that does not answer (or no longer does).
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EHOSTDOWN',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ECONNABORTED',
]);

// OpenSSL verification failures: the peer speaks TLS, its certificate is not trusted.
const CERTIFICATE_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/**
 * Turn a socket or TLS error into a PfsenseError.
 * @param {Error & { code?: string }} err
 */
export function networkError(err) {
  if (err instanceof PfsenseError) {
    return err;
  }
  const code = err?.code ?? '';
  if (CERTIFICATE_CODES.has(code)) {
    return new PfsenseError(ERROR_KINDS.TLS, `certificate not trusted (${code})`);
  }
  if (UNREACHABLE_CODES.has(code)) {
    return new PfsenseError(ERROR_KINDS.UNREACHABLE, `no answer (${code})`);
  }
  // HTTPS on a plain port, or the reverse: nothing usable there.
  if (/^ERR_SSL_|^EPROTO$/.test(code) || /handshake|ssl|tls/i.test(err?.message ?? '')) {
    return new PfsenseError(ERROR_KINDS.NO_API, `TLS handshake failed (${code})`);
  }
  return new PfsenseError(ERROR_KINDS.UNREACHABLE, code || err?.message || 'connection failed');
}

/**
 * Sort an HTTP answer of the REST API that is not a success.
 * @param {number} status
 * @param {string|null} responseId the `response_id` of the JSON envelope
 */
export function kindOfAnswer(status, responseId) {
  const id = String(responseId ?? '');
  if (status === 401 || id === 'AUTH_AUTHENTICATION_FAILED') {
    return ERROR_KINDS.AUTH;
  }
  // AUTH_AUTHORIZATION_FAILED, ENDPOINT_CLIENT_NOT_ALLOWED_BY_ACL,
  // ENDPOINT_METHOD_NOT_ALLOWED_IN_READ_ONLY_MODE…
  if (status === 403) {
    return ERROR_KINDS.PERMISSION;
  }
  if (status === 404) {
    return ERROR_KINDS.NOT_FOUND;
  }
  return ERROR_KINDS.PROTOCOL;
}

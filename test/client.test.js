// -----------------------------------------------------------------------------
// The REST client: the envelope, the error kinds, and one real HTTP exchange
// on the loopback through src/pfsense/http.js (the header, the JSON body).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ENDPOINTS, PfsenseClient, readEnvelope } from '../src/pfsense/client.js';
import { ERROR_KINDS, PfsenseError, networkError } from '../src/pfsense/errors.js';

const json = (status, body) => ({ status, body: JSON.stringify(body) });
const kindOf = (fn) => {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof PfsenseError);
    return err.kind;
  }
  return null;
};

test('the data of a success, whatever it is', () => {
  const ok = { code: 200, status: 'ok', response_id: 'SUCCESS', message: '', data: [1, 2] };
  assert.deepEqual(readEnvelope(json(200, ok), 'GET /x'), [1, 2]);
  assert.equal(readEnvelope(json(200, { ...ok, data: null }), 'GET /x'), null);
});

test('every refusal has a kind the user can act on', () => {
  const env = (code, id) =>
    json(code, { code, status: 'error', response_id: id, message: 'm', data: [] });
  assert.equal(
    kindOf(() => readEnvelope(env(401, 'AUTH_AUTHENTICATION_FAILED'), 'x')),
    ERROR_KINDS.AUTH,
  );
  assert.equal(
    kindOf(() => readEnvelope(env(403, 'AUTH_AUTHORIZATION_FAILED'), 'x')),
    ERROR_KINDS.PERMISSION,
  );
  assert.equal(
    kindOf(() => readEnvelope(env(403, 'ENDPOINT_CLIENT_NOT_ALLOWED_BY_ACL'), 'x')),
    ERROR_KINDS.PERMISSION,
  );
  assert.equal(
    kindOf(() => readEnvelope(env(503, 'ENDPOINT_REST_API_IS_NOT_ENABLED'), 'x')),
    ERROR_KINDS.NO_API,
  );
  assert.equal(
    kindOf(() => readEnvelope(env(500, 'SERVER_ERROR'), 'x')),
    ERROR_KINDS.PROTOCOL,
  );
  assert.equal(
    kindOf(() => readEnvelope({ status: 404, body: '<html>' }, 'x')),
    ERROR_KINDS.NOT_FOUND,
  );
  assert.equal(
    kindOf(() => readEnvelope({ status: 200, body: '<html>' }, 'x')),
    ERROR_KINDS.NO_API,
  );
  assert.equal(
    kindOf(() => readEnvelope({ status: 302, body: '' }, 'x')),
    ERROR_KINDS.NO_API,
  );
});

test('network errors: unreachable, certificate, TLS on a plain port', () => {
  const err = (code, message = code) => Object.assign(new Error(message), { code });
  assert.equal(networkError(err('ECONNREFUSED')).kind, ERROR_KINDS.UNREACHABLE);
  assert.equal(networkError(err('ETIMEDOUT')).kind, ERROR_KINDS.UNREACHABLE);
  assert.equal(networkError(err('DEPTH_ZERO_SELF_SIGNED_CERT')).kind, ERROR_KINDS.TLS);
  assert.equal(networkError(err('ERR_TLS_CERT_ALTNAME_INVALID')).kind, ERROR_KINDS.TLS);
  assert.equal(networkError(err('ERR_SSL_WRONG_VERSION_NUMBER')).kind, ERROR_KINDS.NO_API);
});

test('a real exchange on the loopback: the key in a header, JSON both ways', async (t) => {
  const received = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], body });
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          code: 200,
          status: 'ok',
          response_id: 'SUCCESS',
          message: '',
          data: { ok: true },
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const client = new PfsenseClient({
    target: { protocol: 'http:', host: '127.0.0.1', port: server.address().port },
    apiKey: 'k-123',
  });
  assert.deepEqual(await client.get(ENDPOINTS.SYSTEM_STATUS), { ok: true });
  await client.patch(ENDPOINTS.RULE, { id: 3, disabled: true, apply: true });
  assert.deepEqual(received[0], {
    method: 'GET',
    url: '/api/v2/status/system',
    key: 'k-123',
    body: '',
  });
  assert.equal(received[1].method, 'PATCH');
  assert.deepEqual(JSON.parse(received[1].body), { id: 3, disabled: true, apply: true });
});

test('a closed port is unreachable, and the message never carries the key', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  const client = new PfsenseClient({
    target: { protocol: 'http:', host: '127.0.0.1', port },
    apiKey: 'secret-key-42',
  });
  await assert.rejects(client.get(ENDPOINTS.SYSTEM_STATUS), (err) => {
    assert.equal(err.kind, ERROR_KINDS.UNREACHABLE);
    assert.ok(!err.message.includes('secret-key-42'));
    return true;
  });
});

// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Reading intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['10', '15', '30', '60'];

export const MAX_AWAY_DELAY_MINUTES = 60;

export const DEFAULT_CONFIG = {
  url: '',
  api_key: '',
  allow_self_signed: false,
  poll_interval: '30',
  gateways: '',
  away_delay: 5,
  firewall_rules: '',
  allow_commands: false,
  language: 'fr',
};

// Longest description of a followed firewall rule: pfSense allows 52
// characters in its form, the API more; Gladys shows the device name in a card.
const MAX_RULE_DESCRIPTION = 60;
export const MAX_RULES = 10;
export const MAX_GATEWAYS = 4;

/**
 * Parse the address typed by the user: the URL of the webConfigurator
 * (`https://192.0.2.1`, `https://fw.lan:8443/`), or a bare address
 * (`192.0.2.1`, `fw.lan:8443`), which means HTTPS. The path is dropped: the
 * REST API always lives under `/api/v2`.
 * @param {unknown} raw
 * @returns {{ protocol: 'https:'|'http:', host: string, port: number|null }|null} null when unusable
 */
export function parseUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!['https:', 'http:'].includes(url.protocol)) {
    return null;
  }
  // Credentials in the address would end up in the logs and the device params.
  if (!url.hostname || url.username || url.password) {
    return null;
  }
  return {
    protocol: url.protocol,
    host: url.hostname.replace(/^\[(.*)\]$/, '$1'),
    port: url.port ? Number(url.port) : null,
  };
}

/** The address as shown to the user: never anything but scheme, host and port. */
export function displayUrl(target) {
  if (!target) {
    return '';
  }
  const host = target.host.includes(':') ? `[${target.host}]` : target.host;
  return `${target.protocol}//${host}${target.port ? `:${target.port}` : ''}`;
}

/** Split a comma (or semicolon, or line) separated list, trimmed, without blanks nor duplicates. */
export function splitList(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  const seen = new Set();
  const items = [];
  for (const item of raw.split(/[,;\n]/)) {
    const text = item.trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      items.push(text);
    }
  }
  return items;
}

const toBoolean = (value, fallback) => {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return fallback;
};

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const typedUrl = text('url');
  const target = parseUrl(typedUrl);

  // A number field may arrive as a string ("5", "2,5") or be left empty.
  const rawDelay =
    typeof source.away_delay === 'string'
      ? Number(source.away_delay.trim().replace(',', '.'))
      : source.away_delay;
  const awayDelay =
    typeof rawDelay === 'number' && Number.isFinite(rawDelay) && rawDelay >= 0
      ? Math.min(MAX_AWAY_DELAY_MINUTES, Math.round(rawDelay))
      : DEFAULT_CONFIG.away_delay;

  return {
    target,
    invalidUrl: typedUrl !== '' && target === null,
    // A key copied from the pfSense page may carry spaces around it, never inside.
    apiKey: text('api_key'),
    allowSelfSigned: toBoolean(source.allow_self_signed, DEFAULT_CONFIG.allow_self_signed),
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    gateways: splitList(source.gateways).slice(0, MAX_GATEWAYS),
    awayDelayMs: awayDelay * 60_000,
    rules: splitList(source.firewall_rules)
      .map((description) => description.slice(0, MAX_RULE_DESCRIPTION))
      .slice(0, MAX_RULES),
    allowCommands: toBoolean(source.allow_commands, DEFAULT_CONFIG.allow_commands),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

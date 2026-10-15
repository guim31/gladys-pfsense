// -----------------------------------------------------------------------------
// The Gladys devices of the integration (category/type couples of the core
// table, see test/gladys-rules.test.js):
//
//   - the firewall: CPU, memory and disk usage, temperature (when pfSense
//     reads a sensor), uptime, pfSense version and "package update
//     available"; for each followed gateway its state (online), its latency
//     and its packet loss (dpinger); for each WAN interface of these gateways
//     its download and upload rates;
//   - one presence sensor per network client the user adds from the
//     Discovery tab (presence-sensor/binary: 1 present, 0 away once the
//     departure delay has passed);
//   - one device per firewall rule followed in the configuration (its
//     description): input/binary, 1 when the rule is enabled. Read-only on
//     purpose: the commands go through the scene actions and the widget,
//     never through a switch a voice assistant could flip.
//
// Identities (external ids, permanent):
//   - the firewall: its Netgate device ID (unique per installation, shown on
//     the dashboard of pfSense), else its serial number, else the MAC address
//     of its first interface. Never the address typed in the configuration;
//   - a client: its MAC address;
//   - a rule: its description, made an identifier (`rule:block-kids-tablet`).
// Feature keys are permanent too: a gateway feature carries the gateway
// name of pfSense (`gw_wan_dhcp_latency`), a rate the interface name
// (`wan_wan_download`).
//
// Every device is published with should_poll: false: the integration reads
// the firewall on its own timer (src/hub.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPES = Object.freeze({
  FIREWALL: 'firewall',
  CLIENT: 'client',
  RULE: 'rule',
});

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  CPU: 'cpu_usage',
  MEMORY: 'memory_usage',
  DISK: 'disk_usage',
  TEMPERATURE: 'temperature',
  UPTIME: 'uptime',
  VERSION: 'pfsense_version',
  PACKAGE_UPDATE: 'package_update_available',
  PRESENCE: 'presence',
  RULE_ACTIVE: 'active',
});

export const GATEWAY_FEATURES = Object.freeze({
  ONLINE: 'online',
  LATENCY: 'latency',
  LOSS: 'loss',
});

export const WAN_FEATURES = Object.freeze({
  DOWNLOAD: 'download',
  UPLOAD: 'upload',
});

export const gatewayFeatureKey = (slug, what) => `gw_${slug}_${what}`;
export const wanFeatureKey = (slug, what) => `wan_${slug}_${what}`;

// Feature and device names, in the language chosen in the configuration
// (Gladys does not tell a device integration the user's language). Frozen at
// creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.CPU]: 'CPU usage',
    [FEATURE_KEYS.MEMORY]: 'Memory used',
    [FEATURE_KEYS.DISK]: 'Disk used',
    [FEATURE_KEYS.TEMPERATURE]: 'Temperature',
    [FEATURE_KEYS.UPTIME]: 'Uptime',
    [FEATURE_KEYS.VERSION]: 'pfSense version',
    [FEATURE_KEYS.PACKAGE_UPDATE]: 'Package update available',
    [FEATURE_KEYS.PRESENCE]: 'Presence',
    [FEATURE_KEYS.RULE_ACTIVE]: 'Rule enabled',
    online: (name) => `Gateway ${name} online`,
    latency: (name) => `Latency ${name}`,
    loss: (name) => `Packet loss ${name}`,
    download: (name) => `Download ${name}`,
    upload: (name) => `Upload ${name}`,
    client: (mac) => `Device ${mac}`,
    rule: (description) => `Rule "${description}"`,
  },
  fr: {
    [FEATURE_KEYS.CPU]: 'Charge du processeur',
    [FEATURE_KEYS.MEMORY]: 'Mémoire utilisée',
    [FEATURE_KEYS.DISK]: 'Disque utilisé',
    [FEATURE_KEYS.TEMPERATURE]: 'Température',
    [FEATURE_KEYS.UPTIME]: 'Temps de fonctionnement',
    [FEATURE_KEYS.VERSION]: 'Version de pfSense',
    [FEATURE_KEYS.PACKAGE_UPDATE]: 'Mise à jour de paquet disponible',
    [FEATURE_KEYS.PRESENCE]: 'Présence',
    [FEATURE_KEYS.RULE_ACTIVE]: 'Règle activée',
    online: (name) => `Passerelle ${name} en ligne`,
    latency: (name) => `Latence ${name}`,
    loss: (name) => `Perte de paquets ${name}`,
    download: (name) => `Débit descendant ${name}`,
    upload: (name) => `Débit montant ${name}`,
    client: (mac) => `Appareil ${mac}`,
    rule: (description) => `Règle « ${description} »`,
  },
  de: {
    [FEATURE_KEYS.CPU]: 'CPU-Auslastung',
    [FEATURE_KEYS.MEMORY]: 'Belegter Speicher',
    [FEATURE_KEYS.DISK]: 'Belegter Datenträger',
    [FEATURE_KEYS.TEMPERATURE]: 'Temperatur',
    [FEATURE_KEYS.UPTIME]: 'Betriebszeit',
    [FEATURE_KEYS.VERSION]: 'pfSense-Version',
    [FEATURE_KEYS.PACKAGE_UPDATE]: 'Paket-Update verfügbar',
    [FEATURE_KEYS.PRESENCE]: 'Anwesenheit',
    [FEATURE_KEYS.RULE_ACTIVE]: 'Regel aktiviert',
    online: (name) => `Gateway ${name} online`,
    latency: (name) => `Latenz ${name}`,
    loss: (name) => `Paketverlust ${name}`,
    download: (name) => `Download ${name}`,
    upload: (name) => `Upload ${name}`,
    client: (mac) => `Gerät ${mac}`,
    rule: (description) => `Regel „${description}“`,
  },
  es: {
    [FEATURE_KEYS.CPU]: 'Carga del procesador',
    [FEATURE_KEYS.MEMORY]: 'Memoria usada',
    [FEATURE_KEYS.DISK]: 'Disco usado',
    [FEATURE_KEYS.TEMPERATURE]: 'Temperatura',
    [FEATURE_KEYS.UPTIME]: 'Tiempo de funcionamiento',
    [FEATURE_KEYS.VERSION]: 'Versión de pfSense',
    [FEATURE_KEYS.PACKAGE_UPDATE]: 'Actualización de paquete disponible',
    [FEATURE_KEYS.PRESENCE]: 'Presencia',
    [FEATURE_KEYS.RULE_ACTIVE]: 'Regla activada',
    online: (name) => `Puerta de enlace ${name} en línea`,
    latency: (name) => `Latencia ${name}`,
    loss: (name) => `Pérdida de paquetes ${name}`,
    download: (name) => `Descarga ${name}`,
    upload: (name) => `Subida ${name}`,
    client: (mac) => `Dispositivo ${mac}`,
    rule: (description) => `Regla «${description}»`,
  },
};

export const names = (language) => NAMES[language] ?? NAMES.en;

// Display bounds (the core never applies them on write).
const MAX_RATE_MBPS = 100_000;
const MAX_UPTIME_HOURS = 100_000;
// dpinger marks a gateway down beyond 500 ms by default; a satellite link can
// show more.
const MAX_LATENCY_MS = 10_000;

const sensor = (definition) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...definition,
});

/** A text usable in an external id: lowercase letters, digits and underscores. */
export function slugify(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

/** A rule description made an identifier: lowercase letters, digits and dashes. */
export const ruleSlug = (description) => slugify(description).replace(/_/g, '-');

/** The identifier of a client: its MAC address, lowercase. */
export const clientPlatformId = (mac) => mac.toLowerCase();

export const firewallIds = (gladys, firewallId) =>
  gladys.externalIds(DEVICE_TYPES.FIREWALL, firewallId);
export const clientIds = (gladys, mac) =>
  gladys.externalIds(DEVICE_TYPES.CLIENT, clientPlatformId(mac));
export const ruleIds = (gladys, description) =>
  gladys.externalIds(DEVICE_TYPES.RULE, ruleSlug(description));

/**
 * What kind of device an external id is, and its platform id.
 * @returns {{ type: string, id: string }|null}
 */
export function parseDeviceId(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  for (const type of Object.values(DEVICE_TYPES)) {
    const prefix = gladys.externalIds(type, '').device;
    if (externalId.startsWith(prefix) && externalId.length > prefix.length) {
      return { type, id: externalId.slice(prefix.length) };
    }
  }
  return null;
}

/** The name of the firewall device: its host name, else pfSense and the platform. */
export function firewallName(firewall) {
  if (firewall.hostname && firewall.hostname.toLowerCase() !== 'pfsense') {
    return `pfSense ${firewall.hostname}`.slice(0, 60);
  }
  return firewall.platform ? `pfSense ${firewall.platform}`.slice(0, 60) : 'pfSense';
}

/**
 * The features of the firewall device.
 * @param {object} gladys
 * @param {object} firewall { id, hasTemperature, hasPackages, gateways: [{ name, slug }], wan: [{ name, label, slug }] }
 * @param {string} language
 */
export function firewallFeatures(gladys, firewall, language) {
  const ids = firewallIds(gladys, firewall.id);
  const n = names(language);
  const feature = (key, name, definition) => ({
    ...definition,
    name,
    external_id: ids.feature(key),
  });
  const percent = (key) =>
    feature(
      key,
      n[key],
      sensor({
        category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
        unit: DEVICE_FEATURE_UNITS.PERCENT,
        min: 0,
        max: 100,
      }),
    );
  const features = [
    percent(FEATURE_KEYS.CPU),
    percent(FEATURE_KEYS.MEMORY),
    percent(FEATURE_KEYS.DISK),
  ];
  if (firewall.hasTemperature) {
    features.push(
      feature(
        FEATURE_KEYS.TEMPERATURE,
        n[FEATURE_KEYS.TEMPERATURE],
        sensor({
          category: DEVICE_FEATURE_CATEGORIES.DEVICE_TEMPERATURE_SENSOR,
          type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
          unit: DEVICE_FEATURE_UNITS.CELSIUS,
          min: -40,
          max: 125,
        }),
      ),
    );
  }
  features.push(
    feature(
      FEATURE_KEYS.UPTIME,
      n[FEATURE_KEYS.UPTIME],
      sensor({
        category: DEVICE_FEATURE_CATEGORIES.DURATION,
        type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
        unit: DEVICE_FEATURE_UNITS.HOURS,
        min: 0,
        max: MAX_UPTIME_HOURS,
        // A counter that only grows: its history says nothing a reboot would not.
        keep_history: false,
      }),
    ),
    feature(
      FEATURE_KEYS.VERSION,
      n[FEATURE_KEYS.VERSION],
      sensor({
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        min: 0,
        max: 0,
      }),
    ),
  );
  if (firewall.hasPackages) {
    features.push(
      feature(
        FEATURE_KEYS.PACKAGE_UPDATE,
        n[FEATURE_KEYS.PACKAGE_UPDATE],
        sensor({
          category: DEVICE_FEATURE_CATEGORIES.INPUT,
          type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
          min: 0,
          max: 1,
        }),
      ),
    );
  }
  for (const { name, slug } of firewall.gateways) {
    features.push(
      feature(
        gatewayFeatureKey(slug, GATEWAY_FEATURES.ONLINE),
        n.online(name),
        sensor({
          category: DEVICE_FEATURE_CATEGORIES.INPUT,
          type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
          min: 0,
          max: 1,
        }),
      ),
      feature(
        gatewayFeatureKey(slug, GATEWAY_FEATURES.LATENCY),
        n.latency(name),
        sensor({
          category: DEVICE_FEATURE_CATEGORIES.DURATION,
          type: DEVICE_FEATURE_TYPES.DURATION.DECIMAL,
          unit: DEVICE_FEATURE_UNITS.MILLISECONDS,
          min: 0,
          max: MAX_LATENCY_MS,
        }),
      ),
      feature(
        gatewayFeatureKey(slug, GATEWAY_FEATURES.LOSS),
        n.loss(name),
        sensor({
          category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
          type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
          unit: DEVICE_FEATURE_UNITS.PERCENT,
          min: 0,
          max: 100,
        }),
      ),
    );
  }
  for (const { label, slug } of firewall.wan) {
    const rate = (what, name) =>
      feature(
        wanFeatureKey(slug, what),
        name,
        sensor({
          category: DEVICE_FEATURE_CATEGORIES.DATARATE,
          type: DEVICE_FEATURE_TYPES.DATARATE.RATE,
          unit: DEVICE_FEATURE_UNITS.MEGABITS_PER_SECOND,
          min: 0,
          max: MAX_RATE_MBPS,
        }),
      );
    features.push(
      rate(WAN_FEATURES.DOWNLOAD, n.download(label)),
      rate(WAN_FEATURES.UPLOAD, n.upload(label)),
    );
  }
  return features;
}

/**
 * The discovery payload of the firewall.
 * @param {object} firewall { id, hostname, platform, address, hasTemperature, hasPackages, gateways, wan }
 */
export function buildFirewallDevice(gladys, firewall, language) {
  return {
    name: firewallName(firewall),
    external_id: firewallIds(gladys, firewall.id).device,
    model: firewall.platform ?? undefined,
    should_poll: false,
    params: [
      { name: 'FIREWALL_ADDRESS', value: firewall.address },
      ...(firewall.platform ? [{ name: 'PLATFORM', value: firewall.platform }] : []),
    ],
    features: firewallFeatures(gladys, firewall, language),
  };
}

/** The name proposed for a client: its description in pfSense, its host name, else its MAC. */
export function clientName(client, language) {
  return client.description ?? client.hostName ?? names(language).client(client.mac);
}

/**
 * The discovery payload of a network client.
 * @param {object} client { mac, ip, hostName, description }
 */
export function buildClientDevice(gladys, client, language) {
  const ids = clientIds(gladys, client.mac);
  return {
    name: clientName(client, language).slice(0, 60),
    external_id: ids.device,
    should_poll: false,
    params: [
      { name: 'MAC_ADDRESS', value: client.mac },
      ...(client.ip ? [{ name: 'IP_ADDRESS', value: client.ip }] : []),
    ],
    features: [
      {
        name: names(language)[FEATURE_KEYS.PRESENCE],
        external_id: ids.feature(FEATURE_KEYS.PRESENCE),
        ...sensor({
          category: DEVICE_FEATURE_CATEGORIES.PRESENCE_SENSOR,
          type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
          min: 0,
          max: 1,
        }),
      },
    ],
  };
}

/** The discovery payload of a followed firewall rule. */
export function buildRuleDevice(gladys, description, language) {
  const ids = ruleIds(gladys, description);
  return {
    name: names(language).rule(description).slice(0, 80),
    external_id: ids.device,
    should_poll: false,
    params: [{ name: 'RULE_DESCRIPTION', value: description }],
    features: [
      {
        name: names(language)[FEATURE_KEYS.RULE_ACTIVE],
        external_id: ids.feature(FEATURE_KEYS.RULE_ACTIVE),
        ...sensor({
          category: DEVICE_FEATURE_CATEGORIES.INPUT,
          type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
          min: 0,
          max: 1,
        }),
      },
    ],
  };
}

/** The value of a param of a device received from Gladys. */
export const paramOf = (device, name) =>
  (device?.params ?? []).find((param) => param.name === name)?.value ?? null;

// -----------------------------------------------------------------------------
// The pfSense hub: the REST API of one firewall, read on a timer of the
// container (the interval chosen in the configuration), its states published
// to Gladys when they change, its scene events fired on transitions, and the
// commands (firewall rules, reboot) of the scene actions and the widgets.
//
// Gladys never polls these devices (should_poll: false): Gladys 5.2 does not
// reliably poll external devices (GladysAssistant/Gladys#3198), and the scene
// events must fire even for a firewall whose device was not added.
// (Adapted from guim31/gladys-mikrotik.)
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { displayUrl } from './config.js';
import {
  DEVICE_TYPES,
  FEATURE_KEYS,
  GATEWAY_FEATURES,
  WAN_FEATURES,
  buildClientDevice,
  buildFirewallDevice,
  buildRuleDevice,
  clientIds,
  firewallIds,
  firewallName,
  gatewayFeatureKey,
  parseDeviceId,
  paramOf,
  ruleIds,
  ruleSlug,
  slugify,
  wanFeatureKey,
} from './devices.js';
import { ENDPOINTS, PfsenseClient } from './pfsense/client.js';
import { ERROR_KINDS, PfsenseError } from './pfsense/errors.js';
import {
  normalizeMac,
  parseArp,
  parseGatewayStatuses,
  parseGateways,
  parseHostname,
  parseInterfaces,
  parseLeases,
  parsePackages,
  parseRules,
  parseSystemStatus,
  parseVersion,
} from './pfsense/model.js';
import { PresenceTracker, collectClients } from './presence.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  RULES_TEXT,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'pfsense-hub' });

export const WIDGET_KEYS = Object.freeze({
  FIREWALL: 'firewall',
  PRESENCE: 'presence',
  RULES: 'firewall_rules',
});

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  GATEWAY_DOWN: 'gateway_down',
  GATEWAY_UP: 'gateway_up',
  UNKNOWN_DEVICE: 'unknown_device_connected',
});

export const HUB_TIMINGS = {
  // The pfSense version, the host name and the gateway → interface map.
  structureMs: 10 * 60_000,
  // The package list asks pfSense's package servers (cached by the REST API):
  // once an hour is plenty.
  packagesMs: 60 * 60_000,
  // The discovery list follows the clients seen, at most this often.
  discoveryMs: 5 * 60_000,
  // A refused key is tried again this late, not at every reading: each try
  // is an authentication failure for the login protection of pfSense, which
  // blocks the address of Gladys after a few of them.
  authRetryMs: 5 * 60_000,
  // A present client is published again this often: the "Check presence"
  // scene action of Gladys reads the date of the last value received.
  presentRefreshMs: 2 * 60_000,
  // Any other unchanged value is published again this often, so Gladys never
  // shows it as "no recent value".
  heartbeatMs: 6 * 60 * 60_000,
  // A client seen this long ago leaves the discovery list.
  clientMemoryMs: 7 * 24 * 60 * 60_000,
  readTimeoutMs: 10_000,
  packagesTimeoutMs: 30_000,
  commandTimeoutMs: 20_000,
};

const MAX_STATES_PER_REQUEST = 100;
const MAX_DISCOVERED_CLIENTS = 250;
const MAX_KNOWN_MACS = 5000;
const MAX_GATEWAYS = 4;
// "Unknown device connected" events per reading at most: a new guest network
// or a reset of the DHCP server never floods the scenes.
const MAX_UNKNOWN_EVENTS = 5;

// An endpoint the key may not read (privilege not granted), or that this
// version of the package lacks: skipped, never an outage.
const optional = (err) =>
  err instanceof PfsenseError &&
  (err.kind === ERROR_KINDS.NOT_FOUND || err.kind === ERROR_KINDS.PERMISSION);

const sessionSignature = (config) =>
  JSON.stringify([config.target, config.apiKey, config.allowSelfSigned]);

const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export class PfsenseHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {object} [options.seams] { request } network seam (tests)
   * @param {boolean} [options.timers] periodic timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, seams = {}, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.seams = seams;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.client = null;
    this.signature = null;
    this.firewall = null;
    this.resetReading();
    this.saved = { knownMacs: {}, baselined: false };
    /** Last value published per feature external id: { key, at }. */
    this.published = new Map();
    this.transports = new Map();
    this.connection = null;
    this.discoveryKey = null;
    this.discoveryAt = 0;
    this.pollTimer = null;
    this.polling = null;
    this.stopped = false;
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
  }

  /** Forget what was read from the firewall (a new firewall, a new key). */
  resetReading() {
    this.snapshot = {
      reachable: null,
      error: null,
      system: null,
      version: null,
      packages: null,
      gateways: new Map(),
      wan: new Map(),
      rules: new Map(),
      interfaces: [],
      counts: { arp: 0, leases: 0 },
      // Endpoints this key may not read: listed by the connection test.
      unavailable: new Set(),
    };
    this.counters = new Map();
    this.gatewayDownSince = new Map();
    this.clients = new Map();
    this.lastClients = new Map();
    this.structureAt = 0;
    this.packagesAt = 0;
    this.retryAfter = 0;
    this.gatewayInterfaces = new Map();
    this.presence = new PresenceTracker({
      awayDelayMs: this.config?.awayDelayMs ?? 0,
      now: () => this.now(),
    });
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (firewall connected, lost, back, gateways
  // down and up, user commands). A problem that repeats every reading is
  // logged once at its own level, then at debug until it clears.
  // LOG_LEVEL=debug shows everything.

  problem(key, message, level = 'warn') {
    if (this.warned.has(key)) {
      logger.debug(message);
      return;
    }
    this.warned.add(key);
    logger[level](message);
  }

  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      knownMacs:
        saved.knownMacs && typeof saved.knownMacs === 'object' && !Array.isArray(saved.knownMacs)
          ? saved.knownMacs
          : {},
      baselined: saved.baselined === true,
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.transports.clear();
    this.connection = null;
    this.discoveryKey = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const signature = sessionSignature(config);
    if (signature !== this.signature) {
      this.signature = signature;
      this.client = null;
      if (JSON.stringify(previous?.target) !== JSON.stringify(config.target)) {
        this.firewall = null;
      }
      this.resetReading();
      this.warned.clear();
    }
    this.presence.awayDelayMs = config.awayDelayMs;
    if (this.firewall) {
      // The followed gateways may have changed.
      this.firewall.gateways = [];
      this.firewall.wan = [];
    }
    this.structureAt = 0;
    this.discoveryKey = null;
    await this.pollAll();
    this.schedulePoll();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.polling?.catch(() => {});
    await this.store.flush();
  }

  configured() {
    return Boolean(this.config?.target && this.config.apiKey);
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.configured()) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.resolved('poll');
      } catch (err) {
        this.problem('poll', `Reading failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Reading the firewall ------------------------------------------------------

  /** One reading; concurrent calls share it. */
  pollAll() {
    this.polling ??= this.poll().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  /** Gladys asks for a refresh (onPoll): a reading covers every device. */
  async pollDevice() {
    if (!this.timersEnabled || !this.pollTimer) {
      await this.pollAll();
    }
  }

  async poll() {
    if (!this.configured()) {
      await this.publishConnectionStatus();
      return;
    }
    if (this.now() < this.retryAfter) {
      return;
    }
    let reading;
    try {
      if (!this.client || !this.firewall) {
        await this.connect();
      }
      reading = await this.read();
    } catch (err) {
      if (!(err instanceof PfsenseError)) {
        throw err;
      }
      await this.applyFailure(err);
      return;
    }
    await this.applyReading(reading);
  }

  createClient() {
    return new PfsenseClient({
      target: this.config.target,
      apiKey: this.config.apiKey,
      insecure: this.config.allowSelfSigned,
      request: this.seams.request,
      timeoutMs: this.timings.readTimeoutMs,
    });
  }

  /** Soft read: an endpoint the key may not read returns the fallback, and is noted. */
  async soft(path, fallback, options) {
    try {
      const data = await this.client.get(path, options);
      this.snapshot.unavailable.delete(path);
      return data;
    } catch (err) {
      if (!optional(err)) {
        throw err;
      }
      if (!this.snapshot.unavailable.has(path)) {
        this.snapshot.unavailable.add(path);
        logger.debug(`${path} not read: ${err.message}`);
      }
      return fallback;
    }
  }

  /** What identifies the firewall, read when the client is created. */
  async connect() {
    this.client = this.createClient();
    let system;
    try {
      system = parseSystemStatus(await this.client.get(ENDPOINTS.SYSTEM_STATUS));
    } catch (err) {
      this.client = null;
      // The first endpoint missing means no REST API v2 at all.
      if (err instanceof PfsenseError && err.kind === ERROR_KINDS.NOT_FOUND) {
        throw new PfsenseError(ERROR_KINDS.NO_API, err.message, { status: err.status });
      }
      throw err;
    }
    let id = system.netgateId ?? system.serial;
    if (!id) {
      const interfaces = parseInterfaces(await this.soft(ENDPOINTS.INTERFACES, []));
      id = interfaces.find((item) => item.mac)?.mac ?? `host-${this.config.target.host}`;
    }
    const firewallId = slugify(id) || 'firewall';
    const same = this.firewall?.id === firewallId;
    if (this.firewall && !same) {
      // Another firewall at the same address: start over.
      this.resetReading();
    }
    this.firewall = {
      id: firewallId,
      hostname: same ? this.firewall.hostname : null,
      platform: system.platform,
      address: displayUrl(this.config.target),
      version: same ? this.firewall.version : null,
      hasTemperature: same ? this.firewall.hasTemperature : false,
      hasPackages: same ? this.firewall.hasPackages : false,
      gateways: same ? this.firewall.gateways : [],
      wan: same ? this.firewall.wan : [],
    };
    this.structureAt = 0;
  }

  /** The version, the host name and the gateway → interface map: every few minutes. */
  async readStructure() {
    const version = parseVersion(await this.soft(ENDPOINTS.VERSION, null));
    const { hostname } = parseHostname(await this.soft(ENDPOINTS.HOSTNAME, null));
    const gateways = parseGateways(await this.soft(ENDPOINTS.GATEWAYS, []));
    this.firewall.version = version.version ?? this.firewall.version;
    this.firewall.hostname = hostname ?? this.firewall.hostname;
    this.gatewayInterfaces = new Map(
      gateways.filter((gw) => gw.interface).map((gw) => [gw.name, gw.interface]),
    );
    this.structureAt = this.now();
  }

  /** The package list (update available): hourly, when the key may read it. */
  async readPackages() {
    const now = this.now();
    if (this.packagesAt && now - this.packagesAt < this.timings.packagesMs) {
      return this.snapshot.packages;
    }
    this.packagesAt = now;
    const data = await this.soft(ENDPOINTS.PACKAGES, null, {
      timeoutMs: this.timings.packagesTimeoutMs,
    });
    if (data === null) {
      return null;
    }
    const packages = parsePackages(data);
    return {
      count: packages.length,
      updates: packages.filter((item) => item.updateAvailable).map((item) => item.name),
    };
  }

  async read() {
    const now = this.now();
    const system = parseSystemStatus(await this.client.get(ENDPOINTS.SYSTEM_STATUS));
    if (now - this.structureAt >= this.timings.structureMs) {
      await this.readStructure();
    }
    const gateways = parseGatewayStatuses(await this.soft(ENDPOINTS.GATEWAYS_STATUS, []));
    const interfaces = parseInterfaces(await this.soft(ENDPOINTS.INTERFACES, []));
    const leases = parseLeases(await this.soft(ENDPOINTS.LEASES, []));
    const arp = parseArp(await this.soft(ENDPOINTS.ARP, []));
    const packages = await this.readPackages();
    const rules = await this.readRules();
    return { at: now, system, gateways, interfaces, leases, arp, packages, rules };
  }

  /** The firewall rules followed in the configuration, by description. */
  async readRules({ strict = false } = {}) {
    const result = new Map();
    if (this.config.rules.length === 0) {
      return result;
    }
    const data = strict
      ? await this.client.get(ENDPOINTS.RULES)
      : await this.soft(ENDPOINTS.RULES, null);
    if (data === null) {
      return result;
    }
    const all = parseRules(data);
    for (const description of this.config.rules) {
      const matches = all.filter((rule) => rule.description === description);
      result.set(description, {
        found: matches.length > 0,
        rules: matches,
        // Several rules under one description: enabled as soon as one is.
        active: matches.length === 0 ? null : matches.some((rule) => !rule.disabled) ? 1 : 0,
        count: matches.length,
      });
    }
    return result;
  }

  label() {
    return this.firewall
      ? `Firewall ${firewallName(this.firewall)}`
      : `Firewall ${displayUrl(this.config.target)}`;
  }

  async applyFailure(err) {
    const wasError = this.snapshot.error?.kind;
    const wasReachable = this.snapshot.reachable;
    this.snapshot.error = { kind: err.kind, message: err.message };
    this.snapshot.reachable = false;
    // One warning when the problem starts (or changes), not one per reading.
    if (wasError !== err.kind) {
      logger.warn(`${this.label()}: ${err.message}`);
    } else {
      logger.debug(`${this.label()}: ${err.message} (again)`);
    }
    if (err.kind === ERROR_KINDS.AUTH || err.kind === ERROR_KINDS.PERMISSION) {
      this.retryAfter = this.now() + this.timings.authRetryMs;
    }
    if (err.kind !== ERROR_KINDS.UNREACHABLE) {
      // A configuration problem: identify the firewall again next time.
      this.client = null;
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (wasReachable !== false) {
      this.refreshWidgets();
    }
  }

  async applyReading(reading) {
    const now = reading.at;
    const wasError = this.snapshot.error;
    if (wasError) {
      logger.info(`${this.label()}: connection restored`);
    } else if (this.snapshot.reachable !== true) {
      logger.info(`${this.label()}: connected (pfSense ${this.firewall.version ?? '?'})`);
    }
    this.snapshot.error = null;
    this.snapshot.reachable = true;
    this.retryAfter = 0;

    // A sensor seen once stays a feature: the device structure never flaps.
    if (reading.system.temperature !== null) {
      this.firewall.hasTemperature = true;
    }
    if (reading.packages) {
      this.firewall.hasPackages = true;
    }
    this.snapshot.system = reading.system;
    this.snapshot.packages = reading.packages;
    this.snapshot.interfaces = reading.interfaces;

    const widgetsChanged = new Set();
    this.followGateways(reading);
    await this.applyGateways(reading, widgetsChanged);
    this.applyWan(reading);
    this.applyRules(reading.rules, widgetsChanged);

    const ignore = new Set(reading.interfaces.map((item) => item.mac).filter(Boolean));
    const wan = new Set();
    for (const { name, label } of this.firewall.wan) {
      wan.add(name.toLowerCase());
      wan.add(label.toLowerCase());
    }
    const clients = collectClients(reading, { ignore, wan });
    this.lastClients = clients;
    for (const client of clients.values()) {
      const known = this.clients.get(client.mac);
      this.clients.set(client.mac, {
        ...known,
        ...Object.fromEntries(Object.entries(client).filter(([, value]) => value !== null)),
        lastSeenAt: client.seen ? now : (known?.lastSeenAt ?? null),
        listedAt: now,
      });
    }
    for (const [mac, client] of this.clients) {
      if (now - (client.listedAt ?? 0) > this.timings.clientMemoryMs) {
        this.clients.delete(mac);
      }
    }
    this.snapshot.counts = {
      arp: reading.arp.filter((entry) => !entry.permanent).length,
      leases: reading.leases.filter((lease) => lease.online).length,
    };
    if (this.presence.update(this.followedClients(), clients).length > 0) {
      widgetsChanged.add(WIDGET_KEYS.PRESENCE);
    }

    await this.detectUnknownDevices(reading, ignore);
    await this.publishDevices();
    await this.publishStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    for (const key of widgetsChanged) {
      this.gladys.requestWidgetRefresh(key);
    }
  }

  /**
   * The gateways the firewall device follows: the ones of the configuration,
   * else every gateway pfSense monitors (four at most). A gateway seen once
   * stays, so the device structure does not flap.
   */
  followGateways(reading) {
    const followed = this.firewall.gateways;
    const has = (name) => followed.some((gw) => gw.name.toLowerCase() === name.toLowerCase());
    const add = (name) => {
      const slug = slugify(name);
      if (slug && !has(name) && followed.length < MAX_GATEWAYS) {
        followed.push({ name, slug });
      }
    };
    if (this.config.gateways.length > 0) {
      for (const wanted of this.config.gateways) {
        // The case of pfSense, when it knows the gateway.
        add(
          reading.gateways.find((gw) => gw.name.toLowerCase() === wanted.toLowerCase())?.name ??
            wanted,
        );
      }
    } else {
      for (const gateway of reading.gateways) {
        add(gateway.name);
      }
    }
    // The WAN interfaces of these gateways, for the rates.
    for (const { name } of followed) {
      const status = reading.gateways.find((gw) => gw.name === name);
      let interfaceName = this.gatewayInterfaces.get(name) ?? null;
      if (!interfaceName && status?.srcip) {
        interfaceName =
          reading.interfaces.find(
            (item) => item.ipv4 === status.srcip || item.ipv6 === status.srcip,
          )?.name ?? null;
      }
      if (!interfaceName || this.firewall.wan.some((item) => item.name === interfaceName)) {
        continue;
      }
      const item = reading.interfaces.find((candidate) => candidate.name === interfaceName);
      const slug = slugify(interfaceName);
      if (item && slug) {
        this.firewall.wan.push({
          name: interfaceName,
          label: item.description ?? interfaceName.toUpperCase(),
          slug,
        });
      }
    }
  }

  async applyGateways(reading, widgetsChanged) {
    const now = reading.at;
    const byName = new Map(reading.gateways.map((gw) => [gw.name, gw]));
    const result = new Map();
    for (const { name } of this.firewall.gateways) {
      const gateway = byName.get(name);
      if (!gateway) {
        result.set(name, { found: false, online: null, delay: null, loss: null, substatus: null });
        continue;
      }
      result.set(name, {
        found: true,
        online: gateway.online,
        delay: gateway.delay,
        loss: gateway.loss,
        substatus: gateway.substatus,
      });
      const before = this.snapshot.gateways.get(name)?.online;
      if (before === true && gateway.online === false) {
        this.gatewayDownSince.set(name, now);
        logger.info(`${this.label()}: gateway ${name} is down (${gateway.substatus ?? '?'})`);
        widgetsChanged.add(WIDGET_KEYS.FIREWALL);
        await this.fire(TRIGGERS.GATEWAY_DOWN, {
          gateway: name,
          reason: gateway.substatus ?? 'down',
        });
      } else if (before === false && gateway.online === true) {
        const since = this.gatewayDownSince.get(name) ?? now;
        this.gatewayDownSince.delete(name);
        const downMinutes = Math.round((now - since) / 60_000);
        logger.info(`${this.label()}: gateway ${name} is back after ${downMinutes} min`);
        widgetsChanged.add(WIDGET_KEYS.FIREWALL);
        await this.fire(TRIGGERS.GATEWAY_UP, { gateway: name, down_minutes: downMinutes });
      } else if (before === undefined && gateway.online === false) {
        this.gatewayDownSince.set(name, now);
      }
    }
    this.snapshot.gateways = result;
  }

  /** WAN rates: the growth of the interface counters since the previous reading, in Mbit/s. */
  applyWan(reading) {
    const now = reading.at;
    const byName = new Map(reading.interfaces.map((item) => [item.name, item]));
    const wan = new Map();
    for (const { name } of this.firewall.wan) {
      const item = byName.get(name);
      if (!item) {
        wan.set(name, { found: false, download: null, upload: null, up: null });
        continue;
      }
      const previous = this.counters.get(name);
      let download = null;
      let upload = null;
      if (previous && now > previous.at && item.inBytes !== null && item.outBytes !== null) {
        const seconds = (now - previous.at) / 1000;
        const rx = item.inBytes - previous.rx;
        const tx = item.outBytes - previous.tx;
        // A counter that went back (reboot, reset) gives no rate this time.
        download = rx >= 0 ? round((rx * 8) / seconds / 1e6, 2) : null;
        upload = tx >= 0 ? round((tx * 8) / seconds / 1e6, 2) : null;
      }
      if (item.inBytes !== null && item.outBytes !== null) {
        this.counters.set(name, { rx: item.inBytes, tx: item.outBytes, at: now });
      }
      wan.set(name, { found: true, download, upload, up: item.status === 'up' });
    }
    this.snapshot.wan = wan;
  }

  applyRules(rules, widgetsChanged) {
    for (const [description, rule] of rules) {
      const before = this.snapshot.rules.get(description);
      if (before?.active !== rule.active || before?.found !== rule.found) {
        widgetsChanged.add(WIDGET_KEYS.RULES);
      }
    }
    this.snapshot.rules = rules;
  }

  /** The name pfSense shows for an interface ("LAN" for "lan"). */
  interfaceLabel(name) {
    if (!name) {
      return null;
    }
    const item = this.snapshot.interfaces.find((candidate) => candidate.name === name);
    return item?.description ?? name;
  }

  /** Fire "unknown device connected" for a MAC address never seen before. */
  async detectUnknownDevices(reading, ignore) {
    const known = this.saved.knownMacs;
    const now = reading.at;
    // A dynamic DHCP lease in use: a device that joined the network. Not a
    // static mapping (known by definition), not ARP (the WAN side is in it).
    const candidates = new Map();
    for (const lease of reading.leases) {
      if (lease.dynamic && !candidates.has(lease.mac)) {
        candidates.set(lease.mac, lease);
      }
    }
    let changed = false;
    let fired = 0;
    for (const [mac, lease] of candidates) {
      if (ignore.has(mac) || mac in known) {
        continue;
      }
      known[mac] = now;
      changed = true;
      if (!this.saved.baselined) {
        continue; // the first reading learns the network as it is
      }
      logger.info(`${this.label()}: new device on the network`);
      if (fired < MAX_UNKNOWN_EVENTS) {
        fired += 1;
        await this.fire(TRIGGERS.UNKNOWN_DEVICE, {
          mac,
          ip: lease.ip ?? null,
          host_name: lease.hostName ?? null,
          interface: this.interfaceLabel(lease.interface),
        });
      }
    }
    if (!this.saved.baselined) {
      this.saved.baselined = true;
      changed = true;
    }
    const macs = Object.keys(known);
    if (macs.length > MAX_KNOWN_MACS) {
      // The oldest first.
      macs
        .sort((a, b) => known[a] - known[b])
        .slice(0, macs.length - MAX_KNOWN_MACS)
        .forEach((mac) => delete known[mac]);
    }
    if (changed) {
      this.store.save(this.saved);
    }
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Devices -------------------------------------------------------------------

  /** The devices the user added to Gladys, by type. */
  createdDevices(type) {
    return (this.gladys.devices ?? []).filter(
      (device) => parseDeviceId(this.gladys, device.external_id)?.type === type,
    );
  }

  /** MAC addresses of the clients added to Gladys. */
  followedClients() {
    const macs = [];
    for (const device of this.createdDevices(DEVICE_TYPES.CLIENT)) {
      const mac =
        normalizeMac(paramOf(device, 'MAC_ADDRESS')) ??
        normalizeMac(parseDeviceId(this.gladys, device.external_id).id);
      if (mac) {
        macs.push(mac);
      }
    }
    return macs;
  }

  discoveredClients() {
    const followed = new Set(this.followedClients());
    const list = [...this.clients.values()];
    // The followed ones first (always listed), then the most recently seen.
    list.sort(
      (a, b) =>
        Number(followed.has(b.mac)) - Number(followed.has(a.mac)) ||
        (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0) ||
        a.mac.localeCompare(b.mac),
    );
    const result = list.slice(0, MAX_DISCOVERED_CLIENTS);
    for (const mac of followed) {
      if (!this.clients.has(mac)) {
        result.push({ mac, ip: null, hostName: null, description: null });
      }
    }
    return result;
  }

  async publishDevices({ force = false } = {}) {
    const language = this.config.language;
    const devices = [];
    if (this.firewall) {
      devices.push(buildFirewallDevice(this.gladys, this.firewall, language));
    }
    for (const description of this.config.rules) {
      devices.push(buildRuleDevice(this.gladys, description, language));
    }
    const clients = this.discoveredClients();
    devices.push(...clients.map((client) => buildClientDevice(this.gladys, client, language)));

    // The firewall and the rules publish at once; the client list at most every few minutes.
    const structure = JSON.stringify(devices.slice(0, devices.length - clients.length));
    const members = clients
      .map((client) => client.mac)
      .sort()
      .join(',');
    const key = `${structure}|${members}`;
    if (!force && key === this.discoveryKey) {
      return;
    }
    const structureChanged = !this.discoveryKey?.startsWith(`${structure}|`);
    if (!force && !structureChanged && this.now() - this.discoveryAt < this.timings.discoveryMs) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discoveryKey = key;
      this.discoveryAt = this.now();
      this.resolved('discovery');
    } catch (err) {
      this.problem('discovery', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the firewall, publish everything again. */
  async rediscover() {
    this.structureAt = 0;
    await this.pollAll();
    await this.publishDevices({ force: true });
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    for (const feature of device.features ?? []) {
      this.published.delete(feature.external_id);
    }
    const parsed = parseDeviceId(this.gladys, device.external_id);
    if (parsed?.type === DEVICE_TYPES.CLIENT && this.snapshot.reachable) {
      // Follow it at once, from the last reading.
      this.presence.update(this.followedClients(), this.lastClients);
    }
    await this.publishStates();
    if (parsed) {
      const key =
        parsed.type === DEVICE_TYPES.CLIENT
          ? WIDGET_KEYS.PRESENCE
          : parsed.type === DEVICE_TYPES.RULE
            ? WIDGET_KEYS.RULES
            : WIDGET_KEYS.FIREWALL;
      this.gladys.requestWidgetRefresh(key);
    }
  }

  // --- Publishing to Gladys ------------------------------------------------------------

  /** Every value to publish: { externalId, value, heartbeat }. */
  stateEntries() {
    const entries = [];
    const add = (externalId, value, heartbeat = this.timings.heartbeatMs) => {
      if (value === null || value === undefined) {
        return;
      }
      entries.push({ externalId, value, heartbeat });
    };
    if (this.firewall && this.snapshot.reachable) {
      const ids = firewallIds(this.gladys, this.firewall.id);
      const { system, packages } = this.snapshot;
      add(ids.feature(FEATURE_KEYS.CPU), system?.cpuUsage);
      add(ids.feature(FEATURE_KEYS.MEMORY), system?.memoryUsage);
      add(ids.feature(FEATURE_KEYS.DISK), system?.diskUsage);
      if (this.firewall.hasTemperature && system?.temperature !== null) {
        add(ids.feature(FEATURE_KEYS.TEMPERATURE), round(system.temperature, 1));
      }
      if (system?.uptimeSeconds !== null && system?.uptimeSeconds !== undefined) {
        add(ids.feature(FEATURE_KEYS.UPTIME), Math.floor(system.uptimeSeconds / 3600));
      }
      if (this.firewall.version) {
        add(ids.feature(FEATURE_KEYS.VERSION), { text: this.firewall.version });
      }
      if (this.firewall.hasPackages && packages) {
        add(ids.feature(FEATURE_KEYS.PACKAGE_UPDATE), packages.updates.length > 0 ? 1 : 0);
      }
      for (const { name, slug } of this.firewall.gateways) {
        const gateway = this.snapshot.gateways.get(name);
        if (!gateway?.found) {
          continue;
        }
        add(
          ids.feature(gatewayFeatureKey(slug, GATEWAY_FEATURES.ONLINE)),
          gateway.online === null ? null : gateway.online ? 1 : 0,
        );
        add(
          ids.feature(gatewayFeatureKey(slug, GATEWAY_FEATURES.LATENCY)),
          gateway.delay === null ? null : round(gateway.delay, 1),
        );
        add(
          ids.feature(gatewayFeatureKey(slug, GATEWAY_FEATURES.LOSS)),
          gateway.loss === null ? null : Math.max(0, Math.min(100, Math.round(gateway.loss))),
        );
      }
      for (const { name, slug } of this.firewall.wan) {
        const wan = this.snapshot.wan.get(name);
        if (!wan?.found) {
          continue;
        }
        add(ids.feature(wanFeatureKey(slug, WAN_FEATURES.DOWNLOAD)), wan.download);
        add(ids.feature(wanFeatureKey(slug, WAN_FEATURES.UPLOAD)), wan.upload);
      }
    }
    if (this.snapshot.reachable) {
      for (const [description, rule] of this.snapshot.rules) {
        add(ruleIds(this.gladys, description).feature(FEATURE_KEYS.RULE_ACTIVE), rule.active);
      }
    }
    for (const mac of this.followedClients()) {
      const present = this.presence.presence(mac);
      add(
        clientIds(this.gladys, mac).feature(FEATURE_KEYS.PRESENCE),
        present,
        present === 1 ? this.timings.presentRefreshMs : this.timings.heartbeatMs,
      );
    }
    return entries;
  }

  /** Publish the values that changed (or whose heartbeat is due), for the added devices only. */
  async publishStates() {
    const created = new Set(
      (this.gladys.devices ?? []).flatMap((device) =>
        (device.features ?? []).map((feature) => feature.external_id),
      ),
    );
    const now = this.now();
    const keyOf = (value) => (typeof value === 'object' ? `text:${value.text}` : value);
    const due = this.stateEntries().filter(({ externalId, value, heartbeat }) => {
      if (!created.has(externalId)) {
        return false; // Gladys would drop it, and count it in its quota
      }
      const last = this.published.get(externalId);
      return !last || last.key !== keyOf(value) || now - last.at >= heartbeat;
    });
    for (let at = 0; at < due.length; at += MAX_STATES_PER_REQUEST) {
      const batch = due.slice(at, at + MAX_STATES_PER_REQUEST);
      try {
        await this.gladys.publishStates(
          batch.map(({ externalId, value }) =>
            typeof value === 'object'
              ? { device_feature_external_id: externalId, text: value.text }
              : { device_feature_external_id: externalId, state: value },
          ),
        );
        for (const { externalId, value } of batch) {
          this.published.set(externalId, { key: keyOf(value), at: now });
        }
        this.resolved('states');
      } catch (err) {
        this.problem('states', `States refused by Gladys: ${err.message}`);
      }
    }
  }

  async publishTransports() {
    if (this.snapshot.reachable === null) {
      return;
    }
    const transport = this.snapshot.reachable
      ? DEVICE_TRANSPORTS.LOCAL
      : DEVICE_TRANSPORTS.UNREACHABLE;
    const ids = [
      ...(this.firewall ? [firewallIds(this.gladys, this.firewall.id).device] : []),
      ...this.config.rules.map((description) => ruleIds(this.gladys, description).device),
    ];
    const entries = ids
      .filter((id) => this.transports.get(id) !== transport)
      .map((id) => ({ external_id: id, transport }));
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.config.target) {
      return {
        connected: false,
        message: this.config.invalidUrl ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noUrl,
      };
    }
    if (!this.config.apiKey) {
      return { connected: false, message: CONNECTION_TEXT.noKey };
    }
    if (this.snapshot.error) {
      return { connected: false, message: ERROR_TEXT[this.snapshot.error.kind] };
    }
    if (this.snapshot.reachable) {
      return { connected: true };
    }
    return { connected: false, message: CONNECTION_TEXT.connecting };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  refreshWidgets() {
    for (const key of Object.values(WIDGET_KEYS)) {
      this.gladys.requestWidgetRefresh(key);
    }
  }

  // --- Commands --------------------------------------------------------------------------

  text(table) {
    return pick(table, this.config?.language);
  }

  assertCommands() {
    if (!this.config?.allowCommands) {
      throw new Error(this.text(ACTION_TEXT.disabled));
    }
  }

  /** A client for a command, once the firewall is known. */
  async commandClient() {
    if (!this.configured()) {
      const status = this.connectionStatus();
      throw new Error(this.text(status.message));
    }
    if (!this.client || !this.firewall) {
      await this.pollAll();
    }
    if (!this.client || !this.firewall) {
      const kind = this.snapshot.error?.kind ?? ERROR_KINDS.UNREACHABLE;
      throw new Error(this.text(ERROR_TEXT[kind]));
    }
    return this.client;
  }

  commandError(err) {
    if (err instanceof PfsenseError && err.kind === ERROR_KINDS.PERMISSION) {
      return new Error(this.text(ACTION_TEXT.permission));
    }
    if (err instanceof PfsenseError) {
      return new Error(this.text(ERROR_TEXT[err.kind] ?? ERROR_TEXT[ERROR_KINDS.PROTOCOL]));
    }
    return err;
  }

  /** The description of a rule device, or an error the user can read. */
  ruleOf(deviceExternalId) {
    const parsed = parseDeviceId(this.gladys, deviceExternalId);
    const description =
      parsed?.type === DEVICE_TYPES.RULE
        ? this.config.rules.find((candidate) => ruleSlug(candidate) === parsed.id)
        : undefined;
    if (!description) {
      throw new Error(this.text(ACTION_TEXT.unknownRule));
    }
    return description;
  }

  /**
   * Enable or disable a followed firewall rule (every rule with that
   * description), then apply the firewall changes. The only configuration
   * change the integration makes.
   * @returns {Promise<{ active: boolean, rules: number }>}
   */
  async setRule(deviceExternalId, active) {
    this.assertCommands();
    const description = this.ruleOf(deviceExternalId);
    const client = await this.commandClient();
    let rule;
    try {
      rule = (await this.readRules({ strict: true })).get(description);
      if (!rule?.found) {
        throw new Error(this.text(ACTION_TEXT.ruleNotFound));
      }
      const toChange = rule.rules.filter((item) => item.disabled === active);
      for (const [index, item] of toChange.entries()) {
        // `id` is the position the rule had in the list just read; pfSense
        // applies the filter once, with the last change.
        await client.patch(
          ENDPOINTS.RULE,
          { id: item.id, disabled: !active, apply: index === toChange.length - 1 },
          { timeoutMs: this.timings.commandTimeoutMs },
        );
      }
    } catch (err) {
      logger.warn(`Firewall rule "${description}": command failed: ${err.message}`);
      throw this.commandError(err);
    }
    logger.info(
      `Firewall rule "${description}" ${active ? 'enabled' : 'disabled'} (${rule.count} rule(s))`,
    );
    try {
      const rules = await this.readRules({ strict: true });
      const changed = new Set();
      this.applyRules(rules, changed);
      await this.publishStates();
      for (const key of changed) {
        this.gladys.requestWidgetRefresh(key);
      }
    } catch (err) {
      logger.debug(`Rules not read again: ${err.message}`);
    }
    return { active, rules: rule.count };
  }

  /** Restart the firewall. */
  async reboot() {
    this.assertCommands();
    const client = await this.commandClient();
    try {
      await client.post(ENDPOINTS.REBOOT, {}, { timeoutMs: this.timings.commandTimeoutMs });
    } catch (err) {
      // The firewall may hang up before answering: it is restarting.
      if (!(err instanceof PfsenseError && err.kind === ERROR_KINDS.UNREACHABLE)) {
        logger.warn(`Reboot refused: ${err.message}`);
        throw this.commandError(err);
      }
    }
    logger.info(`${this.label()}: reboot requested`);
    return { rebooting: true };
  }

  // --- Reports ---------------------------------------------------------------------------

  /** "Test the connection": identify the firewall again, then read everything. */
  async testConnection() {
    await this.polling?.catch(() => {});
    this.client = null;
    this.retryAfter = 0;
    this.structureAt = 0;
    this.packagesAt = 0;
    await this.pollAll();
    const message = {};
    for (const language of Object.keys(REPORT_TEXT)) {
      message[language] = this.report(language);
    }
    return message;
  }

  report(language) {
    const text = REPORT_TEXT[language];
    if (!this.configured()) {
      return pick(this.connectionStatus().message, language);
    }
    const lines = [];
    if (!this.snapshot.reachable) {
      lines.push(pick(ERROR_TEXT[this.snapshot.error?.kind ?? ERROR_KINDS.UNREACHABLE], language));
      if (this.snapshot.error?.message) {
        lines.push(this.snapshot.error.message.slice(0, 200));
      }
      return lines.join('\n');
    }
    lines.push(text.connected(firewallName(this.firewall), this.firewall.version ?? '?'));
    const gateways = this.firewall.gateways.map(({ name }) => {
      const gateway = this.snapshot.gateways.get(name);
      if (!gateway?.found) {
        return `${name} (${text.missing})`;
      }
      const details = [gateway.online === false ? text.down : text.up];
      if (gateway.delay !== null) {
        details.push(`${round(gateway.delay, 1)} ms`);
      }
      if (gateway.loss !== null) {
        details.push(`${Math.round(gateway.loss)} %`);
      }
      return `${name} (${details.join(', ')})`;
    });
    lines.push(
      gateways.length
        ? `${labelled(text.gateways, gateways.join(', '), language)} · ${
            text.gatewaySource[this.config.gateways.length ? 'config' : 'all']
          }`
        : text.noGateway,
    );
    lines.push(text.clients(this.snapshot.counts));
    if (this.snapshot.unavailable.size > 0) {
      lines.push(text.unavailable([...this.snapshot.unavailable].join(', ')));
    }
    for (const description of this.config.rules) {
      const rule = this.snapshot.rules.get(description);
      lines.push(
        labelled(
          description,
          !rule?.found ? text.ruleMissing : rule.active ? text.ruleOn : text.ruleOff,
          language,
        ),
      );
    }
    lines.push(this.config.allowCommands ? text.commandsOn : text.commandsOff);
    if (this.config.target.protocol === 'http:') {
      lines.push(text.plainHint);
    }
    return lines.join('\n').slice(0, 2000);
  }

  /** "List the firewall rules": the rules with a description, to copy into the configuration. */
  async listRules() {
    const client = await this.commandClient();
    let rules;
    try {
      rules = parseRules(await client.get(ENDPOINTS.RULES));
    } catch (err) {
      throw this.commandError(err);
    }
    const byDescription = new Map();
    for (const rule of rules) {
      if (!rule.description) {
        continue;
      }
      const entry = byDescription.get(rule.description) ?? {
        count: 0,
        active: false,
        type: rule.type,
        interfaces: new Set(),
      };
      entry.count += 1;
      entry.active ||= !rule.disabled;
      for (const name of rule.interfaces) {
        entry.interfaces.add(this.interfaceLabel(name.toLowerCase()) ?? name);
      }
      byDescription.set(rule.description, entry);
    }
    const message = {};
    for (const [language, text] of Object.entries(RULES_TEXT)) {
      if (byDescription.size === 0) {
        message[language] = text.none;
        continue;
      }
      const lines = [...byDescription.entries()].slice(0, 30).map(([description, entry]) => {
        const followed = this.config.rules.includes(description) ? ' ✓' : '';
        const where = [...entry.interfaces].join('+') || '?';
        const count = entry.count > 1 ? ` ×${entry.count}` : '';
        return `${description}${followed} — ${entry.type ?? '?'}, ${where}${count}, ${entry.active ? text.on : text.off}`;
      });
      message[language] = [text.intro, ...lines].join('\n').slice(0, 2000);
    }
    return message;
  }
}

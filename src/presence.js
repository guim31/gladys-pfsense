// -----------------------------------------------------------------------------
// Presence of the network clients, from one reading of the firewall.
//
// A client is *seen* when it has a live entry in the ARP table of pfSense, or
// when its DHCP lease is "online" (pfSense says so when the MAC is in the ARP
// table: the same fact, seen through the lease). A seen client is present at
// once; a client no longer seen becomes away only once the departure delay
// has passed since it was last seen: a phone asleep drops off the Wi-Fi for
// a few minutes without leaving home.
//
// FreeBSD keeps an ARP entry up to 20 minutes after the last exchange
// (net.link.ether.inet.max_age): a departure shows at the latest about 20
// minutes, plus the delay, after the device left.
//
// When the firewall cannot be read, nothing changes: an outage of the
// firewall never sends the whole household away.
// (Adapted from guim31/gladys-mikrotik.)
// -----------------------------------------------------------------------------

export const SOURCES = Object.freeze({
  ARP: 'arp',
  DHCP: 'dhcp',
});

/**
 * The clients a reading shows, by MAC address, with what each source says.
 * @param {object} reading { arp, leases }
 * @param {object} options { ignore: Set<string> MACs of the firewall, wan: Set<string> WAN interface names and descriptions, lowercase }
 * @returns {Map<string, { mac, ip, hostName, description, interface, seen: boolean, sources: string[] }>}
 */
export function collectClients(reading, { ignore = new Set(), wan = new Set() } = {}) {
  const clients = new Map();
  const entry = (mac) => {
    let client = clients.get(mac);
    if (!client) {
      client = {
        mac,
        ip: null,
        hostName: null,
        description: null,
        interface: null,
        seen: false,
        sources: [],
      };
      clients.set(mac, client);
    }
    return client;
  };
  const mark = (client, source) => {
    client.seen = true;
    if (!client.sources.includes(source)) {
      client.sources.push(source);
    }
  };

  for (const lease of reading.leases ?? []) {
    if (ignore.has(lease.mac)) {
      continue;
    }
    const client = entry(lease.mac);
    client.ip ??= lease.ip;
    client.hostName ??= lease.hostName;
    client.description ??= lease.description;
    client.interface ??= lease.interface;
    if (lease.online) {
      mark(client, SOURCES.DHCP);
    }
  }
  for (const neighbour of reading.arp ?? []) {
    // The firewall's own addresses, and the neighbours on the WAN side (the
    // ISP box), are not clients.
    if (
      ignore.has(neighbour.mac) ||
      neighbour.permanent ||
      wan.has(String(neighbour.interface ?? '').toLowerCase())
    ) {
      continue;
    }
    const client = entry(neighbour.mac);
    client.ip ??= neighbour.ip;
    client.hostName ??= neighbour.hostName;
    client.interface ??= neighbour.interface;
    mark(client, SOURCES.ARP);
  }
  return clients;
}

export class PresenceTracker {
  /**
   * @param {object} options
   * @param {number} options.awayDelayMs
   * @param {() => number} options.now
   */
  constructor({ awayDelayMs, now }) {
    this.awayDelayMs = awayDelayMs;
    this.now = now;
    this.startedAt = now();
    /** @type {Map<string, { present: 0|1|null, lastSeen: number|null, since: number|null }>} */
    this.records = new Map();
  }

  record(mac) {
    let record = this.records.get(mac);
    if (!record) {
      record = { present: null, lastSeen: null, since: null };
      this.records.set(mac, record);
    }
    return record;
  }

  /**
   * Apply one successful reading to the followed clients.
   * @param {string[]} followed MAC addresses of the clients added to Gladys
   * @param {Map<string, { seen: boolean }>} clients collectClients()
   * @returns {string[]} the MAC addresses whose presence changed
   */
  update(followed, clients) {
    const now = this.now();
    const changed = [];
    for (const mac of followed) {
      const record = this.record(mac);
      const before = record.present;
      if (clients.get(mac)?.seen) {
        record.lastSeen = now;
        record.present = 1;
      } else {
        // Never seen since the start: the delay counts from the start.
        const lastSeen = record.lastSeen ?? this.startedAt;
        if (record.present !== 0 && now - lastSeen >= this.awayDelayMs) {
          record.present = 0;
        }
      }
      if (record.present !== before) {
        record.since = now;
        changed.push(mac);
      }
    }
    return changed;
  }

  /** 1, 0, or null while unknown (not seen since the start, delay not over). */
  presence(mac) {
    return this.records.get(mac)?.present ?? null;
  }

  get(mac) {
    return this.records.get(mac) ?? null;
  }
}

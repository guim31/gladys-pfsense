// -----------------------------------------------------------------------------
// Readers of the REST API answers (the `data` of each envelope), tolerant of
// what varies between pfSense CE and Plus, between versions of the package,
// and with the language of the webConfigurator: a field missing or of another
// type becomes null, never an exception.
//
// What pfSense itself computes, and the REST API passes through
// (pfSense sources, src/etc/inc/gwlb.inc and system.inc):
//   - a gateway `status` is "online" or "down" (dpinger), the `substatus`
//     says why: "none", "loss", "delay", "highloss", "highdelay", "down",
//     "force_down". `delay`, `stddev` and `loss` are numbers in ms and %;
//   - a DHCP lease `active_status` is "active", "expired", "reserved" or
//     "static" (a static mapping), and its `online_status` "active/online"
//     or "idle/offline": online means its MAC is in the ARP table. These are
//     gettext() strings, translated when the webConfigurator is not in English;
//   - `uptime` is a text such as "8 Days 03 Hours 26 Minutes 12 Seconds".
// -----------------------------------------------------------------------------

const MAC_PATTERN =
  /^([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})$/i;

/** "aa:bb:cc:dd:ee:ff", "AA-BB-…", "aabb.ccdd.eeff"… → "AA:BB:CC:DD:EE:FF", or null. */
export function normalizeMac(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const match = raw.trim().replace(/\./g, '').match(MAC_PATTERN);
  if (!match) {
    return null;
  }
  const mac = match.slice(1).join(':').toUpperCase();
  // Not a client: the empty, broadcast and multicast addresses.
  if (mac === '00:00:00:00:00:00' || mac === 'FF:FF:FF:FF:FF:FF') {
    return null;
  }
  return mac;
}

const list = (data) =>
  Array.isArray(data) ? data.filter((item) => item && typeof item === 'object') : [];

const text = (value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

/** A number, from a number or a numeric string ("12.5", "12.5ms", "0.0%"). */
export function number(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const match = value.trim().match(/^-?\d+(?:[.,]\d+)?/);
    return match ? Number(match[0].replace(',', '.')) : null;
  }
  return null;
}

const boolean = (value) => {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === 0 || value === '0') {
    return false;
  }
  return null;
};

const percent = (value) => {
  const n = number(value);
  return n === null ? null : Math.max(0, Math.min(100, Math.round(n)));
};

/**
 * The uptime text of pfSense, in seconds: "8 Days 03 Hours 26 Minutes 12
 * Seconds", "1 Day 00 Hours 00 Minutes 07 Seconds", "03 Hours 26 Minutes 12
 * Seconds". A translated text keeps its numbers in the same order: they are
 * read from the right (seconds, minutes, hours, days).
 */
export function parseUptime(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : null;
  }
  if (typeof raw !== 'string') {
    return null;
  }
  const numbers = raw.match(/\d+/g)?.map(Number) ?? [];
  if (numbers.length === 0 || numbers.length > 4) {
    return null;
  }
  const [seconds = 0, minutes = 0, hours = 0, days = 0] = numbers.reverse();
  return days * 86_400 + hours * 3600 + minutes * 60 + seconds;
}

/** GET /status/system */
export function parseSystemStatus(data) {
  const source = data && typeof data === 'object' ? data : {};
  const temperature = number(source.temp_c);
  return {
    platform: text(source.platform),
    serial: text(source.serial),
    netgateId: text(source.netgate_id),
    cpuModel: text(source.cpu_model),
    cpuCount: number(source.cpu_count),
    cpuUsage: percent(source.cpu_usage),
    memoryUsage: percent(source.mem_usage),
    diskUsage: percent(source.disk_usage),
    // pfSense reads no sensor on most virtual machines: null (0 is no reading either).
    temperature: temperature !== null && temperature > 0 && temperature < 150 ? temperature : null,
    uptimeSeconds: parseUptime(source.uptime),
  };
}

/** GET /system/version */
export function parseVersion(data) {
  const source = data && typeof data === 'object' ? data : {};
  return {
    version: text(source.version),
    base: text(source.base),
    patch: text(source.patch),
  };
}

/** GET /system/hostname */
export function parseHostname(data) {
  const source = data && typeof data === 'object' ? data : {};
  return { hostname: text(source.hostname), domain: text(source.domain) };
}

/** GET /status/gateways */
export function parseGatewayStatuses(data) {
  return list(data)
    .map((item) => {
      const status = text(item.status)?.toLowerCase() ?? null;
      const substatus = text(item.substatus)?.toLowerCase() ?? null;
      return {
        name: text(item.name),
        srcip: text(item.srcip),
        monitorip: text(item.monitorip),
        // Monitoring disabled: no delay nor loss, the gateway counts as online.
        delay: number(item.delay),
        stddev: number(item.stddev),
        loss: number(item.loss),
        status,
        substatus,
        online: status === 'online' ? true : status === 'down' ? false : null,
      };
    })
    .filter((gateway) => gateway.name);
}

/** GET /routing/gateways: the interface of each gateway. */
export function parseGateways(data) {
  return list(data)
    .map((item) => ({
      name: text(item.name),
      interface: text(item.interface)?.toLowerCase() ?? null,
      ipprotocol: text(item.ipprotocol),
      description: text(item.descr),
      disabled: boolean(item.disabled) === true,
    }))
    .filter((gateway) => gateway.name);
}

/** GET /status/interfaces */
export function parseInterfaces(data) {
  return list(data)
    .map((item) => ({
      // The pfSense name ("wan", "lan", "opt1") and the one shown ("WAN", "LAN", "IOT").
      name: text(item.name)?.toLowerCase() ?? null,
      description: text(item.descr),
      device: text(item.hwif),
      mac: normalizeMac(item.macaddr),
      status: text(item.status)?.toLowerCase() ?? null,
      enabled: boolean(item.enable),
      ipv4: text(item.ipaddr),
      ipv6: text(item.ipaddrv6),
      gateway: text(item.gateway),
      gatewayv6: text(item.gatewayv6),
      inBytes: number(item.inbytes),
      outBytes: number(item.outbytes),
    }))
    .filter((item) => item.name);
}

const ONLINE = /online/i;
const ACTIVE = /^(active|static)$/i;

/** GET /status/dhcp_server/leases */
export function parseLeases(data) {
  return list(data)
    .map((item) => {
      const activeStatus = text(item.active_status) ?? text(item.act);
      const onlineStatus = text(item.online_status) ?? text(item.online);
      return {
        mac: normalizeMac(item.mac),
        ip: text(item.ip),
        hostName: text(item.hostname),
        description: text(item.descr),
        interface: text(item.if)?.toLowerCase() ?? null,
        activeStatus: activeStatus?.toLowerCase() ?? null,
        // A lease of a device away has expired; a static mapping is always listed.
        active: activeStatus !== null && ACTIVE.test(activeStatus),
        dynamic: activeStatus !== null && /^active$/i.test(activeStatus),
        // "active/online": the MAC is in the ARP table. "idle/offline" also
        // contains "line": test the whole word, and the offline one first.
        online:
          onlineStatus !== null && !/offline/i.test(onlineStatus) && ONLINE.test(onlineStatus),
      };
    })
    .filter((lease) => lease.mac);
}

/** "Expires in 1185 seconds" → 1185; "Permanent" or nothing → null. */
export function parseExpires(raw) {
  if (typeof raw === 'number') {
    return raw;
  }
  const match = typeof raw === 'string' ? raw.match(/(\d+)/) : null;
  return match ? Number(match[1]) : null;
}

/** GET /diagnostics/arp_table */
export function parseArp(data) {
  return list(data)
    .map((item) => ({
      mac: normalizeMac(item.mac_address),
      ip: text(item.ip_address),
      hostName: text(item.hostname),
      interface: text(item.interface),
      // The firewall's own addresses are permanent entries.
      permanent: boolean(item.permanent) === true || /permanent/i.test(text(item.expires) ?? ''),
      expiresSeconds: parseExpires(item.expires),
    }))
    .filter((entry) => entry.mac);
}

/** GET /system/packages */
export function parsePackages(data) {
  return list(data)
    .map((item) => ({
      name: text(item.name),
      installed: text(item.installed_version),
      latest: text(item.latest_version),
      updateAvailable: boolean(item.update_available) === true,
    }))
    .filter((item) => item.name);
}

/** GET /firewall/rules: `id` is the position of the rule (it moves), `tracker` its identity. */
export function parseRules(data) {
  return list(data)
    .map((item) => ({
      id: number(item.id),
      tracker: text(item.tracker),
      description: text(item.descr),
      disabled: boolean(item.disabled) === true,
      type: text(item.type),
      interfaces: Array.isArray(item.interface)
        ? item.interface.map((name) => String(name))
        : text(item.interface)
          ? [text(item.interface)]
          : [],
      ipprotocol: text(item.ipprotocol),
      floating: boolean(item.floating) === true,
    }))
    .filter((rule) => rule.id !== null);
}

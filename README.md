# pfSense for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
follows a [pfSense](https://www.pfsense.org) firewall (CE or Plus) through the
REST API v2 of the free package
[`pfSense-pkg-RESTAPI`](https://github.com/pfrest/pfSense-pkg-RESTAPI), over the
local network. No cloud, no account.

> **Developed without the hardware: feedback welcome.** The integration is
> built and tested against the documented answers of the REST API package and
> the strings pfSense itself writes, not against a real firewall. Please report
> what works and what does not in the
> [issues](https://github.com/guim31/gladys-pfsense/issues).

This project is not affiliated with Netgate. pfSense is a trademark of Electric
Sheep Fencing LLC (Netgate).

## Features

- **Presence sensors**: the clients pfSense sees (ARP table and DHCP leases)
  are listed in the Discovery tab; each one the user adds becomes a presence
  sensor. A configurable **departure delay** avoids false departures, and an
  outage of the firewall never marks anyone away.
- **The firewall as a device**: CPU, memory and disk usage, temperature (when
  pfSense reads a sensor), uptime, pfSense version and **package update
  available**; for each gateway its **state**, **latency** and **packet loss**
  (dpinger); for each WAN interface its **download and upload rates**.
- **Firewall rules** followed by their description: one device per rule,
  showing whether it is enabled.
- **Commands, off by default**: when the user ticks _Allow commands_, scene
  actions and widget buttons (with confirmation) can enable or disable a
  followed rule (parental control) and reboot the firewall. Nothing else in
  pfSense is ever changed, and nothing is exposed as a switch.
- **Scene triggers**: _Gateway down_ (with the reason pfSense gives),
  _Gateway restored_ (with the length of the outage), _Unknown device
  connected_ (a MAC address never seen before gets a DHCP lease, remembered
  across restarts).
- **Dashboard widgets**: _pfSense firewall_ (health, rates, gateways, a Reboot
  button), _Devices at home_, _Firewall rules_ (one button per rule).
- **Test the connection** and **List the firewall rules** in the
  Configuration screen.
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
- pfSense CE or Plus with the **REST API package v2** installed (see its
  [installation guide](https://pfrest.org/INSTALL_AND_CONFIG/)); pfSense removes
  it at each system update, it must be installed again then.
- An **API key** (System → REST API → Keys), ideally created by a dedicated user
  holding only the GET privileges of the endpoints listed in the user guide.
  The commands need the PATCH privilege of `/api/v2/firewall/rule` and the POST
  privilege of `/api/v2/diagnostics/reboot`.

## Installation

1. Install the REST API package on pfSense, create the user and its API key.
2. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-pfsense`
   (or install **pfSense** from the catalog once it is listed).
3. In **Configuration**, enter the address of the webConfigurator and the API
   key; tick _Accept a self-signed certificate_ unless you installed a
   certificate of your own. Save, then click **Test the connection**.
4. Open the **Discover** tab and add the firewall, the phones to follow and the
   rules.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- **Why the REST API and not XML-RPC**: the Home Assistant custom integration
  [`travisghansen/hass-pfsense`](https://github.com/travisghansen/hass-pfsense)
  reads pfSense through XML-RPC and `exec_php`, which needs an account allowed
  to run any PHP code as root on the firewall. An API key of the REST API
  package can be limited to a read-only user, endpoint by endpoint, and revoked
  on its own: the safer choice, at the cost of installing a package.
- **Reading**: every refresh interval (10 s to 1 min, 30 s by default) the
  integration reads `GET /api/v2/status/system`, `/status/gateways`,
  `/status/interfaces`, `/status/dhcp_server/leases`,
  `/diagnostics/arp_table` and, when rules are followed, `/firewall/rules`.
  `/system/version`, `/system/hostname` and `/routing/gateways` are read every
  10 minutes, `/system/packages` hourly. An endpoint the key may not read is
  skipped and listed by the connection test. The rates come from the growth of
  the interface byte counters between two readings. Gladys never polls these
  devices (`should_poll: false`): the timer is the integration's own.
- **States**: only the values that change are sent, for the devices added to
  Gladys only, with a heartbeat every six hours; a present client is sent again
  every two minutes so the _Check user presence_ scene action of Gladys works
  too. Everything is sent again when a device is added or Gladys reconnects.
- **Commands**: `PATCH /api/v2/firewall/rule` with `id` and `disabled` only
  (and `apply` on the last one), and `POST /api/v2/diagnostics/reboot`.
- **Storage**: `/data/pfsense-state.json`, the MAC addresses already seen (for
  the unknown-device trigger).

## Development

```bash
npm install
npm test                 # node --test, against the fake Gladys of the SDK and a fake pfSense
npm run lint
npm run format:check
```

`scripts/probe.mjs` checks the client against a real firewall, read only, and
prints a report without key, addresses, MACs, serials or names:

```bash
node scripts/probe.mjs https://192.168.1.1 --insecure                    # an invented key, refused
PFSENSE_API_KEY=… node scripts/probe.mjs https://192.168.1.1 --insecure  # every endpoint read
```

## Limits

- One firewall per integration; no CARP pair, no VPN tunnels; the "new
  pfSense version available" state is not readable through the REST API, only
  the package updates; a departure shows up to 20 minutes late (ARP entry
  lifetime of FreeBSD). See the Limits section of the user guide.

## Credits

- [`pfSense-pkg-RESTAPI`](https://github.com/pfrest/pfSense-pkg-RESTAPI) by
  Jared Hendrickson (Apache-2.0): the endpoints, their models and the error
  envelope; the test fixtures follow its models.
- [pfSense](https://github.com/pfsense/pfsense) (Apache-2.0): the gateway and
  DHCP lease states (`gwlb.inc`, `system.inc`).
- [`travisghansen/hass-pfsense`](https://github.com/travisghansen/hass-pfsense)
  (Apache-2.0), the Home Assistant custom integration: what is worth following
  on a pfSense firewall; read, no code copied.
- Built on the official
  [integration template](https://github.com/GladysAssistant/integration-template-js)
  and [SDK](https://github.com/GladysAssistant/integration-sdk-js) of Gladys
  Assistant, after the other integrations of guim31 (`gladys-mikrotik`).

## License

[Apache-2.0](LICENSE)

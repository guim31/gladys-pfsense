# pfSense fixtures

The `data` of each REST API v2 answer (the envelope `{ code, status,
response_id, message, data }` is added by `test/helpers/fakePfsense.js`), by
endpoint, for two firewalls:

- `ce-2.8.1.json`: pfSense CE 2.8.1 in a virtual machine (no temperature
  sensor, no serial number), one WAN in DHCP with an IPv4 and an IPv6 gateway,
  a LAN and an IOT VLAN, ISC DHCP leases (dynamic, static mapping, expired),
  the default allow rules and two rules with a description.
- `plus-25.11.json`: pfSense Plus 25.11.1 on a Netgate 4200 (temperature,
  serial number), a PPPoE WAN and a second WAN in DHCP whose gateway is down
  (`highloss`), a rule description shared by an IPv4 and an IPv6 rule. Its key
  has no privilege on `/routing/gateways` in some tests: the gateway interface
  is then found from the source address of dpinger.

The field names and types follow the models of the package
[pfSense-pkg-RESTAPI](https://github.com/pfrest/pfSense-pkg-RESTAPI)
(`Models/SystemStatus.inc`, `RoutingGatewayStatus.inc`, `InterfaceStats.inc`,
`DHCPServerLease.inc`, `ARPTable.inc`, `FirewallRule.inc`, `Package.inc`,
Apache-2.0), the values the strings pfSense itself writes
(`src/etc/inc/gwlb.inc`, `system.inc` of [pfSense](https://github.com/pfsense/pfsense),
Apache-2.0): gateway status and substatus, lease states, uptime text.

They were written for these tests, not captured on a real firewall: every
address is a documentation one (RFC 5737, RFC 3849), every MAC address in the
documentation range of RFC 7042 (`00:00:5E:00:53:xx`), every serial number and
Netgate ID invented. `scripts/probe.mjs` checks the field names against a real
firewall.

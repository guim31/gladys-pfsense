# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-15

### Added

- pfSense CE and Plus firewalls through the REST API v2 of the
  `pfSense-pkg-RESTAPI` package, with an API key; a read-only user is enough,
  an endpoint it may not read is skipped and reported.
- Presence sensors: add the phones and computers pfSense sees (ARP table and
  online DHCP leases) from the Discovery tab. A departure delay avoids false
  departures, and an outage of the firewall never sends anyone away.
- The firewall as a device: CPU, memory and disk usage, temperature, uptime,
  pfSense version and package update available; for each gateway its state,
  latency and packet loss; for each WAN interface its download and upload
  rates.
- Firewall rules followed by their description, as devices showing whether the
  rule is enabled.
- Commands, off by default ("Allow commands"): enable or disable a followed
  firewall rule, reboot the firewall, from a scene action or a widget button
  with confirmation. Nothing else in pfSense is ever changed.
- Scene triggers "Gateway down", "Gateway restored" (with the length of the
  outage) and "Unknown device connected".
- Dashboard widgets "pfSense firewall", "Devices at home" and "Firewall
  rules".
- "Test the connection" and "List the firewall rules" in the Configuration
  screen.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-pfsense/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-pfsense/releases/tag/v1.0.1

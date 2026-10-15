# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the API key of the pfSense REST API package is a `secret` field
  of the Gladys configuration. The integration reads it from Gladys at startup,
  keeps it in memory, sends it only to the firewall address typed in the
  configuration, in the `X-API-Key` header (never in a URL), and never writes
  it to `/data` nor to the logs. A key created by a user holding only the GET
  privileges of the endpoints read is enough unless the commands are allowed.
- **Stored in `/data`**: `pfsense-state.json`, the MAC addresses already seen
  on the network with the date they were first seen (for the "Unknown device
  connected" trigger, 5,000 at most). Nothing else.
- **Network**: requests go only to the firewall address of the configuration,
  on the local network, over HTTPS (or HTTP if the user types an `http://`
  address; the API key then travels unencrypted on the LAN, and the
  connection test says so). Certificates are verified unless the user ticks
  "Accept a self-signed certificate". A refused key is tried again only every
  5 minutes, so the login protection of pfSense does not lock Gladys out. The
  integration opens no port and calls no cloud service; reading the package
  list makes pfSense query its own package servers (with a cache), at most
  once an hour.
- **Changes to the firewall**: none unless "Allow commands" is ticked. Then
  only the `disabled` flag of the firewall rules whose description the user
  listed (then the filter is applied), and a reboot, from a scene action or a
  widget button with confirmation. Nothing is exposed as a switch.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
pfSense and the REST API package themselves (see
[Netgate's security page](https://www.netgate.com/security) and the
[package's policy](https://github.com/pfrest/pfSense-pkg-RESTAPI/security)),
and the other devices and services of your network.

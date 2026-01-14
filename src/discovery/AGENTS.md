# DISCOVERY MODULE

**Generated:** 2026-01-15

## OVERVIEW

Device discovery module implementing two complementary mechanisms: UDP multicast for local network announcements and HTTP-based fallback scanning for unreliable network environments.

## WHERE TO LOOK

| Task                      | Location                          | Notes                                                  |
| ------------------------- | --------------------------------- | ------------------------------------------------------ |
| Primary discovery         | `src/discovery/multicast.ts`      | MulticastDiscovery - UDP multicast (224.0.0.167:53317) |
| HTTP fallback scanning    | `src/discovery/http-discovery.ts` | HttpDiscovery - network range scan every 30s           |
| Runtime adapter selection | `src/discovery/runtime.ts`        | createDiscovery(), createScanner() factories           |
| Discovery interface       | `src/discovery/types.ts`          | Discovery abstract interface                           |
| Deno UDP implementation   | `src/discovery/deno-udp.ts`       | DenoMulticastDiscovery (Deno-specific UDP)             |

## CONVENTIONS

- **Interface binding**: MulticastDiscovery joins groups per interface address via `addMembership(address)` for proper multi-homed device discovery
- **Discovery priority**: `createDiscovery()` returns MulticastDiscovery (primary) for Node.js, `createScanner()` always returns HttpDiscovery (reliability)
- **Deno isolation**: Deno lacks Node's `node:dgram` with multicast support; uses `Deno.listenDatagram()` with manual broadcast
- **Announcement timing**: Multicast announcements sent at `[100, 500, 2000]ms` delays for redundancy

## ANTI-PATTERNS

- **DO NOT use HttpDiscovery as primary**: Designed as fallback when multicast is blocked by firewalls/VPNs
- **DO NOT assume single interface**: MulticastDiscovery iterates all non-internal IPv4 addresses for multi-homed support
- **DO NOT modify AnnouncementMessage directly**: Use `buildAnnouncementMessage()` factory to ensure proper `announce`/`announcement` fields

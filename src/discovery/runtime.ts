import type { DeviceInfo } from "../types.ts"
import { MulticastDiscovery } from "./multicast.ts"
import { HttpDiscovery } from "./http-discovery.ts"
import { DenoMulticastDiscovery } from "./deno-udp.ts"
import type { Discovery } from "./types.ts"

declare const Deno: any

/**
 * Creates a discovery instance based on the runtime environment
 */
export function createDiscovery(deviceInfo: DeviceInfo): Discovery {
  // Check if we're running in Deno
  if (typeof Deno !== "undefined") {
    // In Deno, use Deno-specific UDP implementation
    return new DenoMulticastDiscovery(deviceInfo)
  }

  // In Node.js, use both multicast and HTTP discovery
  return new MulticastDiscovery(deviceInfo)
}

/**
 * Creates a discovery instance for device scanning
 */
export function createScanner(deviceInfo: DeviceInfo): Discovery {
  // Always use HTTP discovery for scanning since it's more reliable
  return new HttpDiscovery(deviceInfo)
} 
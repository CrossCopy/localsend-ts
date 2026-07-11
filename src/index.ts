// Export types
export * from "./types.ts"

// Export config
export * from "./config.ts"

// Export discovery
export { MulticastDiscovery } from "./discovery/multicast.ts"
export { HttpDiscovery } from "./discovery/http-discovery.ts"

// Export API
export { LocalSendServer, LocalSendServer as LocalSendHonoServer } from "./server/server.ts"
export { LocalSendClient } from "./api/client.ts"
export { LocalSendRpcClient } from "./hono-rpc.ts"
export type { LocalSendClientOptions } from "./hono-rpc.ts"
export type { LocalSendAppType } from "./server/routes.ts"

// Export server adapters - fix by using explicit import and export
import {
	BunServerAdapter,
	NodeServerAdapter,
	DenoServerAdapter,
	createServerAdapter
} from "./api/server-adapter"
export type { ServerAdapter } from "./api/server-adapter"
export { BunServerAdapter, NodeServerAdapter, DenoServerAdapter, createServerAdapter }

// Export utils
export { getDeviceInfo, generateFingerprint } from "./utils/device"

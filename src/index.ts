// Export types
export * from "./types";

// Export config
export * from "./config";

// Export discovery
export { MulticastDiscovery } from "./discovery/multicast";
export { HttpDiscovery } from "./discovery/http-discovery";

// Export API
export { LocalSendServer } from "./api/server";
export { LocalSendHonoServer } from "./api/hono-server";
export { LocalSendClient } from "./api/client";

// Export server adapters - fix by using explicit import and export
import { 
  BunServerAdapter,
  NodeServerAdapter,
  DenoServerAdapter,
  createServerAdapter,
} from './api/server-adapter';
export type { ServerAdapter } from './api/server-adapter';
export {
  BunServerAdapter,
  NodeServerAdapter,
  DenoServerAdapter,
  createServerAdapter,
};

// Export utils
export { getDeviceInfo, generateFingerprint } from "./utils/device";

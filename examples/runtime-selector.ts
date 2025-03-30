import { getDeviceInfo, LocalSendHonoServer, MulticastDiscovery } from "../src";
import type { ServerAdapter } from "../src";
import {
  BunServerAdapter,
  NodeServerAdapter,
  DenoServerAdapter,
  createServerAdapter,
} from "../src";

// Parse command line arguments
const args = process.argv.slice(2);
const forceRuntime = args[0]?.toLowerCase();

async function main() {
  try {
    // Get device info with a custom alias
    const deviceInfo = getDeviceInfo({
      alias: "Multi-Runtime Server",
      enableDownloadApi: true,
    });

    // Choose server adapter based on command line argument
    let serverAdapter: ServerAdapter | undefined;
    switch (forceRuntime) {
      case "bun":
        console.log("Forcing Bun runtime...");
        serverAdapter = new BunServerAdapter();
        break;
      case "node":
        console.log("Forcing Node.js runtime...");
        serverAdapter = new NodeServerAdapter();
        break;
      case "deno":
        console.log("Forcing Deno runtime...");
        serverAdapter = new DenoServerAdapter();
        break;
      default:
        console.log("Using auto-detected runtime...");
        // Auto-detect the runtime
        serverAdapter = createServerAdapter();
    }

    // Create and start the HTTP server with the specified adapter
    const server = new LocalSendHonoServer(deviceInfo, {
      saveDirectory: "./received_files",
      requirePin: true,
      pin: "123456",
      serverAdapter, // Pass the adapter
    });

    await server.start();
    console.log(`Server started on port ${deviceInfo.port}`);

    // Start multicast discovery
    const multicastDiscovery = new MulticastDiscovery(deviceInfo);
    multicastDiscovery.onDeviceDiscovered((device) => {
      console.log("Device discovered via multicast:", device.alias);
    });

    await multicastDiscovery.start();
    console.log("Multicast discovery started");

    // Announce our presence
    multicastDiscovery.announcePresence();
    console.log("Announced presence via multicast");

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      console.log("Shutting down...");

      try {
        multicastDiscovery.stop();
        await server.stop();
        console.log("Server stopped");
      } catch (err) {
        console.error("Error stopping server:", err);
      }

      process.exit(0);
    });
  } catch (err) {
    console.error("Error starting LocalSend receiver:", err);
    process.exit(1);
  }
}

// Call the main function
main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});

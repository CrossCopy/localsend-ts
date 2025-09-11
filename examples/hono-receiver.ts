import { getDeviceInfo, LocalSendHonoServer, MulticastDiscovery, HttpDiscovery } from "../src"

// Get device info with a custom alias
const deviceInfo = getDeviceInfo({
	alias: "Hono Receiver",
	port: process.env.PORT ? parseInt(process.env.PORT) : undefined,
	enableDownloadApi: true // Enable download API for browser access
})

console.log("Starting LocalSend receiver with Hono server:", deviceInfo)

// Create and start the Hono server
const pin = "123456"
const server = new LocalSendHonoServer(deviceInfo, {
	saveDirectory: "./received_files",
	pin: pin
})
console.log(`Hono server created with pin: ${pin}`)
await server.start()
console.log(`Server started on port ${deviceInfo.port}`)

// Start multicast discovery
const multicastDiscovery = new MulticastDiscovery(deviceInfo)
multicastDiscovery.onDeviceDiscovered((device) => {
	console.log("Device discovered via multicast:", device.alias)
})

await multicastDiscovery.start()
console.log("Multicast discovery started")

// Announce our presence
multicastDiscovery.announcePresence()
console.log("Announced presence via multicast")

// Start HTTP discovery as fallback
const httpDiscovery = new HttpDiscovery(deviceInfo)
httpDiscovery.onDeviceDiscovered((device) => {
	console.log("Device discovered via HTTP:", device.alias)
})

// Scan for devices periodically
const scanInterval = setInterval(() => {
	console.log("Scanning for devices via HTTP...")
	httpDiscovery.startScan().catch(console.error)
}, 30000) // Every 30 seconds

// Handle graceful shutdown
process.on("SIGINT", async () => {
	console.log("Shutting down...")
	clearInterval(scanInterval)

	try {
		multicastDiscovery.stop()
		await server.stop()
		console.log("Server stopped")
	} catch (err) {
		console.error("Error stopping server:", err)
	}

	process.exit(0)
})

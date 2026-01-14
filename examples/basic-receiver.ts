import { getDeviceInfo, LocalSendHonoServer, MulticastDiscovery, HttpDiscovery } from "../src"

function formatFileSize(bytes: number): string {
	if (bytes === 0) return '0 Bytes'
	const k = 1024
	const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function getFileType(fileName: string): string {
	const ext = fileName.split('.').pop()?.toLowerCase() || ''
	const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg']
	const videoExts = ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm']
	const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma']
	const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt']
	
	if (imageExts.includes(ext)) return 'Image'
	if (videoExts.includes(ext)) return 'Video'
	if (audioExts.includes(ext)) return 'Audio'
	if (docExts.includes(ext)) return 'Document'
	return 'File'
}

// Get device info with a custom alias
const deviceInfo = getDeviceInfo({
	alias: "TS Localsend Receiver",
	enableDownloadApi: true // Enable download API for browser access
})

console.log("Starting LocalSend receiver with device info:", deviceInfo)

// Create and start the HTTP server
const server = new LocalSendHonoServer(deviceInfo, {
	saveDirectory: "./received_files",
	pin: "123456",
	onTransferProgress: async (_fileId, fileName, _received, total, _speed, finished, transferInfo) => {
		if (finished && transferInfo) {
			const fileSize = formatFileSize(total)
			const fileType = getFileType(fileName)
			const avgSpeedFormatted = formatFileSize(transferInfo.averageSpeed) + '/s'
			const timeSeconds = transferInfo.totalTimeSeconds.toFixed(1)
			
			console.log(`\n📁 RECEIVED: ${fileName}`)
			console.log(`   Type: ${fileType}`)
			console.log(`   Size: ${fileSize}`)
			console.log(`   Time: ${timeSeconds}s (${avgSpeedFormatted})`)
			console.log(`   Path: ${transferInfo.filePath}`)
		}
	}
})

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

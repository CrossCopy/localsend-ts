#!/usr/bin/env node
import { defineCommand, runMain } from "citty"
import { getDeviceInfo, LocalSendClient, LocalSendHonoServer, HttpDiscovery } from "./index.ts"
import { createDiscovery, createScanner } from "./discovery/runtime.ts"
import type { FileMetadata, DeviceInfo } from "./index.ts"
import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import readline from "node:readline"
import cliProgress from "cli-progress"
import prettyBytes from "pretty-bytes"
import fs from "node:fs"

// Utility functions
function formatFileSize(bytes: number): string {
	return prettyBytes(bytes)
}

function getFileType(fileName: string): string {
	const ext = fileName.split(".").pop()?.toLowerCase() || ""
	const imageExts = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"]
	const videoExts = ["mp4", "avi", "mov", "mkv", "wmv", "flv", "webm"]
	const audioExts = ["mp3", "wav", "flac", "aac", "ogg", "wma"]
	const docExts = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt"]

	if (imageExts.includes(ext)) return "Image"
	if (videoExts.includes(ext)) return "Video"
	if (audioExts.includes(ext)) return "Audio"
	if (docExts.includes(ext)) return "Document"
	return "File"
}

class InteractiveLocalSend {
	private rl: readline.Interface
	private deviceInfo: DeviceInfo
	private discoveredDevices: Map<string, DeviceInfo> = new Map()
	private currentServer: LocalSendHonoServer | null = null
	private currentDiscovery: any = null
	private currentHttpDiscovery: HttpDiscovery | null = null
	private scanInterval: NodeJS.Timeout | null = null

	constructor(customPort?: number, customAlias?: string) {
		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout
		})

		this.deviceInfo = getDeviceInfo({
			alias: customAlias || `LocalSend CLI ${Math.floor(100 + Math.random() * 900)}`,
			port: customPort,
			enableDownloadApi: false
		})

		// Handle Ctrl+C gracefully
		this.rl.on("SIGINT", () => {
			this.cleanup()
			process.exit(0)
		})
	}

	private async question(prompt: string): Promise<string> {
		return new Promise((resolve) => {
			this.rl.question(prompt, (answer) => {
				resolve(answer.trim())
			})
		})
	}

	private async cleanup() {
		console.log("\nCleaning up...")

		if (this.scanInterval) {
			clearInterval(this.scanInterval)
		}

		if (this.currentDiscovery) {
			this.currentDiscovery.stop()
		}

		if (this.currentServer) {
			try {
				await this.currentServer.stop()
			} catch (err) {
				console.error("Error stopping server:", err)
			}
		}
	}

	async start() {
		console.clear()
		console.log("╔════════════════════════════════════════╗")
		console.log("║          LocalSend Interactive CLI     ║")
		console.log("╚════════════════════════════════════════╝")
		console.log(`Device: ${this.deviceInfo.alias}`)
		console.log(`Port: ${this.deviceInfo.port}`)
		console.log("")

		while (true) {
			try {
				await this.showMainMenu()
			} catch (error) {
				console.error("An error occurred:", error)
				console.log("Returning to main menu...\n")
			}
		}
	}

	private async showMainMenu() {
		console.log("═══════════════════════════════════════════")
		console.log("Main Menu:")
		console.log("  1. Discover nearby devices")
		console.log("  2. Send text message")
		console.log("  3. Send file")
		console.log("  4. Start receiver mode")
		console.log("  5. Change settings")
		console.log("  6. Exit")
		console.log("═══════════════════════════════════════════")

		const choice = await this.question("Enter your choice (1-6): ")

		switch (choice.trim()) {
			case "1":
				await this.discoverDevices()
				break
			case "2":
				await this.sendText()
				break
			case "3":
				await this.sendFile()
				break
			case "4":
				await this.startReceiver()
				break
			case "5":
				await this.changeSettings()
				break
			case "6":
				console.log("Goodbye!")
				await this.cleanup()
				process.exit(0)
				break
			default:
				console.log("Invalid choice. Please enter 1-6.\n")
				break
		}
	}

	private async discoverDevices() {
		console.log("\n🔍 Discovering devices on the network...\n")

		this.discoveredDevices.clear()

		let discoveryServer: LocalSendHonoServer | null = null
		try {
			discoveryServer = new LocalSendHonoServer(this.deviceInfo, {
				onRegister: (device) => {
					console.log(`📱 Found: ${device.alias} (${device.ip}:${device.port})`)
					this.discoveredDevices.set(`${device.ip}:${device.port}`, device)
				}
			})
			await discoveryServer.start()
		} catch (err) {
			console.warn("Failed to start discovery server:", err)
		}

		// Start device discovery
		const discovery = createDiscovery(this.deviceInfo)
		discovery.onDeviceDiscovered((device: DeviceInfo) => {
			console.log(`📱 Found: ${device.alias} (${device.ip}:${device.port})`)
			this.discoveredDevices.set(`${device.ip}:${device.port}`, device)
		})

		await discovery.start()
		discovery.announcePresence?.()

		// Start HTTP discovery
		const httpDiscovery = createScanner(this.deviceInfo)
		httpDiscovery.onDeviceDiscovered((device: DeviceInfo) => {
			console.log(`📱 Found: ${device.alias} (${device.ip}:${device.port})`)
			this.discoveredDevices.set(`${device.ip}:${device.port}`, device)
		})

		console.log("Scanning for 5 seconds...")
		await httpDiscovery.startScan?.()

		// Wait for 5 seconds
		await new Promise((resolve) => setTimeout(resolve, 5000))

		// Stop discovery
		discovery.stop()
		if (discoveryServer) {
			try {
				await discoveryServer.stop()
			} catch (err) {
				console.warn("Failed to stop discovery server:", err)
			}
		}

		const devices = Array.from(this.discoveredDevices.values())

		console.log(`\nScan complete! Found ${devices.length} device(s).`)

		if (devices.length > 0) {
			console.log("\nDiscovered devices:")
			devices.forEach((device, index) => {
				console.log(
					`  ${index + 1}. ${device.alias} (${device.ip}:${device.port}) - ${device.deviceModel}`
				)
			})
		}

		console.log("")
		await this.question("Press Enter to return to main menu...")
	}

	private async sendText() {
		console.log("\n📝 Send Text Message\n")

		// Check if we have discovered devices
		if (this.discoveredDevices.size === 0) {
			console.log("No devices discovered. Please discover devices first.")
			await this.question("Press Enter to return to main menu...")
			return
		}

		// Show available devices
		const devices = Array.from(this.discoveredDevices.values())
		console.log("Available devices:")
		devices.forEach((device, index) => {
			console.log(`  ${index + 1}. ${device.alias} (${device.ip}:${device.port})`)
		})

		const deviceChoice = await this.question("\nEnter device number: ")
		const deviceIndex = parseInt(deviceChoice) - 1

		if (deviceIndex < 0 || deviceIndex >= devices.length) {
			console.log("Invalid device selection.")
			await this.question("Press Enter to return to main menu...")
			return
		}

		const targetDevice = devices[deviceIndex]
		const textMessage = await this.question("Enter text to send: ")

		if (!textMessage.trim()) {
			console.log("No text entered.")
			await this.question("Press Enter to return to main menu...")
			return
		}

		// Create a temporary text file
		const tempFileName = `message_${Date.now()}.txt`
		const tempFilePath = path.join("/tmp", tempFileName)
		await fs.promises.writeFile(tempFilePath, textMessage)

		try {
			await this.sendFileToDevice(targetDevice, tempFilePath, true)
		} finally {
			// Clean up temp file
			try {
				await fs.promises.unlink(tempFilePath)
			} catch {}
		}
	}

	private async sendFile() {
		console.log("\n📁 Send File\n")

		// Check if we have discovered devices
		if (this.discoveredDevices.size === 0) {
			console.log("No devices discovered. Please discover devices first.")
			await this.question("Press Enter to return to main menu...")
			return
		}

		// Show available devices
		const devices = Array.from(this.discoveredDevices.values())
		console.log("Available devices:")
		devices.forEach((device, index) => {
			console.log(`  ${index + 1}. ${device.alias} (${device.ip}:${device.port})`)
		})

		const deviceChoice = await this.question("\nEnter device number: ")
		const deviceIndex = parseInt(deviceChoice) - 1

		if (deviceIndex < 0 || deviceIndex >= devices.length) {
			console.log("Invalid device selection.")
			await this.question("Press Enter to return to main menu...")
			return
		}

		const targetDevice = devices[deviceIndex]
		const filePath = await this.question("Enter absolute path to file: ")

		// Check if file exists
		try {
			await stat(filePath)
		} catch {
			console.log("File does not exist or is not accessible.")
			await this.question("Press Enter to return to main menu...")
			return
		}

		await this.sendFileToDevice(targetDevice, filePath, false)
	}

	private async sendFileToDevice(
		targetDevice: DeviceInfo,
		filePath: string,
		isTextMessage: boolean = false
	) {
		console.log(
			`\n📤 Sending ${isTextMessage ? "text message" : "file"} to ${targetDevice.alias}...`
		)

		try {
			// Create client
			const client = new LocalSendClient(this.deviceInfo)

			// Prepare file metadata
			const fileId = createHash("md5").update(filePath).digest("hex")
			const fileName = path.basename(filePath)
			const fileStats = await readFile(filePath)
			const fileSize = fileStats.length
			const fileHash = createHash("sha256").update(fileStats).digest("hex")

			const previewText = isTextMessage ? fileStats.toString("utf8") : undefined
			const fileMetadata: FileMetadata = {
				id: fileId,
				fileName: isTextMessage ? `message.txt` : fileName,
				size: fileSize,
				fileType: isTextMessage ? "text/plain" : "application/octet-stream",
				sha256: fileHash,
				preview: previewText,
				metadata: {
					modified: new Date().toISOString()
				}
			}

			// Get PIN if needed
			const pin = await this.question("Enter PIN (leave empty if none required): ")

			// Prepare upload
			console.log("Preparing upload...")
			const uploadPrepare = await client.prepareUpload(
				{
					ip: targetDevice.ip!,
					port: targetDevice.port,
					protocol: targetDevice.protocol || "https"
				},
				{ [fileId]: fileMetadata },
				pin
			)

			if (!uploadPrepare) {
				console.log(
					"❌ Failed to prepare upload. Check if the device is reachable and PIN is correct."
				)
				await this.question("Press Enter to return to main menu...")
				return
			}

			if (Object.keys(uploadPrepare.files || {}).length === 0) {
				if (isTextMessage) {
					console.log("✅ Text message delivered (no file upload required).")
					await this.question("Press Enter to return to main menu...")
					return
				}

				console.log("❌ No file tokens returned. Transfer was not accepted.")
				await this.question("Press Enter to return to main menu...")
				return
			}

			// Create progress bar
			const progressBar = new cliProgress.SingleBar(
				{
					format: "{filename} [{bar}] {percentage}% | {sizeDisplay} | Speed: {speed} | ETA: {eta}",
					barCompleteChar: "\u2588",
					barIncompleteChar: "\u2591",
					clearOnComplete: false,
					hideCursor: true
				},
				cliProgress.Presets.shades_classic
			)

			const sizeDisplay = `${formatFileSize(0)}/${formatFileSize(fileSize)}`
			progressBar.start(fileSize, 0, {
				filename: (isTextMessage ? "message.txt" : fileName).padEnd(25),
				sizeDisplay,
				speed: "0 B/s",
				eta: "?",
				percentage: "0.0"
			})

			// Set up progress tracking
			const startTime = Date.now()
			let lastBytes = 0
			let lastTime = startTime

			client.setProgressCallback((bytesUploaded, totalBytes, finished) => {
				const now = Date.now()
				const timeDiff = (now - lastTime) / 1000
				const bytesDiff = bytesUploaded - lastBytes
				const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0

				const speedText = `${formatFileSize(speed)}/s`
				const formattedSizeDisplay = `${formatFileSize(bytesUploaded)}/${formatFileSize(fileSize)}`
				const bytesRemaining = totalBytes - bytesUploaded
				const eta = speed > 0 ? bytesRemaining / speed : 0

				let etaDisplay = "?"
				if (eta > 3600) {
					etaDisplay = `${Math.floor(eta / 3600)}h ${Math.floor((eta % 3600) / 60)}m`
				} else if (eta > 60) {
					etaDisplay = `${Math.floor(eta / 60)}m ${Math.floor(eta % 60)}s`
				} else if (eta > 0) {
					etaDisplay = `${Math.floor(eta)}s`
				}

				progressBar.update(bytesUploaded, {
					sizeDisplay: formattedSizeDisplay,
					speed: speedText,
					eta: etaDisplay,
					percentage: ((bytesUploaded / totalBytes) * 100).toFixed(1)
				})

				lastBytes = bytesUploaded
				lastTime = now

				if (finished) {
					progressBar.stop()
				}
			})

			// Upload file
			const fileToken = uploadPrepare.files[fileId]
			if (!fileToken) {
				console.log("❌ File token missing for upload. Transfer was not accepted.")
				await this.question("Press Enter to return to main menu...")
				return
			}

			const success = await client.uploadFile(
				{
					ip: targetDevice.ip!,
					port: targetDevice.port,
					protocol: targetDevice.protocol || "https"
				},
				uploadPrepare.sessionId,
				fileId,
				fileToken,
				filePath
			)

			if (success) {
				console.log(`✅ ${isTextMessage ? "Text message" : "File"} sent successfully!`)
			} else {
				console.log(`❌ Failed to send ${isTextMessage ? "text message" : "file"}`)
			}
		} catch (error) {
			console.error("Error sending:", error)
		}

		await this.question("Press Enter to return to main menu...")
	}

	private async startReceiver() {
		console.log("\n📥 Starting Receiver Mode\n")

		const saveDir = await this.question("Enter save directory (default: ./received_files): ")
		const pin = await this.question("Enter PIN for authentication (leave empty for no PIN): ")

		const finalSaveDir = saveDir.trim() || "./received_files"

		// Create save directory if it doesn't exist
		try {
			await fs.promises.mkdir(finalSaveDir, { recursive: true })
		} catch (error) {
			console.error("Error creating save directory:", error)
			await this.question("Press Enter to return to main menu...")
			return
		}

		console.log(`\nStarting receiver server...`)
		console.log(`Device: ${this.deviceInfo.alias}`)
		console.log(`Port: ${this.deviceInfo.port}`)
		console.log(`Save directory: ${finalSaveDir}`)
		if (pin) console.log(`PIN required: Yes`)
		console.log("\nPress Ctrl+C to stop receiver and return to main menu.\n")

		const multiBar = new cliProgress.MultiBar(
			{
				clearOnComplete: false,
				hideCursor: true,
				format: "{filename} [{bar}] {percentage}% | {sizeDisplay} | Speed: {speed} | ETA: {eta}",
				barCompleteChar: "\u2588",
				barIncompleteChar: "\u2591"
			},
			cliProgress.Presets.shades_classic
		)

		const activeProgressBars = new Map()

		// Create server
		this.currentServer = new LocalSendHonoServer(this.deviceInfo, {
			saveDirectory: finalSaveDir,
			pin: pin,
			onTransferRequest: async (senderInfo: DeviceInfo, files: Record<string, FileMetadata>) => {
				const filesInfo = Object.values(files)
					.map((file) => `${file.fileName} (${formatFileSize(file.size)})`)
					.join(", ")

				console.log(`\n📩 Incoming transfer from ${senderInfo.alias}:`)
				console.log(`Files: ${filesInfo}`)

				const accept = await this.question("Accept transfer? (y/N): ")

				if (accept.toLowerCase() !== "y") {
					console.log("Transfer rejected\n")
					return false
				}

				// Create progress bars for each file
				Object.entries(files).forEach(([fileId, file]) => {
					const bar = multiBar.create(file.size, 0, {
						filename:
							file.fileName.length > 25
								? file.fileName.substring(0, 22) + "..."
								: file.fileName.padEnd(25),
						sizeDisplay: `${formatFileSize(0)}/${formatFileSize(file.size)}`,
						speed: "0 B/s",
						eta: "?",
						percentage: "0.0"
					})
					activeProgressBars.set(fileId, bar)
				})

				console.log("Transfer accepted, downloading...\n")
				return true
			},
			onTransferProgress: async (
				fileId,
				fileName,
				received,
				total,
				speed,
				finished,
				transferInfo
			) => {
				const progressBar = activeProgressBars.get(fileId)
				if (progressBar) {
					const sizeDisplay = `${formatFileSize(received)}/${formatFileSize(total)}`
					const speedText = `${formatFileSize(speed)}/s`
					const remaining = total - received
					const eta = speed > 0 ? Math.ceil(remaining / speed) : 0

					let etaDisplay = "?"
					if (eta > 3600) {
						etaDisplay = `${Math.floor(eta / 3600)}h ${Math.floor((eta % 3600) / 60)}m`
					} else if (eta > 60) {
						etaDisplay = `${Math.floor(eta / 60)}m ${eta % 60}s`
					} else if (eta > 0) {
						etaDisplay = `${eta}s`
					}

					const percentage = total > 0 ? Math.min(100, (received / total) * 100) : 0

					progressBar.update(received, {
						sizeDisplay,
						speed: speedText,
						eta: etaDisplay,
						percentage: percentage.toFixed(1)
					})

					if (finished && transferInfo) {
						const fileType = getFileType(fileName)
						const avgSpeedFormatted = formatFileSize(transferInfo.averageSpeed) + "/s"
						const timeSeconds = transferInfo.totalTimeSeconds.toFixed(1)

						console.log(`\n📁 RECEIVED: ${fileName}`)
						console.log(`   Type: ${fileType}`)
						console.log(`   Size: ${formatFileSize(total)}`)
						console.log(`   Time: ${timeSeconds}s (${avgSpeedFormatted})`)
						console.log(`   Path: ${transferInfo.filePath}\n`)
					}
				}
			}
		})

		try {
			// Start server
			await this.currentServer.start()

			// Start discovery
			this.currentDiscovery = createDiscovery(this.deviceInfo)
			await this.currentDiscovery.start()
			this.currentDiscovery.announcePresence?.()

			this.currentHttpDiscovery = new HttpDiscovery(this.deviceInfo)
			this.scanInterval = setInterval(() => {
				this.currentHttpDiscovery?.startScan().catch(console.error)
			}, 30000)

			// Wait for Ctrl+C
			await new Promise<void>((resolve) => {
				const cleanup = async () => {
					console.log("\nStopping receiver...")

					if (this.scanInterval) {
						clearInterval(this.scanInterval)
						this.scanInterval = null
					}

					if (this.currentDiscovery) {
						this.currentDiscovery.stop()
						this.currentDiscovery = null
					}

					if (this.currentServer) {
						await this.currentServer.stop()
						this.currentServer = null
					}

					multiBar.stop()
					console.log("Receiver stopped.\n")
					resolve()
				}

				const originalHandler = process.listeners("SIGINT")
				process.removeAllListeners("SIGINT")
				process.once("SIGINT", cleanup)

				// Restore original handlers after cleanup
				resolve = ((originalResolve) => () => {
					originalHandler.forEach((handler) => process.on("SIGINT", handler as any))
					originalResolve()
				})(resolve)
			})
		} catch (error) {
			console.error("Error starting receiver:", error)
			await this.question("Press Enter to return to main menu...")
		}
	}

	private async changeSettings() {
		console.log("\n⚙️  Settings\n")
		console.log(`Current device alias: ${this.deviceInfo.alias}`)
		console.log(`Current port: ${this.deviceInfo.port}`)

		console.log("\nSettings:")
		console.log("  1. Change device alias")
		console.log("  2. Change port")
		console.log("  3. Back to main menu")

		const choice = await this.question("Enter your choice (1-3): ")

		switch (choice.trim()) {
			case "1":
				const newAlias = await this.question("Enter new device alias: ")
				if (newAlias.trim()) {
					this.deviceInfo = getDeviceInfo({
						...this.deviceInfo,
						alias: newAlias.trim()
					})
					console.log(`Device alias changed to: ${this.deviceInfo.alias}`)
				}
				break
			case "2":
				const newPort = await this.question("Enter new port number: ")
				const portNum = parseInt(newPort.trim())
				if (!isNaN(portNum) && portNum > 0 && portNum <= 65535) {
					this.deviceInfo = getDeviceInfo({
						...this.deviceInfo,
						port: portNum
					})
					console.log(`Port changed to: ${this.deviceInfo.port}`)
				} else {
					console.log("Invalid port number.")
				}
				break
			case "3":
				return
			default:
				console.log("Invalid choice.")
				break
		}

		await this.question("Press Enter to continue...")
	}

	close() {
		this.rl.close()
	}
}

const main = defineCommand({
	meta: {
		name: "localsend-interactive",
		version: "0.1.0",
		description: "LocalSend Interactive CLI"
	},
	args: {
		port: {
			type: "string",
			description: "Custom port number"
		},
		alias: {
			type: "string",
			description: "Custom device alias"
		}
	},
	async run({ args }) {
		const portString = args.port as string | undefined
		const port = portString ? parseInt(portString, 10) : undefined
		const alias = args.alias as string | undefined

		const cli = new InteractiveLocalSend(port, alias)

		// Handle process termination
		process.on("SIGINT", () => {
			cli.close()
			process.exit(0)
		})

		await cli.start()
	}
})

runMain(main)

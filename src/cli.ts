#!/usr/bin/env node
import { defineCommand, runMain } from "citty"
// import { version } from "../package.json"
import { getDeviceInfo, LocalSendClient, LocalSendHonoServer, HttpDiscovery } from "./index.ts"
import { createDiscovery, createScanner } from "./discovery/runtime.ts"
import type { FileMetadata, DeviceInfo } from "./index.ts"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import readline from "node:readline"
import cliProgress from "cli-progress"
import prettyBytes from "pretty-bytes"

const defaultName = `XC LocalSend CLI ${Math.floor(100 + Math.random() * 900)}`

const main = defineCommand({
	meta: {
		name: "localsend",
		version: "0.1.0",
		description: "LocalSend JS CLI"
	},
	subCommands: {
		send: defineCommand({
			meta: {
				name: "send",
				description: "Send a file to another device"
			},
			args: {
				target: {
					type: "positional",
					description: "Target device IP address",
					required: true
				},
				file: {
					type: "positional",
					description: "Path to the file to send",
					required: true
				},
				alias: {
					type: "string",
					description: "Custom device alias (default: TypeScript Sender)",
					default: "TypeScript Sender"
				},
				pin: {
					type: "string",
					description: "PIN for authentication (if required)",
					default: "123456"
				},
				port: {
					type: "string",
					description: "Custom port number"
				},
				protocol: {
					type: "string",
					description: "Protocol to use (http or https)",
					default: "http"
				},
				verbose: {
					type: "boolean",
					description: "Show verbose output",
					default: false
				}
			},
			async run({ args }) {
				const targetIp = args.target as string
				const filePath = args.file as string
				const protocol = args.protocol as "http" | "https"
				const portString = args.port as string | undefined
				const port = portString ? parseInt(portString, 10) : undefined

				// Get device info with custom alias
				const deviceInfo = getDeviceInfo({
					alias: args.alias as string,
					port
				})

				if (args.verbose) {
					console.log("Starting LocalSend sender with device info:", deviceInfo)
				} else {
					console.log(`Starting file transfer as '${deviceInfo.alias}'`)
				}

				// Create client
				const client = new LocalSendClient(deviceInfo)

				// Get target device info
				console.log(`Getting device info for ${targetIp}...`)
				const targetDevice = await client.getDeviceInfo({
					ip: targetIp,
					port: deviceInfo.port
				})

				if (!targetDevice) {
					console.error("Failed to get device info for target")
					process.exit(1)
				}

				console.log(`Target device: ${targetDevice.alias}`)

				// Prepare file metadata
				const fileId = createHash("md5").update(filePath).digest("hex")
				const fileName = path.basename(filePath)
				const fileStats = await readFile(filePath)
				const fileSize = fileStats.length

				// Calculate file hash
				const fileHash = createHash("sha256").update(fileStats).digest("hex")

				const fileMetadata: FileMetadata = {
					id: fileId,
					fileName,
					size: fileSize,
					fileType: "application/octet-stream", // You might want to detect the content type
					sha256: fileHash,
					metadata: {
						modified: new Date().toISOString()
					}
				}

				// Prepare upload
				console.log("Preparing upload...")
				const uploadPrepare = await client.prepareUpload(
					{
						ip: targetIp,
						port: deviceInfo.port,
						protocol
					},
					{ [fileId]: fileMetadata },
					args.pin as string
				)

				if (!uploadPrepare) {
					console.error("Failed to prepare upload")
					process.exit(1)
				}

				if (args.verbose) {
					console.log("Upload prepared, session ID:", uploadPrepare.sessionId)
				}

				// Create progress bar for file upload
				const progressBar = new cliProgress.SingleBar(
					{
						format:
							"{filename} [{bar}] {percentage}% | {sizeDisplay} | Speed: {speed} | ETA: {eta}",
						barCompleteChar: "\u2588",
						barIncompleteChar: "\u2591",
						clearOnComplete: false,
						hideCursor: true
					},
					cliProgress.Presets.shades_classic
				)

				// Format size display based on file size
				const sizeDisplay = `${prettyBytes(0)}/${prettyBytes(fileSize)}`

				// Initialize the progress bar
				progressBar.start(fileSize, 0, {
					filename: fileName.length > 25 ? fileName.substring(0, 22) + "..." : fileName.padEnd(25),
					sizeDisplay,
					speed: "0 B/s",
					eta: "?",
					percentage: "0.0"
				})

				// Set up progress tracking variables
				const startTime = Date.now()
				let lastBytes = 0
				let lastTime = startTime

				// Set up progress tracking callback for the client
				client.setProgressCallback((bytesUploaded, totalBytes, finished) => {
					// Calculate instantaneous speed
					const now = Date.now()
					const timeDiff = (now - lastTime) / 1000 // seconds
					const bytesDiff = bytesUploaded - lastBytes
					const speed = bytesDiff / timeDiff // bytes per second

					// Format speed
					const speedText = `${prettyBytes(speed)}/s`

					// Format size display
					const formattedSizeDisplay = `${prettyBytes(bytesUploaded)}/${prettyBytes(fileSize)}`

					// Calculate ETA
					const bytesRemaining = totalBytes - bytesUploaded
					const eta = speed > 0 ? bytesRemaining / speed : 0 // seconds

					// Format ETA
					let etaDisplay
					if (eta > 3600) {
						etaDisplay = `${Math.floor(eta / 3600)}h ${Math.floor((eta % 3600) / 60)}m`
					} else if (eta > 60) {
						etaDisplay = `${Math.floor(eta / 60)}m ${Math.floor(eta % 60)}s`
					} else {
						etaDisplay = `${Math.floor(eta)}s`
					}

					// Update progress bar
					progressBar.update(bytesUploaded, {
						sizeDisplay: formattedSizeDisplay,
						speed: speedText,
						eta: eta > 0 ? etaDisplay : "?",
						percentage: ((bytesUploaded / totalBytes) * 100).toFixed(1)
					})

					// Update last values for next calculation
					lastBytes = bytesUploaded
					lastTime = now

					// If finished, update one last time
					if (finished) {
						progressBar.update(totalBytes, {
							sizeDisplay: formattedSizeDisplay,
							speed: `✓ ${speedText}`,
							eta: "0s"
						})
						progressBar.stop()
					}
				})

				// Upload file
				console.log("Uploading file...")
				const success = await client.uploadFile(
					{
						ip: targetIp,
						port: deviceInfo.port,
						protocol
					},
					uploadPrepare.sessionId,
					fileId,
					uploadPrepare.files[fileId],
					filePath
				)

				if (success) {
					console.log("✅ File uploaded successfully!")
				} else {
					console.error("❌ Failed to upload file")

					// Cancel session
					await client.cancelSession(
						{
							ip: targetIp,
							port: deviceInfo.port,
							protocol
						},
						uploadPrepare.sessionId
					)

					console.log("Session canceled")
					process.exit(1)
				}
			}
		}),
		receive: defineCommand({
			meta: {
				name: "receive",
				description: "Start a receiver to receive files from other devices"
			},
			args: {
				alias: {
					type: "string",
					description: `Custom device alias (default: ${defaultName})`,
					default: defaultName
				},
				port: {
					type: "string",
					description: "Custom port number"
				},
				saveDir: {
					type: "string",
					description: "Directory to save received files",
					default: "./received_files"
				},
				pin: {
					type: "string",
					description: "PIN for authentication",
					default: ""
				},
				autoAccept: {
					type: "boolean",
					description: "Automatically accept all incoming file transfers without prompting",
					default: false
				},
				enableBrowser: {
					type: "boolean",
					description: "Enable browser download API for accessing received files",
					default: false
				},
				discoveryInterval: {
					type: "string",
					description: "Interval in seconds for HTTP discovery scanning",
					default: "30"
				},
				maxRequestSize: {
					type: "string",
					description: "Maximum request body size in MB (default: 5120 MB/5GB)",
					default: "5120"
				},
				verbose: {
					type: "boolean",
					description: "Show verbose output",
					default: false
				}
			},
			async run({ args }) {
				const portString = args.port as string | undefined
				const port = portString ? parseInt(portString, 10) : undefined
				const discoveryInterval = parseInt(args.discoveryInterval as string, 10) * 1000
				const maxRequestSizeMB = parseInt(args.maxRequestSize as string, 10)
				const maxRequestBodySize = maxRequestSizeMB * 1024 * 1024 // Convert MB to bytes

				// Get device info with custom alias
				const deviceInfo = getDeviceInfo({
					alias: args.alias as string,
					port,
					enableDownloadApi: args.enableBrowser as boolean
				})

				if (args.verbose) {
					console.log("Starting LocalSend receiver with device info:", deviceInfo)
					console.log(`Maximum request body size: ${maxRequestSizeMB} MB`)
				} else {
					console.log(`Starting receiver as '${deviceInfo.alias}' on port ${deviceInfo.port}`)
				}

				// Create progress bar
				const multiBar = new cliProgress.MultiBar(
					{
						clearOnComplete: false,
						hideCursor: true,
						format:
							"{filename} [{bar}] {percentage}% | {sizeDisplay} | Speed: {speed} | ETA: {eta}",
						barCompleteChar: "\u2588",
						barIncompleteChar: "\u2591"
					},
					cliProgress.Presets.shades_classic
				)

				// Track active progress bars
				const activeProgressBars = new Map()

				// Create and start the Hono server
				const server = new LocalSendHonoServer(deviceInfo, {
					saveDirectory: args.saveDir as string,
					pin: args.pin as string,
					maxRequestBodySize: maxRequestBodySize,
					onTransferRequest: async (
						senderInfo: DeviceInfo,
						files: Record<string, FileMetadata>
					) => {
						// Format file info for display
						const filesInfo = Object.values(files)
							.map((file) => `${file.fileName} (${prettyBytes(file.size)})`)
							.join(", ")

						console.log(`\n📩 Incoming transfer request from ${senderInfo.alias}:`)
						console.log(`Files: ${filesInfo}`)

						// If autoAccept is enabled, skip confirmation and accept transfer automatically
						if (args.autoAccept as boolean) {
							console.log("Auto-accepting transfer...")

							// Create progress bars for each file
							Object.entries(files).forEach(([fileId, file]) => {
								const totalMb = (file.size / (1024 * 1024)).toFixed(2)

								// Format size display using pretty-bytes
								const sizeDisplay = `${prettyBytes(0)}/${prettyBytes(file.size)}`

								const bar = multiBar.create(file.size, 0, {
									filename:
										file.fileName.length > 25
											? file.fileName.substring(0, 22) + "..."
											: file.fileName.padEnd(25),
									receivedMb: "0.00",
									totalMb,
									sizeDisplay,
									speed: "0 B/s",
									eta: "?",
									percentage: "0.0"
								})
								activeProgressBars.set(fileId, { bar, startTime: null })
							})

							console.log("Downloading...")
							return true
						}

						// Create readline interface for user input
						const rl = readline.createInterface({
							input: process.stdin,
							output: process.stdout
						})

						// Prompt for confirmation
						try {
							const accept = await new Promise<boolean>((resolve) => {
								rl.question("Accept transfer? (y/N): ", (answer) => {
									// Ensure the answer is displayed on the same line as the prompt
									resolve(answer.toLowerCase() === "y")
									rl.close()
								})
							})

							if (!accept) {
								console.log("Transfer rejected")
								return false
							}

							// Create progress bars for each file when transfer is accepted
							Object.entries(files).forEach(([fileId, file]) => {
								const totalMb = (file.size / (1024 * 1024)).toFixed(2)

								// Format size display using pretty-bytes
								const sizeDisplay = `${prettyBytes(0)}/${prettyBytes(file.size)}`

								const bar = multiBar.create(file.size, 0, {
									filename:
										file.fileName.length > 25
											? file.fileName.substring(0, 22) + "..."
											: file.fileName.padEnd(25),
									receivedMb: "0.00",
									totalMb,
									sizeDisplay,
									speed: "0 B/s",
									eta: "?",
									percentage: "0.0"
								})
								activeProgressBars.set(fileId, { bar, startTime: null })
							})

							console.log("Transfer accepted, downloading...")
							return true
						} catch (error) {
							console.error("Error getting user input:", error)
							rl.close()
							return false
						}
					},
					onTransferProgress: async (
						fileId: string,
						fileName: string,
						received: number,
						total: number,
						speed: number,
						finished?: boolean,
						transferInfo?: {
							filePath: string
							totalTimeSeconds: number
							averageSpeed: number
						}
					) => {
						const progressBar = activeProgressBars.get(fileId)
						if (progressBar) {
							const receivedMb = (received / (1024 * 1024)).toFixed(2)
							const totalMb = (total / (1024 * 1024)).toFixed(2)

							// For large files, show progress in GB if applicable
							const sizeDisplay = `${prettyBytes(received)}/${prettyBytes(total)}`

							// Format speed with appropriate units
							const speedText = `${prettyBytes(speed)}/s`

							// Calculate ETA in seconds
							const remaining = total - received
							const eta = speed > 0 ? Math.ceil(remaining / speed) : 0

							// Format ETA nicely for longer transfers
							let etaDisplay
							if (eta > 3600) {
								etaDisplay = `${Math.floor(eta / 3600)}h ${Math.floor((eta % 3600) / 60)}m`
							} else if (eta > 60) {
								etaDisplay = `${Math.floor(eta / 60)}m ${eta % 60}s`
							} else {
								etaDisplay = `${eta}s`
							}

							// Calculate percentage (handle division by zero)
							const percentage = total > 0 ? Math.min(100, (received / total) * 100) : 0

							// Update progress bar
							progressBar.bar.update(received, {
								receivedMb,
								totalMb,
								sizeDisplay,
								speed: speedText,
								eta: eta ? etaDisplay : "?",
								percentage: percentage.toFixed(1)
							})

							// When complete, mark with checkmark
							if (received >= total) {
								progressBar.bar.update(total, {
									sizeDisplay,
									speed: `✓ ${speedText}`,
									eta: "0s"
								})
							}

							// Print transfer summary if finished
							if (finished && transferInfo) {
								const { filePath, totalTimeSeconds, averageSpeed } = transferInfo

								// Format size and speed using pretty-bytes
								const sizeStr = prettyBytes(total)
								const speedStr = `${prettyBytes(averageSpeed)}/s`

								// Format time
								let timeStr = ""
								if (totalTimeSeconds >= 3600) {
									const hours = Math.floor(totalTimeSeconds / 3600)
									const minutes = Math.floor((totalTimeSeconds % 3600) / 60)
									const seconds = Math.floor(totalTimeSeconds % 60)
									timeStr = `${hours}h ${minutes}m ${seconds}s`
								} else if (totalTimeSeconds >= 60) {
									const minutes = Math.floor(totalTimeSeconds / 60)
									const seconds = Math.floor(totalTimeSeconds % 60)
									timeStr = `${minutes}m ${seconds}s`
								} else {
									timeStr = `${Math.floor(totalTimeSeconds)}s`
								}

								// flush stdout
								process.stdout.write("\n")
								await new Promise((resolve) => setTimeout(resolve, 100))
								// Print transfer summary in table format
								// Reset cursor position
								console.log("\n✅ Transfer complete:")
								console.table({
									File: fileName,
									Size: `${sizeStr} (${total.toLocaleString()} bytes)`,
									"Saved to": filePath,
									Time: timeStr,
									"Average speed": speedStr
								})
							}
						}
					}
				})

				await server.start()
				console.log(`Server started on port ${deviceInfo.port}`)

				// Start multicast discovery
				const discovery = createDiscovery(deviceInfo)
				discovery.onDeviceDiscovered((device) => {
					if (args.verbose) {
						console.log("Device discovered:", device.alias)
					}
				})

				await discovery.start()
				if (args.verbose) {
					console.log("Device discovery started")
				}

				// Announce our presence
				discovery.announcePresence?.()
				console.log("Announced presence")

				// Start HTTP discovery as fallback
				const httpDiscovery = new HttpDiscovery(deviceInfo)
				httpDiscovery.onDeviceDiscovered((device) => {
					if (args.verbose) {
						console.log("Device discovered via HTTP:", device.alias)
					}
				})

				// Scan for devices periodically
				const scanInterval = setInterval(() => {
					if (args.verbose) {
						console.log("Scanning for devices via HTTP...")
					}
					httpDiscovery.startScan().catch(console.error)
				}, discoveryInterval)

				// First scan immediately
				httpDiscovery.startScan().catch(console.error)

				console.log("Receiver is running. Press Ctrl+C to stop.")

				// Handle graceful shutdown
				process.on("SIGINT", async () => {
					console.log("Shutting down...")
					clearInterval(scanInterval)

					try {
						discovery.stop()
						await server.stop()

						// Stop progress bars
						multiBar.stop()

						console.log("Server stopped")
					} catch (err) {
						console.error("Error stopping server:", err)
					}

					process.exit(0)
				})
			}
		}),
		discover: defineCommand({
			meta: {
				name: "discover",
				description: "Discover available devices on the network"
			},
			args: {
				alias: {
					type: "string",
					description: "Custom device alias (default: TS Scanner)",
					default: "TS Scanner"
				},
				port: {
					type: "string",
					description: "Custom port number"
				},
				timeout: {
					type: "string",
					description: "Scan timeout in seconds",
					default: "5"
				},
				json: {
					type: "boolean",
					description: "Output results as JSON",
					default: false
				},
				verbose: {
					type: "boolean",
					description: "Show verbose output",
					default: false
				}
			},
			async run({ args }) {
				const portString = args.port as string | undefined
				const port = portString ? parseInt(portString, 10) : undefined
				const timeout = parseInt(args.timeout as string, 10) * 1000

				// Get device info with custom alias
				const deviceInfo = getDeviceInfo({
					alias: args.alias as string,
					port
				})

				if (args.verbose) {
					console.log("Starting device discovery with device info:", deviceInfo)
				} else {
					console.log(`Scanning for devices as '${deviceInfo.alias}'...`)
				}

				// Keep track of discovered devices
				const discoveredDevices = new Map<string, any>()

				// Start device discovery
				const discovery = createDiscovery(deviceInfo)
				discovery.onDeviceDiscovered((device: any) => {
					if (args.verbose) {
						console.log("Device discovered:", device.alias)
					}
					discoveredDevices.set(`${device.ip}:${device.port}`, device)
				})

				await discovery.start()
				if (args.verbose) {
					console.log("Device discovery started")
				}

				// Start HTTP discovery
				const httpDiscovery = createScanner(deviceInfo)
				httpDiscovery.onDeviceDiscovered((device: any) => {
					if (args.verbose) {
						console.log("Device discovered via HTTP:", device.alias)
					}
					discoveredDevices.set(`${device.ip}:${device.port}`, device)
				})

				// Start scan
				console.log("Scanning the network...")
				await httpDiscovery.startScan?.()

				// Wait for timeout
				await new Promise((resolve) => setTimeout(resolve, timeout))

				// Stop discovery
				discovery.stop()

				// Output results
				const devices = Array.from(discoveredDevices.values())

				if (devices.length === 0) {
					console.log("No devices found")
				} else {
					if (args.json) {
						console.log(JSON.stringify(devices, null, 2))
					} else {
						console.log(`\nFound ${devices.length} device${devices.length === 1 ? "" : "s"}:\n`)
						devices.forEach((device, index) => {
							console.log(`${index + 1}. ${device.alias}`)
							console.log(`   IP: ${device.ip}`)
							console.log(`   Port: ${device.port}`)
							console.log(`   Protocol: ${device.protocol}`)
							console.log(`   OS: ${device.deviceModel}`)
							console.log("")
						})
					}
				}

				process.exit(0)
			}
		})
	},
	run({ args }) {
		console.log("Please use a subcommand: send | receive | discover")
		console.log("Examples:")
		console.log("  localsend send 192.168.1.100 ./file.txt")
		console.log("  localsend receive --saveDir ./downloads")
		console.log("  localsend discover --timeout 10")
	}
})

runMain(main)

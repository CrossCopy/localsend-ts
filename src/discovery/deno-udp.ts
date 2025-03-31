import type { DeviceInfo } from "../types.ts"
import type { AnnouncementMessage } from "../types.ts"
import { DEFAULT_CONFIG } from "../config.ts"
import type { Discovery } from "./types.ts"

declare namespace Deno {
	interface DatagramConn {
		receive(): Promise<[Uint8Array, { hostname: string; port: number }]>
		send(
			data: Uint8Array,
			options: { transport: "udp"; hostname: string; port: number }
		): Promise<void>
		close(): void
	}

	function listenDatagram(options: {
		transport: "udp"
		hostname: string
		port: number
	}): Promise<DatagramConn>
}

export class DenoMulticastDiscovery implements Discovery {
	private socket: Deno.DatagramConn | null = null
	private knownDevices: Map<string, DeviceInfo> = new Map()
	private onDeviceDiscoveredCallback?: (device: DeviceInfo) => void
	private isListening = false

	constructor(private deviceInfo: DeviceInfo) {}

	async start(): Promise<void> {
		try {
			// Create UDP socket
			this.socket = await Deno.listenDatagram({
				transport: "udp",
				hostname: DEFAULT_CONFIG.MULTICAST_ADDRESS,
				port: DEFAULT_CONFIG.MULTICAST_PORT
			})

			// Start listening for messages
			this.isListening = true
			this.listenForMessages()
		} catch (err) {
			console.error("Failed to start Deno UDP socket:", err)
			throw err
		}
	}

	private async listenForMessages() {
		console.log("Listening for messages on multicast address:", DEFAULT_CONFIG.MULTICAST_ADDRESS)
		if (!this.socket) return

		while (this.isListening) {
			try {
				const [data, addr] = await this.socket.receive()
				const message = new TextDecoder().decode(data)
				console.log("Received UDP message from:", addr.hostname, message)
				try {
					const announcement = JSON.parse(message) as AnnouncementMessage

					// Ignore self-announcements
					if (announcement.fingerprint === this.deviceInfo.fingerprint) {
						continue
					}

					// Handle announcement
					if (announcement.announce) {
						// Respond to announcement
						await this.respondToAnnouncement(announcement, addr.hostname)
					}

					// Store device in known devices
					this.knownDevices.set(announcement.fingerprint, announcement)

					// Notify new device
					if (this.onDeviceDiscoveredCallback) {
						this.onDeviceDiscoveredCallback(announcement)
					}
				} catch (err) {
					console.error("Error parsing announcement message:", err)
				}
			} catch (err) {
				if (this.isListening) {
					console.error("Error receiving UDP message:", err)
				}
			}
		}
	}

	async announcePresence(): Promise<void> {
		if (!this.socket) return

		const message: AnnouncementMessage = {
			...this.deviceInfo,
			announce: true
		}

		const buffer = new TextEncoder().encode(JSON.stringify(message))
		await this.socket.send(buffer, {
			transport: "udp",
			hostname: DEFAULT_CONFIG.MULTICAST_ADDRESS,
			port: DEFAULT_CONFIG.MULTICAST_PORT
		})
	}

	private async respondToAnnouncement(
		device: AnnouncementMessage,
		ipAddress: string
	): Promise<void> {
		if (!this.socket) return

		const responseMessage: AnnouncementMessage = {
			...this.deviceInfo,
			announce: false
		}

		const buffer = new TextEncoder().encode(JSON.stringify(responseMessage))
		await this.socket.send(buffer, {
			transport: "udp",
			hostname: DEFAULT_CONFIG.MULTICAST_ADDRESS,
			port: DEFAULT_CONFIG.MULTICAST_PORT
		})
	}

	onDeviceDiscovered(callback: (device: DeviceInfo) => void): void {
		this.onDeviceDiscoveredCallback = callback
	}

	getKnownDevices(): DeviceInfo[] {
		return Array.from(this.knownDevices.values())
	}

	stop(): void {
		this.isListening = false
		if (this.socket) {
			this.socket.close()
			this.socket = null
		}
	}
}

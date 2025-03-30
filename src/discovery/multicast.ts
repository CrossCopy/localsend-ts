import { createSocket } from "dgram"
import type { AnnouncementMessage, DeviceInfo } from "../types"
import { DEFAULT_CONFIG } from "../config"
import { getDeviceInfo } from "../utils/device"

export class MulticastDiscovery {
	private socket
	private knownDevices: Map<string, DeviceInfo> = new Map()
	private onDeviceDiscoveredCallback?: (device: DeviceInfo) => void

	constructor(private deviceInfo: DeviceInfo) {
		this.socket = createSocket("udp4")
	}

	start(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.socket.on("error", (err) => {
				console.error("Multicast socket error:", err)
				reject(err)
			})

			this.socket.on("message", (message, rinfo) => {
				try {
					const data = JSON.parse(message.toString()) as AnnouncementMessage

					// Ignore self-announcements
					if (data.fingerprint === this.deviceInfo.fingerprint) {
						return
					}

					// Handle announcement
					if (data.announce) {
						// Respond to announcement
						this.respondToAnnouncement(data, rinfo.address)
					}

					// Store device in known devices
					this.knownDevices.set(data.fingerprint, data)

					// Notify new device
					if (this.onDeviceDiscoveredCallback) {
						this.onDeviceDiscoveredCallback(data)
					}
				} catch (err) {
					console.error("Error parsing announcement message:", err)
				}
			})

			// Bind socket to the multicast port
			this.socket.bind(DEFAULT_CONFIG.MULTICAST_PORT, () => {
				// Join multicast group
				this.socket.addMembership(DEFAULT_CONFIG.MULTICAST_ADDRESS)
				resolve()
			})
		})
	}

	/**
	 * Announce device presence to the local network
	 */
	announcePresence(): void {
		const message: AnnouncementMessage = {
			...this.deviceInfo,
			announce: true
		}

		const buffer = Buffer.from(JSON.stringify(message))
		this.socket.send(
			buffer,
			0,
			buffer.length,
			DEFAULT_CONFIG.MULTICAST_PORT,
			DEFAULT_CONFIG.MULTICAST_ADDRESS
		)
	}

	/**
	 * Respond to an announcement from another device
	 */
	private respondToAnnouncement(device: AnnouncementMessage, ipAddress: string): void {
		// You can implement both HTTP response and UDP fallback response here
		// For the fallback UDP response:
		const responseMessage: AnnouncementMessage = {
			...this.deviceInfo,
			announce: false
		}

		const buffer = Buffer.from(JSON.stringify(responseMessage))
		this.socket.send(
			buffer,
			0,
			buffer.length,
			DEFAULT_CONFIG.MULTICAST_PORT,
			DEFAULT_CONFIG.MULTICAST_ADDRESS
		)
	}

	/**
	 * Set callback for when a new device is discovered
	 */
	onDeviceDiscovered(callback: (device: DeviceInfo) => void): void {
		this.onDeviceDiscoveredCallback = callback
	}

	/**
	 * Get all known devices
	 */
	getKnownDevices(): DeviceInfo[] {
		return Array.from(this.knownDevices.values())
	}

	/**
	 * Stop discovery
	 */
	stop(): void {
		this.socket.close()
	}
}

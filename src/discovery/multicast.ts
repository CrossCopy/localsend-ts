import { createSocket } from "node:dgram"
import type { RemoteInfo } from "node:dgram"
import { networkInterfaces } from "node:os"
import type { AnnouncementMessage, DeviceInfo } from "../types.ts"
import { DEFAULT_CONFIG } from "../config.ts"
import { LocalSendClient } from "../api/client.ts"
import type { Discovery } from "./types.ts"
import { Buffer } from "node:buffer"

const ANNOUNCE_DELAYS_MS = [100, 500, 2000]
const DEBUG_DISCOVERY = process.env.LOCALSEND_DEBUG_DISCOVERY === "1"

function getInterfaceAddresses(): string[] {
	const interfaces = networkInterfaces()
	const addresses: string[] = []

	for (const networkInterface of Object.values(interfaces)) {
		if (!networkInterface) {
			continue
		}

		for (const address of networkInterface) {
			const isIpv4 = address.family === "IPv4" || address.family === 4
			if (isIpv4 && !address.internal) {
				addresses.push(address.address)
			}
		}
	}

	return addresses
}
export class MulticastDiscovery implements Discovery {
	private socket
	private knownDevices: Map<string, DeviceInfo> = new Map()
	private onDeviceDiscoveredCallback?: (device: DeviceInfo) => void
	private client: LocalSendClient
	private interfaceAddresses: string[]

	constructor(private deviceInfo: DeviceInfo) {
		this.socket = createSocket({ type: "udp4", reuseAddr: true })
		this.client = new LocalSendClient(deviceInfo)
		this.interfaceAddresses = getInterfaceAddresses()
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

					const device = this.normalizeAnnouncement(data, rinfo)
					const isAnnouncement = this.isAnnouncementMessage(data)
					if (DEBUG_DISCOVERY) {
						console.log(
							"[DISCOVER/UDP] Message",
							JSON.stringify({
								from: rinfo.address,
								port: rinfo.port,
								announce: isAnnouncement,
								alias: device.alias,
								fingerprint: device.fingerprint
							})
						)
					}

					// Handle announcement
					if (isAnnouncement) {
						// Respond to announcement
						void this.respondToAnnouncement(device)
					}

					// Store device in known devices
					this.knownDevices.set(device.fingerprint, device)

					// Notify new device
					if (this.onDeviceDiscoveredCallback) {
						this.onDeviceDiscoveredCallback(device)
					}
				} catch (err) {
					console.error("Error parsing announcement message:", err)
				}
			})

			// Bind socket to the multicast port
			this.socket.bind(
				{
					port: DEFAULT_CONFIG.MULTICAST_PORT,
					address: "0.0.0.0",
					exclusive: false
				},
				() => {
					if (DEBUG_DISCOVERY) {
						console.log("[DISCOVER/UDP] Binding multicast socket", {
							port: DEFAULT_CONFIG.MULTICAST_PORT,
							addresses: this.interfaceAddresses
						})
					}
					// Join multicast group for each interface
					if (this.interfaceAddresses.length === 0) {
						try {
							this.socket.addMembership(DEFAULT_CONFIG.MULTICAST_ADDRESS)
							if (DEBUG_DISCOVERY) {
								console.log("[DISCOVER/UDP] Joined multicast group (default interface)")
							}
						} catch (err) {
							console.warn("Failed to join multicast group:", err)
						}
					} else {
						for (const address of this.interfaceAddresses) {
							try {
								this.socket.addMembership(DEFAULT_CONFIG.MULTICAST_ADDRESS, address)
								if (DEBUG_DISCOVERY) {
									console.log("[DISCOVER/UDP] Joined multicast group", address)
								}
							} catch (err) {
								console.warn("Failed to join multicast group for interface:", address, err)
							}
						}
					}
					resolve()
				}
			)
		})
	}

	/**
	 * Announce device presence to the local network
	 */
	announcePresence(): void {
		void this.sendAnnouncement()
	}

	/**
	 * Respond to an announcement from another device
	 */
	private async respondToAnnouncement(device: DeviceInfo): Promise<void> {
		if (DEBUG_DISCOVERY) {
			console.log("[DISCOVER/UDP] Responding to announcement from", {
				alias: device.alias,
				ip: device.ip,
				port: device.port,
				protocol: device.protocol
			})
		}
		if (device.ip) {
			const registeredDevice = await this.client.register({
				ip: device.ip,
				port: device.port,
				protocol: device.protocol
			})

			if (registeredDevice) {
				if (DEBUG_DISCOVERY) {
					console.log("[DISCOVER/HTTP] Register response received from", {
						alias: registeredDevice.alias,
						fingerprint: registeredDevice.fingerprint
					})
				}
				return
			}
		}

		if (DEBUG_DISCOVERY) {
			console.log("[DISCOVER/UDP] HTTP register failed, falling back to UDP response")
		}
		await this.sendUdpMessage(this.buildAnnouncementMessage(false))
	}

	private buildAnnouncementMessage(announce: boolean): AnnouncementMessage {
		return {
			...this.deviceInfo,
			announce,
			announcement: announce
		}
	}

	private isAnnouncementMessage(message: AnnouncementMessage): boolean {
		if (typeof message.announce === "boolean") {
			return message.announce
		}
		if (typeof message.announcement === "boolean") {
			return message.announcement
		}
		return false
	}

	private normalizeAnnouncement(message: AnnouncementMessage, rinfo: RemoteInfo): DeviceInfo {
		const protocol = message.protocol ?? this.deviceInfo.protocol
		const port = message.port ?? this.deviceInfo.port

		return {
			alias: message.alias,
			version: message.version ?? DEFAULT_CONFIG.PROTOCOL_VERSION,
			deviceModel: message.deviceModel ?? null,
			deviceType: message.deviceType ?? null,
			fingerprint: message.fingerprint,
			port,
			protocol,
			download: message.download ?? false,
			ip: rinfo.address
		}
	}

	private async sendAnnouncement(): Promise<void> {
		const message = this.buildAnnouncementMessage(true)
		for (const delay of ANNOUNCE_DELAYS_MS) {
			await new Promise((resolve) => setTimeout(resolve, delay))
			if (DEBUG_DISCOVERY) {
				console.log("[DISCOVER/UDP] Sending announcement", {
					alias: message.alias,
					port: message.port,
					protocol: message.protocol
				})
			}
			await this.sendUdpMessage(message)
		}
	}

	private async sendUdpMessage(message: AnnouncementMessage): Promise<void> {
		const buffer = Buffer.from(JSON.stringify(message))

		if (this.interfaceAddresses.length === 0) {
			this.socket.send(
				buffer,
				0,
				buffer.length,
				DEFAULT_CONFIG.MULTICAST_PORT,
				DEFAULT_CONFIG.MULTICAST_ADDRESS
			)
			if (DEBUG_DISCOVERY) {
				console.log("[DISCOVER/UDP] Sent multicast message (default interface)")
			}
			return
		}

		for (const address of this.interfaceAddresses) {
			try {
				this.socket.setMulticastInterface(address)
				this.socket.send(
					buffer,
					0,
					buffer.length,
					DEFAULT_CONFIG.MULTICAST_PORT,
					DEFAULT_CONFIG.MULTICAST_ADDRESS
				)
				if (DEBUG_DISCOVERY) {
					console.log("[DISCOVER/UDP] Sent multicast message", address)
				}
			} catch (err) {
				console.warn("Failed to send multicast message on interface:", address, err)
			}
		}
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

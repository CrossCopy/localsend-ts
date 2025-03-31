import type { DeviceInfo } from "../types.ts"
import { LocalSendClient } from "../api/client.ts"
import { networkInterfaces } from "node:os"
import type { Discovery } from "./types.ts"

/**
 * HttpDiscovery is used to discover devices in the network using the HTTP method
 * when multicast fails or is not available.
 */
export class HttpDiscovery implements Discovery {
	private knownDevices: Map<string, DeviceInfo> = new Map()
	private onDeviceDiscoveredCallback?: (device: DeviceInfo) => void
	private client: LocalSendClient
	private isScanning = false
	private scanInterval?: NodeJS.Timeout

	constructor(private deviceInfo: DeviceInfo) {
		this.client = new LocalSendClient(deviceInfo)
	}

	async start(): Promise<void> {
		// Start periodic scanning
		this.scanInterval = setInterval(() => {
			this.startScan().catch(console.error)
		}, 30000) // Every 30 seconds

		// First scan immediately
		await this.startScan()
	}

	stop(): void {
		if (this.scanInterval) {
			clearInterval(this.scanInterval)
			this.scanInterval = undefined
		}
	}

	/**
	 * Start scanning for devices in the network
	 */
	async startScan(): Promise<void> {
		if (this.isScanning) {
			return
		}

		this.isScanning = true

		try {
			// Get all local IP addresses to scan the network
			const localIps = this.getLocalIpAddresses()

			// Generate IP addresses in the same subnet
			const targetIps = this.generateTargetIps(localIps)

			// Scan all targets concurrently
			const promises = targetIps.map((ip) => this.scanTarget(ip))

			// Wait for all promises to settle
			await Promise.allSettled(promises)
		} catch (err) {
			console.error("Error during HTTP discovery:", err)
		} finally {
			this.isScanning = false
		}
	}

	/**
	 * Check if a host is up by attempting a quick connection with timeout
	 */
	private async isHostUp(ip: string, port: number): Promise<boolean> {
		try {
			const controller = new AbortController()
			const timeoutId = setTimeout(() => controller.abort(), 500) // 500ms timeout

			const response = await fetch(`http://${ip}:${port}/api/localsend/v2/info`, {
				method: "HEAD",
				signal: controller.signal
			})

			clearTimeout(timeoutId)
			return response.ok
		} catch (err) {
			return false // Any error means the host is not reachable
		}
	}

	/**
	 * Scan a single target IP address
	 */
	private async scanTarget(ip: string): Promise<void> {
		try {
			// First check if the host is up before attempting to register
			const isUp = await this.isHostUp(ip, this.deviceInfo.port)

			if (!isUp) {
				return // Skip registration attempt if host is not up
			}

			const device = await this.client.register({
				ip,
				port: this.deviceInfo.port
			})

			if (device) {
				// Ignore self
				if (device.fingerprint === this.deviceInfo.fingerprint) {
					return
				}

				// Add to known devices
				this.knownDevices.set(device.fingerprint, device)

				// Notify new device
				if (this.onDeviceDiscoveredCallback) {
					this.onDeviceDiscoveredCallback(device)
				}
			}
		} catch (err) {
			// Ignore errors - just means the device is not available
		}
	}

	/**
	 * Get all local IP addresses
	 */
	private getLocalIpAddresses(): string[] {
		const interfaces = networkInterfaces()
		const ips: string[] = []

		for (const networkInterface of Object.values(interfaces)) {
			if (networkInterface) {
				for (const address of networkInterface) {
					// Only use IPv4 addresses
					if (address.family === "IPv4" && !address.internal) {
						ips.push(address.address)
					}
				}
			}
		}

		return ips
	}

	/**
	 * Generate target IP addresses from local IP addresses
	 */
	private generateTargetIps(localIps: string[]): string[] {
		const targets: string[] = []

		for (const localIp of localIps) {
			// Get the network prefix (first 3 octets)
			const parts = localIp.split(".")
			if (parts.length === 4) {
				const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`

				// Generate IPs in the same subnet (1-254)
				for (let i = 1; i <= 254; i++) {
					const targetIp = `${prefix}.${i}`
					// Don't scan our own IP
					if (targetIp !== localIp) {
						targets.push(targetIp)
					}
				}
			}
		}

		return targets
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
}

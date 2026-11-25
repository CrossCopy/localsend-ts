import type { DeviceInfo } from "../types.ts"
import { networkInterfaces } from "node:os"
import type { Discovery } from "./types.ts"
import { Agent } from "undici"
import { DEFAULT_CONFIG } from "../config.ts"

export type ScanOutcome = {
	devices: DeviceInfo[]
	complete: boolean
}

/**
 * HttpDiscovery is used to discover devices in the network using the HTTP method
 * when multicast fails or is not available.
 */
export class HttpDiscovery implements Discovery {
	private knownDevices: Map<string, DeviceInfo> = new Map()
	private onDeviceDiscoveredCallback?: (device: DeviceInfo) => void
	private isScanning = false
	private scanInterval?: NodeJS.Timeout
	private scanPort: number
	private allowInsecureTls =
		process.env.LOCALSEND_INSECURE_TLS === undefined
			? true
			: process.env.LOCALSEND_INSECURE_TLS === "1"

	constructor(
		private deviceInfo: DeviceInfo,
		options: { scanPort?: number } = {}
	) {
		this.scanPort = options.scanPort ?? DEFAULT_CONFIG.MULTICAST_PORT
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

			// Scan all targets with a concurrency limit
			await this.runWithConcurrency(
				targetIps.map((ip) => () => this.scanTarget(ip)),
				50
			)
		} catch (err) {
			console.error("Error during HTTP discovery:", err)
		} finally {
			this.isScanning = false
		}
	}

	/**
	 * Probe a single known peer at its own IP and port (liveness check).
	 */
	async probePeer(ip: string, port: number, signal?: AbortSignal): Promise<DeviceInfo | null> {
		const device = await this.fetchDeviceInfo(ip, port, signal)
		if (!device || device.fingerprint === this.deviceInfo.fingerprint) {
			return null
		}
		return { ...device, ip, port }
	}

	/**
	 * Scan a list of target IPs with an optional overall deadline.
	 * Keeps any devices discovered before the deadline expires and reports
	 * whether the full sweep completed.
	 */
	async scanWithin(targets: string[], withinMs?: number): Promise<ScanOutcome> {
		const controller = new AbortController()
		let complete = true
		let timer: NodeJS.Timeout | undefined
		if (withinMs !== undefined) {
			timer = setTimeout(() => {
				complete = false
				controller.abort()
			}, withinMs)
		}

		const discovered: DeviceInfo[] = []
		try {
			await this.runWithConcurrency(
				targets.map((ip) => async () => {
					if (controller.signal.aborted) return
					const device = await this.probePeer(ip, this.scanPort, controller.signal)
					if (device) {
						discovered.push(device)
						this.knownDevices.set(device.fingerprint, device)
						this.onDeviceDiscoveredCallback?.(device)
					}
				}),
				50
			)
		} finally {
			if (timer) clearTimeout(timer)
		}

		const seen = new Set<string>()
		const deduped: DeviceInfo[] = []
		for (const d of discovered) {
			if (!seen.has(d.fingerprint)) {
				seen.add(d.fingerprint)
				deduped.push(d)
			}
		}
		return { devices: deduped, complete }
	}

	/**
	 * Scan a single target IP address
	 */
	private async scanTarget(ip: string): Promise<void> {
		try {
			const discoveredDevice = await this.probePeer(ip, this.scanPort)
			if (!discoveredDevice) {
				return
			}

			// Add to known devices
			this.knownDevices.set(discoveredDevice.fingerprint, discoveredDevice)

			// Notify new device
			if (this.onDeviceDiscoveredCallback) {
				this.onDeviceDiscoveredCallback(discoveredDevice)
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
					const isIpv4 = address.family === "IPv4"
					// Only use IPv4 addresses
					if (isIpv4 && !address.internal) {
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

	private async fetchDeviceInfo(
		ip: string,
		port: number = this.scanPort,
		signal?: AbortSignal
	): Promise<DeviceInfo | null> {
		const protocols = this.getProtocolCandidates()
		for (const protocol of protocols) {
			if (signal?.aborted) return null
			const result = await this.fetchDeviceInfoWithProtocol(ip, port, protocol, signal)
			if (result) {
				return {
					...result,
					protocol
				}
			}
		}

		return null
	}

	private async runWithConcurrency(
		tasks: Array<() => Promise<void>>,
		limit: number
	): Promise<void> {
		let index = 0
		const workers = Array.from({ length: limit }, async () => {
			while (index < tasks.length) {
				const current = index++
				const task = tasks[current]
				if (task) {
					await task()
				}
			}
		})

		await Promise.all(workers)
	}

	private getProtocolCandidates(): Array<"http" | "https"> {
		const preferred = this.deviceInfo.protocol || "http"
		if (preferred === "https") {
			return ["https", "http"]
		}
		return ["http", "https"]
	}

	private async fetchDeviceInfoWithProtocol(
		ip: string,
		port: number,
		protocol: "http" | "https",
		outerSignal?: AbortSignal
	): Promise<DeviceInfo | null> {
		try {
			const controller = new AbortController()
			const onOuterAbort = () => controller.abort()
			if (outerSignal) {
				if (outerSignal.aborted) return null
				outerSignal.addEventListener("abort", onOuterAbort, { once: true })
			}
			const timeoutId = setTimeout(() => controller.abort(), 1000)
			const url = `${protocol}://${ip}:${port}/api/localsend/v2/info`
			const options: any = {
				method: "GET",
				signal: controller.signal
			}

			if (protocol === "https" && this.allowInsecureTls) {
				const isBun = typeof (globalThis as any).Bun !== "undefined"
				if (isBun) {
					options.tls = { rejectUnauthorized: false }
				} else {
					try {
						options.dispatcher = new Agent({ connect: { rejectUnauthorized: false } })
					} catch {
						// Ignore if undici isn't available; fetch will use default TLS settings.
					}
				}
			}

			const response = await fetch(url, options)

			clearTimeout(timeoutId)
			outerSignal?.removeEventListener("abort", onOuterAbort)

			if (!response.ok) {
				return null
			}

			const data = (await response.json()) as DeviceInfo
			return {
				...data,
				port: data.port ?? port,
				protocol
			}
		} catch (err) {
			return null
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
}

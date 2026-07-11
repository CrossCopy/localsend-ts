import { Hono } from "hono"
import type { ServerAdapter } from "./adapters/index.ts"
import { createServerAdapter } from "./adapters/index.ts"
import { createLocalSendRoutes, type LocalSendContext } from "./routes.ts"
import type { DeviceInfo, FileMetadata } from "../types.ts"
import { UploadSessionStore } from "../core/sessions.ts"
import fs from "node:fs"

export type TransferRequestHandler = (
	senderInfo: DeviceInfo,
	files: Record<string, FileMetadata>
) => Promise<boolean>

export type TransferProgressHandler = (
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
) => Promise<void>

export class LocalSendServer {
	public app!: Hono
	private server: unknown = null
	private serverAdapter: ServerAdapter
	private uploads: UploadSessionStore = new UploadSessionStore()
	private deviceInfo: DeviceInfo
	private saveDirectory: string
	private requirePin: boolean = false
	private pin: string = ""
	private transferRequestHandler: TransferRequestHandler | null = null
	private transferProgressHandler: TransferProgressHandler | null = null
	private onRegisterCallback: ((device: DeviceInfo) => void) | null = null
	private maxRequestBodySize: number = 5 * 1024 * 1024 * 1024

	constructor(
		deviceInfo: DeviceInfo,
		options: {
			saveDirectory?: string
			pin?: string
			serverAdapter?: ServerAdapter
			onTransferRequest?: TransferRequestHandler
			onTransferProgress?: TransferProgressHandler
			onRegister?: (device: DeviceInfo) => void
			maxRequestBodySize?: number
			protocol?: "http" | "https"
		} = {}
	) {
		this.deviceInfo = options.protocol ? { ...deviceInfo, protocol: options.protocol } : deviceInfo
		this.saveDirectory = options.saveDirectory || "./received_files"
		this.pin = options.pin || ""
		this.requirePin = !!this.pin
		this.transferRequestHandler = options.onTransferRequest || null
		this.transferProgressHandler = options.onTransferProgress || null
		this.onRegisterCallback = options.onRegister || null
		this.maxRequestBodySize = options.maxRequestBodySize || this.maxRequestBodySize

		this.serverAdapter = options.serverAdapter || createServerAdapter()

		if (!fs.existsSync(this.saveDirectory)) {
			fs.mkdirSync(this.saveDirectory, { recursive: true })
		}

		this.registerRoutes()
	}

	private registerRoutes() {
		const ctx: LocalSendContext = {
			deviceInfo: this.deviceInfo,
			saveDirectory: this.saveDirectory,
			requirePin: this.requirePin,
			pin: this.pin,
			transferRequestHandler: this.transferRequestHandler || undefined,
			transferProgressHandler: this.transferProgressHandler || undefined,
			onRegisterCallback: this.onRegisterCallback || undefined,
			maxRequestBodySize: this.maxRequestBodySize,
			uploads: this.uploads,
			getRemoteAddress: this.getRemoteAddress.bind(this),
			normalizeRemoteAddress: this.normalizeRemoteAddress.bind(this)
		}

		this.app = createLocalSendRoutes(ctx)
	}

	private getRemoteAddress(c: any): string | null {
		const forwardedFor = c.req?.header?.("x-forwarded-for")
		if (forwardedFor) {
			return forwardedFor.split(",")[0]?.trim() || null
		}

		const raw = c.req?.raw
		const socketAddress = raw?.socket?.remoteAddress
		if (socketAddress) {
			return this.normalizeRemoteAddress(socketAddress)
		}

		const server = this.server as any
		if (server && typeof server.requestIP === "function" && raw) {
			const addr = server.requestIP(raw)
			if (addr && typeof addr.address === "string") {
				return addr.address
			}
		}

		return null
	}

	private normalizeRemoteAddress(address?: string | null): string | null {
		if (!address) {
			return null
		}

		if (address.startsWith("::ffff:")) {
			return address.slice("::ffff:".length)
		}

		return address
	}

	async start(): Promise<void> {
		try {
			this.server = await this.serverAdapter.start({
				port: this.deviceInfo.port,
				fetch: this.app.fetch,
				maxRequestBodySize: this.maxRequestBodySize
			})

			const sizeInGB = Math.round(this.maxRequestBodySize / (1024 * 1024 * 1024))
			console.log(`LocalSend server started on port ${this.deviceInfo.port}`)
			console.log(`Maximum request body size: ${sizeInGB} GB`)
			console.log(`API documentation available at http://localhost:${this.deviceInfo.port}/docs`)
		} catch (error) {
			console.error("Failed to start server:", error)
			throw error
		}
	}

	async stop(): Promise<void> {
		if (this.server) {
			await this.serverAdapter.stop(this.server)
			this.server = null
		}
	}
}

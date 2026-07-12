import { Hono } from "hono"
import type { ServerAdapter } from "./adapters/index.ts"
import { createServerAdapter } from "./adapters/index.ts"
import { createLocalSendRoutes, type LocalSendContext } from "./routes.ts"
import type { DeviceInfo, FileMetadata } from "../protocol/types.ts"
import { UploadSessionStore, DownloadSessionStore } from "../core/sessions.ts"
import { stageFile, type StagedFile } from "../core/files.ts"
import { generateSelfSignedCert, certFingerprintSha256 } from "../crypto/cert.ts"
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
	private _deviceInfo: DeviceInfo
	private saveDirectory: string
	private requirePin: boolean = false
	private pin: string = ""
	private transferRequestHandler: TransferRequestHandler | null = null
	private transferProgressHandler: TransferProgressHandler | null = null
	private onRegisterCallback: ((device: DeviceInfo) => void) | null = null
	private maxRequestBodySize: number = 5 * 1024 * 1024 * 1024
	private sharedFilePaths: string[] = []
	private sharedFiles: StagedFile[] = []
	private downloads = new DownloadSessionStore()
	private tls?: { cert: string; key: string }
	private requestedProtocol?: "http" | "https"

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
			sharedFiles?: string[]
			tls?: { cert: string; key: string }
		} = {}
	) {
		this._deviceInfo = deviceInfo
		if (options.protocol) this._deviceInfo.protocol = options.protocol
		this.saveDirectory = options.saveDirectory || "./received_files"
		this.pin = options.pin || ""
		this.requirePin = !!this.pin
		this.transferRequestHandler = options.onTransferRequest || null
		this.transferProgressHandler = options.onTransferProgress || null
		this.onRegisterCallback = options.onRegister || null
		this.maxRequestBodySize = options.maxRequestBodySize || this.maxRequestBodySize
		this.sharedFilePaths = options.sharedFiles ?? []
		this.requestedProtocol = options.protocol
		this.tls = options.tls

		this.serverAdapter = options.serverAdapter || createServerAdapter()

		if (!fs.existsSync(this.saveDirectory)) {
			fs.mkdirSync(this.saveDirectory, { recursive: true })
		}

		this.registerRoutes()
	}

	get deviceInfo(): DeviceInfo {
		return this._deviceInfo
	}

	get tlsCert(): string | undefined {
		return this.tls?.cert
	}

	private registerRoutes() {
		const ctx: LocalSendContext = {
			deviceInfo: this._deviceInfo,
			saveDirectory: this.saveDirectory,
			requirePin: this.requirePin,
			pin: this.pin,
			transferRequestHandler: this.transferRequestHandler || undefined,
			transferProgressHandler: this.transferProgressHandler || undefined,
			onRegisterCallback: this.onRegisterCallback || undefined,
			maxRequestBodySize: this.maxRequestBodySize,
			uploads: this.uploads,
			sharedFiles: this.sharedFiles,
			downloads: this.downloads,
			getRemoteAddress: this.getRemoteAddress.bind(this)
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
			if (this.sharedFilePaths.length > 0) {
				this.sharedFiles = await Promise.all(this.sharedFilePaths.map(stageFile))
				this._deviceInfo.download = true
				this.registerRoutes()
			}

			const wantsHttps = this._deviceInfo.protocol === "https" || this.requestedProtocol === "https"
			if (wantsHttps) {
				if (!this.tls) {
					this.tls = generateSelfSignedCert()
				}
				this._deviceInfo.protocol = "https"
				this._deviceInfo.fingerprint = certFingerprintSha256(this.tls.cert)
			}

			this.server = await this.serverAdapter.start({
				port: this._deviceInfo.port,
				fetch: this.app.fetch,
				maxRequestBodySize: this.maxRequestBodySize,
				tls: wantsHttps ? this.tls : undefined
			})

			const sizeInGB = Math.round(this.maxRequestBodySize / (1024 * 1024 * 1024))
			console.log(`LocalSend server started on port ${this._deviceInfo.port}`)
			console.log(`Maximum request body size: ${sizeInGB} GB`)
			console.log(`API documentation available at http://localhost:${this._deviceInfo.port}/docs`)
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

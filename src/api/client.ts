import { Buffer } from "node:buffer"
import type { DeviceInfo, PrepareUploadResponse, FileMetadata } from "../types.ts"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"

export class LocalSendClient {
	private progressCallback:
		| ((bytesUploaded: number, totalBytes: number, finished: boolean) => void)
		| null = null
	private allowInsecureTls =
		process.env.LOCALSEND_INSECURE_TLS === undefined
			? true
			: process.env.LOCALSEND_INSECURE_TLS === "1"

	constructor(private deviceInfo: DeviceInfo) {
		// Client will be created on-demand when making requests
	}

	/**
	 * Set a callback to track upload progress
	 */
	setProgressCallback(
		callback: (bytesUploaded: number, totalBytes: number, finished: boolean) => void
	): void {
		this.progressCallback = callback
	}

	/**
	 * Register with another device (discovery)
	 */
	async register(targetDevice: {
		ip: string
		port: number
		protocol?: "http" | "https"
	}): Promise<DeviceInfo | null> {
		try {
			const device = await this.requestJson<DeviceInfo>(targetDevice, "/api/localsend/v2/register", {
				method: "POST",
				body: {
					...this.deviceInfo,
					deviceModel: this.deviceInfo.deviceModel || "",
					deviceType: this.deviceInfo.deviceType || "desktop"
				}
			})

			return this.normalizeDeviceInfo(device, targetDevice)
		} catch (err) {
			console.error("Error registering with device:", err)
			return null
		}
	}

	/**
	 * Prepare file upload by sending metadata to receiver
	 */
	async prepareUpload(
		targetDevice: { ip: string; port: number; protocol: "http" | "https" },
		files: Record<string, FileMetadata>,
		pin?: string
	): Promise<PrepareUploadResponse | null> {
		try {
			// Ensure the data conforms to the expected types
			const deviceInfo = {
				...this.deviceInfo,
				deviceModel: this.deviceInfo.deviceModel || "",
				deviceType: this.deviceInfo.deviceType || ("desktop" as const)
			}

			// Convert files object to format expected by SDK
			// by removing null values (replacing with undefined)
			const convertedFiles: Record<string, any> = {}

			Object.entries(files).forEach(([key, file]) => {
				convertedFiles[key] = {
					id: file.id,
					fileName: file.fileName,
					size: file.size,
					fileType: file.fileType,
					sha256: file.sha256 === null ? undefined : file.sha256,
					preview: file.preview === null ? undefined : file.preview,
					metadata:
						file.metadata === null
							? undefined
							: {
									modified: file.metadata?.modified === null ? undefined : file.metadata?.modified,
									accessed: file.metadata?.accessed === null ? undefined : file.metadata?.accessed
								}
				}
			})

			const result = await this.requestWithStatus<PrepareUploadResponse>(
				targetDevice,
				"/api/localsend/v2/prepare-upload",
				{
					method: "POST",
					body: {
						info: deviceInfo,
						files: convertedFiles
					},
					query: pin ? { pin } : undefined
				}
			)

			if (!result) {
				return null
			}

			if (result.status === 204) {
				return {
					sessionId: "",
					files: {}
				}
			}

			return result.data
		} catch (err) {
			console.error("Error preparing upload:", err)
			return null
		}
	}

	/**
	 * Upload a file to the receiver
	 */
	async uploadFile(
		targetDevice: { ip: string; port: number; protocol: "http" | "https" },
		sessionId: string,
		fileId: string,
		fileToken: string,
		filePath: string
	): Promise<boolean> {
		try {
			// Get file size
			const stats = await stat(filePath)

			// Create base URL for upload
			const baseUrl = `${targetDevice.protocol}://${targetDevice.ip}:${targetDevice.port}/api/localsend/v2/upload?sessionId=${sessionId}&fileId=${fileId}&token=${fileToken}`

			// Initialize progress tracking
			let totalBytesUploaded = 0

			// For large files (>50MB), split into chunks
			if (stats.size > 50 * 1024 * 1024) {
				console.log(
					`File is large (${(stats.size / (1024 * 1024)).toFixed(2)} MB), uploading in chunks...`
				)

				// Set chunk size to 10MB
				const CHUNK_SIZE = 10 * 1024 * 1024 // 10MB chunks
				let offset = 0
				let success = true

				while (offset < stats.size) {
					const end = Math.min(offset + CHUNK_SIZE, stats.size)
					const chunkSize = end - offset

					if (this.progressCallback) {
						this.progressCallback(totalBytesUploaded, stats.size, false)
					}

					console.log(
						`Uploading chunk: ${(offset / (1024 * 1024)).toFixed(2)} - ${(end / (1024 * 1024)).toFixed(2)} MB`
					)

					// Create a read stream for just this chunk
					const fileStream = createReadStream(filePath, { start: offset, end: end - 1 })

					// Read the chunk into a buffer
					const chunks: Uint8Array[] = []
					for await (const chunk of fileStream) {
						chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk))
					}

					const blob = new Blob(chunks)

					// Upload the chunk
					const fetchOptions: any = {
						method: "POST",
						headers: {
							"Content-Length": chunkSize.toString(),
							"X-Content-Range": `bytes ${offset}-${end - 1}/${stats.size}`
						},
						body: blob
					}
					this.applyTlsOptions(fetchOptions, targetDevice.protocol)
					const response = await fetch(baseUrl, fetchOptions)

					if (!response.ok) {
						console.error(
							`Failed to upload chunk: ${offset}-${end - 1}, Status: ${response.status}`
						)
						success = false
						break
					}

					// Update progress
					totalBytesUploaded += chunkSize
					if (this.progressCallback) {
						this.progressCallback(totalBytesUploaded, stats.size, offset + chunkSize >= stats.size)
					}

					offset = end
				}

				return success
			} else {
				// For smaller files, use a single request
				const fileStream = createReadStream(filePath)
				const chunks: Uint8Array[] = []
				for await (const chunk of fileStream) {
					chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk))
				}

				const blob = new Blob(chunks)

				// Call progress callback before upload
				if (this.progressCallback) {
					this.progressCallback(0, stats.size, false)
				}

				const fetchOptions: any = {
					method: "POST",
					headers: {
						"Content-Length": stats.size.toString()
					},
					body: blob
				}
				this.applyTlsOptions(fetchOptions, targetDevice.protocol)
				const response = await fetch(baseUrl, fetchOptions)

				// Call progress callback after upload
				if (this.progressCallback) {
					this.progressCallback(stats.size, stats.size, true)
				}

				return response.ok
			}
		} catch (err) {
			console.error("Error uploading file:", err)
			return false
		}
	}

	/**
	 * Cancel an ongoing session
	 */
	async cancelSession(
		targetDevice: { ip: string; port: number; protocol: "http" | "https" },
		sessionId: string
	): Promise<boolean> {
		try {
			const response = await this.requestJson<unknown>(
				targetDevice,
				"/api/localsend/v2/cancel",
				{
					method: "POST",
					query: {
						sessionId
					},
					expectJson: false
				}
			)

			return response !== null
		} catch (err) {
			console.error("Error canceling session:", err)
			return false
		}
	}

	/**
	 * Get information about a device
	 */
	async getDeviceInfo(targetDevice: {
		ip: string
		port: number
		protocol?: "http" | "https"
	}): Promise<DeviceInfo | null> {
		try {
			const candidates = this.getProtocolCandidates(targetDevice.protocol)
			for (const protocol of candidates) {
				const device = await this.requestJson<DeviceInfo>(
					{
						...targetDevice,
						protocol
					},
					"/api/localsend/v2/info",
					{
						method: "GET"
					}
				)

				const normalized = this.normalizeDeviceInfo(device, {
					...targetDevice,
					protocol
				})
				if (normalized) {
					return normalized
				}
			}

			return null
		} catch (err) {
			console.error("Error getting device info:", err)
			return null
		}
	}

	private getProtocolCandidates(
		preferred?: "http" | "https"
	): Array<"http" | "https"> {
		if (preferred === "https") {
			return ["https", "http"]
		}
		if (preferred === "http") {
			return ["http", "https"]
		}
		return ["https", "http"]
	}

	private normalizeDeviceInfo(
		device: DeviceInfo | null,
		targetDevice: { port: number; protocol?: "http" | "https" }
	): DeviceInfo | null {
		if (!device) {
			return null
		}

		return {
			...device,
			port: device.port ?? targetDevice.port,
			protocol: device.protocol ?? targetDevice.protocol ?? "http"
		}
	}

	private async requestJson<T>(
		targetDevice: { ip: string; port: number; protocol?: "http" | "https" },
		path: string,
		options: {
			method: "GET" | "POST"
			body?: unknown
			query?: Record<string, string>
			expectJson?: boolean
		}
	): Promise<T | null> {
		const protocol = targetDevice.protocol || this.deviceInfo.protocol || "http"
		const url = new URL(`${protocol}://${targetDevice.ip}:${targetDevice.port}${path}`)
		if (options.query) {
			for (const [key, value] of Object.entries(options.query)) {
				if (value !== undefined && value !== null) {
					url.searchParams.set(key, value)
				}
			}
		}

		const fetchOptions: any = {
			method: options.method,
			headers: {
				"Content-Type": "application/json"
			}
		}

		if (options.body !== undefined) {
			fetchOptions.body = JSON.stringify(options.body)
		}

		this.applyTlsOptions(fetchOptions, protocol)

		const response = await fetch(url.toString(), fetchOptions)

		if (!response.ok) {
			return null
		}

		if (options.expectJson === false) {
			return {} as T
		}

		return (await response.json()) as T
	}

	private async requestWithStatus<T>(
		targetDevice: { ip: string; port: number; protocol?: "http" | "https" },
		path: string,
		options: {
			method: "GET" | "POST"
			body?: unknown
			query?: Record<string, string>
		}
	): Promise<{ status: number; data: T | null } | null> {
		const protocol = targetDevice.protocol || this.deviceInfo.protocol || "http"
		const url = new URL(`${protocol}://${targetDevice.ip}:${targetDevice.port}${path}`)
		if (options.query) {
			for (const [key, value] of Object.entries(options.query)) {
				if (value !== undefined && value !== null) {
					url.searchParams.set(key, value)
				}
			}
		}

		const fetchOptions: any = {
			method: options.method,
			headers: {
				"Content-Type": "application/json"
			}
		}

		if (options.body !== undefined) {
			fetchOptions.body = JSON.stringify(options.body)
		}

		this.applyTlsOptions(fetchOptions, protocol)

		const response = await fetch(url.toString(), fetchOptions)
		if (!response.ok) {
			return null
		}

		if (response.status === 204) {
			return { status: response.status, data: null }
		}

		const contentType = response.headers.get("content-type") || ""
		if (!contentType.includes("application/json")) {
			return { status: response.status, data: null }
		}

		const data = (await response.json()) as T
		return { status: response.status, data }
	}

	private applyTlsOptions(options: any, protocol: "http" | "https"): void {
		if (protocol !== "https" || !this.allowInsecureTls) {
			return
		}

		const isBun = typeof (globalThis as any).Bun !== "undefined"
		if (isBun) {
			options.tls = { rejectUnauthorized: false }
			return
		}

		try {
			const { Agent } = require("undici")
			options.dispatcher = new Agent({ connect: { rejectUnauthorized: false } })
		} catch {
			// Ignore if undici is not available.
		}
	}
}

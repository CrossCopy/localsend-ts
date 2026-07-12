import type {
	DeviceInfo,
	PrepareUploadResponse,
	PrepareDownloadResponse,
	FileMetadata
} from "../protocol/types.ts"
import { createReadStream } from "node:fs"
import { stat, unlink } from "node:fs/promises"
import { Readable } from "node:stream"

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
			const device = await this.requestJson<DeviceInfo>(
				targetDevice,
				"/api/localsend/v2/register",
				{
					method: "POST",
					body: {
						...this.deviceInfo,
						deviceModel: this.deviceInfo.deviceModel || "",
						deviceType: this.deviceInfo.deviceType || "desktop"
					}
				}
			)

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
	 * Upload a file to the receiver.
	 *
	 * Sends the entire file as a single POST body, as the LocalSend protocol
	 * requires (no chunking, no non-standard range headers).
	 */
	async uploadFile(
		targetDevice: { ip: string; port: number; protocol: "http" | "https" },
		sessionId: string,
		fileId: string,
		fileToken: string,
		filePath: string
	): Promise<boolean> {
		try {
			const stats = await stat(filePath)
			const url = `${targetDevice.protocol}://${targetDevice.ip}:${targetDevice.port}/api/localsend/v2/upload?sessionId=${sessionId}&fileId=${fileId}&token=${fileToken}`

			if (this.progressCallback) this.progressCallback(0, stats.size, false)

			const fetchOptions: any = {
				method: "POST",
				headers: { "Content-Length": stats.size.toString() }
			}

			// Bun's fetch streams `Bun.file(...)` directly without buffering the
			// whole file in memory, avoiding known issues with web-stream request
			// bodies under Bun's fetch implementation. Other runtimes (Node) use a
			// web ReadableStream built from a Node read stream with duplex: "half".
			const isBun = typeof (globalThis as any).Bun !== "undefined"
			if (isBun) {
				fetchOptions.body = (globalThis as any).Bun.file(filePath)
			} else {
				const nodeStream = createReadStream(filePath)
				const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream
				fetchOptions.body = webStream
				fetchOptions.duplex = "half"
			}

			this.applyTlsOptions(fetchOptions, targetDevice.protocol)
			const response = await fetch(url, fetchOptions)

			if (this.progressCallback) this.progressCallback(stats.size, stats.size, true)
			return response.ok
		} catch (err) {
			console.error("Error uploading file:", err)
			return false
		}
	}

	/**
	 * Prepare file download by requesting session + file metadata from sender
	 */
	async prepareDownload(
		targetDevice: { ip: string; port: number; protocol: "http" | "https" },
		pin?: string
	): Promise<PrepareDownloadResponse | null> {
		try {
			return await this.requestJson<PrepareDownloadResponse>(
				targetDevice,
				"/api/localsend/v2/prepare-download",
				{ method: "POST", query: pin ? { pin } : undefined }
			)
		} catch (err) {
			console.error("Error preparing download:", err)
			return null
		}
	}

	/**
	 * Download a file from the sender, streaming the response body to disk.
	 */
	async download(
		targetDevice: { ip: string; port: number; protocol: "http" | "https" },
		sessionId: string,
		fileId: string,
		outPath: string
	): Promise<boolean> {
		try {
			const { createWriteStream } = await import("node:fs")
			const protocol = targetDevice.protocol || "http"
			const url = `${protocol}://${targetDevice.ip}:${targetDevice.port}/api/localsend/v2/download?sessionId=${sessionId}&fileId=${fileId}`
			const fetchOptions: any = { method: "GET" }
			this.applyTlsOptions(fetchOptions, protocol)
			const res = await fetch(url, fetchOptions)
			if (!res.ok || !res.body) return false

			const out = createWriteStream(outPath)
			const reader = res.body.getReader()
			try {
				await new Promise<void>((resolve, reject) => {
					out.on("error", reject)
					const pump = (): void => {
						reader
							.read()
							.then(({ done, value }) => {
								if (done) {
									out.end()
									return
								}
								if (!out.write(value)) {
									out.once("drain", pump)
								} else {
									pump()
								}
							})
							.catch(reject)
					}
					out.on("finish", () => resolve())
					pump()
				})
			} finally {
				reader.releaseLock()
			}

			return true
		} catch (err) {
			console.error("Error downloading file:", err)
			// Best-effort cleanup: don't leave a partially-written file on disk
			// if the stream errored mid-transfer.
			await unlink(outPath).catch(() => {})
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
			const response = await this.requestJson<unknown>(targetDevice, "/api/localsend/v2/cancel", {
				method: "POST",
				query: {
					sessionId
				},
				expectJson: false
			})

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

	private getProtocolCandidates(preferred?: "http" | "https"): Array<"http" | "https"> {
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

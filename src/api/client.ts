import type {
	DeviceInfo,
	PrepareUploadRequest,
	PrepareUploadResponse,
	FileMetadata
} from "../types.ts"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import {
	getApiLocalsendV2Info,
	postApiLocalsendV2Register,
	postApiLocalsendV2PrepareUpload,
	postApiLocalsendV2Cancel
} from "../sdk/index.ts"
import { type ClientOptions, type Client, createClient, createConfig } from "@hey-api/client-fetch"

export class LocalSendClient {
	private client: Client | null = null
	private progressCallback:
		| ((bytesUploaded: number, totalBytes: number, finished: boolean) => void)
		| null = null

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
	async register(targetDevice: { ip: string; port: number }): Promise<DeviceInfo | null> {
		try {
			const client = this.createClientForTarget(targetDevice)
			const { data } = await postApiLocalsendV2Register({
				client,
				body: {
					...this.deviceInfo,
					deviceModel: this.deviceInfo.deviceModel || "",
					deviceType: this.deviceInfo.deviceType || "desktop"
				}
			})

			return data as DeviceInfo
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
			const client = this.createClientForTarget(targetDevice)

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

			const { data } = await postApiLocalsendV2PrepareUpload({
				client,
				body: {
					info: deviceInfo,
					files: convertedFiles
				},
				query: pin ? { pin } : undefined
			})

			return data as PrepareUploadResponse
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
					const response = await fetch(baseUrl, {
						method: "POST",
						headers: {
							"Content-Length": chunkSize.toString(),
							"X-Content-Range": `bytes ${offset}-${end - 1}/${stats.size}`
						},
						body: blob
					})

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

				const response = await fetch(baseUrl, {
					method: "POST",
					headers: {
						"Content-Length": stats.size.toString()
					},
					body: blob
				})

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
			const client = this.createClientForTarget(targetDevice)
			const { data } = await postApiLocalsendV2Cancel({
				client,
				query: {
					sessionId
				}
			})

			return !!data
		} catch (err) {
			console.error("Error canceling session:", err)
			return false
		}
	}

	/**
	 * Get information about a device
	 */
	async getDeviceInfo(targetDevice: { ip: string; port: number }): Promise<DeviceInfo | null> {
		try {
			const client = this.createClientForTarget(targetDevice)
			const { data } = await getApiLocalsendV2Info({
				client
			})

			return data as DeviceInfo
		} catch (err) {
			console.error("Error getting device info:", err)
			return null
		}
	}

	/**
	 * Create a client for a specific target device
	 */
	private createClientForTarget(targetDevice: {
		ip: string
		port: number
		protocol?: "http" | "https"
	}): Client {
		const protocol = targetDevice.protocol || "http"
		const baseUrl = `${protocol}://${targetDevice.ip}:${targetDevice.port}`

		return createClient(
			createConfig<ClientOptions>({
				baseUrl
			})
		)
	}
}

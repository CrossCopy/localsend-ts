import type {
	DeviceInfo,
	PrepareUploadRequest,
	PrepareUploadResponse,
	FileMetadata
} from "../types"
import { createReadStream } from "fs"
import { stat } from "fs/promises"
import {
	getApiLocalsendV2Info,
	postApiLocalsendV2Register,
	postApiLocalsendV2PrepareUpload,
	postApiLocalsendV2Cancel
} from "../sdk"
import { type ClientOptions, type Client, createClient, createConfig } from "@hey-api/client-fetch"

export class LocalSendClient {
	private client: Client | null = null

	constructor(private deviceInfo: DeviceInfo) {
		// Client will be created on-demand when making requests
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
			const fileStream = createReadStream(filePath)

			// We need to manually implement the file upload since
			// the SDK doesn't support NodeJS ReadStream as body
			// Create a custom FormData-like object
			const formData = new FormData()

			// Convert the Node.js stream to a Blob
			const chunks: Uint8Array[] = []
			for await (const chunk of fileStream) {
				chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk))
			}

			const blob = new Blob(chunks)
			formData.append("file", blob)

			const client = this.createClientForTarget(targetDevice)
			const url = `${targetDevice.protocol}://${targetDevice.ip}:${targetDevice.port}/api/localsend/v2/upload?sessionId=${sessionId}&fileId=${fileId}&token=${fileToken}`

			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Length": stats.size.toString()
				},
				body: blob
			})

			return response.ok
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

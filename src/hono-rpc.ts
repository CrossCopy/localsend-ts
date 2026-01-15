import { hc, type InferResponseType } from "hono/client"
import type { LocalSendAppType } from "./api/hono-server.ts"
import type { DeviceInfo, FileMetadata, PrepareUploadResponse, MessageResponse } from "./types.ts"

export interface LocalSendClientOptions {
	baseUrl: string
	headers?: Record<string, string>
}

export class LocalSendRpcClient {
	private client: ReturnType<typeof hc<LocalSendAppType>>

	constructor(options: LocalSendClientOptions) {
		this.client = hc<LocalSendAppType>(options.baseUrl, {
			headers: options.headers,
			fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
				return fetch(input, init)
			}
		})
	}

	async getInfo(): Promise<DeviceInfo> {
		const res = await this.client.api.localsend.v2.info.$get()
		if (!res.ok) throw new Error(`Failed to get device info: ${res.status}`)
		return (await res.json()) as DeviceInfo
	}

	async register(deviceInfo: Partial<DeviceInfo>): Promise<DeviceInfo> {
		const res = await this.client.api.localsend.v2.register.$post({
			json: deviceInfo
		})
		if (!res.ok) throw new Error(`Failed to register: ${res.status}`)
		return (await res.json()) as DeviceInfo
	}

	async prepareUpload(
		info: DeviceInfo,
		files: Record<string, FileMetadata>,
		pin?: string
	): Promise<PrepareUploadResponse> {
		const requestParams = {
			json: { info, files }
		} as any

		if (pin) {
			requestParams.query = { pin }
		}

		const res = await this.client.api.localsend.v2["prepare-upload"].$post(requestParams)
		if (!res.ok) throw new Error(`Failed to prepare upload: ${res.status}`)
		return (await res.json()) as PrepareUploadResponse
	}

	async uploadFile(
		sessionId: string,
		fileId: string,
		token: string,
		file: File | Blob,
		onProgress?: (uploaded: number, total: number) => void
	): Promise<MessageResponse> {
		const fileSize = file.size

		if (fileSize > 50 * 1024 * 1024) {
			const CHUNK_SIZE = 10 * 1024 * 1024
			let offset = 0

			while (offset < fileSize) {
				const end = Math.min(offset + CHUNK_SIZE, fileSize)
				const chunk = file.slice(offset, end)

				if (onProgress) {
					onProgress(offset, fileSize)
				}

				const res = await this.client.api.localsend.v2.upload.$post(
					{
						query: {
							sessionId,
							fileId,
							token
						}
					},
					{
						body: chunk,
						headers: {
							"Content-Length": (end - offset).toString(),
							"X-Content-Range": `bytes ${offset}-${end - 1}/${fileSize}`
						}
					} as any
				)

				if (!res.ok) throw new Error(`Failed to upload chunk: ${res.status}`)

				offset = end
			}

			if (onProgress) {
				onProgress(fileSize, fileSize)
			}

			return { message: "File upload complete" }
		} else {
			if (onProgress) {
				onProgress(0, fileSize)
			}

			const res = await this.client.api.localsend.v2.upload.$post(
				{
					query: {
						sessionId,
						fileId,
						token
					}
				} as any,
				{
					body: file
				} as any
			)

			if (!res.ok) throw new Error(`Failed to upload file: ${res.status}`)

			if (onProgress) {
				onProgress(fileSize, fileSize)
			}

			return (await res.json()) as MessageResponse
		}
	}

	async cancelSession(sessionId: string): Promise<MessageResponse> {
		const res = await this.client.api.localsend.v2.cancel.$post({
			query: { sessionId }
		})
		if (!res.ok) throw new Error(`Failed to cancel session: ${res.status}`)
		return (await res.json()) as MessageResponse
	}
}

import { Hono } from "hono"
import { openAPIRouteHandler } from "hono-openapi"
import { Scalar } from "@scalar/hono-api-reference"
import type {
	DeviceInfo,
	PrepareUploadRequest,
	PrepareUploadResponse,
	FileMetadata,
	MessageResponse
} from "../types.ts"
import {
	deviceInfoSchema,
	fileMetadataSchema,
	prepareUploadRequestSchema,
	prepareUploadResponseSchema,
	messageResponseSchema
} from "../types.ts"
import { Buffer } from "node:buffer"
import { randomBytes } from "node:crypto"
import path from "node:path"
import fs from "node:fs"
import * as v from "valibot"
import { describeRoute, resolver, validator } from "hono-openapi"
import { bodyLimit } from "hono/body-limit"
import type { Context } from "hono"

export interface LocalSendContext {
	deviceInfo: DeviceInfo
	saveDirectory: string
	requirePin: boolean
	pin: string
	transferRequestHandler?: (
		senderInfo: DeviceInfo,
		files: Record<string, FileMetadata>
	) => Promise<boolean>
	transferProgressHandler?: (
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
	onRegisterCallback?: (device: DeviceInfo) => void
	maxRequestBodySize: number
	activeSessions: Map<string, SessionData>
	getRemoteAddress: (c: any) => string | null
	normalizeRemoteAddress: (address?: string | null) => string | null
}

export type SessionData = {
	info: DeviceInfo
	files: Record<string, FileMetadata>
	tokens: Record<string, string>
	acceptedFiles: string[]
	receivedFiles: Set<string>
	transferStartTimes: Record<string, number>
	bytesReceived: Record<string, number>
	fileStreams: Record<string, fs.WriteStream>
}

function createLocalSendMiddleware(ctx: LocalSendContext) {
	return async (c: Context, next: () => Promise<void>) => {
		c.set("localsendContext", ctx)
		await next()
	}
}

export function createLocalSendRoutes(ctx: LocalSendContext) {
	const middleware = createLocalSendMiddleware(ctx)

	const app = new Hono()
		.use("*", middleware)
		.get("/docs", Scalar({ url: "/openapi", theme: "elysiajs" }))
		.get(
			"/api/localsend/v2/info",
			describeRoute({
				description: "Get device information",
				responses: {
					200: {
						description: "Device information",
						content: {
							"application/json": { schema: resolver(deviceInfoSchema) }
						}
					}
				}
			}),
			(c) => {
				return c.json(ctx.deviceInfo)
			}
		)
		.post(
			"/api/localsend/v2/register",
			describeRoute({
				description: "Register device (for discovery)",
				responses: {
					200: {
						description: "Server device information",
						content: {
							"application/json": { schema: resolver(deviceInfoSchema) }
						}
					},
					400: {
						description: "Bad request",
						content: {
							"application/json": { schema: resolver(messageResponseSchema) }
						}
					}
				}
			}),
			async (c) => {
				try {
					const body = (await c.req.json()) as Partial<DeviceInfo>
					const remoteAddress = ctx.getRemoteAddress(c)
					if (ctx.onRegisterCallback && remoteAddress && body?.fingerprint && body?.alias) {
						ctx.onRegisterCallback({
							...body,
							ip: remoteAddress
						} as DeviceInfo)
					}
					return c.json(ctx.deviceInfo)
				} catch (err) {
					console.error("Error parsing request body:", err)
					return c.json({ message: "Invalid body" }, 400)
				}
			}
		)
		.post(
			"/api/localsend/v2/prepare-upload",
			describeRoute({
				description: "Prepare file upload",
				responses: {
					200: {
						description: "Upload preparation response",
						content: {
							"application/json": { schema: resolver(prepareUploadResponseSchema) }
						}
					},
					400: {
						description: "Bad request",
						content: {
							"application/json": { schema: resolver(messageResponseSchema) }
						}
					},
					401: {
						description: "Unauthorized (PIN required)",
						content: {
							"application/json": { schema: resolver(messageResponseSchema) }
						}
					}
				}
			}),
			validator("json", prepareUploadRequestSchema),
			validator("query", v.object({ pin: v.optional(v.string()) })),
			async (c) => {
				try {
					const body = c.req.valid("json")

					if (ctx.requirePin) {
						const pinParam = c.req.query("pin")
						if (!pinParam || pinParam !== ctx.pin) {
							return c.json({ message: "PIN required" }, 401)
						}
					} else if (ctx.transferRequestHandler) {
						const accepted = await ctx.transferRequestHandler(body.info, body.files)

						if (!accepted) {
							return c.json({ message: "Transfer rejected by user" }, 403)
						}
					}

					const sessionId = randomBytes(16).toString("hex")

					const tokens: Record<string, string> = {}
					Object.keys(body.files).forEach((fileId) => {
						tokens[fileId] = randomBytes(16).toString("hex")
					})

					ctx.activeSessions.set(sessionId, {
						info: body.info,
						files: body.files,
						tokens,
						acceptedFiles: Object.keys(body.files),
						receivedFiles: new Set(),
						transferStartTimes: {},
						bytesReceived: {},
						fileStreams: {}
					})

					const response: PrepareUploadResponse = {
						sessionId,
						files: tokens
					}
					return c.json(response)
				} catch (err) {
					console.error("Error handling prepare-upload:", err)
					return c.json({ message: "Invalid body" }, 400)
				}
			}
		)
		.post(
			"/api/localsend/v2/upload",
			describeRoute({
				description: "Upload a file",
				responses: {
					200: {
						description: "File upload successful",
						content: {
							"application/json": { schema: resolver(messageResponseSchema) }
						}
					},
					400: {
						description: "Bad request",
						content: {
							"application/json": { schema: resolver(messageResponseSchema) }
						}
					},
					403: {
						description: "Forbidden",
						content: {
							"application/json": { schema: resolver(messageResponseSchema) }
						}
					},
					404: {
						description: "Session or file not found",
						content: {
							"application/json": { schema: resolver(messageResponseSchema) }
						}
					},
					500: {
						description: "Internal server error",
						content: {
							"application/json": { schema: resolver(messageResponseSchema) }
						}
					}
				}
			}),
			validator(
				"query",
				v.object({ sessionId: v.string(), fileId: v.string(), token: v.string() })
			),
			// validator(""),
			async (c) => {
				const sessionId = c.req.valid("query").sessionId
				const fileId = c.req.valid("query").fileId
				const token = c.req.valid("query").token

				if (!sessionId || !fileId || !token) {
					return c.json({ message: "Missing parameters" }, 400)
				}

				const session = ctx.activeSessions.get(sessionId)
				if (!session) {
					return c.json({ message: "Session not found" }, 404)
				}

				if (session.tokens[fileId] !== token) {
					return c.json({ message: "Invalid token" }, 403)
				}

				if (!session.acceptedFiles.includes(fileId)) {
					return c.json({ message: "File not accepted" }, 403)
				}

				const fileMetadata = session.files[fileId]
				if (!fileMetadata) {
					return c.json({ message: "File metadata not found" }, 404)
				}

				try {
					const filePath = path.join(ctx.saveDirectory, fileMetadata.fileName)

					const dirPath = path.dirname(filePath)
					if (!fs.existsSync(dirPath)) {
						fs.mkdirSync(dirPath, { recursive: true })
					}

					const contentRange = c.req.header("X-Content-Range")
					let isChunkedUpload = false
					let rangeStart = 0
					let rangeEnd = 0
					let totalSize = 0

					if (contentRange) {
						isChunkedUpload = true
						const match = contentRange.match(/bytes (\d+)-(\d+)\/(\d+)/)
						if (match) {
							rangeStart = parseInt(match[1], 10)
							rangeEnd = parseInt(match[2], 10)
							totalSize = parseInt(match[3], 10)

							if (totalSize !== fileMetadata.size) {
								return c.json(
									{
										message: `File size mismatch. Expected: ${fileMetadata.size}, Got: ${totalSize}`
									},
									400
								)
							}
						} else {
							return c.json({ message: "Invalid Content-Range format" }, 400)
						}
					}

					if (!session.transferStartTimes[fileId] || (isChunkedUpload && rangeStart === 0)) {
						session.transferStartTimes[fileId] = Date.now()
						session.bytesReceived[fileId] = 0

						const fileStream = fs.createWriteStream(filePath, {
							flags: isChunkedUpload ? "w" : "w"
						})

						if (!session.fileStreams) {
							session.fileStreams = {}
						}

						session.fileStreams[fileId] = fileStream
					} else if (isChunkedUpload && rangeStart > 0) {
						if (!session.fileStreams[fileId] || session.fileStreams[fileId].closed) {
							const fileStream = fs.createWriteStream(filePath, { flags: "a" })
							session.fileStreams[fileId] = fileStream
						}
					}

					const stream = c.req.raw.body

					if (!stream) {
						return c.json({ message: "Request body stream not available" }, 500)
					}

					if (!session.fileStreams) {
						session.fileStreams = {}
					}

					const fileStream = session.fileStreams[fileId]

					if (!fileStream) {
						return c.json({ message: "File stream not found" }, 500)
					}

					let totalChunkSize = 0
					let lastProgressUpdate = Date.now()
					const PROGRESS_UPDATE_INTERVAL = 100

					try {
						const reader = stream.getReader()

						while (true) {
							const { done, value } = await reader.read()

							if (done) {
								break
							}

							if (value && value.length > 0) {
								totalChunkSize += value.length
								fileStream.write(Buffer.from(value))

								const now = Date.now()
								if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
									const elapsedSinceStart = (now - session.transferStartTimes[fileId]) / 1000
									const speed =
										elapsedSinceStart > 0
											? (session.bytesReceived[fileId] + totalChunkSize) / elapsedSinceStart
											: 0

									const currentReceived = session.bytesReceived[fileId] + totalChunkSize

									if (ctx.transferProgressHandler) {
										ctx.transferProgressHandler(
											fileId,
											fileMetadata.fileName,
											currentReceived,
											fileMetadata.size,
											speed
										)
									}

									lastProgressUpdate = now
								}
							}
						}

						const chunkReceivedBytes = isChunkedUpload ? rangeEnd - rangeStart + 1 : totalChunkSize

						session.bytesReceived[fileId] += chunkReceivedBytes

						const elapsedTime = (Date.now() - session.transferStartTimes[fileId]) / 1000
						const speed = elapsedTime > 0 ? session.bytesReceived[fileId] / elapsedTime : 0

						if (ctx.transferProgressHandler) {
							ctx.transferProgressHandler(
								fileId,
								fileMetadata.fileName,
								session.bytesReceived[fileId],
								fileMetadata.size,
								speed
							)
						}

						const isLastChunk = isChunkedUpload
							? rangeEnd + 1 >= totalSize
							: session.bytesReceived[fileId] >= fileMetadata.size

						if (isLastChunk) {
							fileStream.end()
							delete session.fileStreams[fileId]

							session.receivedFiles.add(fileId)

							const totalTimeSeconds = (Date.now() - session.transferStartTimes[fileId]) / 1000

							const avgSpeed =
								totalTimeSeconds > 0 ? session.bytesReceived[fileId] / totalTimeSeconds : 0

							if (ctx.transferProgressHandler) {
								ctx.transferProgressHandler(
									fileId,
									fileMetadata.fileName,
									session.bytesReceived[fileId],
									fileMetadata.size,
									avgSpeed,
									true,
									{
										filePath,
										totalTimeSeconds,
										averageSpeed: avgSpeed
									}
								)
							}

							if (session.receivedFiles.size === session.acceptedFiles.length) {
								ctx.activeSessions.delete(sessionId)
							}

							return c.json({ message: "File received successfully" })
						}

						return c.json({
							message: "Chunk received",
							bytesReceived: session.bytesReceived[fileId],
							totalBytes: fileMetadata.size
						})
					} catch (error) {
						fileStream.end()
						console.error("Error processing file chunk:", error)
						return c.json({ message: "Error processing file chunk" }, 500)
					}
				} catch (err) {
					console.error("Error handling file upload:", err)
					return c.json({ message: "Error handling file upload" }, 500)
				}
			}
		)
		.post(
			"/api/localsend/v2/cancel",
			describeRoute({
				description: "Cancel an upload session",
				responses: {
					200: {
						description: "Session cancelled successfully",
						content: {
							"application/json": { schema: resolver(messageResponseSchema) }
						}
					},
					400: {
						description: "Missing sessionId",
						content: {
							"application/json": { schema: resolver(messageResponseSchema) }
						}
					}
				}
			}),
			validator("query", v.object({ sessionId: v.string() })),
			(c) => {
				const sessionId = c.req.query("sessionId")

				if (!sessionId) {
					return c.json({ message: "Missing sessionId" }, 400)
				}

				if (ctx.activeSessions.has(sessionId)) {
					ctx.activeSessions.delete(sessionId)
				}

				return c.json({ message: "Session canceled" })
			}
		)
		.notFound((c) => {
			return c.json({ message: "Not found" }, 404)
		})
		.onError((err, c) => {
			console.error("Server error:", err)
			return c.json({ message: "Internal server error" }, 500)
		})
	app.get(
		"/openapi",
		openAPIRouteHandler(app, {
			documentation: {
				info: {
					title: "LocalSend API",
					version: "1.0.0",
					description: "LocalSend API"
				}
			}
		})
	)
	return app
}

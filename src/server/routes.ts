import { Hono } from "hono"
import { openAPIRouteHandler } from "hono-openapi"
import { Scalar } from "@scalar/hono-api-reference"
import type { DeviceInfo, PrepareUploadResponse, FileMetadata } from "../types.ts"
import {
	deviceInfoSchema,
	prepareUploadRequestSchema,
	prepareUploadResponseSchema,
	messageResponseSchema
} from "../types.ts"
import { Buffer } from "node:buffer"
import path from "node:path"
import fs from "node:fs"
import * as v from "valibot"
import { describeRoute, resolver, validator } from "hono-openapi"
import type { Context } from "hono"
import type { UploadSessionStore } from "../core/sessions.ts"
import { resolveSavePath } from "../core/files.ts"

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
	uploads: UploadSessionStore
	getRemoteAddress: (c: any) => string | null
	normalizeRemoteAddress: (address?: string | null) => string | null
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
					}
					if (ctx.transferRequestHandler) {
						const accepted = await ctx.transferRequestHandler(body.info, body.files)

						if (!accepted) {
							return c.json({ message: "Transfer rejected by user" }, 403)
						}
					}

					if (Object.keys(body.files).length === 0) return c.body(null, 204)

					const { sessionId, tokens } = ctx.uploads.create(body.info, body.files)

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
			async (c) => {
				const sessionId = c.req.valid("query").sessionId
				const fileId = c.req.valid("query").fileId
				const token = c.req.valid("query").token

				if (!sessionId || !fileId || !token) {
					return c.json({ message: "Missing parameters" }, 400)
				}

				const session = ctx.uploads.get(sessionId)
				if (!session) {
					return c.json({ message: "Session not found" }, 404)
				}

				if (!ctx.uploads.validateToken(sessionId, fileId, token)) {
					return c.json({ message: "Invalid token" }, 403)
				}

				if (!session.acceptedFiles.includes(fileId)) {
					return c.json({ message: "File not accepted" }, 403)
				}

				const fileMetadata = session.files[fileId]
				if (!fileMetadata) {
					return c.json({ message: "File metadata not found" }, 404)
				}

				let filePath: string
				try {
					filePath = resolveSavePath(ctx.saveDirectory, fileMetadata.fileName)
				} catch (err) {
					return c.json({ message: "Unsafe path" }, 400)
				}

				try {
					const dirPath = path.dirname(filePath)
					if (!fs.existsSync(dirPath)) {
						fs.mkdirSync(dirPath, { recursive: true })
					}

					const stream = c.req.raw.body
					if (!stream) {
						return c.json({ message: "Request body stream not available" }, 500)
					}

					const fileStream = fs.createWriteStream(filePath, { flags: "w" })
					const reader = stream.getReader()
					let received = 0
					const start = Date.now()

					// Waits for all buffered writes to actually reach disk. Without this,
					// the handler could respond success before large files are fully
					// flushed, racing anyone who reads the file right after the response.
					const closeFileStream = () =>
						new Promise<void>((resolve, reject) => {
							fileStream.end((err?: Error | null) => (err ? reject(err) : resolve()))
						})

					try {
						while (true) {
							const { done, value } = await reader.read()
							if (done) break
							if (value && value.length > 0) {
								received += value.length
								fileStream.write(Buffer.from(value))
								if (ctx.transferProgressHandler) {
									const elapsed = (Date.now() - start) / 1000
									ctx.transferProgressHandler(
										fileId,
										fileMetadata.fileName,
										received,
										fileMetadata.size,
										elapsed > 0 ? received / elapsed : 0
									)
								}
							}
						}
					} catch (error) {
						await closeFileStream().catch(() => {})
						console.error("Error processing file upload:", error)
						return c.json({ message: "Error processing file upload" }, 500)
					}

					await closeFileStream()
					ctx.uploads.markReceived(sessionId, fileId)
					const totalTime = (Date.now() - start) / 1000
					if (ctx.transferProgressHandler) {
						ctx.transferProgressHandler(
							fileId,
							fileMetadata.fileName,
							received,
							fileMetadata.size,
							totalTime > 0 ? received / totalTime : 0,
							true,
							{
								filePath,
								totalTimeSeconds: totalTime,
								averageSpeed: totalTime > 0 ? received / totalTime : 0
							}
						)
					}
					return c.json({ message: "File received successfully" })
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

				if (ctx.uploads.has(sessionId)) {
					ctx.uploads.delete(sessionId)
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

export type LocalSendAppType = ReturnType<typeof createLocalSendRoutes>

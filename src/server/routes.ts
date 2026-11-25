import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { openAPIRouteHandler } from "hono-openapi"
import { Scalar } from "@scalar/hono-api-reference"
import type { DeviceInfo, PrepareUploadResponse, FileMetadata } from "../protocol/types.ts"
import { renderSharePage } from "./web.ts"
import {
	deviceInfoSchema,
	prepareUploadRequestSchema,
	prepareUploadResponseSchema,
	prepareDownloadResponseSchema,
	messageResponseSchema
} from "../protocol/types.ts"
import { Buffer } from "node:buffer"
import { randomBytes } from "node:crypto"
import path from "node:path"
import fs from "node:fs"
import { unlink } from "node:fs/promises"
import * as v from "valibot"
import { describeRoute, resolver, validator } from "hono-openapi"
import type { Context } from "hono"
import type { UploadSessionStore, DownloadSessionStore } from "../core/sessions.ts"
import { uniqueSavePath, type StagedFile } from "../core/files.ts"
import type { PinGate } from "./pin.ts"

export type TransferDecision =
	| boolean
	| { action: "accept"; fileIds?: string[] }
	| { action: "decline" }
	| { action: "refuse"; reason: string }

export interface LocalSendContext {
	deviceInfo: DeviceInfo
	saveDirectory: string
	pinGate: PinGate
	transferRequestHandler?: (
		senderInfo: DeviceInfo,
		files: Record<string, FileMetadata>
	) => Promise<TransferDecision>
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
	sharedFiles: StagedFile[]
	downloads: DownloadSessionStore
	getRemoteAddress: (c: any) => string | null
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
		.get("/", (c) => {
			const peerIp = ctx.getRemoteAddress(c) ?? "unknown"
			const pinVerdict = ctx.pinGate.check(c.req.query("pin"), peerIp)
			if (pinVerdict.status === "locked_out") {
				return c.json({ message: "Too many invalid PIN attempts" }, 429)
			}
			if (pinVerdict.status === "unauthorized") {
				return c.json({ message: "PIN required" }, 401)
			}
			if (!ctx.sharedFiles || ctx.sharedFiles.length === 0) {
				return c.json({ message: "No files shared" }, 404)
			}
			const sessionId = ctx.downloads.create(ctx.sharedFiles)
			const files: Record<string, FileMetadata> = {}
			for (const f of ctx.sharedFiles) files[f.fileId] = f.metadata
			return c.html(renderSharePage(ctx.deviceInfo, sessionId, files))
		})
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
					const peerIp = ctx.getRemoteAddress(c) ?? "unknown"
					const pinVerdict = ctx.pinGate.check(c.req.query("pin"), peerIp)
					if (pinVerdict.status === "locked_out") {
						return c.json({ message: "Too many invalid PIN attempts" }, 429)
					}
					if (pinVerdict.status === "unauthorized") {
						return c.json({ message: "PIN required" }, 401)
					}

					if (Object.keys(body.files).length === 0) return c.body(null, 204)

					let acceptedFileIds: string[] = Object.keys(body.files)
					if (ctx.transferRequestHandler) {
						// The wire body carries no sender IP; attach the socket address (as the
						// register route does) so consent UIs can show who is connecting.
						const remoteAddress = ctx.getRemoteAddress(c)
						const senderInfo: DeviceInfo = remoteAddress
							? { ...body.info, ip: remoteAddress }
							: body.info

						const signal = c.req.raw.signal
						if (signal?.aborted) {
							return c.json({ message: "Request cancelled" }, 400)
						}

						const decision = await ctx.transferRequestHandler(senderInfo, body.files)
						if (signal?.aborted) {
							return c.json({ message: "Request cancelled" }, 400)
						}

						if (typeof decision === "boolean") {
							if (!decision) {
								return c.json({ message: "Transfer rejected by user" }, 403)
							}
						} else if (decision.action === "refuse") {
							console.warn("Offer refused as unusable:", decision.reason)
							return c.json({ message: "Invalid transfer offer" }, 400)
						} else if (decision.action === "decline") {
							return c.json({ message: "Transfer rejected by user" }, 403)
						} else if (decision.action === "accept") {
							if (decision.fileIds) {
								acceptedFileIds = decision.fileIds.filter((id) => Boolean(body.files[id]))
							}
							if (acceptedFileIds.length === 0) {
								return c.json({ message: "Transfer rejected by user" }, 403)
							}
						}
					}

					const { sessionId, tokens } = ctx.uploads.create(body.info, body.files, acceptedFileIds)

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
					413: {
						description: "Payload too large",
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
			bodyLimit({
				maxSize: ctx.maxRequestBodySize,
				onError: (c) => c.json({ message: "Payload too large" }, 413)
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

				const session = ctx.uploads.beginUpload(sessionId)
				if (!session) {
					return c.json({ message: "Session not found" }, 404)
				}

				try {
					if (!ctx.uploads.validateToken(sessionId, fileId, token)) {
						console.warn("Refused upload: invalid token", { sessionId, fileId })
						return c.json({ message: "Invalid token" }, 403)
					}

					if (!session.acceptedFiles.includes(fileId)) {
						console.warn("Refused upload: file not accepted", { sessionId, fileId })
						return c.json({ message: "File not accepted" }, 403)
					}

					const fileMetadata = session.files[fileId]
					if (!fileMetadata) {
						return c.json({ message: "File metadata not found" }, 404)
					}

					// Validate path safety before writing anything to disk
					try {
						uniqueSavePath(ctx.saveDirectory, fileMetadata.fileName)
					} catch {
						console.warn("Refused upload: unsafe path", { sessionId, fileId })
						return c.json({ message: "Unsafe path" }, 400)
					}

					if (!fs.existsSync(ctx.saveDirectory)) {
						fs.mkdirSync(ctx.saveDirectory, { recursive: true })
					}

					const stream = c.req.raw.body
					if (!stream) {
						return c.json({ message: "Request body stream not available" }, 500)
					}

					// Stage into an exclusive temporary file so partial/cancelled uploads never
					// appear at or overwrite the final destination path.
					const tempName = `.localsend-tmp-${sessionId}-${fileId}-${randomBytes(4).toString("hex")}`
					const tempPath = path.join(ctx.saveDirectory, tempName)
					const fileStream = fs.createWriteStream(tempPath, { flags: "wx" })
					const reader = stream.getReader()
					let received = 0
					const start = Date.now()
					const abortSignal = session.abortController.signal

					const closeFileStream = () =>
						new Promise<void>((resolve, reject) => {
							fileStream.end((err?: Error | null) => (err ? reject(err) : resolve()))
						})

					const readWithAbort = async () => {
						if (abortSignal.aborted) {
							throw new Error("Transfer cancelled")
						}
						return new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
							const onAbort = () => reject(new Error("Transfer cancelled"))
							abortSignal.addEventListener("abort", onAbort, { once: true })
							reader.read().then(
								(res) => {
									abortSignal.removeEventListener("abort", onAbort)
									resolve(res)
								},
								(err) => {
									abortSignal.removeEventListener("abort", onAbort)
									reject(err)
								}
							)
						})
					}

					try {
						while (true) {
							const { done, value } = await readWithAbort()
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
						await reader.cancel().catch(() => {})
						await closeFileStream().catch(() => {})
						await unlink(tempPath).catch(() => {})
						if (session.cancelled || abortSignal.aborted) {
							return c.json({ message: "Transfer cancelled" }, 400)
						}
						ctx.uploads.delete(sessionId)
						console.warn("Error processing file upload:", { sessionId, fileId, error })
						return c.json({ message: "Error processing file upload" }, 500)
					}

					await closeFileStream()

					if (session.cancelled || abortSignal.aborted) {
						await unlink(tempPath).catch(() => {})
						return c.json({ message: "Transfer cancelled" }, 400)
					}

					if (received !== fileMetadata.size) {
						await unlink(tempPath).catch(() => {})
						ctx.uploads.delete(sessionId)
						console.warn("Incomplete upload: size mismatch", {
							sessionId,
							fileId,
							received,
							expected: fileMetadata.size
						})
						return c.json({ message: "Incomplete upload: size mismatch" }, 400)
					}

					// Atomic publication without overwriting an existing destination
					let finalPath: string | null = null
					for (let attempt = 0; attempt < 32; attempt++) {
						const candidate = uniqueSavePath(ctx.saveDirectory, fileMetadata.fileName)
						const dirPath = path.dirname(candidate)
						if (!fs.existsSync(dirPath)) {
							fs.mkdirSync(dirPath, { recursive: true })
						}
						try {
							fs.linkSync(tempPath, candidate)
							fs.unlinkSync(tempPath)
							finalPath = candidate
							break
						} catch (err: any) {
							if (err?.code === "EEXIST") continue
							// Fallback to rename if hardlink is unsupported on this filesystem
							fs.renameSync(tempPath, candidate)
							finalPath = candidate
							break
						}
					}

					if (!finalPath) {
						await unlink(tempPath).catch(() => {})
						return c.json({ message: "Destination collision" }, 500)
					}

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
								filePath: finalPath,
								totalTimeSeconds: totalTime,
								averageSpeed: totalTime > 0 ? received / totalTime : 0
							}
						)
					}
					return c.json({ message: "File received successfully" })
				} catch (err) {
					console.warn("Error handling file upload:", { sessionId, fileId, err })
					return c.json({ message: "Error handling file upload" }, 500)
				} finally {
					ctx.uploads.endUpload(sessionId)
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
					ctx.uploads.cancel(sessionId)
				}

				return c.json({ message: "Session canceled" })
			}
		)
		.post(
			"/api/localsend/v2/prepare-download",
			describeRoute({
				description: "Prepare a reverse download (share-by-link)",
				responses: {
					200: {
						description: "Download metadata",
						content: {
							"application/json": { schema: resolver(prepareDownloadResponseSchema) }
						}
					},
					401: {
						description: "PIN required",
						content: {
							"application/json": { schema: resolver(messageResponseSchema) }
						}
					},
					404: {
						description: "Nothing shared",
						content: {
							"application/json": { schema: resolver(messageResponseSchema) }
						}
					}
				}
			}),
			validator("query", v.object({ pin: v.optional(v.string()) })),
			async (c) => {
				const peerIp = ctx.getRemoteAddress(c) ?? "unknown"
				const pinVerdict = ctx.pinGate.check(c.req.query("pin"), peerIp)
				if (pinVerdict.status === "locked_out") {
					return c.json({ message: "Too many invalid PIN attempts" }, 429)
				}
				if (pinVerdict.status === "unauthorized") {
					return c.json({ message: "PIN required" }, 401)
				}
				if (!ctx.sharedFiles || ctx.sharedFiles.length === 0) {
					return c.json({ message: "Nothing shared" }, 404)
				}
				const sessionId = ctx.downloads.create(ctx.sharedFiles)
				const files: Record<string, FileMetadata> = {}
				for (const f of ctx.sharedFiles) files[f.fileId] = f.metadata
				return c.json({ info: ctx.deviceInfo, sessionId, files })
			}
		)
		.get(
			"/api/localsend/v2/download",
			describeRoute({
				description: "Download a shared file",
				responses: {
					200: { description: "Binary file" },
					404: {
						description: "Not found",
						content: {
							"application/json": { schema: resolver(messageResponseSchema) }
						}
					}
				}
			}),
			validator("query", v.object({ sessionId: v.string(), fileId: v.string() })),
			async (c) => {
				const { sessionId, fileId } = c.req.valid("query")
				const staged = ctx.downloads.getFile(sessionId, fileId)
				if (!staged) return c.json({ message: "Not found" }, 404)
				const stream = fs.createReadStream(staged.absolutePath)
				const webStream = (await import("node:stream")).Readable.toWeb(
					stream
				) as unknown as ReadableStream
				return new Response(webStream, {
					status: 200,
					headers: {
						"Content-Type": staged.metadata.fileType || "application/octet-stream",
						"Content-Length": staged.metadata.size.toString(),
						"Content-Disposition": `attachment; filename="${encodeURIComponent(staged.metadata.fileName)}"`
					}
				})
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

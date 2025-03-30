import { Hono } from "hono"
import type {
	DeviceInfo,
	PrepareUploadRequest,
	PrepareUploadResponse,
	FileMetadata,
	MessageResponse
} from "../types"
import {
	deviceInfoSchema,
	fileMetadataSchema,
	prepareUploadRequestSchema,
	prepareUploadResponseSchema,
	messageResponseSchema
} from "../types"
import { randomBytes } from "crypto"
import path from "path"
import fs from "fs"
import { type ServerAdapter, createServerAdapter } from "./server-adapter"
import * as v from "valibot"
import { describeRoute, openAPISpecs } from "hono-openapi"
import { resolver, validator } from "hono-openapi/valibot"
import { apiReference } from "@scalar/hono-api-reference"
import { bodyLimit } from "hono/body-limit"

// Define a transfer request handler type
export type TransferRequestHandler = (
	senderInfo: DeviceInfo,
	files: Record<string, FileMetadata>
) => Promise<boolean>

// Define a transfer progress handler type
export type TransferProgressHandler = (
	fileId: string,
	fileName: string,
	received: number,
	total: number,
	speed: number
) => void

type SessionData = {
	info: DeviceInfo
	files: Record<string, FileMetadata>
	tokens: Record<string, string>
	acceptedFiles: string[]
	receivedFiles: Set<string>
	transferStartTimes: Record<string, number>
	bytesReceived: Record<string, number>
	fileStreams: Record<string, fs.WriteStream>
}

export class LocalSendHonoServer {
	private app = new Hono()
	private server: unknown = null
	private serverAdapter: ServerAdapter
	private activeSessions: Map<string, SessionData> = new Map()
	private deviceInfo: DeviceInfo
	private saveDirectory: string
	private requirePin: boolean = false
	private pin: string = ""
	private transferRequestHandler: TransferRequestHandler | null = null
	private transferProgressHandler: TransferProgressHandler | null = null
	private maxRequestBodySize: number = 5 * 1024 * 1024 * 1024 // Default to 5GB

	constructor(
		deviceInfo: DeviceInfo,
		options: {
			saveDirectory?: string
			pin?: string
			serverAdapter?: ServerAdapter
			onTransferRequest?: TransferRequestHandler
			onTransferProgress?: TransferProgressHandler
			maxRequestBodySize?: number
		} = {}
	) {
		this.deviceInfo = deviceInfo
		this.saveDirectory = options.saveDirectory || "./received_files"
		this.pin = options.pin || ""
		this.requirePin = !!this.pin // Only require PIN if one is provided
		this.transferRequestHandler = options.onTransferRequest || null
		this.transferProgressHandler = options.onTransferProgress || null
		// Set max request body size if provided, otherwise use default
		this.maxRequestBodySize = options.maxRequestBodySize || this.maxRequestBodySize

		// Use provided server adapter or create one based on runtime environment
		this.serverAdapter = options.serverAdapter || createServerAdapter()

		// Create save directory if it doesn't exist
		if (!fs.existsSync(this.saveDirectory)) {
			fs.mkdirSync(this.saveDirectory, { recursive: true })
		}

		// Register API routes
		this.registerRoutes()
	}

	private registerRoutes() {
		// OpenAPI documentation
		this.app.get(
			"/openapi",
			openAPISpecs(this.app, {
				documentation: {
					info: {
						title: "LocalSend API",
						version: "2.0.0",
						description: "API for LocalSend file sharing application"
					},
					servers: [
						{ url: `http://localhost:${this.deviceInfo.port}`, description: "Local Server" }
					]
				}
			})
		)

		// API Reference UI
		this.app.get(
			"/docs",
			apiReference({
				theme: "saturn",
				url: "/openapi"
			})
		)

		// Device info route
		this.app.get(
			"/api/localsend/v2/info",
			describeRoute({
				description: "Get device information",
				validateResponse: true,
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
				return c.json(this.deviceInfo)
			}
		)

		// Register route (for discovery)
		this.app.post(
			"/api/localsend/v2/register",
			describeRoute({
				description: "Register device (for discovery)",
				validateResponse: true,
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
			validator("json", deviceInfoSchema),
			async (c) => {
				try {
					const body = c.req.valid("json")
					return c.json(this.deviceInfo)
				} catch (err) {
					console.error("Error parsing request body:", err)
					return c.json({ message: "Invalid body" }, 400)
				}
			}
		)

		// Upload API routes
		this.app.post(
			"/api/localsend/v2/prepare-upload",
			describeRoute({
				description: "Prepare file upload",
				validateResponse: true,
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

					// Check PIN if required
					if (this.requirePin) {
						const pinParam = c.req.query("pin")
						if (!pinParam || pinParam !== this.pin) {
							return c.json({ message: "PIN required" }, 401)
						}
					} else if (this.transferRequestHandler) {
						// If no PIN but we have a request handler, use it for confirmation
						const accepted = await this.transferRequestHandler(body.info, body.files)

						if (!accepted) {
							return c.json({ message: "Transfer rejected by user" }, 403)
						}
					}

					// Generate a session ID
					const sessionId = randomBytes(16).toString("hex")

					// Generate tokens for each file
					const tokens: Record<string, string> = {}
					Object.keys(body.files).forEach((fileId) => {
						tokens[fileId] = randomBytes(16).toString("hex")
					})

					// Store the session
					this.activeSessions.set(sessionId, {
						info: body.info,
						files: body.files,
						tokens,
						acceptedFiles: Object.keys(body.files),
						receivedFiles: new Set(),
						transferStartTimes: {},
						bytesReceived: {},
						fileStreams: {}
					})

					// Create the response
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

		this.app.post(
			"/api/localsend/v2/upload",
			bodyLimit({
				maxSize: this.maxRequestBodySize, // Use the configured max request body size
				onError: (c) => {
					const sizeInGB = Math.round(this.maxRequestBodySize / (1024 * 1024 * 1024))
					return c.text(`File size exceeds the ${sizeInGB}GB limit`, 413)
				}
			}),
			describeRoute({
				description: "Upload a file",
				validateResponse: true,
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
				// Get query parameters
				const sessionId = c.req.query("sessionId")
				const fileId = c.req.query("fileId")
				const token = c.req.query("token")

				// Validate parameters
				if (!sessionId || !fileId || !token) {
					return c.json({ message: "Missing parameters" }, 400)
				}

				// Check if session exists
				const session = this.activeSessions.get(sessionId)
				if (!session) {
					return c.json({ message: "Session not found" }, 404)
				}

				// Validate token
				if (session.tokens[fileId] !== token) {
					return c.json({ message: "Invalid token" }, 403)
				}

				// Check if file was accepted
				if (!session.acceptedFiles.includes(fileId)) {
					return c.json({ message: "File not accepted" }, 403)
				}

				// Get file metadata
				const fileMetadata = session.files[fileId]
				if (!fileMetadata) {
					return c.json({ message: "File metadata not found" }, 404)
				}

				try {
					// Create file path
					const filePath = path.join(this.saveDirectory, fileMetadata.fileName)

					// Ensure the directory exists (create all parent directories if they don't)
					const dirPath = path.dirname(filePath)
					if (!fs.existsSync(dirPath)) {
						fs.mkdirSync(dirPath, { recursive: true })
					}

					// Check if this is a chunked upload
					const contentRange = c.req.header("X-Content-Range")
					let isChunkedUpload = false
					let rangeStart = 0
					let rangeEnd = 0
					let totalSize = 0

					if (contentRange) {
						isChunkedUpload = true
						// Parse content range header: "bytes 0-999999/1234567"
						const match = contentRange.match(/bytes (\d+)-(\d+)\/(\d+)/)
						if (match) {
							rangeStart = parseInt(match[1], 10)
							rangeEnd = parseInt(match[2], 10)
							totalSize = parseInt(match[3], 10)

							// Validate that the total size matches the expected file size
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

					// Initialize start time and bytes received if first chunk or not a chunked upload
					if (!session.transferStartTimes[fileId] || (isChunkedUpload && rangeStart === 0)) {
						session.transferStartTimes[fileId] = Date.now()
						session.bytesReceived[fileId] = 0

						// For the first chunk or full file, create or truncate the file
						const fileStream = fs.createWriteStream(filePath, {
							flags: isChunkedUpload ? "w" : "w"
						})

						// Initialize fileStreams object if it doesn't exist
						if (!session.fileStreams) {
							session.fileStreams = {}
						}

						// Store the file stream in the session for later chunks
						session.fileStreams[fileId] = fileStream
					} else if (isChunkedUpload && rangeStart > 0) {
						// For subsequent chunks in a chunked upload, open the file for appending
						// Check if we need to create a new stream (previous one might be closed)
						if (!session.fileStreams[fileId] || session.fileStreams[fileId].closed) {
							// Open file for appending
							const fileStream = fs.createWriteStream(filePath, { flags: "a" })
							session.fileStreams[fileId] = fileStream
						}
					}

					// Get the request as a stream
					const stream = c.req.raw.body

					if (!stream) {
						return c.json({ message: "Request body stream not available" }, 500)
					}

					// Make sure fileStreams object exists
					if (!session.fileStreams) {
						session.fileStreams = {}
					}

					const fileStream = session.fileStreams[fileId]

					if (!fileStream) {
						return c.json({ message: "File stream not found" }, 500)
					}

					// Process the incoming data in chunks
					let totalChunkSize = 0
					try {
						const reader = stream.getReader()

						// Read and process chunks
						while (true) {
							const { done, value } = await reader.read()

							if (done) {
								break
							}

							// Write chunk to file
							if (value && value.length > 0) {
								totalChunkSize += value.length
								fileStream.write(Buffer.from(value))
							}
						}

						// Calculate actual bytes received including this chunk
						const chunkReceivedBytes = isChunkedUpload ? rangeEnd - rangeStart + 1 : totalChunkSize

						// Update bytes received for this file
						session.bytesReceived[fileId] += chunkReceivedBytes

						// Calculate speed in bytes per second
						const elapsedTime = (Date.now() - session.transferStartTimes[fileId]) / 1000
						const speed = elapsedTime > 0 ? session.bytesReceived[fileId] / elapsedTime : 0

						// Call progress handler if provided
						if (this.transferProgressHandler) {
							this.transferProgressHandler(
								fileId,
								fileMetadata.fileName,
								session.bytesReceived[fileId],
								fileMetadata.size,
								speed
							)
						}

						// For chunked uploads, only close the stream when we've received all bytes
						const isLastChunk = isChunkedUpload
							? rangeEnd + 1 >= totalSize
							: session.bytesReceived[fileId] >= fileMetadata.size

						// Check if transfer is complete
						if (isLastChunk) {
							// Close the file stream
							fileStream.end()
							delete session.fileStreams[fileId]

							// Mark file as received
							session.receivedFiles.add(fileId)

							// Check if all files have been received
							if (session.receivedFiles.size === session.acceptedFiles.length) {
								// All files received, clean up the session
								this.activeSessions.delete(sessionId)
							}

							return c.json({ message: "File received successfully" })
						}

						return c.json({
							message: "Chunk received",
							bytesReceived: session.bytesReceived[fileId],
							totalBytes: fileMetadata.size
						})
					} catch (error) {
						// Close the stream in case of error
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

		this.app.post(
			"/api/localsend/v2/cancel",
			describeRoute({
				description: "Cancel an upload session",
				validateResponse: true,
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

				// Check if session exists
				if (this.activeSessions.has(sessionId)) {
					// Delete the session
					this.activeSessions.delete(sessionId)
				}

				return c.json({ message: "Session canceled" })
			}
		)

		// Default 404 handler
		this.app.notFound((c) => {
			return c.json({ message: "Not found" }, 404)
		})

		// Error handler
		this.app.onError((err, c) => {
			console.error("Server error:", err)
			return c.json({ message: "Internal server error" }, 500)
		})
	}

	async start(): Promise<void> {
		try {
			// Start the server using the adapter
			this.server = await this.serverAdapter.start({
				port: this.deviceInfo.port,
				fetch: this.app.fetch,
				// Use configured max request body size
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

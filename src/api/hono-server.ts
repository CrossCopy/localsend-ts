import { Hono } from "hono"
import type { Context } from "hono"
import type {
	DeviceInfo,
	PrepareUploadRequest,
	PrepareUploadResponse,
	FileMetadata
} from "../types"
import { DEFAULT_CONFIG } from "../config"
import { randomBytes } from "crypto"
import path from "path"
import fs from "fs"
import { type ServerAdapter, createServerAdapter } from "./server-adapter"

type SessionData = {
	info: DeviceInfo
	files: Record<string, FileMetadata>
	tokens: Record<string, string>
	acceptedFiles: string[]
	receivedFiles: Set<string>
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

	constructor(
		deviceInfo: DeviceInfo,
		options: {
			saveDirectory?: string
			requirePin?: boolean
			pin?: string
			serverAdapter?: ServerAdapter
		} = {}
	) {
		this.deviceInfo = deviceInfo
		this.saveDirectory = options.saveDirectory || "./received_files"
		this.requirePin = options.requirePin || false
		this.pin = options.pin || ""

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
		// Device info route
		this.app.get("/api/localsend/v2/info", (c: Context) => {
			return c.json(this.deviceInfo)
		})

		// Register route (for discovery)
		this.app.post("/api/localsend/v2/register", async (c: Context) => {
			try {
				const body = await c.req.json()
				return c.json(this.deviceInfo)
			} catch (err) {
				console.error("Error parsing request body:", err)
				return c.json({ message: "Invalid body" }, 400)
			}
		})

		// Upload API routes
		this.app.post("/api/localsend/v2/prepare-upload", async (c: Context) => {
			try {
				const body = (await c.req.json()) as PrepareUploadRequest

				// Check PIN if required
				if (this.requirePin) {
					const pinParam = c.req.query("pin")
					if (!pinParam || pinParam !== this.pin) {
						return c.json({ message: "PIN required" }, 401)
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
					receivedFiles: new Set()
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
		})

		this.app.post("/api/localsend/v2/upload", async (c: Context) => {
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

				// Get the request buffer
				const buffer = await c.req.arrayBuffer()

				// Write the file
				fs.writeFileSync(filePath, Buffer.from(buffer))

				// Mark file as received
				session.receivedFiles.add(fileId)

				// Check if all files have been received
				if (session.receivedFiles.size === session.acceptedFiles.length) {
					// All files received, clean up the session
					this.activeSessions.delete(sessionId)
				}

				return c.json({ message: "File received" })
			} catch (err) {
				console.error("Error writing file:", err)
				return c.json({ message: "Error writing file" }, 500)
			}
		})

		this.app.post("/api/localsend/v2/cancel", (c: Context) => {
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
		})

		// Default 404 handler
		this.app.notFound((c: Context) => {
			return c.json({ message: "Not found" }, 404)
		})

		// Error handler
		this.app.onError((err, c: Context) => {
			console.error("Server error:", err)
			return c.json({ message: "Internal server error" }, 500)
		})
	}

	async start(): Promise<void> {
		try {
			// Start the server using the adapter
			this.server = await this.serverAdapter.start({
				port: this.deviceInfo.port,
				fetch: this.app.fetch
			})

			console.log(`LocalSend server started on port ${this.deviceInfo.port}`)
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

import { createServer, IncomingMessage, ServerResponse } from "node:http"
import type {
	DeviceInfo,
	PrepareUploadRequest,
	PrepareUploadResponse,
	PrepareDownloadResponse,
	FileMetadata
} from "../types.ts"
import { DEFAULT_CONFIG } from "../config.ts"
import { randomBytes } from "node:crypto"
import path from "node:path"
import fs from "node:fs"

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>
type SessionData = {
	info: DeviceInfo
	files: Record<string, FileMetadata>
	tokens: Record<string, string>
	acceptedFiles: string[]
	receivedFiles: Set<string>
}

export class LocalSendServer {
	private server
	private routes: Map<string, RouteHandler> = new Map()
	private activeSessions: Map<string, SessionData> = new Map()
	private deviceInfo: DeviceInfo
	private saveDirectory: string
	private requirePin: boolean = false
	private pin: string = ""

	constructor(
		deviceInfo: DeviceInfo,
		options: { saveDirectory?: string; requirePin?: boolean; pin?: string } = {}
	) {
		this.deviceInfo = deviceInfo
		this.saveDirectory = options.saveDirectory || "./received_files"
		this.requirePin = options.requirePin || false
		this.pin = options.pin || ""

		// Create save directory if it doesn't exist
		if (!fs.existsSync(this.saveDirectory)) {
			fs.mkdirSync(this.saveDirectory, { recursive: true })
		}

		this.server = createServer(this.handleRequest.bind(this))

		// Register API routes
		this.registerRoutes()
	}

	private registerRoutes() {
		// Device info route
		this.routes.set("/api/localsend/v2/info", this.handleInfo.bind(this))

		// Register route (for discovery)
		this.routes.set("/api/localsend/v2/register", this.handleRegister.bind(this))

		// Upload API routes
		this.routes.set("/api/localsend/v2/prepare-upload", this.handlePrepareUpload.bind(this))
		this.routes.set("/api/localsend/v2/upload", this.handleUpload.bind(this))
		this.routes.set("/api/localsend/v2/cancel", this.handleCancel.bind(this))
	}

	start(): Promise<void> {
		return new Promise<void>((resolve) => {
			this.server.listen(this.deviceInfo.port, () => {
				console.log(`LocalSend server started on port ${this.deviceInfo.port}`)
				resolve()
			})
		})
	}

	stop(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.server.close((err) => {
				if (err) {
					reject(err)
				} else {
					resolve()
				}
			})
		})
	}

	private async handleRequest(req: IncomingMessage, res: ServerResponse) {
		const url = new URL(req.url || "/", `http://${req.headers.host}`)
		const pathname = url.pathname

		// Find the appropriate route handler
		const handler = this.routes.get(pathname)

		if (handler) {
			try {
				await handler(req, res)
			} catch (err) {
				console.error("Error handling request:", err)
				res.statusCode = 500
				res.end(JSON.stringify({ message: "Internal server error" }))
			}
		} else {
			// Route not found
			res.statusCode = 404
			res.end(JSON.stringify({ message: "Not found" }))
		}
	}

	private async handleInfo(req: IncomingMessage, res: ServerResponse) {
		res.setHeader("Content-Type", "application/json")
		res.end(JSON.stringify(this.deviceInfo))
	}

	private async handleRegister(req: IncomingMessage, res: ServerResponse) {
		// Parse the request body
		const body = await this.parseJsonBody<DeviceInfo>(req)

		if (!body) {
			res.statusCode = 400
			res.end(JSON.stringify({ message: "Invalid body" }))
			return
		}

		// Send our device info as response
		res.setHeader("Content-Type", "application/json")
		res.end(JSON.stringify(this.deviceInfo))
	}

	private async handlePrepareUpload(req: IncomingMessage, res: ServerResponse) {
		// Parse the request body
		const body = await this.parseJsonBody<PrepareUploadRequest>(req)

		if (!body) {
			res.statusCode = 400
			res.end(JSON.stringify({ message: "Invalid body" }))
			return
		}

		// Check PIN if required
		const url = new URL(req.url || "/", `http://${req.headers.host}`)
		if (this.requirePin) {
			const pinParam = url.searchParams.get("pin")
			if (!pinParam || pinParam !== this.pin) {
				res.statusCode = 401
				res.end(JSON.stringify({ message: "PIN required" }))
				return
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

		// Send the response
		res.setHeader("Content-Type", "application/json")
		res.statusCode = 200
		res.end(JSON.stringify(response))
	}

	private async handleUpload(req: IncomingMessage, res: ServerResponse) {
		// Get query parameters
		const url = new URL(req.url || "/", `http://${req.headers.host}`)
		const sessionId = url.searchParams.get("sessionId")
		const fileId = url.searchParams.get("fileId")
		const token = url.searchParams.get("token")

		// Validate parameters
		if (!sessionId || !fileId || !token) {
			res.statusCode = 400
			res.end(JSON.stringify({ message: "Missing parameters" }))
			return
		}

		// Check if session exists
		const session = this.activeSessions.get(sessionId)
		if (!session) {
			res.statusCode = 404
			res.end(JSON.stringify({ message: "Session not found" }))
			return
		}

		// Validate token
		if (session.tokens[fileId] !== token) {
			res.statusCode = 403
			res.end(JSON.stringify({ message: "Invalid token" }))
			return
		}

		// Check if file was accepted
		if (!session.acceptedFiles.includes(fileId)) {
			res.statusCode = 403
			res.end(JSON.stringify({ message: "File not accepted" }))
			return
		}

		// Get file metadata
		const fileMetadata = session.files[fileId]
		if (!fileMetadata) {
			res.statusCode = 404
			res.end(JSON.stringify({ message: "File metadata not found" }))
			return
		}

		try {
			// Create file path
			const filePath = path.join(this.saveDirectory, fileMetadata.fileName)

			// Ensure the directory exists (create all parent directories if they don't)
			const dirPath = path.dirname(filePath)
			if (!fs.existsSync(dirPath)) {
				fs.mkdirSync(dirPath, { recursive: true })
			}

			// Create write stream
			const writeStream = fs.createWriteStream(filePath)

			// Pipe the request to the file
			req.pipe(writeStream)

			// Handle completion
			writeStream.on("finish", () => {
				// Mark file as received
				session.receivedFiles.add(fileId)

				// Check if all files have been received
				if (session.receivedFiles.size === session.acceptedFiles.length) {
					// All files received, clean up the session
					this.activeSessions.delete(sessionId)
				}

				// Send success response
				res.statusCode = 200
				res.end()
			})

			// Handle errors
			writeStream.on("error", (err) => {
				console.error("Error writing file:", err)
				res.statusCode = 500
				res.end(JSON.stringify({ message: "Error writing file" }))
			})
		} catch (err) {
			console.error("Error preparing file write:", err)
			res.statusCode = 500
			res.end(JSON.stringify({ message: "Error preparing file write" }))
		}
	}

	private async handleCancel(req: IncomingMessage, res: ServerResponse) {
		// Get session ID from query parameters
		const url = new URL(req.url || "/", `http://${req.headers.host}`)
		const sessionId = url.searchParams.get("sessionId")

		if (!sessionId) {
			res.statusCode = 400
			res.end(JSON.stringify({ message: "Missing sessionId" }))
			return
		}

		// Check if session exists
		if (this.activeSessions.has(sessionId)) {
			// Delete the session
			this.activeSessions.delete(sessionId)
		}

		// Send success response
		res.statusCode = 200
		res.end()
	}

	private parseJsonBody<T>(req: IncomingMessage): Promise<T | null> {
		return new Promise((resolve) => {
			let body = ""

			req.on("data", (chunk) => {
				body += chunk.toString()
			})

			req.on("end", () => {
				try {
					resolve(JSON.parse(body) as T)
				} catch (err) {
					console.error("Error parsing JSON body:", err)
					resolve(null)
				}
			})

			req.on("error", (err) => {
				console.error("Error reading request body:", err)
				resolve(null)
			})
		})
	}
}

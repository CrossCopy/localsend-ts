import { randomBytes } from "node:crypto"
import type { DeviceInfo, FileMetadata } from "../protocol/types.ts"

export type UploadSession = {
	info: DeviceInfo
	files: Record<string, FileMetadata>
	tokens: Record<string, string>
	acceptedFiles: string[]
	receivedFiles: Set<string>
}

export class UploadSessionStore {
	private sessions = new Map<string, UploadSession>()

	create(info: DeviceInfo, files: Record<string, FileMetadata>) {
		const sessionId = randomBytes(16).toString("hex")
		const tokens: Record<string, string> = {}
		for (const fileId of Object.keys(files)) tokens[fileId] = randomBytes(16).toString("hex")
		this.sessions.set(sessionId, {
			info,
			files,
			tokens,
			acceptedFiles: Object.keys(files),
			receivedFiles: new Set()
		})
		return { sessionId, tokens }
	}

	get(sessionId: string): UploadSession | undefined {
		return this.sessions.get(sessionId)
	}

	has(sessionId: string): boolean {
		return this.sessions.has(sessionId)
	}

	validateToken(sessionId: string, fileId: string, token: string): boolean {
		const s = this.sessions.get(sessionId)
		return !!s && s.tokens[fileId] === token
	}

	markReceived(sessionId: string, fileId: string): { allDone: boolean } {
		const s = this.sessions.get(sessionId)
		if (!s) return { allDone: false }
		s.receivedFiles.add(fileId)
		const allDone = s.receivedFiles.size === s.acceptedFiles.length
		if (allDone) this.sessions.delete(sessionId)
		return { allDone }
	}

	delete(sessionId: string): void {
		this.sessions.delete(sessionId)
	}
}

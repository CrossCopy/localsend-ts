import { randomBytes } from "node:crypto"
import type { DeviceInfo, FileMetadata } from "../protocol/types.ts"
import type { StagedFile } from "./files.ts"

export type UploadSession = {
	info: DeviceInfo
	files: Record<string, FileMetadata>
	tokens: Record<string, string>
	acceptedFiles: string[]
	receivedFiles: Set<string>
	createdAt: number
	abortController: AbortController
	cancelled: boolean
	activeUploads: number
}

export class UploadSessionStore {
	private sessions = new Map<string, UploadSession>()

	constructor(private ttlMs: number = 3_600_000) {}

	purgeExpired(now: number = Date.now()): void {
		for (const [id, s] of this.sessions) {
			if (now - s.createdAt > this.ttlMs && s.activeUploads === 0) {
				s.abortController.abort()
				this.sessions.delete(id)
			}
		}
	}

	create(info: DeviceInfo, files: Record<string, FileMetadata>, acceptedFileIds?: string[]) {
		this.purgeExpired()
		const sessionId = randomBytes(16).toString("hex")
		const accepted = acceptedFileIds ?? Object.keys(files)
		const tokens: Record<string, string> = {}
		for (const fileId of accepted) {
			if (files[fileId]) tokens[fileId] = randomBytes(16).toString("hex")
		}
		this.sessions.set(sessionId, {
			info,
			files,
			tokens,
			acceptedFiles: accepted.filter((id) => Boolean(files[id])),
			receivedFiles: new Set(),
			createdAt: Date.now(),
			abortController: new AbortController(),
			cancelled: false,
			activeUploads: 0
		})
		return { sessionId, tokens }
	}

	get(sessionId: string): UploadSession | undefined {
		const s = this.sessions.get(sessionId)
		if (!s) return undefined
		if (s.cancelled) return undefined
		if (Date.now() - s.createdAt > this.ttlMs && s.activeUploads === 0) {
			this.sessions.delete(sessionId)
			return undefined
		}
		return s
	}

	has(sessionId: string): boolean {
		const s = this.sessions.get(sessionId)
		return !!s && !s.cancelled
	}

	validateToken(sessionId: string, fileId: string, token: string): boolean {
		const s = this.sessions.get(sessionId)
		return !!s && !s.cancelled && s.tokens[fileId] === token
	}

	beginUpload(sessionId: string): UploadSession | undefined {
		const s = this.get(sessionId)
		if (!s || s.cancelled) return undefined
		s.activeUploads += 1
		return s
	}

	endUpload(sessionId: string): void {
		const s = this.sessions.get(sessionId)
		if (!s) return
		s.activeUploads = Math.max(0, s.activeUploads - 1)
		if (s.cancelled && s.activeUploads === 0) {
			this.sessions.delete(sessionId)
		}
	}

	markReceived(sessionId: string, fileId: string): { allDone: boolean } {
		const s = this.sessions.get(sessionId)
		if (!s || s.cancelled) return { allDone: false }
		s.receivedFiles.add(fileId)
		const allDone = s.receivedFiles.size === s.acceptedFiles.length
		if (allDone) this.sessions.delete(sessionId)
		return { allDone }
	}

	cancel(sessionId: string): boolean {
		const s = this.sessions.get(sessionId)
		if (!s) return false
		s.cancelled = true
		s.abortController.abort()
		if (s.activeUploads === 0) {
			this.sessions.delete(sessionId)
		}
		return true
	}

	delete(sessionId: string): void {
		const s = this.sessions.get(sessionId)
		if (s) {
			s.cancelled = true
			s.abortController.abort()
		}
		this.sessions.delete(sessionId)
	}

	clear(): void {
		for (const s of this.sessions.values()) {
			s.cancelled = true
			s.abortController.abort()
		}
		this.sessions.clear()
	}
}

export type DownloadSession = { files: Record<string, StagedFile>; createdAt: number }

export class DownloadSessionStore {
	private sessions = new Map<string, DownloadSession>()

	constructor(private ttlMs: number = 3_600_000) {}

	purgeExpired(now: number = Date.now()): void {
		for (const [id, s] of this.sessions) {
			if (now - s.createdAt > this.ttlMs) this.sessions.delete(id)
		}
	}

	create(files: StagedFile[]): string {
		this.purgeExpired()
		const sessionId = randomBytes(16).toString("hex")
		const map: Record<string, StagedFile> = {}
		for (const f of files) map[f.fileId] = f
		this.sessions.set(sessionId, { files: map, createdAt: Date.now() })
		return sessionId
	}

	get(sessionId: string): DownloadSession | undefined {
		const s = this.sessions.get(sessionId)
		if (!s) return undefined
		if (Date.now() - s.createdAt > this.ttlMs) {
			this.sessions.delete(sessionId)
			return undefined
		}
		return s
	}

	getFile(sessionId: string, fileId: string): StagedFile | undefined {
		return this.get(sessionId)?.files[fileId]
	}

	delete(sessionId: string): void {
		this.sessions.delete(sessionId)
	}
}

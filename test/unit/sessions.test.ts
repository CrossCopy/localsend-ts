import { test, expect } from "bun:test"
import { UploadSessionStore } from "../../src/core/sessions.ts"
import type { DeviceInfo, FileMetadata } from "../../src/protocol/types.ts"

const info = {
	alias: "a",
	version: "2.1",
	deviceModel: null,
	deviceType: "desktop",
	fingerprint: "fp",
	port: 53317,
	protocol: "http",
	download: false
} as DeviceInfo
const files: Record<string, FileMetadata> = {
	f1: { id: "f1", fileName: "a.txt", size: 3, fileType: "text/plain" },
	f2: { id: "f2", fileName: "b.txt", size: 3, fileType: "text/plain" }
}

test("create issues a sessionId and one token per file", () => {
	const store = new UploadSessionStore()
	const { sessionId, tokens } = store.create(info, files)
	expect(sessionId).toHaveLength(32)
	expect(Object.keys(tokens).sort()).toEqual(["f1", "f2"])
	expect(store.validateToken(sessionId, "f1", tokens.f1)).toBe(true)
	expect(store.validateToken(sessionId, "f1", "wrong")).toBe(false)
})

test("markReceived reports allDone when every file arrives", () => {
	const store = new UploadSessionStore()
	const { sessionId } = store.create(info, files)
	expect(store.markReceived(sessionId, "f1").allDone).toBe(false)
	expect(store.markReceived(sessionId, "f2").allDone).toBe(true)
})

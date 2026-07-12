import { test, expect } from "bun:test"
import { UploadSessionStore, DownloadSessionStore } from "../../src/core/sessions.ts"
import type { DeviceInfo, FileMetadata } from "../../src/protocol/types.ts"
import type { StagedFile } from "../../src/core/files.ts"

const info = {
	alias: "a",
	version: "2.1",
	fingerprint: "fp",
	port: 1,
	protocol: "http",
	download: false
} as DeviceInfo
const files: Record<string, FileMetadata> = {
	f1: { id: "f1", fileName: "a", size: 1, fileType: "x" }
}

test("expired upload sessions are purged on next create", () => {
	const store = new UploadSessionStore(1000) // 1s ttl
	const { sessionId } = store.create(info, files)
	// force expiry by purging with a future clock
	store.purgeExpired(Date.now() + 5000)
	expect(store.get(sessionId)).toBeUndefined()
})

test("fresh sessions survive purge", () => {
	const store = new UploadSessionStore(1000)
	const { sessionId } = store.create(info, files)
	store.purgeExpired(Date.now())
	expect(store.get(sessionId)).toBeTruthy()
})

test("expired download sessions are purged on next create", () => {
	const store = new DownloadSessionStore(1000) // 1s ttl
	const staged: StagedFile = {
		fileId: "f1",
		metadata: { id: "f1", fileName: "a", size: 1, fileType: "x" },
		absolutePath: "/tmp/a"
	}
	const sessionId = store.create([staged])
	// force expiry by purging with a future clock
	store.purgeExpired(Date.now() + 5000)
	expect(store.get(sessionId)).toBeUndefined()
})

test("fresh download sessions survive purge", () => {
	const store = new DownloadSessionStore(1000)
	const staged: StagedFile = {
		fileId: "f1",
		metadata: { id: "f1", fileName: "a", size: 1, fileType: "x" },
		absolutePath: "/tmp/a"
	}
	const sessionId = store.create([staged])
	store.purgeExpired(Date.now())
	expect(store.get(sessionId)).toBeTruthy()
})

test("DownloadSessionStore.get enforces TTL on access, not just on create", async () => {
	const store = new DownloadSessionStore(5)
	const staged: StagedFile = {
		fileId: "f1",
		metadata: { id: "f1", fileName: "a", size: 1, fileType: "x" },
		absolutePath: "/tmp/a"
	}
	const sessionId = store.create([staged])
	await Bun.sleep(40)
	expect(store.get(sessionId)).toBeUndefined()
	expect(store.getFile(sessionId, "f1")).toBeUndefined()
})

test("DownloadSessionStore.get still returns unexpired sessions", async () => {
	const store = new DownloadSessionStore(10_000)
	const staged: StagedFile = {
		fileId: "f1",
		metadata: { id: "f1", fileName: "a", size: 1, fileType: "x" },
		absolutePath: "/tmp/a"
	}
	const sessionId = store.create([staged])
	await Bun.sleep(40)
	expect(store.get(sessionId)).toBeTruthy()
	expect(store.getFile(sessionId, "f1")).toBeTruthy()
})

test("UploadSessionStore.get enforces TTL on access, not just on create", async () => {
	const store = new UploadSessionStore(5)
	const { sessionId } = store.create(info, files)
	await Bun.sleep(40)
	expect(store.get(sessionId)).toBeUndefined()
})

test("UploadSessionStore.get still returns unexpired sessions", async () => {
	const store = new UploadSessionStore(10_000)
	const { sessionId } = store.create(info, files)
	await Bun.sleep(40)
	expect(store.get(sessionId)).toBeTruthy()
})

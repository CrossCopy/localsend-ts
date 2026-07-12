import { test, expect } from "bun:test"
import path from "node:path"
import { DownloadSessionStore } from "../../src/core/sessions.ts"
import { stageFile } from "../../src/core/files.ts"
import { tempDir, rmTemp, makeRandomFile } from "../helpers/util.ts"

test("stageFile builds a StagedFile with metadata + absolute path", async () => {
	const dir = await tempDir()
	try {
		const { path: p } = await makeRandomFile(dir, "doc.bin", 2048)
		const staged = await stageFile(p)
		expect(staged.absolutePath).toBe(path.resolve(p))
		expect(staged.metadata.fileName).toBe("doc.bin")
		expect(staged.metadata.size).toBe(2048)
		expect(staged.fileId).toBe(staged.metadata.id)
	} finally {
		await rmTemp(dir)
	}
})

test("DownloadSessionStore create/get/getFile round-trips", async () => {
	const dir = await tempDir()
	try {
		const { path: p } = await makeRandomFile(dir, "a.bin", 10)
		const staged = await stageFile(p)
		const store = new DownloadSessionStore()
		const sessionId = store.create([staged])
		expect(sessionId).toHaveLength(32)
		const session = store.get(sessionId)
		expect(session).toBeTruthy()
		expect(session!.files[staged.fileId].absolutePath).toBe(staged.absolutePath)
		expect(store.getFile(sessionId, staged.fileId)!.metadata.size).toBe(10)
		expect(store.getFile(sessionId, "nope")).toBeUndefined()
		store.delete(sessionId)
		expect(store.get(sessionId)).toBeUndefined()
	} finally {
		await rmTemp(dir)
	}
})

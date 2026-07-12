import { test, expect } from "bun:test"
import { getDeviceInfo } from "../../src/utils/device.ts"
import { LocalSendServer } from "../../src/server/server.ts"
import { LocalSendClient } from "../../src/core/send.ts"
import { buildFileMetadataFromPath } from "../../src/core/files.ts"
import { getFreePort, tempDir, rmTemp, makeRandomFile, sha256File } from "../helpers/util.ts"
import path from "node:path"

test("upload over HTTPS (self-signed) is byte-for-byte", async () => {
	const src = await tempDir()
	const saveDir = await tempDir()
	const port = await getFreePort()
	const server = new LocalSendServer(getDeviceInfo({ alias: "R", port }), {
		protocol: "https",
		saveDirectory: saveDir,
		onTransferRequest: async () => true
	})
	await server.start()
	const client = new LocalSendClient(getDeviceInfo({ alias: "S" }))
	const target = { ip: "127.0.0.1", port, protocol: "https" as const }
	try {
		const f = await makeRandomFile(src, "tls.bin", 1024 * 1024)
		const { fileId, fileMetadata } = await buildFileMetadataFromPath(f.path)
		const prep = await client.prepareUpload(target, { [fileId]: fileMetadata })
		expect(prep && prep.files[fileId]).toBeTruthy()
		const ok = await client.uploadFile(target, prep!.sessionId, fileId, prep!.files[fileId], f.path)
		expect(ok).toBe(true)
		expect(await sha256File(path.join(saveDir, "tls.bin"))).toBe(f.sha256)
	} finally {
		await server.stop()
		await rmTemp(src)
		await rmTemp(saveDir)
	}
})

test("download over HTTPS (self-signed) is byte-for-byte", async () => {
	const dir = await tempDir()
	const outDir = await tempDir()
	const port = await getFreePort()
	const shared = await makeRandomFile(dir, "share.bin", 1024 * 1024)
	const server = new LocalSendServer(getDeviceInfo({ alias: "Sharer", port }), {
		protocol: "https",
		sharedFiles: [shared.path]
	})
	await server.start()
	const client = new LocalSendClient(getDeviceInfo({ alias: "D" }))
	const target = { ip: "127.0.0.1", port, protocol: "https" as const }
	try {
		const meta = await client.prepareDownload(target)
		expect(meta).toBeTruthy()
		const fileId = Object.keys(meta!.files)[0]
		const out = path.join(outDir, "got.bin")
		expect(await client.download(target, meta!.sessionId, fileId, out)).toBe(true)
		expect(await sha256File(out)).toBe(shared.sha256)
	} finally {
		await server.stop()
		await rmTemp(dir)
		await rmTemp(outDir)
	}
})

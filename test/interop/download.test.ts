import { test, expect } from "bun:test"
import { getDeviceInfo } from "../../src/utils/device.ts"
import { LocalSendServer } from "../../src/server/server.ts"
import { LocalSendClient } from "../../src/core/send.ts"
import { getFreePort, tempDir, rmTemp, makeRandomFile, sha256File } from "../helpers/util.ts"
import path from "node:path"

test("client downloads a shared file byte-for-byte (incl 60MB)", async () => {
	const dir = await tempDir()
	const outDir = await tempDir()
	const big = await makeRandomFile(dir, "big.bin", 60 * 1024 * 1024)
	const port = await getFreePort()
	const server = new LocalSendServer(getDeviceInfo({ alias: "Sharer", port }), {
		sharedFiles: [big.path]
	})
	await server.start()
	const client = new LocalSendClient(getDeviceInfo({ alias: "Downloader" }))
	const target = { ip: "127.0.0.1", port, protocol: "http" as const }
	try {
		const meta = await client.prepareDownload(target)
		expect(meta).toBeTruthy()
		const fileId = Object.keys(meta!.files)[0]
		const out = path.join(outDir, "got.bin")
		expect(await client.download(target, meta!.sessionId, fileId, out)).toBe(true)
		expect(await sha256File(out)).toBe(big.sha256)
	} finally {
		await server.stop()
		await rmTemp(dir)
		await rmTemp(outDir)
	}
})

import { test, expect } from "bun:test"
import { getDeviceInfo } from "../../src/utils/device.ts"
import { LocalSendServer } from "../../src/server/server.ts"
import { getFreePort, tempDir, rmTemp, makeRandomFile } from "../helpers/util.ts"

test("GET / lists shared files with download links", async () => {
	const dir = await tempDir()
	const src = await makeRandomFile(dir, "photo.bin", 32)
	const port = await getFreePort()
	const server = new LocalSendServer(getDeviceInfo({ alias: "Sharer", port }), {
		sharedFiles: [src.path]
	})
	await server.start()
	try {
		const res = await fetch(`http://127.0.0.1:${port}/`)
		expect(res.status).toBe(200)
		expect(res.headers.get("content-type") || "").toContain("text/html")
		const html = await res.text()
		expect(html).toContain("photo.bin")
		expect(html).toContain("/api/localsend/v2/download?sessionId=")
	} finally {
		await server.stop()
		await rmTemp(dir)
	}
})

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

test("GET / does not bypass the PIN required for prepare-download", async () => {
	const dir = await tempDir()
	const src = await makeRandomFile(dir, "secret.bin", 32)
	const port = await getFreePort()
	const server = new LocalSendServer(getDeviceInfo({ alias: "Sharer", port }), {
		sharedFiles: [src.path],
		pin: "4242"
	})
	await server.start()
	try {
		const base = `http://127.0.0.1:${port}`
		const res = await fetch(`${base}/`)
		expect(res.status).toBe(401)
		const body = await res.text()
		expect(body).not.toContain("sessionId")

		const noPin = await fetch(`${base}/api/localsend/v2/prepare-download`, { method: "POST" })
		expect(noPin.status).toBe(401)

		const withPin = await fetch(`${base}/api/localsend/v2/prepare-download?pin=4242`, {
			method: "POST"
		})
		expect(withPin.status).toBe(200)
		const { sessionId, files } = (await withPin.json()) as any
		const fileId = Object.keys(files)[0]
		const dl = await fetch(
			`${base}/api/localsend/v2/download?sessionId=${sessionId}&fileId=${fileId}`
		)
		expect(dl.status).toBe(200)
	} finally {
		await server.stop()
		await rmTemp(dir)
	}
})

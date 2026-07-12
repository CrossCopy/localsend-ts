import { test, expect } from "bun:test"
import { createServer } from "node:http"
import { getFreePort, tempDir, rmTemp, makeRandomFile } from "../helpers/util.ts"
import { getDeviceInfo } from "../../src/utils/device.ts"
import { LocalSendClient } from "../../src/core/send.ts"

test("uploadFile sends the whole file in ONE request with no X-Content-Range (60MB)", async () => {
	const dir = await tempDir()
	const port = await getFreePort()
	const requests: { rangeHeader: string | undefined; bytes: number }[] = []

	const server = createServer((req, res) => {
		let bytes = 0
		req.on("data", (c) => (bytes += c.length))
		req.on("end", () => {
			requests.push({ rangeHeader: req.headers["x-content-range"] as string | undefined, bytes })
			res.statusCode = 200
			res.end(JSON.stringify({ message: "ok" }))
		})
	})
	await new Promise<void>((r) => server.listen(port, r))

	try {
		const { path: filePath } = await makeRandomFile(dir, "big.bin", 60 * 1024 * 1024)
		const client = new LocalSendClient(getDeviceInfo({ alias: "s" }))
		const ok = await client.uploadFile(
			{ ip: "127.0.0.1", port, protocol: "http" },
			"sess",
			"fid",
			"tok",
			filePath
		)
		expect(ok).toBe(true)
		expect(requests).toHaveLength(1)
		expect(requests[0].rangeHeader).toBeUndefined()
		expect(requests[0].bytes).toBe(60 * 1024 * 1024)
	} finally {
		await new Promise<void>((r) => server.close(() => r()))
		await rmTemp(dir)
	}
})

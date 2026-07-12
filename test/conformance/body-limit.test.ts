import { test, expect } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { getDeviceInfo } from "../../src/utils/device.ts"
import { LocalSendServer } from "../../src/server/server.ts"
import { getFreePort, tempDir, rmTemp } from "../helpers/util.ts"

// Exercises the Hono app's fetch handler directly (server.app.fetch), bypassing
// Bun.serve()'s own maxRequestBodySize. This is what actually runs on every
// runtime (Bun/Node/Deno) via the respective adapters, and on Node/Deno there is
// no OS-level body-size enforcement at all -- so this is the only place a
// cross-runtime body limit can be enforced.
test("upload exceeding maxRequestBodySize is rejected instead of being saved", async () => {
	const dir = await tempDir()
	const port = await getFreePort()
	const server = new LocalSendServer(getDeviceInfo({ alias: "probe", port }), {
		saveDirectory: dir,
		maxRequestBodySize: 1024,
		onTransferRequest: async () => true
	})
	try {
		const base = `http://127.0.0.1:${port}/api/localsend/v2`
		const info = {
			alias: "x",
			version: "2.1",
			deviceModel: null,
			deviceType: "headless",
			fingerprint: "fp",
			port,
			protocol: "http",
			download: false
		}
		const size = 5000
		const prepReq = new Request(`${base}/prepare-upload`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				info,
				files: { f1: { id: "f1", fileName: "big.bin", size, fileType: "text/plain" } }
			})
		})
		const prep = await server.app.fetch(prepReq)
		expect(prep.status).toBe(200)
		const { sessionId, files } = (await prep.json()) as any

		const payload = new Uint8Array(size).fill(65)
		const upReq = new Request(`${base}/upload?sessionId=${sessionId}&fileId=f1&token=${files.f1}`, {
			method: "POST",
			// Explicit content-length so the bodyLimit fast path fires deterministically
			// (constructing a Request in-process doesn't always populate it automatically).
			headers: { "content-length": String(size) },
			body: payload
		})
		const up = await server.app.fetch(upReq)
		// Bun's own limit may intercept first with a different status in other contexts,
		// but at the Hono-app level (what Node/Deno rely on) this must reject.
		expect(up.status).toBeGreaterThanOrEqual(400)
		expect(existsSync(path.join(dir, "big.bin"))).toBe(false)
	} finally {
		await server.stop()
		await rmTemp(dir)
	}
})

import { test, expect } from "bun:test"
import { startReceiver } from "../helpers/harness.ts"

test("prepare-upload with empty files returns 204", async () => {
	const receiver = await startReceiver({ autoAccept: true })
	try {
		const base = `http://127.0.0.1:${receiver.port}/api/localsend/v2`
		const info = {
			alias: "x",
			version: "2.1",
			deviceType: "headless",
			fingerprint: "fp",
			port: receiver.port,
			protocol: "http"
		}
		const res = await fetch(`${base}/prepare-upload`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ info, files: {} })
		})
		expect(res.status).toBe(204)
	} finally {
		await receiver.stop()
	}
})

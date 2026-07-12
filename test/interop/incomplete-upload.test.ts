import { test, expect } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { startReceiver } from "../helpers/harness.ts"

test("rejects a truncated upload body instead of marking it received", async () => {
	const receiver = await startReceiver({ autoAccept: true })
	try {
		const base = `http://127.0.0.1:${receiver.port}/api/localsend/v2`
		const info = {
			alias: "x",
			version: "2.1",
			deviceModel: null,
			deviceType: "headless",
			fingerprint: "fp",
			port: receiver.port,
			protocol: "http",
			download: false
		}
		const prep = await fetch(`${base}/prepare-upload`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				info,
				files: { f1: { id: "f1", fileName: "truncated.bin", size: 100, fileType: "text/plain" } }
			})
		})
		expect(prep.ok).toBe(true)
		const { sessionId, files } = (await prep.json()) as any

		// Declared size is 100 bytes but we only send 10 -- a truncated / lying client.
		const shortBody = "A".repeat(10)
		const up = await fetch(`${base}/upload?sessionId=${sessionId}&fileId=f1&token=${files.f1}`, {
			method: "POST",
			body: shortBody
		})

		expect(up.status).toBeGreaterThanOrEqual(400)
		expect(existsSync(path.join(receiver.saveDir, "truncated.bin"))).toBe(false)
	} finally {
		await receiver.stop()
	}
})

test("a full-size upload still succeeds", async () => {
	const receiver = await startReceiver({ autoAccept: true })
	try {
		const base = `http://127.0.0.1:${receiver.port}/api/localsend/v2`
		const info = {
			alias: "x",
			version: "2.1",
			deviceModel: null,
			deviceType: "headless",
			fingerprint: "fp",
			port: receiver.port,
			protocol: "http",
			download: false
		}
		const body = "B".repeat(100)
		const prep = await fetch(`${base}/prepare-upload`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				info,
				files: { f1: { id: "f1", fileName: "complete.bin", size: 100, fileType: "text/plain" } }
			})
		})
		expect(prep.ok).toBe(true)
		const { sessionId, files } = (await prep.json()) as any

		const up = await fetch(`${base}/upload?sessionId=${sessionId}&fileId=f1&token=${files.f1}`, {
			method: "POST",
			body
		})

		expect(up.status).toBe(200)
		expect(existsSync(path.join(receiver.saveDir, "complete.bin"))).toBe(true)
	} finally {
		await receiver.stop()
	}
})

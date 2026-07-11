import { test, expect } from "bun:test"
import path from "node:path"
import { existsSync } from "node:fs"
import { startReceiver } from "../helpers/harness.ts"

test("rejects filename that escapes the save directory", async () => {
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
		const evil = "../ESCAPED.txt"
		const prep = await fetch(`${base}/prepare-upload`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				info,
				files: { f1: { id: "f1", fileName: evil, size: 5, fileType: "text/plain" } }
			})
		})
		expect(prep.ok).toBe(true)
		const { sessionId, files } = (await prep.json()) as any
		const up = await fetch(`${base}/upload?sessionId=${sessionId}&fileId=f1&token=${files.f1}`, {
			method: "POST",
			body: "HELLO"
		})
		// escaped path must NOT exist
		const escaped = path.resolve(receiver.saveDir, "..", "ESCAPED.txt")
		expect(existsSync(escaped)).toBe(false)
		// server should have rejected the write (non-2xx) OR written safely inside saveDir
		if (up.ok) {
			expect(existsSync(path.join(receiver.saveDir, "ESCAPED.txt"))).toBe(false)
		} else {
			expect(up.status).toBeGreaterThanOrEqual(400)
		}
	} finally {
		await receiver.stop()
	}
})

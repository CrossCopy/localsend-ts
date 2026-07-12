import { test, expect } from "bun:test"
import * as v from "valibot"
import { prepareDownloadResponseSchema } from "../../src/protocol/types.ts"
import { getDeviceInfo } from "../../src/utils/device.ts"
import { LocalSendServer } from "../../src/server/server.ts"
import { getFreePort, tempDir, rmTemp, makeRandomFile } from "../helpers/util.ts"

test("prepareDownloadResponseSchema accepts the real prepare-download response shape", () => {
	const info = getDeviceInfo({ alias: "x", port: 53317 })
	const result = v.parse(prepareDownloadResponseSchema, {
		info,
		sessionId: "s",
		files: {
			f1: { id: "f1", fileName: "a.bin", size: 10, fileType: "application/octet-stream" }
		}
	})
	expect(result.sessionId).toBe("s")
	expect(result.files.f1.fileName).toBe("a.bin")
})

test("openapi document's prepare-download 200 response is not the message-only shape", async () => {
	const dir = await tempDir()
	const src = await makeRandomFile(dir, "shared.bin", 16)
	const port = await getFreePort()
	const server = new LocalSendServer(getDeviceInfo({ alias: "Sharer", port }), {
		sharedFiles: [src.path]
	})
	await server.start()
	try {
		const res = await fetch(`http://127.0.0.1:${port}/openapi`)
		expect(res.status).toBe(200)
		const doc = (await res.json()) as any
		const responseSchema =
			doc.paths["/api/localsend/v2/prepare-download"].post.responses["200"].content[
				"application/json"
			].schema
		const serialized = JSON.stringify(responseSchema)
		expect(serialized).toContain("sessionId")
	} finally {
		await server.stop()
		await rmTemp(dir)
	}
})

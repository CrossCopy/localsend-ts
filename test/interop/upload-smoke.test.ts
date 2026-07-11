import { test, expect } from "bun:test"
import { startReceiver, sendFile, savedPath } from "../helpers/harness.ts"
import { tempDir, rmTemp, makeRandomFile, sha256File } from "../helpers/util.ts"

test("uploads a small file byte-for-byte (TS -> TS)", async () => {
	const src = await tempDir()
	const receiver = await startReceiver({ autoAccept: true })
	try {
		const { path: filePath, sha256 } = await makeRandomFile(src, "hello.bin", 1024)
		const ok = await sendFile(receiver, filePath)
		expect(ok).toBe(true)
		const got = await sha256File(savedPath(receiver, "hello.bin"))
		expect(got).toBe(sha256)
	} finally {
		await receiver.stop()
		await rmTemp(src)
	}
})

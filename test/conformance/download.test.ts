import { test, expect } from "bun:test"
import { getDeviceInfo } from "../../src/utils/device.ts"
import { LocalSendServer } from "../../src/server/server.ts"
import { getFreePort, tempDir, rmTemp, makeRandomFile, sha256File } from "../helpers/util.ts"
import { readFile } from "node:fs/promises"
import path from "node:path"

async function startSharer(files: string[], opts: { pin?: string } = {}) {
	const port = await getFreePort()
	const server = new LocalSendServer(getDeviceInfo({ alias: "Sharer", port }), {
		sharedFiles: files,
		pin: opts.pin
	})
	await server.start()
	return { port, stop: () => server.stop() }
}

test("prepare-download returns {info, sessionId, files}; download streams exact bytes", async () => {
	const dir = await tempDir()
	const src = await makeRandomFile(dir, "shared.bin", 4096)
	const sharer = await startSharer([src.path])
	try {
		const base = `http://127.0.0.1:${sharer.port}/api/localsend/v2`
		const prep = await fetch(`${base}/prepare-download`, { method: "POST" })
		expect(prep.status).toBe(200)
		const body = (await prep.json()) as any
		expect(body.sessionId).toBeTruthy()
		expect(body.info.alias).toBe("Sharer")
		const fileId = Object.keys(body.files)[0]
		expect(body.files[fileId].fileName).toBe("shared.bin")

		const dl = await fetch(`${base}/download?sessionId=${body.sessionId}&fileId=${fileId}`)
		expect(dl.status).toBe(200)
		const buf = Buffer.from(await dl.arrayBuffer())
		const outPath = path.join(dir, "downloaded.bin")
		await Bun.write(outPath, buf)
		expect(await sha256File(outPath)).toBe(src.sha256)
	} finally {
		await sharer.stop()
		await rmTemp(dir)
	}
})

test("prepare-download requires correct PIN", async () => {
	const dir = await tempDir()
	const src = await makeRandomFile(dir, "s.bin", 16)
	const sharer = await startSharer([src.path], { pin: "4242" })
	try {
		const base = `http://127.0.0.1:${sharer.port}/api/localsend/v2`
		expect((await fetch(`${base}/prepare-download`, { method: "POST" })).status).toBe(401)
		expect((await fetch(`${base}/prepare-download?pin=4242`, { method: "POST" })).status).toBe(200)
	} finally {
		await sharer.stop()
		await rmTemp(dir)
	}
})

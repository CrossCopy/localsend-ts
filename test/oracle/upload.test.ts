import { test, expect } from "bun:test"
import { spawn } from "node:child_process"
import path from "node:path"
import { getDeviceInfo } from "../../src/utils/device.ts"
import { LocalSendServer } from "../../src/server/server.ts"
import { getFreePort, tempDir, rmTemp, makeRandomFile, sha256File } from "../helpers/util.ts"
import { ORACLE_BIN, oracleAvailable } from "./oracle-helpers.ts"

const run = oracleAvailable()

// NOTE: the brief's reference implementation used `spawnSync`, but that blocks the JS
// main thread for the whole child process lifetime. Our server-under-test runs on Bun's
// native HTTP server, which dispatches each request to a JS `fetch` handler on that same
// thread -- so a synchronous spawn here would deadlock the oracle's HTTP calls against our
// own server. Using async `spawn` (awaited via a promise) keeps the event loop pumping so
// the server can actually answer the oracle's requests while we wait for it to exit.
function runOracle(args: string[], timeoutMs: number): Promise<{ status: number | null }> {
	return new Promise((resolve, reject) => {
		const child = spawn(ORACLE_BIN, args, { stdio: "ignore" })
		const timer = setTimeout(() => {
			child.kill()
			reject(new Error(`oracle timed out after ${timeoutMs}ms`))
		}, timeoutMs)
		child.on("error", (err) => {
			clearTimeout(timer)
			reject(err)
		})
		child.on("exit", (code) => {
			clearTimeout(timer)
			resolve({ status: code })
		})
	})
}

test.skipIf(!run)("official Rust v2 client uploads to our TS server byte-for-byte", async () => {
	const src = await tempDir()
	const saveDir = await tempDir()
	const port = await getFreePort()
	const server = new LocalSendServer(getDeviceInfo({ alias: "TS-Receiver", port }), {
		saveDirectory: saveDir,
		onTransferRequest: async () => true
	})
	await server.start()
	try {
		const f = await makeRandomFile(src, "oracle.bin", 3 * 1024 * 1024)
		const r = await runOracle(
			["send", "--host", "127.0.0.1", "--port", String(port), "--file", f.path],
			60000
		)
		expect(r.status).toBe(0)
		expect(await sha256File(path.join(saveDir, "oracle.bin"))).toBe(f.sha256)
	} finally {
		await server.stop()
		await rmTemp(src)
		await rmTemp(saveDir)
	}
})

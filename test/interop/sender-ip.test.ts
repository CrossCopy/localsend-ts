import { test, expect } from "bun:test"
import { getDeviceInfo } from "../../src/utils/device.ts"
import { LocalSendServer } from "../../src/server/server.ts"
import { getFreePort, tempDir, rmTemp } from "../helpers/util.ts"

// The LocalSend wire protocol does not carry the sender's IP in the prepare-upload
// body (`info` has no `ip` field) — the receiver only learns it from the socket.
// The official app fills it in via `dto.info.toDevice(request.ip, ...)`, and our own
// register route already attaches `ip: remoteAddress`. The upload path must do the same
// so the consent UI can show who is connecting.
test("onTransferRequest receives the sender's socket IP even though the wire body omits it", async () => {
	const port = await getFreePort()
	const saveDir = await tempDir()
	let handlerCalled = false
	let capturedIp: string | undefined
	const server = new LocalSendServer(getDeviceInfo({ alias: "Receiver", port }), {
		saveDirectory: saveDir,
		onTransferRequest: async (senderInfo) => {
			handlerCalled = true
			capturedIp = senderInfo.ip
			return false // decline — we only care what the handler was handed
		}
	})
	await server.start()
	try {
		const info = {
			alias: "Sender",
			version: "2.1",
			deviceModel: null,
			deviceType: "headless",
			fingerprint: "fp-sender",
			port,
			protocol: "http",
			download: false
		}
		const res = await fetch(`http://127.0.0.1:${port}/api/localsend/v2/prepare-upload`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				info,
				files: {
					f1: { id: "f1", fileName: "a.bin", size: 1, fileType: "application/octet-stream" }
				}
			})
		})
		expect(handlerCalled).toBe(true)
		expect(res.status).toBe(403)
		expect(capturedIp).toBeTruthy()
		expect(capturedIp).toMatch(/^(127\.0\.0\.1|::1|::ffff:127\.)/)
	} finally {
		await server.stop()
		await rmTemp(saveDir)
	}
})

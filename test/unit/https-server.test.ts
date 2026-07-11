import { test, expect } from "bun:test"
import { getDeviceInfo } from "../../src/utils/device.ts"
import { LocalSendServer } from "../../src/server/server.ts"
import { certFingerprintSha256 } from "../../src/crypto/cert.ts"
import { getFreePort } from "../helpers/util.ts"

test("https server auto-generates a cert and sets fingerprint = SHA-256(DER) uppercase", async () => {
	const port = await getFreePort()
	const server = new LocalSendServer(getDeviceInfo({ alias: "S", port }), { protocol: "https" })
	await server.start()
	try {
		const fp = server.deviceInfo.fingerprint
		expect(fp).toMatch(/^[0-9A-F]{64}$/)
		expect(server.deviceInfo.protocol).toBe("https")
		// fingerprint matches the generated cert
		expect(certFingerprintSha256(server.tlsCert!)).toBe(fp)
	} finally {
		await server.stop()
	}
})

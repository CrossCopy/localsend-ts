import { describe, expect, it } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PinGate, MAX_TRACKED_PEERS } from "../../src/server/pin.ts"
import { loadOrGenerateTlsCertificate } from "../../src/crypto/cert.ts"
import { selectMulticastInterfaces } from "../../src/discovery/multicast.ts"
import { HttpDiscovery } from "../../src/discovery/http-discovery.ts"
import { LocalSendServer } from "../../src/server/server.ts"
import { getDeviceInfo } from "../../src/utils/device.ts"

describe("localsend-rs alignment: PinGate", () => {
	it("missing PIN returns unauthorized without spending lockout budget", () => {
		const gate = new PinGate("123456")
		for (let i = 0; i < 10; i++) {
			expect(gate.check(undefined, "10.0.0.1")).toEqual({ status: "unauthorized" })
		}
		expect(gate.wrongGuessesSinceClear).toBe(0)
		expect(gate.check("123456", "10.0.0.1")).toEqual({ status: "ok", cleared: true })
	})

	it("locks out after 3 wrong PIN attempts and bounds tracked peers", () => {
		const gate = new PinGate("123456")
		expect(gate.check("000000", "10.0.0.2", 1000)).toEqual({ status: "unauthorized" })
		expect(gate.check("000000", "10.0.0.2", 1001)).toEqual({ status: "unauthorized" })
		expect(gate.check("000000", "10.0.0.2", 1002)).toEqual({ status: "unauthorized" })
		expect(gate.check("123456", "10.0.0.2", 1003)).toEqual({ status: "locked_out" })

		for (let i = 0; i < MAX_TRACKED_PEERS + 50; i++) {
			gate.check("bad", `10.1.${Math.floor(i / 255)}.${i % 255}`, 2000 + i)
		}
		expect(gate.trackedPeers).toBeLessThanOrEqual(MAX_TRACKED_PEERS)
	})

	it("supports runtime setPin and guessing pressure tracking", () => {
		const gate = new PinGate(null)
		expect(gate.check(undefined, "10.0.0.1")).toEqual({ status: "ok", cleared: false })
		gate.setPin("9999")
		expect(gate.check("1111", "10.0.0.1")).toEqual({ status: "unauthorized" })
		expect(gate.underGuessingPressure(1)).toBe(true)
		expect(gate.check("9999", "10.0.0.1")).toEqual({ status: "ok", cleared: true })
		expect(gate.underGuessingPressure(1)).toBe(false)
	})
})

describe("localsend-rs alignment: TLS persistence", () => {
	it("persists cert without changing fingerprint and loads from read-only dir", () => {
		const dir = mkdtempSync(join(tmpdir(), "ls-tls-"))
		try {
			const certPath = join(dir, "cert.pem")
			const keyPath = join(dir, "key.pem")
			const first = loadOrGenerateTlsCertificate(certPath, keyPath)
			const second = loadOrGenerateTlsCertificate(certPath, keyPath)
			expect(second.fingerprint).toBe(first.fingerprint)

			chmodSync(dir, 0o555)
			const readOnlyLoaded = loadOrGenerateTlsCertificate(certPath, keyPath)
			expect(readOnlyLoaded.fingerprint).toBe(first.fingerprint)
		} finally {
			chmodSync(dir, 0o755)
			rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe("localsend-rs alignment: multicast interface filtering", () => {
	it("drops container bridges when physical interfaces exist", () => {
		const addrs = selectMulticastInterfaces({
			en0: [
				{
					address: "192.168.1.10",
					netmask: "255.255.255.0",
					family: "IPv4",
					mac: "00:00:00:00:00:00",
					internal: false,
					cidr: "192.168.1.10/24"
				}
			],
			docker0: [
				{
					address: "172.17.0.1",
					netmask: "255.255.0.0",
					family: "IPv4",
					mac: "00:00:00:00:00:00",
					internal: false,
					cidr: "172.17.0.1/16"
				}
			],
			"br-abc": [
				{
					address: "172.18.0.1",
					netmask: "255.255.0.0",
					family: "IPv4",
					mac: "00:00:00:00:00:00",
					internal: false,
					cidr: "172.18.0.1/16"
				}
			]
		} as any)
		expect(addrs).toEqual(["192.168.1.10"])
	})
})

describe("localsend-rs alignment: server offer refusal, cancel, and probePeer", () => {
	it("refuses offer with 400 without leaking internal reason and cancels without stopping listener", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ls-srv-"))
		const server = new LocalSendServer(getDeviceInfo({ alias: "Receiver", port: 0 }), {
			saveDirectory: dir,
			onTransferRequest: async (_sender, files) => {
				const first = Object.values(files)[0]
				if (first?.fileName === "bad.bin") {
					return { action: "refuse", reason: "internal-policy-secret" }
				}
				return { action: "accept" }
			}
		})
		await server.start()
		const port = (server as any).server.port ?? (server as any).server.address?.()?.port
		try {
			const discovery = new HttpDiscovery(getDeviceInfo({ alias: "Prober", port: 59999 }))
			const probed = await discovery.probePeer("127.0.0.1", port)
			expect(probed?.alias).toBe("Receiver")
			expect(probed?.port).toBe(port)

			const refuseRes = await fetch(`http://127.0.0.1:${port}/api/localsend/v2/prepare-upload`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					info: getDeviceInfo({ alias: "Sender", port: 12345 }),
					files: {
						f1: { id: "f1", fileName: "bad.bin", size: 3, fileType: "application/octet-stream" }
					}
				})
			})
			expect(refuseRes.status).toBe(400)
			const refuseText = await refuseRes.text()
			expect(refuseText).not.toContain("internal-policy-secret")

			const acceptRes = await fetch(`http://127.0.0.1:${port}/api/localsend/v2/prepare-upload`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					info: getDeviceInfo({ alias: "Sender", port: 12345 }),
					files: {
						f2: { id: "f2", fileName: "good.txt", size: 5, fileType: "text/plain" }
					}
				})
			})
			expect(acceptRes.status).toBe(200)
			const prepared = (await acceptRes.json()) as {
				sessionId: string
				files: Record<string, string>
			}
			expect(server.cancelTransfer(prepared.sessionId)).toBe(true)

			const uploadAfterCancel = await fetch(
				`http://127.0.0.1:${port}/api/localsend/v2/upload?sessionId=${prepared.sessionId}&fileId=f2&token=${prepared.files["f2"]}`,
				{ method: "POST", body: "hello" }
			)
			expect(uploadAfterCancel.status).toBe(404)

			// Listener is still alive for subsequent requests
			const infoRes = await fetch(`http://127.0.0.1:${port}/api/localsend/v2/info`)
			expect(infoRes.status).toBe(200)
		} finally {
			await server.stop()
			rmSync(dir, { recursive: true, force: true })
		}
	})
})

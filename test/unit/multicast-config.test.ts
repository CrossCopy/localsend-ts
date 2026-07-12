import { test, expect } from "bun:test"
import { MulticastDiscovery } from "../../src/discovery/multicast.ts"
import { getDeviceInfo } from "../../src/utils/device.ts"
import { DEFAULT_CONFIG } from "../../src/protocol/constants.ts"

test("defaults to the protocol multicast group", () => {
	const d = new MulticastDiscovery(getDeviceInfo({ alias: "x" }))
	expect(d.multicastAddress).toBe(DEFAULT_CONFIG.MULTICAST_ADDRESS)
	expect(d.multicastPort).toBe(DEFAULT_CONFIG.MULTICAST_PORT)
	d.stop()
})

test("honors an injected multicast group (for test isolation)", () => {
	const d = new MulticastDiscovery(getDeviceInfo({ alias: "x" }), {
		multicastAddress: "239.1.2.3",
		multicastPort: 50000
	})
	expect(d.multicastAddress).toBe("239.1.2.3")
	expect(d.multicastPort).toBe(50000)
	d.stop()
})

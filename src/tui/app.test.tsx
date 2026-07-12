import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { getDeviceInfo } from "../index.ts"
import { App } from "./App.tsx"
import { createTuiStore, memoryControls, memoryDeps } from "./test-helpers.ts"
import type { DiscoveredDevice } from "./transfer.ts"

const info = getDeviceInfo({ alias: "TestDevice", port: 53317, enableDownloadApi: false })

const makeDevice = (ip: string, over: Partial<DiscoveredDevice> = {}): DiscoveredDevice => ({
	...info,
	alias: `Peer ${ip}`,
	fingerprint: `fp-${ip}`,
	ip,
	...over
})

test("renders the send tab dashboard with tab bar and status bar", async () => {
	const store = createTuiStore(info, memoryDeps())
	const { renderOnce, captureCharFrame, renderer } = await testRender(() => <App store={store} />, {
		width: 90,
		height: 30
	})
	await renderOnce()
	const frame = captureCharFrame()
	expect(frame).toContain("LocalSend")
	expect(frame).toContain("Send")
	expect(frame).toContain("Selection")
	expect(frame).toContain("Nearby devices")
	expect(frame).toContain("TestDevice")
	renderer.destroy()
})

test("devices pane lists discovered devices", async () => {
	const store = createTuiStore(info, memoryDeps())
	store.addDevice(makeDevice("10.0.0.9", { alias: "Kitchen Laptop" }))
	store.setPane("devices")
	const { renderOnce, captureCharFrame, renderer } = await testRender(() => <App store={store} />, {
		width: 90,
		height: 30
	})
	await renderOnce()
	const frame = captureCharFrame()
	expect(frame).toContain("Nearby devices (1)")
	expect(frame).toContain("Kitchen Laptop")
	expect(frame).toContain("10.0.0.9")
	renderer.destroy()
})

test("receive tab shows identity and quick save modes", async () => {
	const store = createTuiStore(info, memoryDeps())
	store.setTab("receive")
	const { renderOnce, captureCharFrame, renderer } = await testRender(() => <App store={store} />, {
		width: 90,
		height: 30
	})
	await renderOnce()
	const frame = captureCharFrame()
	expect(frame).toContain("You are visible as")
	expect(frame).toContain("Quick Save")
	renderer.destroy()
})

test("incoming request modal renders over the dashboard", async () => {
	const controls = memoryControls()
	const store = createTuiStore(info, controls.deps)
	await store.startServer()
	const sender = makeDevice("10.0.0.3", { alias: "Pixel", deviceType: "mobile" })
	void controls.fireRequest(sender, {
		a: {
			id: "a",
			fileName: "photo.png",
			size: 4200,
			fileType: "application/octet-stream",
			sha256: "x"
		}
	})
	const { renderOnce, captureCharFrame, renderer } = await testRender(() => <App store={store} />, {
		width: 90,
		height: 30
	})
	await renderOnce()
	const frame = captureCharFrame()
	expect(frame).toContain("Incoming from Pixel")
	expect(frame).toContain("photo.png")
	expect(frame).toContain("Y accept")
	renderer.destroy()
})

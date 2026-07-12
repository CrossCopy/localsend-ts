import { expect, test } from "bun:test"
import { getDeviceInfo } from "../index.ts"
import type { DeviceInfo, FileMetadata } from "../index.ts"
import type { DiscoveredDevice } from "./transfer.ts"
import { createTuiStore, type Persist, type PersistedConfig, type TuiDeps } from "./store.ts"

const info = getDeviceInfo({ alias: "TestDevice", port: 53317, enableDownloadApi: false })

const makeDevice = (ip: string, over: Partial<DiscoveredDevice> = {}): DiscoveredDevice => ({
	...info,
	alias: `Peer ${ip}`,
	fingerprint: `fp-${ip}`,
	ip,
	...over
})

function memoryPersist(initial: PersistedConfig = {}): {
	persist: Persist
	saved: PersistedConfig[]
} {
	const saved: PersistedConfig[] = []
	let current = initial
	return {
		saved,
		persist: {
			load: () => current,
			save: (config) => {
				current = config
				saved.push(config)
			}
		}
	}
}

function makeDeps(persistOverride?: { persist: Persist }) {
	const calls = {
		serverStart: 0,
		serverStop: 0,
		sentTexts: [] as string[],
		sentPaths: [] as string[]
	}
	let discoveredCb: ((device: DeviceInfo) => void) | null = null
	let requestHandler:
		| ((info: DeviceInfo, files: Record<string, FileMetadata>) => Promise<boolean>)
		| null = null
	const deps: TuiDeps = {
		createDiscovery: () => ({
			onDeviceDiscovered: (cb) => {
				discoveredCb = cb
			},
			start: async () => {},
			stop: () => {},
			announcePresence: () => {}
		}),
		createScanner: () => ({ onDeviceDiscovered: () => {}, startScan: async () => {} }),
		createServer: (_info, options) => {
			requestHandler = options?.onTransferRequest ?? null
			return {
				start: async () => {
					calls.serverStart++
				},
				stop: async () => {
					calls.serverStop++
				}
			}
		},
		sendText: async (_i, _d, message) => {
			calls.sentTexts.push(message)
			return { ok: true, message: "sent" }
		},
		sendPath: async (_i, _d, filePath) => {
			calls.sentPaths.push(filePath)
			return { ok: true, message: "sent" }
		},
		persist: persistOverride?.persist ?? memoryPersist().persist,
		now: () => 1000
	}
	return {
		deps,
		calls,
		emitDevice: (d: DeviceInfo) => discoveredCb?.(d),
		fireRequest: (i: DeviceInfo, files: Record<string, FileMetadata>) => requestHandler?.(i, files)
	}
}

const fileMeta = (
	id: string,
	name: string,
	size: number,
	over: Partial<FileMetadata> = {}
): FileMetadata => ({
	id,
	fileName: name,
	size,
	fileType: "application/octet-stream",
	sha256: "abc",
	...over
})

test("discovery dedupes devices by ip:port", async () => {
	const { deps, emitDevice } = makeDeps()
	const store = createTuiStore(info, deps)
	await store.startScanning()
	emitDevice(makeDevice("10.0.0.5"))
	emitDevice(makeDevice("10.0.0.5"))
	emitDevice(makeDevice("10.0.0.6"))
	expect(store.state.devices.length).toBe(2)
	store.stopScanning()
})

test("boot starts the always-on server", async () => {
	const { deps, calls } = makeDeps()
	const store = createTuiStore(info, deps)
	await store.boot()
	expect(calls.serverStart).toBe(1)
	expect(store.state.serverRunning).toBe(true)
	await store.cleanup()
	expect(calls.serverStop).toBe(1)
})

test("sending selection to a device marks files done and finishes", async () => {
	const { deps, calls } = makeDeps()
	const store = createTuiStore(info, deps)
	store.addDevice(makeDevice("10.0.0.5"))
	store.addText("hello world")
	await store.addPath(import.meta.path) // this test file exists
	await store.sendToDevice(store.selectedDevice()!)
	expect(calls.sentTexts).toEqual(["hello world"])
	expect(calls.sentPaths.length).toBe(1)
	expect(store.state.session?.status).toBe("finished")
	expect(store.state.session?.files.every((f) => f.status === "done")).toBe(true)
})

test("sending with an empty selection sets an error and no session", async () => {
	const { deps } = makeDeps()
	const store = createTuiStore(info, deps)
	store.addDevice(makeDevice("10.0.0.5"))
	await store.sendToDevice(store.selectedDevice()!)
	expect(store.state.session).toBeNull()
	expect(store.state.statusLevel).toBe("error")
})

test("failed file yields finishedWithErrors and retry re-sends", async () => {
	const { deps, calls } = makeDeps()
	let failNext = true
	deps.sendPath = async (_i, _d, p) => {
		calls.sentPaths.push(p)
		if (failNext) {
			failNext = false
			return { ok: false, message: "Upload failed" }
		}
		return { ok: true, message: "sent" }
	}
	const store = createTuiStore(info, deps)
	store.addDevice(makeDevice("10.0.0.5"))
	await store.addPath(import.meta.path)
	await store.sendToDevice(store.selectedDevice()!)
	expect(store.state.session?.status).toBe("finishedWithErrors")
	await store.retryFailed()
	expect(store.state.session?.status).toBe("finished")
	expect(calls.sentPaths.length).toBe(2)
})

test("cancel while the only file is in flight ends canceledBySender, not finished", async () => {
	const { deps } = makeDeps()
	const store = createTuiStore(info, deps)
	store.addDevice(makeDevice("10.0.0.5"))
	await store.addPath(import.meta.path)
	// Simulate the user pressing `c` while this single file is uploading.
	deps.sendPath = async () => {
		store.cancelSession()
		return { ok: true, message: "sent" }
	}
	await store.sendToDevice(store.selectedDevice()!)
	expect(store.state.session?.status).toBe("canceledBySender")
	expect(store.state.session?.files[0]?.status).not.toBe("done")
})

test("incoming request is held for consent when quickSave is off", async () => {
	const { deps, fireRequest } = makeDeps()
	const store = createTuiStore(info, deps)
	await store.boot()
	const sender = makeDevice("10.0.0.9", { alias: "Sender" })
	const pending = fireRequest(sender, { a: fileMeta("a", "photo.png", 100) })
	// modal is now open
	expect(store.state.incomingRequest?.sender.alias).toBe("Sender")
	store.acceptIncoming()
	await expect(pending!).resolves.toBe(true)
	expect(store.state.incomingRequest).toBeNull()
	expect(store.state.session?.direction).toBe("receive")
})

test("quickSave 'on' auto-accepts without a modal", async () => {
	const { deps, fireRequest } = makeDeps()
	const store = createTuiStore(info, deps)
	await store.boot()
	store.cycleQuickSave() // off -> favorites
	store.cycleQuickSave() // favorites -> on
	const sender = makeDevice("10.0.0.9", { alias: "Sender" })
	const accepted = await fireRequest(sender, { a: fileMeta("a", "photo.png", 100) })
	expect(accepted).toBe(true)
	expect(store.state.incomingRequest).toBeNull()
})

test("favorites toggle persists and sorts favorites first", async () => {
	const mem = memoryPersist()
	const { deps } = makeDeps({ persist: mem.persist })
	const store = createTuiStore(info, deps)
	store.addDevice(makeDevice("10.0.0.5", { alias: "Zeta" }))
	store.addDevice(makeDevice("10.0.0.6", { alias: "Alpha" }))
	// Zeta is at index by alias sort: Alpha, Zeta
	expect(store.state.devices[0]!.alias).toBe("Alpha")
	store.toggleFavorite(store.state.devices[1]) // favorite Zeta
	expect(store.state.devices[0]!.alias).toBe("Zeta")
	expect(mem.saved.at(-1)?.favorites?.length).toBe(1)
})

test("persisted favorites and quickSave load on construction", () => {
	const mem = memoryPersist({
		quickSave: "on",
		favorites: [{ fingerprint: "fp-x", alias: "Saved", ip: "1.2.3.4", port: 53317 }]
	})
	const { deps } = makeDeps({ persist: mem.persist })
	const store = createTuiStore(info, deps)
	expect(store.state.quickSave).toBe("on")
	expect(store.state.favorites.length).toBe(1)
})

test("tab cycling wraps", () => {
	const { deps } = makeDeps()
	const store = createTuiStore(info, deps)
	expect(store.state.tab).toBe("send")
	store.cycleTab(-1)
	expect(store.state.tab).toBe("settings")
	store.cycleTab(1)
	expect(store.state.tab).toBe("send")
})

test("openInput defers so the trigger key is not captured by the input", async () => {
	const { deps } = makeDeps()
	const store = createTuiStore(info, deps)
	store.openInput("compose-text")
	// Not set synchronously — the triggering keystroke's dispatch must finish first.
	expect(store.state.inputMode).toBeNull()
	await new Promise((resolve) => setTimeout(resolve, 5))
	expect(store.state.inputMode).toBe("compose-text")
})

test("manual address entry adds and focuses the device", async () => {
	const { deps } = makeDeps()
	const store = createTuiStore(info, deps)
	await store.addManualAddress("192.168.1.50:53317")
	expect(store.state.devices.length).toBe(1)
	expect(store.state.devices[0]!.ip).toBe("192.168.1.50")
	expect(store.state.focusedPane).toBe("devices")
})

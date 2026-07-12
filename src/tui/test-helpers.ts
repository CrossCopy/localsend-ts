import type { DeviceInfo, FileMetadata } from "../index.ts"
import { createTuiStore, type Persist, type PersistedConfig, type TuiDeps } from "./store.ts"

export { createTuiStore }

export function memoryPersist(initial: PersistedConfig = {}): Persist {
	let current = initial
	return {
		load: () => current,
		save: (config) => {
			current = config
		}
	}
}

export interface MemoryControls {
	deps: TuiDeps
	emitDevice: (device: DeviceInfo) => void
	fireRequest: (
		info: DeviceInfo,
		files: Record<string, FileMetadata>
	) => Promise<boolean> | undefined
}

/** Fully stubbed deps with control handles for driving discovery/requests in tests. */
export function memoryControls(persist: Persist = memoryPersist()): MemoryControls {
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
			return { start: async () => {}, stop: async () => {} }
		},
		sendText: async () => ({ ok: true, message: "sent" }),
		sendPath: async () => ({ ok: true, message: "sent" }),
		persist,
		now: () => 1000
	}
	return {
		deps,
		emitDevice: (device) => discoveredCb?.(device),
		fireRequest: (info, files) => requestHandler?.(info, files)
	}
}

/** Convenience: just the deps, no control handles. */
export function memoryDeps(): TuiDeps {
	return memoryControls().deps
}

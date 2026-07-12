import { createStore } from "solid-js/store"
import os from "node:os"
import path from "node:path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { LocalSendHonoServer } from "../index.ts"
import type { DeviceInfo, FileMetadata } from "../index.ts"
import { createDiscovery, createScanner } from "../discovery/runtime.ts"
import { sendPathToDevice, sendTextToDevice, type DiscoveredDevice } from "./transfer.ts"

// ── Domain vocabulary (borrowed verbatim from the official LocalSend app) ──

/** Mirrors the Flutter app's SessionStatus enum. */
export type SessionStatus =
	| "waiting"
	| "sending"
	| "finished"
	| "finishedWithErrors"
	| "declined"
	| "canceledBySender"
	| "canceledByReceiver"

export type FileStatus = "queued" | "sending" | "done" | "failed" | "skipped"

export type Tab = "send" | "receive" | "settings"
export type Pane = "selection" | "devices"
export type QuickSaveMode = "off" | "favorites" | "on"
export type StatusLevel = "info" | "success" | "error"

/** Which inline input (if any) is currently capturing keystrokes. */
export type InputMode = "add-path" | "manual-ip" | "compose-text"

export type SelectionItem =
	| { kind: "file"; path: string; name: string; size: number }
	| { kind: "text"; content: string }

export interface Favorite {
	fingerprint: string
	alias: string
	ip: string
	port: number
}

export interface SessionFile {
	id: string
	name: string
	size: number
	received: number
	status: FileStatus
}

export interface Session {
	direction: "send" | "receive"
	peer: { alias: string; ip: string; deviceType: string | null }
	status: SessionStatus
	files: SessionFile[]
	startedAt: number
	speed: number
	doneAt: number | null
}

export interface IncomingRequest {
	sender: { alias: string; ip: string; deviceType: string | null; fingerprint: string }
	files: SessionFile[]
	isMessage: boolean
	message: string | null
	resolve: (accepted: boolean) => void
}

export interface ReceivedFile {
	fileName: string
	size: number
	time: string
	from: string
}

export interface TuiSettings {
	alias: string
	port: number
	saveDir: string
	protocol: "http" | "https"
}

export interface TuiState {
	tab: Tab
	focusedPane: Pane
	selection: SelectionItem[]
	selectionIndex: number
	devices: DiscoveredDevice[]
	deviceIndex: number
	favorites: Favorite[]
	scanState: "idle" | "scanning"
	serverRunning: boolean
	session: Session | null
	incomingRequest: IncomingRequest | null
	quickSave: QuickSaveMode
	recentReceives: ReceivedFile[]
	settings: TuiSettings
	inputMode: InputMode | null
	statusMessage: string | null
	statusLevel: StatusLevel | null
}

// ── Persistence ──

export interface PersistedConfig {
	favorites?: Favorite[]
	quickSave?: QuickSaveMode
}

export interface Persist {
	load(): PersistedConfig
	save(config: PersistedConfig): void
}

const configDir = path.join(os.homedir(), ".config", "localsend-tui")
const configPath = path.join(configDir, "config.json")

export const filePersist: Persist = {
	load() {
		try {
			if (!existsSync(configPath)) return {}
			return JSON.parse(readFileSync(configPath, "utf8")) as PersistedConfig
		} catch {
			return {}
		}
	},
	save(config) {
		try {
			if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true })
			writeFileSync(configPath, JSON.stringify(config, null, 2))
		} catch {
			// persistence is best-effort; never crash the TUI over it
		}
	}
}

// ── Injectable dependencies (real network on default, stubbed in tests) ──

export interface DiscoveryLike {
	onDeviceDiscovered(cb: (device: DeviceInfo) => void): void
	start(): Promise<void> | void
	stop(): void
	announcePresence?(): void
}

export interface ScannerLike {
	onDeviceDiscovered(cb: (device: DeviceInfo) => void): void
	startScan?(): Promise<void>
}

export interface ServerLike {
	start(): Promise<unknown> | unknown
	stop(): Promise<unknown> | unknown
}

export type ServerOptions = ConstructorParameters<typeof LocalSendHonoServer>[1]

export interface TuiDeps {
	createDiscovery: (info: DeviceInfo) => DiscoveryLike
	createScanner: (info: DeviceInfo) => ScannerLike
	createServer: (info: DeviceInfo, options: ServerOptions) => ServerLike
	sendText: typeof sendTextToDevice
	sendPath: typeof sendPathToDevice
	persist: Persist
	now: () => number
}

export const defaultDeps: TuiDeps = {
	createDiscovery: (info) => createDiscovery(info) as unknown as DiscoveryLike,
	createScanner: (info) => createScanner(info) as unknown as ScannerLike,
	createServer: (info, options) => new LocalSendHonoServer(info, options),
	sendText: sendTextToDevice,
	sendPath: sendPathToDevice,
	persist: filePersist,
	now: () => Date.now()
}

// ── Helpers ──

function deviceGlyph(deviceType: string | null | undefined): string {
	if (deviceType === "mobile") return "📱"
	if (deviceType === "web" || deviceType === "headless") return "🌐"
	if (deviceType === "server") return "🖥️"
	return "💻"
}
export { deviceGlyph }

function selectionTotalBytes(selection: SelectionItem[]): number {
	return selection.reduce((sum, item) => {
		if (item.kind === "file") return sum + item.size
		return sum + Buffer.byteLength(item.content, "utf8")
	}, 0)
}
export { selectionTotalBytes }

/** Short visual id derived from a fingerprint, like the app's `#XXXX`. */
export function visualId(fingerprint: string): string {
	let hash = 0
	for (let i = 0; i < fingerprint.length; i++) {
		hash = (hash * 31 + fingerprint.charCodeAt(i)) >>> 0
	}
	return hash.toString(16).toUpperCase().slice(0, 4).padStart(4, "0")
}

// ── Store factory ──

export function createTuiStore(baseInfo: DeviceInfo, deps: TuiDeps = defaultDeps) {
	const persisted = deps.persist.load()

	// Identity comes from CLI args / getDeviceInfo, never from persisted config —
	// persisting alias/port would override explicit `--alias`/`--port` and let two
	// instances collide on the same saved port. Only favorites and quickSave persist.
	const settings: TuiSettings = {
		alias: baseInfo.alias,
		port: baseInfo.port,
		saveDir: "./received_files",
		protocol: baseInfo.protocol
	}

	const [state, setState] = createStore<TuiState>({
		tab: "send",
		focusedPane: "selection",
		selection: [],
		selectionIndex: 0,
		devices: [],
		deviceIndex: 0,
		favorites: persisted.favorites ?? [],
		scanState: "idle",
		serverRunning: false,
		session: null,
		incomingRequest: null,
		quickSave: persisted.quickSave ?? "off",
		recentReceives: [],
		settings,
		inputMode: null,
		statusMessage: null,
		statusLevel: null
	})

	let deviceInfo: DeviceInfo = { ...baseInfo, ...settings }
	let discovery: DiscoveryLike | null = null
	let scanner: ScannerLike | null = null
	let server: ServerLike | null = null
	let scanInterval: ReturnType<typeof setInterval> | null = null
	let cancelRequested = false

	const persistNow = () => {
		deps.persist.save({
			favorites: state.favorites,
			quickSave: state.quickSave
		})
	}

	const setStatus = (message: string | null, level: StatusLevel | null) => {
		setState({ statusMessage: message, statusLevel: level })
	}

	// ── Navigation ──

	const setTab = (tab: Tab) => setState({ tab })
	const cycleTab = (delta: 1 | -1) => {
		const order: Tab[] = ["send", "receive", "settings"]
		const i = order.indexOf(state.tab)
		setState({ tab: order[(i + delta + order.length) % order.length]! })
	}
	const togglePane = () => {
		setState({ focusedPane: state.focusedPane === "selection" ? "devices" : "selection" })
	}
	const setPane = (pane: Pane) => setState({ focusedPane: pane })

	// ── Selection ──

	const clampSelectionIndex = () => {
		const max = Math.max(0, state.selection.length - 1)
		if (state.selectionIndex > max) setState({ selectionIndex: max })
	}

	const addText = (content: string) => {
		if (!content.trim()) return
		setState("selection", (items) => [...items, { kind: "text", content }])
		setStatus("Message added to selection", "info")
	}

	const addPath = async (rawPath: string): Promise<boolean> => {
		const filePath = rawPath.trim().replace(/^~(?=$|\/)/, os.homedir())
		if (!filePath) return false
		try {
			const { stat } = await import("node:fs/promises")
			const info = await stat(filePath)
			if (info.isDirectory()) {
				setStatus("Directories are not supported yet — pick a file", "error")
				return false
			}
			setState("selection", (items) => [
				...items,
				{ kind: "file", path: filePath, name: path.basename(filePath), size: info.size }
			])
			setStatus(`Added ${path.basename(filePath)}`, "success")
			return true
		} catch {
			setStatus("File not found or inaccessible", "error")
			return false
		}
	}

	const removeSelectionItem = (index: number) => {
		setState("selection", (items) => items.filter((_, i) => i !== index))
		clampSelectionIndex()
	}
	const clearSelection = () => {
		setState({ selection: [], selectionIndex: 0 })
	}
	const moveSelection = (delta: 1 | -1) => {
		if (state.selection.length === 0) return
		setState("selectionIndex", (i) => (i + delta + state.selection.length) % state.selection.length)
	}

	// ── Devices ──

	const isFavorite = (fingerprint: string) =>
		state.favorites.some((f) => f.fingerprint === fingerprint)

	const sortDevices = (devices: DiscoveredDevice[]): DiscoveredDevice[] =>
		[...devices].sort((a, b) => {
			const fa = isFavorite(a.fingerprint) ? 0 : 1
			const fb = isFavorite(b.fingerprint) ? 0 : 1
			if (fa !== fb) return fa - fb
			return a.alias.localeCompare(b.alias)
		})

	const addDevice = (device: DeviceInfo) => {
		const ip = (device as DiscoveredDevice).ip
		if (!ip) return
		const key = `${ip}:${device.port}`
		if (state.devices.some((d) => `${d.ip}:${d.port}` === key)) return
		const next = sortDevices([...state.devices, device as DiscoveredDevice])
		setState({ devices: next })
	}

	const selectedDevice = (): DiscoveredDevice | null => state.devices[state.deviceIndex] ?? null

	const moveDevice = (delta: 1 | -1) => {
		if (state.devices.length === 0) return
		setState("deviceIndex", (i) => (i + delta + state.devices.length) % state.devices.length)
	}

	const toggleFavorite = (device: DiscoveredDevice | null = selectedDevice()) => {
		if (!device) return
		if (isFavorite(device.fingerprint)) {
			setState("favorites", (favs) => favs.filter((f) => f.fingerprint !== device.fingerprint))
		} else {
			setState("favorites", (favs) => [
				...favs,
				{ fingerprint: device.fingerprint, alias: device.alias, ip: device.ip, port: device.port }
			])
		}
		setState({ devices: sortDevices(state.devices) })
		persistNow()
	}

	// ── Discovery ──

	const startScanning = async () => {
		if (state.scanState === "scanning") return
		setState({ scanState: "scanning" })
		try {
			if (!discovery) {
				discovery = deps.createDiscovery(deviceInfo)
				discovery.onDeviceDiscovered(addDevice)
				await discovery.start()
				discovery.announcePresence?.()
			}
			if (!scanner) {
				scanner = deps.createScanner(deviceInfo)
				scanner.onDeviceDiscovered(addDevice)
			}
			await scanner.startScan?.()
			if (!scanInterval) {
				scanInterval = setInterval(() => {
					void scanner?.startScan?.()?.catch?.(() => {})
				}, 5000)
			}
		} catch {
			// keep the TUI alive even if discovery fails
		} finally {
			setState({ scanState: "idle" })
		}
	}

	const rescan = async () => {
		setState({ devices: [], deviceIndex: 0 })
		discovery?.announcePresence?.()
		await startScanning()
	}

	const stopScanning = () => {
		discovery?.stop()
		discovery = null
		scanner = null
		if (scanInterval) clearInterval(scanInterval)
		scanInterval = null
		setState({ scanState: "idle" })
	}

	// ── Always-on receiver ──

	const startServer = async () => {
		if (server) return
		try {
			const created = deps.createServer(deviceInfo, {
				saveDirectory: state.settings.saveDir,
				onTransferRequest: async (senderInfo, files) => handleIncoming(senderInfo, files),
				onTransferProgress: async (fileId, fileName, received, total, speed, finished) => {
					handleProgress(fileId, fileName, received, total, speed, finished ?? false)
				}
			})
			await created.start()
			server = created
			setState({ serverRunning: true })
			discovery?.announcePresence?.()
		} catch {
			setStatus("Failed to start receiver", "error")
		}
	}

	const stopServer = async () => {
		if (!server) return
		try {
			await server.stop()
		} catch {}
		server = null
		setState({ serverRunning: false })
	}

	// ── Incoming transfer consent ──

	const handleIncoming = (
		senderInfo: DeviceInfo,
		files: Record<string, FileMetadata>
	): Promise<boolean> => {
		const fingerprint = senderInfo.fingerprint
		const senderIsFavorite = isFavorite(fingerprint)
		if (state.quickSave === "on" || (state.quickSave === "favorites" && senderIsFavorite)) {
			beginReceiveSession(senderInfo, files)
			return Promise.resolve(true)
		}

		const fileList = Object.values(files)
		// Match the official app: a request is a "message" only when the single text
		// file carries an inline preview. A real .txt file has fileType text/plain but
		// no preview and must be shown as a file, not an empty message.
		const isMessage =
			fileList.length === 1 &&
			fileList[0]!.fileType === "text/plain" &&
			fileList[0]!.preview != null
		return new Promise<boolean>((resolve) => {
			setState({
				incomingRequest: {
					sender: {
						alias: senderInfo.alias,
						ip: (senderInfo as DiscoveredDevice).ip ?? "",
						deviceType: senderInfo.deviceType ?? null,
						fingerprint
					},
					files: fileList.map((f) => ({
						id: f.id,
						name: f.fileName,
						size: f.size,
						received: 0,
						status: "queued" as FileStatus
					})),
					isMessage,
					message: isMessage ? (fileList[0]!.preview ?? null) : null,
					resolve: (accepted: boolean) => {
						if (accepted) beginReceiveSession(senderInfo, files)
						setState({ incomingRequest: null })
						resolve(accepted)
					}
				}
			})
		})
	}

	const acceptIncoming = () => state.incomingRequest?.resolve(true)
	const declineIncoming = () => state.incomingRequest?.resolve(false)

	const beginReceiveSession = (senderInfo: DeviceInfo, files: Record<string, FileMetadata>) => {
		setState({
			session: {
				direction: "receive",
				peer: {
					alias: senderInfo.alias,
					ip: (senderInfo as DiscoveredDevice).ip ?? "",
					deviceType: senderInfo.deviceType ?? null
				},
				status: "sending",
				files: Object.values(files).map((f) => ({
					id: f.id,
					name: f.fileName,
					size: f.size,
					received: 0,
					status: "sending" as FileStatus
				})),
				startedAt: deps.now(),
				speed: 0,
				doneAt: null
			}
		})
	}

	const handleProgress = (
		fileId: string,
		fileName: string,
		received: number,
		total: number,
		speed: number,
		finished: boolean
	) => {
		if (!state.session || state.session.direction !== "receive") return
		const idx = state.session.files.findIndex((f) => f.id === fileId)
		if (idx >= 0) {
			setState("session", "files", idx, {
				received,
				status: finished ? "done" : "sending"
			})
		}
		setState("session", "speed", speed)
		if (finished) {
			setState("recentReceives", (list) => [
				{
					fileName,
					size: total,
					time: new Date(deps.now()).toLocaleTimeString(),
					from: state.session?.peer.alias ?? "unknown"
				},
				...list
			])
			setStatus(`Received ${fileName}`, "success")
			const allDone = state.session!.files.every((f) => f.status === "done")
			if (allDone) setState("session", "status", "finished")
		}
	}

	// ── Sending ──

	const sendToDevice = async (device: DiscoveredDevice) => {
		if (state.selection.length === 0) {
			setStatus("Nothing selected — press a to add a file or t to write a message", "error")
			return
		}
		if (state.session && state.session.status === "sending") return

		cancelRequested = false
		setState({
			session: {
				direction: "send",
				peer: { alias: device.alias, ip: device.ip, deviceType: device.deviceType ?? null },
				status: "sending",
				files: state.selection.map((item, i) => ({
					id: String(i),
					name: item.kind === "file" ? item.name : "message.txt",
					size: item.kind === "file" ? item.size : Buffer.byteLength(item.content, "utf8"),
					received: 0,
					status: "queued" as FileStatus
				})),
				startedAt: deps.now(),
				speed: 0,
				doneAt: null
			}
		})

		await runSendQueue(device)
	}

	const runSendQueue = async (device: DiscoveredDevice) => {
		const selection = state.selection
		let hadError = false
		for (let i = 0; i < selection.length; i++) {
			if (cancelRequested) {
				setState("session", "status", "canceledBySender")
				return
			}
			if (state.session?.files[i]?.status === "done") continue
			setState("session", "files", i, "status", "sending")
			const item = selection[i]!
			const result =
				item.kind === "file"
					? await deps.sendPath(deviceInfo, device, item.path)
					: await deps.sendText(deviceInfo, device, item.content)
			// Re-check after the await: if the user hit cancel while this file was in
			// flight, honor it now instead of marking it done and finishing the queue
			// (the underlying upload has no abort, but the session reflects the cancel).
			if (cancelRequested) {
				setState("session", { status: "canceledBySender", doneAt: deps.now() })
				return
			}
			if (result.ok) {
				setState("session", "files", i, { status: "done", received: state.session!.files[i]!.size })
			} else {
				hadError = true
				setState("session", "files", i, "status", "failed")
				setStatus(result.message, "error")
			}
		}
		setState("session", {
			status: hadError ? "finishedWithErrors" : "finished",
			doneAt: deps.now()
		})
		if (!hadError) setStatus("Transfer complete", "success")
	}

	const cancelSession = () => {
		if (state.session?.direction === "send" && state.session.status === "sending") {
			cancelRequested = true
		}
	}

	const retryFailed = async () => {
		if (!state.session || state.session.direction !== "send") return
		const device = state.devices.find((d) => d.ip === state.session!.peer.ip)
		if (!device) {
			setStatus("Device no longer reachable for retry", "error")
			return
		}
		cancelRequested = false
		setState("session", "status", "sending")
		for (let i = 0; i < state.session.files.length; i++) {
			if (state.session.files[i]!.status !== "failed") continue
			setState("session", "files", i, "status", "queued")
		}
		await runSendQueue(device)
	}

	const closeSession = () => setState({ session: null })

	// ── Quick save / settings ──

	const cycleQuickSave = () => {
		const order: QuickSaveMode[] = ["off", "favorites", "on"]
		const next = order[(order.indexOf(state.quickSave) + 1) % order.length]!
		setState({ quickSave: next })
		setStatus(`Quick Save: ${next}`, "info")
		persistNow()
	}

	const updateSettings = (partial: Partial<TuiSettings>) => {
		setState("settings", partial)
		deviceInfo = { ...deviceInfo, ...state.settings }
		persistNow()
	}

	// ── Inline input mode ──

	const openInput = (mode: InputMode) => {
		// Defer one tick so the keystroke that triggered opening (e.g. "t") is not
		// captured by the input that focuses in the same key-dispatch pass.
		setTimeout(() => setState({ inputMode: mode }), 0)
	}
	// Synchronous variant for unit tests that assert inputMode immediately.
	const openInputNow = (mode: InputMode) => setState({ inputMode: mode })
	const closeInput = () => setState({ inputMode: null })

	const submitInput = async (value: string) => {
		const mode = state.inputMode
		setState({ inputMode: null })
		if (mode === "add-path") {
			await addPath(value)
		} else if (mode === "compose-text") {
			addText(value)
		} else if (mode === "manual-ip") {
			await addManualAddress(value)
		}
	}

	const addManualAddress = async (raw: string): Promise<void> => {
		const trimmed = raw.trim()
		if (!trimmed) return
		const [host, portStr] = trimmed.replace(/^https?:\/\//, "").split(":")
		const port = portStr ? parseInt(portStr, 10) : state.settings.port
		if (!host) {
			setStatus("Enter an address like 192.168.1.5 or 192.168.1.5:53317", "error")
			return
		}
		const manual: DiscoveredDevice = {
			alias: host,
			version: baseInfo.version,
			deviceModel: null,
			deviceType: null,
			fingerprint: `manual-${host}:${port}`,
			port,
			protocol: state.settings.protocol,
			download: false,
			ip: host
		}
		addDevice(manual)
		const idx = state.devices.findIndex((d) => d.ip === host && d.port === port)
		if (idx >= 0) setState({ deviceIndex: idx, focusedPane: "devices" })
		setStatus(`Added ${host}:${port}`, "success")
	}

	// ── Lifecycle ──

	const boot = async () => {
		await startServer()
		await startScanning()
	}

	const cleanup = async () => {
		stopScanning()
		await stopServer()
	}

	return {
		state,
		get deviceInfo() {
			return deviceInfo
		},
		// navigation
		setTab,
		cycleTab,
		togglePane,
		setPane,
		// selection
		addText,
		addPath,
		removeSelectionItem,
		clearSelection,
		moveSelection,
		// devices
		isFavorite,
		selectedDevice,
		moveDevice,
		toggleFavorite,
		addDevice,
		addManualAddress,
		// discovery
		startScanning,
		rescan,
		stopScanning,
		// server
		startServer,
		stopServer,
		// incoming
		acceptIncoming,
		declineIncoming,
		// sending
		sendToDevice,
		cancelSession,
		retryFailed,
		closeSession,
		// quick save / settings
		cycleQuickSave,
		updateSettings,
		// input
		openInput,
		openInputNow,
		closeInput,
		submitInput,
		// status
		setStatus,
		// lifecycle
		boot,
		cleanup
	}
}

export type TuiStore = ReturnType<typeof createTuiStore>

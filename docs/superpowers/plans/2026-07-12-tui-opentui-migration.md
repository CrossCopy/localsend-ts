# TUI Migration: Ink → OpenTUI Solid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠️ UX supersession note (2026-07-12):** [2026-07-12-tui-ux-design.md](./2026-07-12-tui-ux-design.md) redesigns the TUI UX based on the official LocalSend app (tab dashboard, content-first send, always-on receiver, consent modal, transfer progress overlay). Tasks 1–2 below remain valid as written. Task 3's state shape and Task 4's screens describe the **old menu UI** and are superseded by the design doc's §6 (state) and §4 (screens) once the redesign is approved — do not implement Tasks 3–4 verbatim without checking which direction the user chose.

**Goal:** Replace the Ink/React TUI (`src/cli-tui.tsx`) with an OpenTUI Solid implementation, keeping identical features (device discovery, send text, send file, receiver mode, settings) and removing `ink`/`react` from the published dependency tree.

**Architecture:** Stay a **single package** — no workspace split. OpenTUI deps go in root `devDependencies` because the TUI is not part of the published npm artifact (it is not in `bin`, `files`, or `build.ts` entrypoints; it runs via `bun src/cli-tui.tsx`). The 820-line single file is split into a `src/tui/` module: a framework-agnostic transfer module, a Solid store with injectable dependencies (so state logic is unit-testable without network), presentational components, and an `App` that wires keyboard input to store actions. `src/cli-tui.tsx` stays the entry point so the `tui`/`tui:dev` scripts keep working.

**Tech Stack:** Bun, `@opentui/core`, `@opentui/solid`, `solid-js`, citty (kept), existing `localsend` library internals (`LocalSendClient`, `LocalSendHonoServer`, `createDiscovery`, `createScanner`).

## Global Constraints

- The TUI runs under **Bun only** (OpenTUI's native Zig renderer uses FFI; the Solid transform comes from a Bun preload plugin). The repo scripts already use `bun`.
- All new TUI dependencies go in `devDependencies`. **Nothing is added to `dependencies`.** This migration must also **remove** `ink` and `react` from `dependencies` and `@types/react` from `devDependencies`.
- Published surface is untouched: `bin`, `exports`, `files` in `package.json` and the entrypoints in `build.ts` do not change.
- `tsconfig.json` switches to `"jsx": "preserve"`, `"jsxImportSource": "@opentui/solid"`. This is safe: `src/cli-tui.tsx` is the only `.tsx` file in the repo (verified — `cli-interactive.ts` only matched the word "un**link**").
- After every task: `bun run check-types` passes, `bun test src/tui` passes, `bun run format` before committing.
- Code style: tabs, double quotes, no semicolons (repo prettier config — running `bun run format` normalizes this).
- ⚠️ Between Task 1 and Task 4 the TUI is a reduced shell (full features return in Task 4). This never affects the published package since the TUI isn't shipped.

## File Structure

- Modify: `package.json` — dependency swap only
- Create: `bunfig.toml` — Bun preload for the Solid JSX transform
- Modify: `tsconfig.json` — JSX settings
- Rewrite: `src/cli-tui.tsx` — thin citty entry that renders the app
- Create: `src/tui/theme.ts` — hex color constants (Ink used named colors; OpenTUI takes hex)
- Create: `src/tui/transfer.ts` — framework-agnostic send logic (metadata building, upload, temp-file text send)
- Create: `src/tui/transfer.test.ts`
- Create: `src/tui/store.ts` — Solid store + all app actions, dependencies injectable for tests
- Create: `src/tui/store.test.ts`
- Create: `src/tui/components.tsx` — presentational components (Header, StatusBar, MainMenu, DeviceList, SendScreen, ReceiveScreen, SettingsScreen)
- Create: `src/tui/App.tsx` — screen routing + keyboard handling
- Create: `src/tui/app.test.tsx`, `src/tui/smoke.test.tsx`
- Modify: `AGENTS.md`, `README.md` — replace Ink references

---

### Task 1: Toolchain swap + minimal OpenTUI shell

Replaces the Ink toolchain with OpenTUI Solid in one commit, because one `tsconfig.json` cannot typecheck React JSX and Solid JSX simultaneously. The old Ink implementation is deleted here; every piece of its behavior is re-specified with full code in Tasks 2–4, so nothing is lost.

**Files:**

- Modify: `package.json`
- Create: `bunfig.toml`
- Modify: `tsconfig.json:8`
- Rewrite: `src/cli-tui.tsx`
- Test: `src/tui/smoke.test.tsx`

**Interfaces:**

- Produces: working `bun src/cli-tui.tsx` shell; `testRender` harness available for later tasks.

- [ ] **Step 1: Swap dependencies**

```bash
cd /Users/hk/Dev/localsend-ts/.claude/worktrees/tui-opentui-migration-44c896
bun remove ink react @types/react
bun add -d @opentui/core @opentui/solid solid-js
```

Expected: `package.json` `dependencies` no longer contains `ink`/`react`; `devDependencies` gains the three packages; `bun.lock` updated.

- [ ] **Step 2: Create `bunfig.toml`** (repo root — this makes `bun` compile `.tsx` with the Solid transform for both `bun run` and `bun test`)

```toml
preload = ["@opentui/solid/preload"]
```

- [ ] **Step 3: Update `tsconfig.json`**

Replace line 8 (`"jsx": "react-jsx",`) with:

```json
		"jsx": "preserve",
		"jsxImportSource": "@opentui/solid",
```

- [ ] **Step 4: Write the failing smoke test** — `src/tui/smoke.test.tsx`

```tsx
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"

test("opentui solid renders text", async () => {
	const { renderOnce, captureCharFrame, renderer } = await testRender(
		() => <text>hello opentui</text>,
		{ width: 40, height: 5 }
	)
	await renderOnce()
	expect(captureCharFrame()).toContain("hello opentui")
	renderer.destroy()
})
```

Note: `testRender` returns the same helpers as `createTestRenderer` from `@opentui/core/testing` (`renderer`, `renderOnce`, `captureCharFrame`, `mockInput`, …). If destructuring fails, check the exact return type in `node_modules/@opentui/solid/dist/index.d.ts` and adjust the destructure — the assertion stays the same.

- [ ] **Step 5: Run test — expected to pass already** (the harness needs no app code)

Run: `bun test src/tui/smoke.test.tsx`
Expected: PASS. If it fails on the Solid transform, verify `bunfig.toml` is at repo root and re-run.

- [ ] **Step 6: Replace `src/cli-tui.tsx` with the minimal shell** (delete the entire Ink implementation)

```tsx
#!/usr/bin/env bun
import { render, useKeyboard, useRenderer } from "@opentui/solid"

const App = () => {
	const renderer = useRenderer()
	useKeyboard((key) => {
		if (key.name === "q" || key.name === "escape") {
			renderer.destroy()
			process.exit(0)
		}
	})
	return (
		<box flexDirection="column" padding={1}>
			<text fg="#00FFFF">
				<b>🌐 LocalSend TUI</b>
			</text>
			<text fg="#808080">OpenTUI migration in progress — press q to quit</text>
		</box>
	)
}

render(() => <App />)
```

- [ ] **Step 7: Verify types and manual run**

Run: `bun run check-types`
Expected: no errors (the only React JSX file is gone).

Run in a real terminal (needs a TTY, don't run in CI): `bun src/cli-tui.tsx` — see the header, press `q`, terminal restores cleanly.

- [ ] **Step 8: Commit**

```bash
bun run format
git add -A
git commit -m "feat(tui): swap ink/react toolchain for opentui solid, minimal shell"
```

---

### Task 2: Transfer module (framework-agnostic send logic)

**Files:**

- Create: `src/tui/transfer.ts`
- Test: `src/tui/transfer.test.ts`

**Interfaces:**

- Consumes: `LocalSendClient`, `DeviceInfo`, `FileMetadata` from `../index.ts`.
- Produces (used by Task 3's store and its tests):
  - `interface DiscoveredDevice extends DeviceInfo { ip: string }`
  - `interface SendResult { ok: boolean; message: string }`
  - `buildFileMetadata(filePath: string, fileBuffer: Buffer, isTextMessage: boolean): FileMetadata`
  - `sendFileToDevice(deviceInfo: DeviceInfo, device: DiscoveredDevice, filePath: string, isTextMessage: boolean): Promise<SendResult>`
  - `type SendFileFn = typeof sendFileToDevice`
  - `sendTextToDevice(deviceInfo, device, message: string, send?: SendFileFn): Promise<SendResult>`
  - `sendPathToDevice(deviceInfo, device, filePath: string, send?: SendFileFn): Promise<SendResult>`

- [ ] **Step 1: Write the failing tests** — `src/tui/transfer.test.ts`

```ts
import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { getDeviceInfo } from "../index.ts"
import {
	buildFileMetadata,
	sendPathToDevice,
	sendTextToDevice,
	type DiscoveredDevice,
	type SendFileFn
} from "./transfer.ts"

const info = getDeviceInfo({ alias: "TestDevice", port: 53317, enableDownloadApi: false })
const device: DiscoveredDevice = { ...info, alias: "Peer", ip: "127.0.0.1" }

test("buildFileMetadata for a text message", () => {
	const buffer = Buffer.from("hello")
	const meta = buildFileMetadata("/tmp/x.txt", buffer, true)
	expect(meta.fileName).toBe("message.txt")
	expect(meta.fileType).toBe("text/plain")
	expect(meta.preview).toBe("hello")
	expect(meta.size).toBe(5)
	expect(meta.sha256).toBe(createHash("sha256").update(buffer).digest("hex"))
	expect(meta.id).toBe(createHash("md5").update("/tmp/x.txt").digest("hex"))
})

test("buildFileMetadata for a binary file", () => {
	const meta = buildFileMetadata("/some/dir/photo.png", Buffer.from([1, 2, 3]), false)
	expect(meta.fileName).toBe("photo.png")
	expect(meta.fileType).toBe("application/octet-stream")
	expect(meta.preview).toBeUndefined()
})

test("sendTextToDevice writes temp file, sends it, cleans up", async () => {
	let sentPath = ""
	let sentContent = ""
	const fakeSend: SendFileFn = async (_info, _device, filePath, isText) => {
		sentPath = filePath
		sentContent = await readFile(filePath, "utf8")
		expect(isText).toBe(true)
		return { ok: true, message: "ok" }
	}
	const result = await sendTextToDevice(info, device, "hi there", fakeSend)
	expect(result.ok).toBe(true)
	expect(sentContent).toBe("hi there")
	expect(existsSync(sentPath)).toBe(false)
})

test("sendPathToDevice rejects a missing file without calling send", async () => {
	let called = false
	const fakeSend: SendFileFn = async () => {
		called = true
		return { ok: true, message: "" }
	}
	const result = await sendPathToDevice(info, device, "/definitely/not/here.bin", fakeSend)
	expect(result.ok).toBe(false)
	expect(result.message).toBe("File not found or inaccessible")
	expect(called).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/tui/transfer.test.ts`
Expected: FAIL — `Cannot find module './transfer.ts'`

- [ ] **Step 3: Implement `src/tui/transfer.ts`** (logic ported 1:1 from the old Ink `sendFileToDevice`/`sendTextMessage`/`sendFileFromPath`)

```ts
import { createHash } from "node:crypto"
import { readFile, stat, unlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { LocalSendClient } from "../index.ts"
import type { DeviceInfo, FileMetadata } from "../index.ts"

export interface DiscoveredDevice extends DeviceInfo {
	ip: string
}

export interface SendResult {
	ok: boolean
	message: string
}

export function buildFileMetadata(
	filePath: string,
	fileBuffer: Buffer,
	isTextMessage: boolean
): FileMetadata {
	return {
		id: createHash("md5").update(filePath).digest("hex"),
		fileName: isTextMessage ? "message.txt" : path.basename(filePath),
		size: fileBuffer.length,
		fileType: isTextMessage ? "text/plain" : "application/octet-stream",
		sha256: createHash("sha256").update(fileBuffer).digest("hex"),
		preview: isTextMessage ? fileBuffer.toString("utf8") : undefined,
		metadata: {
			modified: new Date().toISOString()
		}
	}
}

export async function sendFileToDevice(
	deviceInfo: DeviceInfo,
	device: DiscoveredDevice,
	filePath: string,
	isTextMessage: boolean
): Promise<SendResult> {
	const client = new LocalSendClient(deviceInfo)
	const fileBuffer = await readFile(filePath)
	const fileMetadata = buildFileMetadata(filePath, fileBuffer, isTextMessage)
	const target = {
		ip: device.ip,
		port: device.port,
		protocol: device.protocol || "https"
	}

	const uploadPrepare = await client.prepareUpload(target, {
		[fileMetadata.id]: fileMetadata
	})
	if (!uploadPrepare) {
		return { ok: false, message: "Failed to prepare upload" }
	}

	const fileToken = uploadPrepare.files?.[fileMetadata.id]
	if (!fileToken) {
		if (isTextMessage) {
			return { ok: true, message: "Text message delivered" }
		}
		return { ok: false, message: "No file token returned" }
	}

	const success = await client.uploadFile(
		target,
		uploadPrepare.sessionId,
		fileMetadata.id,
		fileToken,
		filePath
	)
	return success
		? { ok: true, message: "File sent successfully" }
		: { ok: false, message: "Upload failed" }
}

export type SendFileFn = typeof sendFileToDevice

export async function sendTextToDevice(
	deviceInfo: DeviceInfo,
	device: DiscoveredDevice,
	message: string,
	send: SendFileFn = sendFileToDevice
): Promise<SendResult> {
	const tempFilePath = path.join(os.tmpdir(), `localsend-message-${Date.now()}.txt`)
	try {
		await writeFile(tempFilePath, message)
		return await send(deviceInfo, device, tempFilePath, true)
	} catch {
		return { ok: false, message: "Failed to send message" }
	} finally {
		try {
			await unlink(tempFilePath)
		} catch {}
	}
}

export async function sendPathToDevice(
	deviceInfo: DeviceInfo,
	device: DiscoveredDevice,
	filePath: string,
	send: SendFileFn = sendFileToDevice
): Promise<SendResult> {
	try {
		await stat(filePath)
	} catch {
		return { ok: false, message: "File not found or inaccessible" }
	}
	try {
		return await send(deviceInfo, device, filePath, false)
	} catch {
		return { ok: false, message: "Upload failed" }
	}
}
```

Note: if `tsc` reports that `protocol` does not exist on `DeviceInfo`, check `src/types.ts` for the actual property name — the old Ink code used `device.protocol || "https"`, so it exists in practice; mirror whatever the type declares.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/tui/transfer.test.ts && bun run check-types`
Expected: 4 pass, no type errors.

- [ ] **Step 5: Commit**

```bash
bun run format
git add src/tui/transfer.ts src/tui/transfer.test.ts
git commit -m "feat(tui): extract framework-agnostic transfer module"
```

---

### Task 3: Solid store with injectable dependencies

**Files:**

- Create: `src/tui/store.ts`
- Test: `src/tui/store.test.ts`

**Interfaces:**

- Consumes: `DiscoveredDevice`, `SendResult`, `sendTextToDevice`, `sendPathToDevice` from `./transfer.ts`; `LocalSendHonoServer`, `DeviceInfo` from `../index.ts`; `createDiscovery`, `createScanner` from `../discovery/runtime.ts`.
- Produces (used by Task 4):
  - `type Screen = "main" | "devices" | "send-text" | "send-file" | "receive" | "settings"`
  - `MENU_ITEMS: MenuItem[]` where `MenuItem = { key: string; label: string; icon: string; screen: Screen | null }` (null = exit)
  - `createTuiStore(deviceInfo: DeviceInfo, deps?: TuiDeps)` returning `{ state, deviceInfo, selectedDevice, addDevice, setScreen, setStatus, setTextInput, setFileInput, moveMenu, moveDeviceSelection, startScanning, stopScanning, startReceiver, stopReceiver, submitText, submitFile, cleanup }`
  - `type TuiStore = ReturnType<typeof createTuiStore>`
  - `interface TuiDeps { createDiscovery; createScanner; createServer; sendText; sendPath }`

- [ ] **Step 1: Write the failing tests** — `src/tui/store.test.ts`

```ts
import { expect, test } from "bun:test"
import { getDeviceInfo } from "../index.ts"
import type { DiscoveredDevice } from "./transfer.ts"
import { createTuiStore, type TuiDeps } from "./store.ts"

const info = getDeviceInfo({ alias: "TestDevice", port: 53317, enableDownloadApi: false })

const makeDevice = (ip: string): DiscoveredDevice => ({ ...info, alias: `Peer ${ip}`, ip })

function makeDeps() {
	const calls = {
		serverStart: 0,
		serverStop: 0,
		sentTexts: [] as string[],
		sentPaths: [] as string[]
	}
	let discoveredCb: ((device: DiscoveredDevice) => void) | null = null
	const deps: TuiDeps = {
		createDiscovery: () => ({
			onDeviceDiscovered: (cb) => {
				discoveredCb = cb
			},
			start: async () => {},
			stop: () => {},
			announcePresence: () => {}
		}),
		createScanner: () => ({
			onDeviceDiscovered: () => {},
			startScan: async () => {}
		}),
		createServer: () => ({
			start: async () => {
				calls.serverStart++
			},
			stop: async () => {
				calls.serverStop++
			}
		}),
		sendText: async (_info, _device, message) => {
			calls.sentTexts.push(message)
			return { ok: true, message: "sent" }
		},
		sendPath: async (_info, _device, filePath) => {
			calls.sentPaths.push(filePath)
			return { ok: true, message: "sent" }
		}
	}
	return { deps, calls, emitDevice: (d: DiscoveredDevice) => discoveredCb?.(d) }
}

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

test("entering receive screen starts the server; leaving stops it", async () => {
	const { deps, calls } = makeDeps()
	const store = createTuiStore(info, deps)
	store.setScreen("receive")
	await new Promise((resolve) => setTimeout(resolve, 0))
	expect(calls.serverStart).toBe(1)
	expect(store.state.isReceiving).toBe(true)
	store.setScreen("main")
	await new Promise((resolve) => setTimeout(resolve, 0))
	expect(calls.serverStop).toBe(1)
	expect(store.state.isReceiving).toBe(false)
})

test("submitText sends trimmed message to the selected device", async () => {
	const { deps, calls } = makeDeps()
	const store = createTuiStore(info, deps)
	store.addDevice(makeDevice("10.0.0.5"))
	store.setTextInput("  hello world  ")
	await store.submitText()
	expect(calls.sentTexts).toEqual(["hello world"])
	expect(store.state.textInput).toBe("")
	expect(store.state.statusLevel).toBe("success")
	expect(store.state.screen).toBe("main")
})

test("submitText with no device sets an error status", async () => {
	const { deps, calls } = makeDeps()
	const store = createTuiStore(info, deps)
	store.setTextInput("hello")
	await store.submitText()
	expect(calls.sentTexts).toEqual([])
	expect(store.state.statusLevel).toBe("error")
})

test("menu and device selection wrap around", () => {
	const { deps } = makeDeps()
	const store = createTuiStore(info, deps)
	store.moveMenu(-1)
	expect(store.state.menuIndex).toBe(5)
	store.moveMenu(1)
	expect(store.state.menuIndex).toBe(0)
	store.addDevice(makeDevice("10.0.0.5"))
	store.addDevice(makeDevice("10.0.0.6"))
	store.moveDeviceSelection(-1)
	expect(store.state.selectedDeviceIndex).toBe(1)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/tui/store.test.ts`
Expected: FAIL — `Cannot find module './store.ts'`

- [ ] **Step 3: Implement `src/tui/store.ts`**

```ts
import { createStore } from "solid-js/store"
import { LocalSendHonoServer } from "../index.ts"
import type { DeviceInfo } from "../index.ts"
import { createDiscovery, createScanner } from "../discovery/runtime.ts"
import { sendPathToDevice, sendTextToDevice, type DiscoveredDevice } from "./transfer.ts"

export type Screen = "main" | "devices" | "send-text" | "send-file" | "receive" | "settings"
export type StatusLevel = "info" | "success" | "error"

export interface ReceivedFile {
	fileName: string
	size: number
	time: string
	type: string
}

export interface TuiState {
	screen: Screen
	menuIndex: number
	selectedDeviceIndex: number
	devices: DiscoveredDevice[]
	isScanning: boolean
	lastScanTime: Date | null
	textInput: string
	fileInput: string
	isSending: boolean
	statusMessage: string | null
	statusLevel: StatusLevel | null
	isReceiving: boolean
	receivedFiles: ReceivedFile[]
}

export interface MenuItem {
	key: string
	label: string
	icon: string
	screen: Screen | null
}

export const MENU_ITEMS: MenuItem[] = [
	{ key: "1", label: "View & Select Devices", icon: "📱", screen: "devices" },
	{ key: "2", label: "Send Text Message", icon: "📝", screen: "send-text" },
	{ key: "3", label: "Send File", icon: "📁", screen: "send-file" },
	{ key: "4", label: "Start Receiver Mode", icon: "📥", screen: "receive" },
	{ key: "5", label: "Settings", icon: "⚙️", screen: "settings" },
	{ key: "6", label: "Exit", icon: "🚪", screen: null }
]

export interface DiscoveryLike {
	onDeviceDiscovered(cb: (device: DiscoveredDevice) => void): void
	start(): Promise<void> | void
	stop(): void
	announcePresence?(): void
}

export interface ScannerLike {
	onDeviceDiscovered(cb: (device: DiscoveredDevice) => void): void
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
}

const defaultDeps: TuiDeps = {
	createDiscovery: (info) => createDiscovery(info) as unknown as DiscoveryLike,
	createScanner: (info) => createScanner(info) as unknown as ScannerLike,
	createServer: (info, options) => new LocalSendHonoServer(info, options),
	sendText: sendTextToDevice,
	sendPath: sendPathToDevice
}

export function createTuiStore(deviceInfo: DeviceInfo, deps: TuiDeps = defaultDeps) {
	const [state, setState] = createStore<TuiState>({
		screen: "main",
		menuIndex: 0,
		selectedDeviceIndex: 0,
		devices: [],
		isScanning: false,
		lastScanTime: null,
		textInput: "",
		fileInput: "",
		isSending: false,
		statusMessage: null,
		statusLevel: null,
		isReceiving: false,
		receivedFiles: []
	})

	let discovery: DiscoveryLike | null = null
	let scanner: ScannerLike | null = null
	let server: ServerLike | null = null
	let scanInterval: ReturnType<typeof setInterval> | null = null

	const setStatus = (message: string | null, level: StatusLevel | null) => {
		setState({ statusMessage: message, statusLevel: level })
	}

	const addDevice = (device: DiscoveredDevice) => {
		if (!device.ip) return
		const exists = state.devices.some((d) => `${d.ip}:${d.port}` === `${device.ip}:${device.port}`)
		if (exists) return
		setState({ devices: [...state.devices, device], lastScanTime: new Date() })
	}

	const selectedDevice = () => state.devices[state.selectedDeviceIndex] ?? null

	const moveMenu = (delta: 1 | -1) => {
		setState("menuIndex", (i) => (i + delta + MENU_ITEMS.length) % MENU_ITEMS.length)
	}

	const moveDeviceSelection = (delta: 1 | -1) => {
		if (state.devices.length === 0) return
		setState(
			"selectedDeviceIndex",
			(i) => (i + delta + state.devices.length) % state.devices.length
		)
	}

	const setTextInput = (value: string) => setState({ textInput: value })
	const setFileInput = (value: string) => setState({ fileInput: value })

	const startReceiver = async () => {
		if (server || state.isReceiving) return
		setStatus("Starting receiver...", "info")
		try {
			const receiver = deps.createServer(deviceInfo, {
				saveDirectory: "./received_files",
				onTransferRequest: async (senderInfo, files) => {
					const fileCount = Object.keys(files).length
					setStatus(
						`Incoming transfer from ${senderInfo.alias} (${fileCount} file${fileCount === 1 ? "" : "s"})`,
						"info"
					)
					return true
				},
				onTransferProgress: async (
					_fileId,
					fileName,
					_received,
					total,
					_speed,
					finished,
					transferInfo
				) => {
					if (finished && transferInfo) {
						setState("receivedFiles", (files) => [
							...files,
							{
								fileName,
								size: total,
								time: new Date().toLocaleTimeString(),
								type: fileName.split(".").pop() || "file"
							}
						])
						setStatus(`Received ${fileName}`, "success")
					}
				}
			})
			await receiver.start()
			server = receiver
			setState({ isReceiving: true })
			setStatus("Receiver started", "success")
			discovery?.announcePresence?.()
		} catch {
			setStatus("Failed to start receiver", "error")
		}
	}

	const stopReceiver = async () => {
		if (!server) {
			setState({ isReceiving: false })
			return
		}
		setStatus("Stopping receiver...", "info")
		try {
			await server.stop()
		} catch {}
		server = null
		setState({ isReceiving: false })
		setStatus("Receiver stopped", "success")
	}

	const setScreen = (screen: Screen) => {
		const previous = state.screen
		setState({ screen })
		if (screen === "main") setState({ menuIndex: 0 })
		if (screen === "receive" && previous !== "receive") void startReceiver()
		if (previous === "receive" && screen !== "receive") void stopReceiver()
	}

	const startScanning = async () => {
		if (state.isScanning) return
		setState({ isScanning: true })
		try {
			discovery = deps.createDiscovery(deviceInfo)
			discovery.onDeviceDiscovered(addDevice)
			await discovery.start()
			discovery.announcePresence?.()

			scanner = deps.createScanner(deviceInfo)
			scanner.onDeviceDiscovered(addDevice)
			await scanner.startScan?.()

			scanInterval = setInterval(() => {
				scanner?.startScan?.()?.catch(() => {})
			}, 5000)
		} catch {
			// keep the TUI alive even if discovery fails
		} finally {
			setState({ isScanning: false, lastScanTime: new Date() })
		}
	}

	const stopScanning = () => {
		discovery?.stop()
		discovery = null
		scanner = null
		if (scanInterval) clearInterval(scanInterval)
		scanInterval = null
		setState({ isScanning: false })
	}

	const submitText = async () => {
		const device = selectedDevice()
		const message = state.textInput.trim()
		if (!device) {
			setStatus("No device selected", "error")
			setScreen("main")
			return
		}
		if (!message || state.isSending) return
		setState({ textInput: "", isSending: true })
		setScreen("main")
		setStatus("Sending message...", "info")
		const result = await deps.sendText(deviceInfo, device, message)
		setState({ isSending: false })
		setStatus(result.message, result.ok ? "success" : "error")
	}

	const submitFile = async () => {
		const device = selectedDevice()
		const filePath = state.fileInput.trim()
		if (!device) {
			setStatus("No device selected", "error")
			setScreen("main")
			return
		}
		if (!filePath || state.isSending) return
		setState({ fileInput: "", isSending: true })
		setScreen("main")
		setStatus("Sending file...", "info")
		const result = await deps.sendPath(deviceInfo, device, filePath)
		setState({ isSending: false })
		setStatus(result.message, result.ok ? "success" : "error")
	}

	const cleanup = async () => {
		stopScanning()
		if (server) {
			try {
				await server.stop()
			} catch {}
			server = null
		}
	}

	return {
		state,
		deviceInfo,
		selectedDevice,
		addDevice,
		setScreen,
		setStatus,
		setTextInput,
		setFileInput,
		moveMenu,
		moveDeviceSelection,
		startScanning,
		stopScanning,
		startReceiver,
		stopReceiver,
		submitText,
		submitFile,
		cleanup
	}
}

export type TuiStore = ReturnType<typeof createTuiStore>
```

Note: `scanner?.startScan?.()?.catch(...)` — `startScan` is optional and may return void; if `tsc` complains, use `void scanner?.startScan?.()?.catch?.(() => {})` or wrap in try/catch.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/tui/store.test.ts && bun run check-types`
Expected: 5 pass, no type errors.

- [ ] **Step 5: Commit**

```bash
bun run format
git add src/tui/store.ts src/tui/store.test.ts
git commit -m "feat(tui): add solid store with injectable deps"
```

---

### Task 4: Components, App, and entry point

**Files:**

- Create: `src/tui/theme.ts`
- Create: `src/tui/components.tsx`
- Create: `src/tui/App.tsx`
- Rewrite: `src/cli-tui.tsx`
- Test: `src/tui/app.test.tsx`

**Interfaces:**

- Consumes: `createTuiStore`, `TuiStore`, `MENU_ITEMS` from `./store.ts`; `DiscoveredDevice` from `./transfer.ts`; `useKeyboard`, `useRenderer`, `render`, `testRender` from `@opentui/solid`.
- Produces: `App(props: { store: TuiStore })` component; fully functional `bun src/cli-tui.tsx`.

- [ ] **Step 1: Write the failing render tests** — `src/tui/app.test.tsx`

```tsx
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { getDeviceInfo } from "../index.ts"
import { App } from "./App.tsx"
import { createTuiStore, type TuiDeps } from "./store.ts"
import type { DiscoveredDevice } from "./transfer.ts"

const info = getDeviceInfo({ alias: "TestDevice", port: 53317, enableDownloadApi: false })

const noopDeps: TuiDeps = {
	createDiscovery: () => ({
		onDeviceDiscovered: () => {},
		start: async () => {},
		stop: () => {},
		announcePresence: () => {}
	}),
	createScanner: () => ({ onDeviceDiscovered: () => {}, startScan: async () => {} }),
	createServer: () => ({ start: async () => {}, stop: async () => {} }),
	sendText: async () => ({ ok: true, message: "sent" }),
	sendPath: async () => ({ ok: true, message: "sent" })
}

test("renders the main menu with device info", async () => {
	const store = createTuiStore(info, noopDeps)
	const { renderOnce, captureCharFrame, renderer } = await testRender(() => <App store={store} />, {
		width: 80,
		height: 30
	})
	await renderOnce()
	const frame = captureCharFrame()
	expect(frame).toContain("Main Menu")
	expect(frame).toContain("Send Text Message")
	expect(frame).toContain("TestDevice")
	renderer.destroy()
})

test("devices screen lists discovered devices", async () => {
	const store = createTuiStore(info, noopDeps)
	const device: DiscoveredDevice = { ...info, alias: "Kitchen Laptop", ip: "10.0.0.9" }
	store.addDevice(device)
	store.setScreen("devices")
	const { renderOnce, captureCharFrame, renderer } = await testRender(() => <App store={store} />, {
		width: 80,
		height: 30
	})
	await renderOnce()
	const frame = captureCharFrame()
	expect(frame).toContain("Nearby Devices (1)")
	expect(frame).toContain("Kitchen Laptop")
	expect(frame).toContain("10.0.0.9")
	renderer.destroy()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/tui/app.test.tsx`
Expected: FAIL — `Cannot find module './App.tsx'`

- [ ] **Step 3: Create `src/tui/theme.ts`**

```ts
export const colors = {
	cyan: "#00FFFF",
	gray: "#808080",
	yellow: "#FFFF00",
	green: "#00FF00",
	red: "#FF4444",
	white: "#FFFFFF",
	black: "#000000"
} as const
```

- [ ] **Step 4: Create `src/tui/components.tsx`**

```tsx
import { For, Show } from "solid-js"
import prettyBytes from "pretty-bytes"
import type { DeviceInfo } from "../index.ts"
import { colors } from "./theme.ts"
import { MENU_ITEMS, type TuiStore } from "./store.ts"
import type { DiscoveredDevice } from "./transfer.ts"

export const Header = (props: { title: string; deviceName: string; port: number }) => (
	<box flexDirection="column" marginBottom={1}>
		<box justifyContent="center" paddingTop={1} paddingBottom={1}>
			<text fg={colors.cyan}>
				<b>🌐 LocalSend TUI - {props.title}</b>
			</text>
		</box>
		<box justifyContent="center">
			<text fg={colors.gray}>
				Device: {props.deviceName} | Port: {props.port}
			</text>
		</box>
	</box>
)

export const StatusBar = (props: { store: TuiStore }) => {
	const state = () => props.store.state
	const statusColor = () =>
		state().statusLevel === "error"
			? colors.red
			: state().statusLevel === "success"
				? colors.green
				: colors.yellow
	return (
		<box
			border
			borderStyle="single"
			borderColor={colors.gray}
			paddingLeft={1}
			paddingRight={1}
			marginTop={1}
			flexDirection="column"
		>
			<text>
				Status:{" "}
				<span fg={state().isScanning ? colors.yellow : colors.green}>
					{state().isScanning ? "🔍 Scanning..." : "✓ Ready"}
				</span>
				{" | "}Devices: <span fg={colors.cyan}>{state().devices.length}</span>
				{" | "}Last scan:{" "}
				<span fg={colors.gray}>
					{state().lastScanTime ? state().lastScanTime!.toLocaleTimeString() : "Never"}
				</span>
			</text>
			<Show when={state().statusMessage}>
				<text fg={statusColor()}>{state().statusMessage}</text>
			</Show>
		</box>
	)
}

export const MainMenu = (props: { selectedIndex: number }) => (
	<box flexDirection="column" marginTop={1} marginBottom={1}>
		<text fg={colors.yellow}>
			<b>Main Menu:</b>
		</text>
		<For each={MENU_ITEMS}>
			{(item, index) => (
				<box marginLeft={2} marginTop={1}>
					<text
						fg={props.selectedIndex === index() ? colors.black : colors.white}
						bg={props.selectedIndex === index() ? colors.cyan : undefined}
					>
						{props.selectedIndex === index() ? "▶ " : "  "}
						{item.icon} {item.label}
					</text>
				</box>
			)}
		</For>
		<box marginTop={1}>
			<text fg={colors.gray}>↑↓ Navigate | Enter: Select | q: Quit</text>
		</box>
	</box>
)

export const DeviceList = (props: { devices: DiscoveredDevice[]; selectedIndex: number }) => (
	<box flexDirection="column" marginTop={1} marginBottom={1}>
		<text fg={colors.yellow}>
			<b>📱 Nearby Devices ({props.devices.length}):</b>
		</text>
		<Show
			when={props.devices.length > 0}
			fallback={
				<box marginLeft={2} marginTop={1}>
					<text fg={colors.gray}>No devices found. Scanning...</text>
				</box>
			}
		>
			<For each={props.devices}>
				{(device, index) => (
					<box marginLeft={2} marginTop={1}>
						<text
							fg={props.selectedIndex === index() ? colors.black : colors.white}
							bg={props.selectedIndex === index() ? colors.cyan : undefined}
						>
							{props.selectedIndex === index() ? "▶ " : "  "}
							{device.alias} ({device.ip}:{device.port})
							<span fg={colors.gray}> - {device.deviceModel}</span>
						</text>
					</box>
				)}
			</For>
			<box marginTop={1}>
				<text fg={colors.gray}>↑↓ Navigate | Enter: Select | Esc: Back</text>
			</box>
		</Show>
	</box>
)

export const SendScreen = (props: { store: TuiStore; mode: "text" | "file" }) => {
	const store = props.store
	const device = () => store.selectedDevice()
	const isText = () => props.mode === "text"
	return (
		<box flexDirection="column" marginTop={1} marginBottom={1}>
			<text fg={colors.yellow}>
				<b>{isText() ? "📝 Send Text Message" : "📁 Send File"}</b>
			</text>
			<Show
				when={device()}
				fallback={
					<box flexDirection="column" marginTop={1}>
						<text fg={colors.red}>No device selected. Please select a device first.</text>
						<text fg={colors.gray}>Esc: Back</text>
					</box>
				}
			>
				<box flexDirection="column" marginTop={1}>
					<text>
						Target: <span fg={colors.cyan}>{device()!.alias}</span> ({device()!.ip}:{device()!.port}
						)
					</text>
					<box marginTop={1} flexDirection="row">
						<text>{isText() ? "Message: " : "File path: "}</text>
						<input
							focused
							value={isText() ? store.state.textInput : store.state.fileInput}
							onInput={(value: string) =>
								isText() ? store.setTextInput(value) : store.setFileInput(value)
							}
							onSubmit={() => void (isText() ? store.submitText() : store.submitFile())}
							placeholder={isText() ? "Type your message..." : "/absolute/path/to/file"}
							flexGrow={1}
						/>
					</box>
					<box marginTop={1}>
						<text fg={colors.gray}>Type and press Enter to send | Esc: Back</text>
					</box>
				</box>
			</Show>
		</box>
	)
}

export const ReceiveScreen = (props: { store: TuiStore }) => {
	const state = () => props.store.state
	return (
		<box flexDirection="column" marginTop={1} marginBottom={1}>
			<text fg={colors.yellow}>
				<b>📥 Receiver Mode</b>
			</text>
			<box marginTop={1}>
				<text>
					Status:{" "}
					<span fg={state().isReceiving ? colors.green : colors.red}>
						{state().isReceiving ? "🟢 Listening for incoming transfers" : "🔴 Stopped"}
					</span>
				</text>
			</box>
			<Show when={state().receivedFiles.length > 0}>
				<box flexDirection="column" marginTop={1}>
					<text fg={colors.cyan}>
						<b>Recent transfers:</b>
					</text>
					<For each={state().receivedFiles.slice(-5)}>
						{(file) => (
							<box marginLeft={2}>
								<text>
									📄 {file.fileName} ({prettyBytes(file.size)}) - {file.time}
								</text>
							</box>
						)}
					</For>
				</box>
			</Show>
			<box marginTop={1}>
				<text fg={colors.gray}>
					{state().isReceiving ? "r: Stop receiver" : "r: Start receiver"} | Esc: Back
				</text>
			</box>
		</box>
	)
}

export const SettingsScreen = (props: { deviceInfo: DeviceInfo }) => (
	<box flexDirection="column" marginTop={1} marginBottom={1}>
		<text fg={colors.yellow}>
			<b>⚙️ Settings</b>
		</text>
		<box marginTop={1}>
			<text>
				Device: <span fg={colors.cyan}>{props.deviceInfo.alias}</span>
			</text>
		</box>
		<box marginTop={1}>
			<text>
				Port: <span fg={colors.cyan}>{props.deviceInfo.port}</span>
			</text>
		</box>
		<box marginTop={1}>
			<text fg={colors.gray}>Esc: Back</text>
		</box>
	</box>
)
```

Note on `<input>` props: `focused`, `onInput`, `onSubmit` are the binding-level props (documented in the React binding; the Solid binding shares the same component catalogue). If `onSubmit` doesn't fire, the fallback is handling `key.name === "return"` for these screens in `App.tsx`'s `useKeyboard` and calling `submitText`/`submitFile` there.

- [ ] **Step 5: Create `src/tui/App.tsx`**

```tsx
import { Match, Switch, onCleanup, onMount } from "solid-js"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { MENU_ITEMS, type TuiStore } from "./store.ts"
import {
	DeviceList,
	Header,
	MainMenu,
	ReceiveScreen,
	SendScreen,
	SettingsScreen,
	StatusBar
} from "./components.tsx"

export const App = (props: { store: TuiStore }) => {
	const store = props.store
	const renderer = useRenderer()

	const exit = () => {
		void store.cleanup().finally(() => {
			renderer.destroy()
			process.exit(0)
		})
	}

	onMount(() => {
		void store.startScanning()
	})
	onCleanup(() => {
		void store.cleanup()
	})

	useKeyboard((key) => {
		const screen = store.state.screen

		if (key.name === "escape") {
			if (screen === "main") exit()
			else store.setScreen("main")
			return
		}

		// The focused <input> owns all other keys on these screens
		if (screen === "send-text" || screen === "send-file") return

		switch (screen) {
			case "main":
				if (key.name === "q") exit()
				else if (key.name === "up") store.moveMenu(-1)
				else if (key.name === "down") store.moveMenu(1)
				else if (key.name === "return") {
					const item = MENU_ITEMS[store.state.menuIndex]
					if (!item) return
					if (item.screen === null) exit()
					else store.setScreen(item.screen)
				}
				break
			case "devices":
				if (key.name === "up") store.moveDeviceSelection(-1)
				else if (key.name === "down") store.moveDeviceSelection(1)
				else if (key.name === "return" && store.state.devices.length > 0) {
					store.setScreen("main")
				}
				break
			case "receive":
				if (key.name === "r") {
					if (store.state.isReceiving) void store.stopReceiver()
					else void store.startReceiver()
				}
				break
		}
	})

	const title = () =>
		store.state.screen === "main"
			? "Main Menu"
			: store.state.screen.charAt(0).toUpperCase() + store.state.screen.slice(1)

	return (
		<box flexDirection="column" minHeight={24}>
			<Header title={title()} deviceName={store.deviceInfo.alias} port={store.deviceInfo.port} />
			<Switch fallback={<MainMenu selectedIndex={store.state.menuIndex} />}>
				<Match when={store.state.screen === "devices"}>
					<DeviceList
						devices={store.state.devices}
						selectedIndex={store.state.selectedDeviceIndex}
					/>
				</Match>
				<Match when={store.state.screen === "send-text"}>
					<SendScreen store={store} mode="text" />
				</Match>
				<Match when={store.state.screen === "send-file"}>
					<SendScreen store={store} mode="file" />
				</Match>
				<Match when={store.state.screen === "receive"}>
					<ReceiveScreen store={store} />
				</Match>
				<Match when={store.state.screen === "settings"}>
					<SettingsScreen deviceInfo={store.deviceInfo} />
				</Match>
			</Switch>
			<StatusBar store={store} />
		</box>
	)
}
```

- [ ] **Step 6: Rewrite `src/cli-tui.tsx`** (replaces the Task 1 shell)

```tsx
#!/usr/bin/env bun
import { render } from "@opentui/solid"
import { defineCommand, runMain } from "citty"
import { getDeviceInfo } from "./index.ts"
import { createTuiStore } from "./tui/store.ts"
import { App } from "./tui/App.tsx"

const main = defineCommand({
	meta: {
		name: "localsend-tui",
		version: "0.1.0",
		description: "LocalSend Interactive TUI"
	},
	args: {
		port: {
			type: "string",
			description: "Custom port number"
		},
		alias: {
			type: "string",
			description: "Custom device alias"
		}
	},
	async run({ args }) {
		const portString = args.port as string | undefined
		const port = portString ? parseInt(portString, 10) : undefined
		const alias =
			(args.alias as string | undefined) || `LocalSend TUI ${Math.floor(100 + Math.random() * 900)}`
		const deviceInfo = getDeviceInfo({ alias, port, enableDownloadApi: false })
		const store = createTuiStore(deviceInfo)
		render(() => <App store={store} />)
	}
})

runMain(main)
```

- [ ] **Step 7: Run all tests and typecheck**

Run: `bun test src/tui && bun run check-types`
Expected: all tests pass (smoke + transfer + store + app), no type errors.

- [ ] **Step 8: Commit**

```bash
bun run format
git add -A
git commit -m "feat(tui): full opentui solid app with screens, keyboard, and entry"
```

---

### Task 5: Manual verification and doc updates

**Files:**

- Modify: `AGENTS.md:30`, `AGENTS.md:112`
- Modify: `README.md:28-46` (the "Interactive TUI" section)

**Interfaces:**

- Consumes: the finished app from Task 4.

- [ ] **Step 1: Manual end-to-end check** (requires a real terminal; run outside CI)

Open two terminal windows in the repo root:

1. Terminal A: `bun src/cli-tui.tsx --alias ReceiverA` → menu with ↑/↓ works → select "Start Receiver Mode" → status shows "Receiver started" / "🟢 Listening".
2. Terminal B: `bun src/cli-tui.tsx --alias SenderB` → wait for ReceiverA to appear under "View & Select Devices" → select it (Enter) → "Send Text Message" → type `hello` → Enter → status shows "Text message delivered" or "File sent successfully".
3. Terminal A: receive screen lists the transfer under "Recent transfers"; `./received_files/` contains `message.txt`.
4. Both: Esc returns to main menu; `q`/Esc on main menu exits and the terminal restores (no leftover alternate screen, cursor visible).

If discovery finds nothing, check both instances are on the same network interface — this matches the old Ink behavior and is not a migration regression.

- [ ] **Step 2: Update `AGENTS.md`**

Line 30: replace `bun run tui            # React Ink TUI (recommended CLI)` with:

```
bun run tui            # OpenTUI (Solid) TUI (recommended CLI)
```

Line 112: replace `│   ├── cli-tui.tsx   # React Ink TUI (recommended)` with:

```
│   ├── cli-tui.tsx   # OpenTUI (Solid) TUI (recommended)
```

If AGENTS.md documents the repo layout in more detail, add a line for `src/tui/` (store, components, transfer module) next to the `cli-tui.tsx` entry.

- [ ] **Step 3: Update `README.md`**

In the "Interactive TUI (Recommended)" section, replace the sentence containing "built with **Ink (React for CLI)**" with:

```
The TUI provides a sophisticated interface built with **OpenTUI (Solid.js)** featuring:
```

Note: the TUI now requires Bun (`npm run tui` still works because the script itself invokes `bun`) — add a one-line note if the section implies Node compatibility.

- [ ] **Step 4: Final verification**

```bash
bun test src/tui
bun run check-types
bun run build
```

Expected: all pass; `bun run build` still produces `dist/cli.js` and `dist/cli-interactive.js` untouched by this migration.

- [ ] **Step 5: Commit**

```bash
bun run format
git add -A
git commit -m "docs: update TUI references from ink to opentui"
```

---

## Deferred (deliberately out of scope — YAGNI)

- Shipping the TUI as a published bin. OpenTUI's native core makes `node dist/cli-tui.js` non-viable; the right path is Bun standalone executables (`Bun.build` with `@opentui/solid/bun-plugin` and `compile`, see `/docs/reference/standalone-executables`). If that ever happens, _that_ is the moment to consider a separate workspace package — not now.
- Replacing hand-rolled menu/device-list navigation with OpenTUI's `<select>` component (its keyboard handling and `wrapSelection` would delete `moveMenu`/`moveDeviceSelection`). Worth doing as a follow-up once the Solid event-prop surface for `select` is confirmed against the installed version's typings.
- `scrollbox` for long device/transfer lists.

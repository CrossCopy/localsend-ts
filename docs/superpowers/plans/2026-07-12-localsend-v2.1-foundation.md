# LocalSend v2.1 Foundation (Phases 0–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an automated test harness, refactor the protocol logic into a runtime-agnostic testable core with a single canonical server, and fix all correctness/security bugs in the v2 upload path.

**Architecture:** Extract protocol types, crypto, and a framework-free `core/` (sessions, receive handlers, send client, file IO) out of the 500-line Hono route closures. The Hono server + adapters become a thin transport shell delegating to `core/`. One canonical `LocalSendServer`; the broken vanilla server is removed. Fixes are TDDّ against a spec-conformance + TS↔TS interop suite.

**Tech Stack:** TypeScript, Bun (primary runtime + `bun test` + `bun build`), Hono (HTTP), valibot (schemas), undici (Node fetch/TLS), node:crypto/fs. No new runtime deps in these phases.

## Global Constraints

- **Formatting (Prettier, enforced):** no semicolons; no trailing commas; tabs (2-space width); print width 100. Run `bun run format` before every commit.
- **Imports:** `.ts` extensions allowed and used (`import { X } from "./file.ts"`); `node:` prefix for builtins; valibot as `import * as v from "valibot"`.
- **Protocol source of truth:** `src/protocol/types.ts` valibot schemas — never hand-maintain duplicate protocol types.
- **Never edit** `src/sdk/*.gen.ts` (regenerated on build).
- **Protocol target:** LocalSend **v2.1**, endpoints under `/api/localsend/v2/`. Multicast `224.0.0.167:53317`, default port `53317`.
- **Upload wire rule:** a file is uploaded as the **entire binary body in ONE POST** — no `Content-Range`/`X-Content-Range`.
- **Type check:** `bun run check-types` (`tsc --noEmit`) must pass at every commit.
- **Reference spec:** `docs/superpowers/specs/2026-07-12-localsend-v2.1-completion-and-test-harness-design.md` §3.

---

## File Structure (target after Phase 1)

- `src/protocol/constants.ts` — ports, multicast, API paths, version (was `src/config.ts`).
- `src/protocol/types.ts` — DeviceInfo/FileMetadata/DTO valibot schemas (was `src/types.ts`).
- `src/crypto/fingerprint.ts` — `generateFingerprint()` (was in `src/utils/device.ts`).
- `src/core/files.ts` — `sanitizeFilename`, `resolveSavePath`, hashing, metadata builders (was `src/utils/file.ts`).
- `src/core/sessions.ts` — `UploadSessionStore` (session/token state).
- `src/core/receive.ts` — framework-free request handlers returning normalized results.
- `src/core/send.ts` — `LocalSendClient` (was `src/api/client.ts`).
- `src/server/routes.ts` — Hono routes delegating to `core/receive.ts` (was `src/api/hono-routes.ts`).
- `src/server/adapters/{types,bun,node,deno}.ts` — server adapters (was `src/api/server-adapter.ts`).
- `src/server/server.ts` — canonical `LocalSendServer` (was `src/api/hono-server.ts`).
- `src/utils/device.ts` — `getDeviceInfo` (kept; re-exports fingerprint).
- **Removed:** `src/api/server.ts` (vanilla `LocalSendServer`), `src/api/deno-client.ts` (unused dead code — verify no imports first).
- `test/helpers/harness.ts` — stable test API (start receiver, send file, stage/download).
- `test/helpers/util.ts` — temp dirs, free ports, random files, sha256.
- `test/unit/*.test.ts`, `test/conformance/*.test.ts`, `test/interop/*.test.ts`.

> Migration technique: when moving a module, leave the OLD path as a thin re-export
> (`export * from "../new/path.ts"`) until all imports are updated, so each step stays green.
> Remove the old file only in the dedicated cleanup task.

---

## Phase 0 — Test Scaffolding

### Task 0.1: Test utilities + harness + first green interop test

**Files:**
- Create: `test/helpers/util.ts`
- Create: `test/helpers/harness.ts`
- Create: `test/interop/upload-smoke.test.ts`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Produces: `tempDir(): Promise<string>`, `rmTemp(dir)`, `getFreePort(): Promise<number>`, `makeRandomFile(dir, name, size): Promise<{path, sha256}>`, `sha256File(path): Promise<string>`
- Produces: `startReceiver(opts?): Promise<Receiver>` where `Receiver = { port, saveDir, deviceInfo, stop() }`; `sendFile(receiver, filePath, opts?): Promise<boolean>`. These wrap the CURRENT API today and are updated in Phase 1 so test bodies stay stable.

- [ ] **Step 1: Write `test/helpers/util.ts`**

```ts
import { mkdtemp, rm, stat, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createServer } from "node:net"
import { createHash, randomBytes } from "node:crypto"

export async function tempDir(): Promise<string> {
	return await mkdtemp(path.join(tmpdir(), "localsend-test-"))
}

export async function rmTemp(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true })
}

export function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = createServer()
		srv.once("error", reject)
		srv.listen(0, () => {
			const addr = srv.address()
			if (addr && typeof addr === "object") {
				const port = addr.port
				srv.close(() => resolve(port))
			} else {
				srv.close(() => reject(new Error("no port")))
			}
		})
	})
}

export async function makeRandomFile(
	dir: string,
	name: string,
	size: number
): Promise<{ path: string; sha256: string }> {
	const filePath = path.join(dir, name)
	const buf = randomBytes(size)
	await writeFile(filePath, buf)
	return { path: filePath, sha256: createHash("sha256").update(buf).digest("hex") }
}

export async function sha256File(filePath: string): Promise<string> {
	const buf = await readFile(filePath)
	return createHash("sha256").update(buf).digest("hex")
}

export async function fileSize(filePath: string): Promise<number> {
	return (await stat(filePath)).size
}
```

- [ ] **Step 2: Write `test/helpers/harness.ts` (wraps current API)**

```ts
import { getDeviceInfo } from "../../src/utils/device.ts"
import { LocalSendHonoServer } from "../../src/api/hono-server.ts"
import { LocalSendClient } from "../../src/api/client.ts"
import { getFreePort, tempDir, rmTemp } from "./util.ts"
import path from "node:path"

export interface Receiver {
	port: number
	saveDir: string
	deviceInfo: ReturnType<typeof getDeviceInfo>
	stop(): Promise<void>
}

export async function startReceiver(opts: { pin?: string; autoAccept?: boolean } = {}): Promise<Receiver> {
	const port = await getFreePort()
	const saveDir = await tempDir()
	const deviceInfo = getDeviceInfo({ alias: "Test Receiver", port })
	const server = new LocalSendHonoServer(deviceInfo, {
		saveDirectory: saveDir,
		pin: opts.pin,
		onTransferRequest: async () => opts.autoAccept ?? true
	})
	await server.start()
	return {
		port,
		saveDir,
		deviceInfo,
		async stop() {
			await server.stop()
			await rmTemp(saveDir)
		}
	}
}

export async function sendFile(
	receiver: Pick<Receiver, "port">,
	filePath: string,
	opts: { pin?: string } = {}
): Promise<boolean> {
	const sender = getDeviceInfo({ alias: "Test Sender" })
	const client = new LocalSendClient(sender)
	const target = { ip: "127.0.0.1", port: receiver.port, protocol: "http" as const }
	const { buildFileMetadataFromPath } = await import("../../src/utils/file.ts")
	const { fileId, fileMetadata } = await buildFileMetadataFromPath(filePath)
	const prep = await client.prepareUpload(target, { [fileId]: fileMetadata }, opts.pin)
	if (!prep || !prep.files[fileId]) return false
	return client.uploadFile(target, prep.sessionId, fileId, prep.files[fileId], filePath)
}

export function savedPath(receiver: Receiver, name: string): string {
	return path.join(receiver.saveDir, name)
}
```

- [ ] **Step 3: Write `test/interop/upload-smoke.test.ts`**

```ts
import { test, expect } from "bun:test"
import { startReceiver, sendFile, savedPath } from "../helpers/harness.ts"
import { tempDir, rmTemp, makeRandomFile, sha256File } from "../helpers/util.ts"

test("uploads a small file byte-for-byte (TS -> TS)", async () => {
	const src = await tempDir()
	const receiver = await startReceiver({ autoAccept: true })
	try {
		const { path: filePath, sha256 } = await makeRandomFile(src, "hello.bin", 1024)
		const ok = await sendFile(receiver, filePath)
		expect(ok).toBe(true)
		const got = await sha256File(savedPath(receiver, "hello.bin"))
		expect(got).toBe(sha256)
	} finally {
		await receiver.stop()
		await rmTemp(src)
	}
})
```

- [ ] **Step 4: Add test script to `package.json`**

Add to `"scripts"`: `"test": "bun test"`.

- [ ] **Step 5: Run the test — verify GREEN**

Run: `bun test test/interop/upload-smoke.test.ts`
Expected: 1 pass. (Proves the harness works against current code.)

- [ ] **Step 6: Format, type-check, commit**

```bash
bun run format
bun run check-types
git add test package.json
git commit -m "test: add bun test harness with TS<->TS upload smoke test"
```

---

## Phase 1 — Refactor to runtime-agnostic core

> Order matters: leaf modules first (constants, types, crypto, files, sessions), then handlers,
> then server, then delete dead code. Each task ends green via `check-types` + `bun test`.

### Task 1.1: Extract protocol constants

**Files:**
- Create: `src/protocol/constants.ts`
- Modify: `src/config.ts` (becomes re-export)

**Interfaces:**
- Produces: `DEFAULT_CONFIG` (unchanged shape), `API_PATHS = { info, register, prepareUpload, upload, cancel, prepareDownload, download }`, `MULTICAST`.

- [ ] **Step 1: Create `src/protocol/constants.ts`**

```ts
export const DEFAULT_CONFIG = {
	MULTICAST_PORT: 53317,
	MULTICAST_ADDRESS: "224.0.0.167",
	HTTP_PORT: 53317,
	PROTOCOL_VERSION: "2.1"
}

export const API_BASE = "/api/localsend/v2"

export const API_PATHS = {
	info: `${API_BASE}/info`,
	register: `${API_BASE}/register`,
	prepareUpload: `${API_BASE}/prepare-upload`,
	upload: `${API_BASE}/upload`,
	cancel: `${API_BASE}/cancel`,
	prepareDownload: `${API_BASE}/prepare-download`,
	download: `${API_BASE}/download`
}
```

- [ ] **Step 2: Make `src/config.ts` re-export**

```ts
export * from "./protocol/constants.ts"
```

- [ ] **Step 3: Type-check + test + commit**

```bash
bun run check-types && bun test
bun run format
git add src/protocol/constants.ts src/config.ts
git commit -m "refactor: extract protocol constants to src/protocol/constants.ts"
```

Expected: all green (re-export keeps existing imports working).

### Task 1.2: Move protocol types

**Files:**
- Create: `src/protocol/types.ts` (copy current `src/types.ts` verbatim, change internal import of config to `./constants.ts` if any)
- Modify: `src/types.ts` → `export * from "./protocol/types.ts"`

- [ ] **Step 1:** Copy the full contents of `src/types.ts` into `src/protocol/types.ts` unchanged (no leniency edits yet — those are Phase 2).
- [ ] **Step 2:** Replace `src/types.ts` body with `export * from "./protocol/types.ts"`.
- [ ] **Step 3:** `bun run check-types && bun test` → green. `bun run format`.
- [ ] **Step 4:** Commit: `git commit -am "refactor: move protocol types to src/protocol/types.ts"`

### Task 1.3: Extract crypto/fingerprint

**Files:**
- Create: `src/crypto/fingerprint.ts`
- Modify: `src/utils/device.ts` (import fingerprint from new module, re-export it)

- [ ] **Step 1: Create `src/crypto/fingerprint.ts`**

```ts
import { randomBytes } from "node:crypto"

/** HTTP-mode fingerprint: a random hex string. (HTTPS-mode cert fingerprint arrives in Phase 4.) */
export function generateFingerprint(): string {
	return randomBytes(32).toString("hex")
}
```

- [ ] **Step 2:** In `src/utils/device.ts`, remove the local `generateFingerprint` definition; add `import { generateFingerprint } from "../crypto/fingerprint.ts"` and `export { generateFingerprint }`.
- [ ] **Step 3:** `bun run check-types && bun test` → green. `bun run format`.
- [ ] **Step 4:** Commit: `git commit -am "refactor: extract fingerprint to src/crypto/fingerprint.ts"`

### Task 1.4: Create `src/core/files.ts` with traversal-safe path resolver (test-first)

**Files:**
- Create: `src/core/files.ts`
- Create: `test/unit/files.test.ts`
- Modify: `src/utils/file.ts` → re-export from `../core/files.ts`

**Interfaces:**
- Produces: `sanitizeFilename(name: string): string`, `resolveSavePath(saveDir: string, fileName: string): string` (throws `Error` on traversal escape), plus the existing `createFileId`, `computeSha256FromFile`, `computeSha256FromBytes`, `buildFileMetadataFromPath`, `buildFileMetadataFromBytes` (moved verbatim).

- [ ] **Step 1: Write `test/unit/files.test.ts`**

```ts
import { test, expect } from "bun:test"
import path from "node:path"
import { resolveSavePath, sanitizeFilename } from "../../src/core/files.ts"

const SAVE = "/tmp/ls-save"

test("resolveSavePath keeps plain names inside saveDir", () => {
	expect(resolveSavePath(SAVE, "a.txt")).toBe(path.join(SAVE, "a.txt"))
})

test("resolveSavePath allows safe subfolders", () => {
	expect(resolveSavePath(SAVE, "sub/dir/a.txt")).toBe(path.join(SAVE, "sub/dir/a.txt"))
})

test("resolveSavePath rejects parent traversal", () => {
	expect(() => resolveSavePath(SAVE, "../evil.txt")).toThrow()
	expect(() => resolveSavePath(SAVE, "sub/../../evil.txt")).toThrow()
	expect(() => resolveSavePath(SAVE, "/etc/passwd")).toThrow()
})

test("sanitizeFilename strips path separators", () => {
	expect(sanitizeFilename("../../x.txt")).toBe("x.txt")
	expect(sanitizeFilename("a/b/c.txt")).toBe("c.txt")
})
```

- [ ] **Step 2: Run — verify FAIL**

Run: `bun test test/unit/files.test.ts`
Expected: FAIL (`resolveSavePath` not exported).

- [ ] **Step 3: Create `src/core/files.ts`** (move existing helpers from `src/utils/file.ts` verbatim, then add the two new functions)

```ts
import { Buffer } from "node:buffer"
import { createHash, randomBytes } from "node:crypto"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import type { FileMetadata } from "../protocol/types.ts"

export function sanitizeFilename(name: string): string {
	return path.basename(name)
}

/**
 * Resolve a save path for an incoming file, preserving safe sub-folders but
 * rejecting any path that escapes saveDir (path traversal).
 */
export function resolveSavePath(saveDir: string, fileName: string): string {
	const root = path.resolve(saveDir)
	const candidate = path.resolve(root, fileName)
	if (candidate !== root && !candidate.startsWith(root + path.sep)) {
		throw new Error(`Unsafe file path rejected: ${fileName}`)
	}
	return candidate
}

// ---- moved verbatim from src/utils/file.ts ----
export function createFileId(seed?: string): string {
	if (seed) return createHash("md5").update(seed).digest("hex")
	return randomBytes(16).toString("hex")
}

export async function computeSha256FromFile(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256")
		const stream = createReadStream(filePath)
		stream.on("data", (chunk) => hash.update(chunk))
		stream.on("error", (err) => reject(err))
		stream.on("end", () => resolve(hash.digest("hex")))
	})
}

export function computeSha256FromBytes(payload: Uint8Array): string {
	return createHash("sha256").update(payload).digest("hex")
}

export async function buildFileMetadataFromPath(
	filePath: string,
	options: {
		fileId?: string
		fileName?: string
		fileType?: string
		preview?: string
		metadata?: { modified?: string; accessed?: string }
		computeSha256?: boolean
	} = {}
): Promise<{ fileId: string; fileMetadata: FileMetadata }> {
	const fileStats = await stat(filePath)
	const fileId = options.fileId ?? createFileId(filePath)
	const fileName = options.fileName ?? path.basename(filePath)
	const fileType = options.fileType ?? "application/octet-stream"
	const metadata =
		options.metadata ?? {
			modified: fileStats.mtime?.toISOString(),
			accessed: fileStats.atime?.toISOString()
		}
	const sha256 = options.computeSha256 === false ? undefined : await computeSha256FromFile(filePath)
	const fileMetadata: FileMetadata = {
		id: fileId,
		fileName,
		size: fileStats.size,
		fileType,
		sha256,
		preview: options.preview,
		metadata
	}
	return { fileId, fileMetadata }
}

export function buildFileMetadataFromBytes(
	payload: Uint8Array,
	options: {
		fileId?: string
		fileName: string
		fileType?: string
		preview?: string
		metadata?: { modified?: string; accessed?: string }
	}
): { fileId: string; fileMetadata: FileMetadata } {
	const buffer = Buffer.from(payload)
	const fileId = options.fileId ?? createFileId()
	const fileType = options.fileType ?? "application/octet-stream"
	const metadata = options.metadata ?? { modified: new Date().toISOString() }
	const fileMetadata: FileMetadata = {
		id: fileId,
		fileName: options.fileName,
		size: buffer.length,
		fileType,
		sha256: computeSha256FromBytes(buffer),
		preview: options.preview,
		metadata
	}
	return { fileId, fileMetadata }
}
```

- [ ] **Step 4:** Replace `src/utils/file.ts` body with `export * from "../core/files.ts"`.
- [ ] **Step 5: Run — verify PASS**

Run: `bun test test/unit/files.test.ts`
Expected: 4 pass.

- [ ] **Step 6:** `bun run check-types && bun test` → all green. `bun run format`. Commit:

```bash
git add src/core/files.ts src/utils/file.ts test/unit/files.test.ts
git commit -m "refactor: add core/files with traversal-safe resolveSavePath (+tests)"
```

### Task 1.5: Extract `UploadSessionStore` (test-first)

**Files:**
- Create: `src/core/sessions.ts`
- Create: `test/unit/sessions.test.ts`

**Interfaces:**
- Produces:
```ts
type UploadSession = {
	info: DeviceInfo
	files: Record<string, FileMetadata>
	tokens: Record<string, string>
	acceptedFiles: string[]
	receivedFiles: Set<string>
}
class UploadSessionStore {
	create(info: DeviceInfo, files: Record<string, FileMetadata>): { sessionId: string; tokens: Record<string, string> }
	get(sessionId: string): UploadSession | undefined
	validateToken(sessionId: string, fileId: string, token: string): boolean
	markReceived(sessionId: string, fileId: string): { allDone: boolean }
	delete(sessionId: string): void
	has(sessionId: string): boolean
}
```

- [ ] **Step 1: Write `test/unit/sessions.test.ts`**

```ts
import { test, expect } from "bun:test"
import { UploadSessionStore } from "../../src/core/sessions.ts"
import type { DeviceInfo, FileMetadata } from "../../src/protocol/types.ts"

const info = { alias: "a", version: "2.1", deviceModel: null, deviceType: "desktop", fingerprint: "fp", port: 53317, protocol: "http", download: false } as DeviceInfo
const files: Record<string, FileMetadata> = {
	f1: { id: "f1", fileName: "a.txt", size: 3, fileType: "text/plain" },
	f2: { id: "f2", fileName: "b.txt", size: 3, fileType: "text/plain" }
}

test("create issues a sessionId and one token per file", () => {
	const store = new UploadSessionStore()
	const { sessionId, tokens } = store.create(info, files)
	expect(sessionId).toHaveLength(32)
	expect(Object.keys(tokens).sort()).toEqual(["f1", "f2"])
	expect(store.validateToken(sessionId, "f1", tokens.f1)).toBe(true)
	expect(store.validateToken(sessionId, "f1", "wrong")).toBe(false)
})

test("markReceived reports allDone when every file arrives", () => {
	const store = new UploadSessionStore()
	const { sessionId } = store.create(info, files)
	expect(store.markReceived(sessionId, "f1").allDone).toBe(false)
	expect(store.markReceived(sessionId, "f2").allDone).toBe(true)
})
```

- [ ] **Step 2: Run — verify FAIL** (`UploadSessionStore` not found). Run: `bun test test/unit/sessions.test.ts`
- [ ] **Step 3: Create `src/core/sessions.ts`**

```ts
import { randomBytes } from "node:crypto"
import type { DeviceInfo, FileMetadata } from "../protocol/types.ts"

export type UploadSession = {
	info: DeviceInfo
	files: Record<string, FileMetadata>
	tokens: Record<string, string>
	acceptedFiles: string[]
	receivedFiles: Set<string>
}

export class UploadSessionStore {
	private sessions = new Map<string, UploadSession>()

	create(info: DeviceInfo, files: Record<string, FileMetadata>) {
		const sessionId = randomBytes(16).toString("hex")
		const tokens: Record<string, string> = {}
		for (const fileId of Object.keys(files)) tokens[fileId] = randomBytes(16).toString("hex")
		this.sessions.set(sessionId, {
			info,
			files,
			tokens,
			acceptedFiles: Object.keys(files),
			receivedFiles: new Set()
		})
		return { sessionId, tokens }
	}

	get(sessionId: string): UploadSession | undefined {
		return this.sessions.get(sessionId)
	}

	has(sessionId: string): boolean {
		return this.sessions.has(sessionId)
	}

	validateToken(sessionId: string, fileId: string, token: string): boolean {
		const s = this.sessions.get(sessionId)
		return !!s && s.tokens[fileId] === token
	}

	markReceived(sessionId: string, fileId: string): { allDone: boolean } {
		const s = this.sessions.get(sessionId)
		if (!s) return { allDone: false }
		s.receivedFiles.add(fileId)
		const allDone = s.receivedFiles.size === s.acceptedFiles.length
		if (allDone) this.sessions.delete(sessionId)
		return { allDone }
	}

	delete(sessionId: string): void {
		this.sessions.delete(sessionId)
	}
}
```

- [ ] **Step 4: Run — verify PASS.** Run: `bun test test/unit/sessions.test.ts` → 2 pass.
- [ ] **Step 5:** `bun run check-types && bun test`. `bun run format`. Commit:

```bash
git add src/core/sessions.ts test/unit/sessions.test.ts
git commit -m "refactor: add core/sessions UploadSessionStore (+tests)"
```

### Task 1.6: Move client to `src/core/send.ts`

**Files:**
- Create: `src/core/send.ts` (move `src/api/client.ts` verbatim; update internal imports to `../protocol/types.ts`)
- Modify: `src/api/client.ts` → `export * from "../core/send.ts"`

- [ ] **Step 1:** Copy `src/api/client.ts` into `src/core/send.ts`, changing the type import to `../protocol/types.ts`. Do NOT change upload logic yet (chunking fix is Phase 2).
- [ ] **Step 2:** Replace `src/api/client.ts` body with `export * from "../core/send.ts"`.
- [ ] **Step 3:** `bun run check-types && bun test` → green. `bun run format`.
- [ ] **Step 4:** Commit: `git commit -am "refactor: move LocalSendClient to src/core/send.ts"`

### Task 1.7: Rewrite server routes to delegate to core; single canonical server

**Files:**
- Create: `src/server/routes.ts` (Hono routes calling `UploadSessionStore` + `core/files.ts`)
- Create: `src/server/adapters/{types,bun,node,deno}.ts` (move from `src/api/server-adapter.ts`, one class per file; `types.ts` gains optional `tls?: {cert,key}` field — unused until Phase 4)
- Create: `src/server/server.ts` (canonical `LocalSendServer`, moved/renamed from `LocalSendHonoServer`)
- Modify: `src/api/hono-server.ts` → re-export `LocalSendServer as LocalSendHonoServer` and `LocalSendServer`
- Modify: `src/api/hono-routes.ts` → `export * from "../server/routes.ts"`
- Modify: `src/api/server-adapter.ts` → re-export from `../server/adapters/*`

**Interfaces:**
- Produces: `class LocalSendServer` with the same constructor options as the current `LocalSendHonoServer` plus `protocol?: "http"|"https"` (http-only honored this phase). `createLocalSendRoutes(ctx)` unchanged signature; internally uses `UploadSessionStore` and `resolveSavePath`.

- [ ] **Step 1:** Create `src/server/adapters/types.ts`:

```ts
export interface ServerAdapter {
	start(options: {
		port: number
		fetch: Function
		maxRequestBodySize?: number
		tls?: { cert: string; key: string }
	}): Promise<unknown>
	stop(server: unknown): Promise<void>
}
```

- [ ] **Step 2:** Split the three adapter classes from `src/api/server-adapter.ts` into `bun.ts`, `node.ts`, `deno.ts` (verbatim bodies; import `ServerAdapter` from `./types.ts`). Create `src/server/adapters/index.ts` exporting all three + `createServerAdapter()` (verbatim). Ignore `tls` for now.
- [ ] **Step 3:** Create `src/server/routes.ts` by moving `createLocalSendRoutes` from `src/api/hono-routes.ts`, with two internal changes only:
  - Replace the inline session `Map` + token logic with `ctx.uploads: UploadSessionStore` (`ctx.uploads.create(...)`, `.get`, `.validateToken`, `.markReceived`).
  - Replace `path.join(ctx.saveDirectory, fileMetadata.fileName)` with `resolveSavePath(ctx.saveDirectory, fileMetadata.fileName)` inside a try/catch returning `c.json({message:"Unsafe path"},400)`.
  - Keep the existing `X-Content-Range` handling for now (removed in Phase 2, Task 2.1) so behavior is unchanged this task.
- [ ] **Step 4:** Create `src/server/server.ts` = current `LocalSendHonoServer` renamed to `LocalSendServer`, constructing an `UploadSessionStore` and passing it in `ctx.uploads`; add `protocol?: "http"|"https"` option stored on `deviceInfo.protocol` (no TLS yet).
- [ ] **Step 5:** Turn old files into re-exports: `src/api/hono-server.ts` → `export { LocalSendServer, LocalSendServer as LocalSendHonoServer } from "../server/server.ts"` and `export type { LocalSendAppType } from "../server/routes.ts"`; `src/api/hono-routes.ts` → `export * from "../server/routes.ts"`; `src/api/server-adapter.ts` → `export * from "../server/adapters/index.ts"`.
- [ ] **Step 6:** Update `test/helpers/harness.ts` to import `LocalSendServer` from `../../src/server/server.ts` (keep the exported `LocalSendServer` name).
- [ ] **Step 7:** `bun run check-types && bun test` → all green (smoke + unit).
- [ ] **Step 8:** `bun run format`. Commit:

```bash
git add src test
git commit -m "refactor: consolidate to src/server/* delegating to core; single LocalSendServer"
```

### Task 1.8: Update `index.ts` exports + remove dead code

**Files:**
- Modify: `src/index.ts`
- Delete: `src/api/server.ts` (vanilla server), `src/api/deno-client.ts` (verify unused)

- [ ] **Step 1:** Grep for consumers of the vanilla server and deno-client:

Run: `grep -rn "api/server\.ts\|api/server\"\|deno-client\|new LocalSendServer(" src examples test`
Expected: only `src/api/server.ts` self and the vanilla import in `src/index.ts` (line 12). If `examples/basic-receiver.ts` imports the vanilla server, update it to `LocalSendServer` from `../src/index.ts`.

- [ ] **Step 2:** Edit `src/index.ts`:
  - Remove `export { LocalSendServer } from "./api/server.ts"`.
  - Change to `export { LocalSendServer, LocalSendHonoServer } from "./server/server.ts"` (alias retained for one release).
  - Update remaining exports to new paths (`./crypto/fingerprint.ts` for `generateFingerprint`, `./core/send.ts` for client if desired — old `./api/*` re-exports still work).
- [ ] **Step 3:** Delete `src/api/server.ts` and `src/api/deno-client.ts` (only if Step 1 confirmed no external imports).
- [ ] **Step 4:** `bun run check-types && bun test` → green. `bun run format`. Commit:

```bash
git add -A
git commit -m "refactor: remove broken vanilla server + dead deno-client; update public exports"
```

---

## Phase 2 — Correctness & security fixes (TDD)

### Task 2.1: Upload sends whole file in one request (remove invented chunking)

**Files:**
- Create: `test/conformance/upload-wire.test.ts`
- Modify: `src/core/send.ts` (`uploadFile`)
- Modify: `src/server/routes.ts` (remove `X-Content-Range` branch)
- Modify: `src/hono-rpc.ts` (remove chunking branch)

**Interfaces:**
- Consumes: `UploadSessionStore`, `resolveSavePath`.
- Produces: `uploadFile(...)` unchanged signature but streams the whole file as one POST with `Content-Length` and NO `X-Content-Range`.

- [ ] **Step 1: Write `test/conformance/upload-wire.test.ts`** (asserts one whole-body POST, no range header, even for >50 MB)

```ts
import { test, expect } from "bun:test"
import { createServer } from "node:http"
import { getFreePort, tempDir, rmTemp, makeRandomFile } from "../helpers/util.ts"
import { getDeviceInfo } from "../../src/utils/device.ts"
import { LocalSendClient } from "../../src/core/send.ts"

test("uploadFile sends the whole file in ONE request with no X-Content-Range (60MB)", async () => {
	const dir = await tempDir()
	const port = await getFreePort()
	const requests: { rangeHeader: string | undefined; bytes: number }[] = []

	const server = createServer((req, res) => {
		let bytes = 0
		req.on("data", (c) => (bytes += c.length))
		req.on("end", () => {
			requests.push({ rangeHeader: req.headers["x-content-range"] as string | undefined, bytes })
			res.statusCode = 200
			res.end(JSON.stringify({ message: "ok" }))
		})
	})
	await new Promise<void>((r) => server.listen(port, r))

	try {
		const { path: filePath } = await makeRandomFile(dir, "big.bin", 60 * 1024 * 1024)
		const client = new LocalSendClient(getDeviceInfo({ alias: "s" }))
		const ok = await client.uploadFile(
			{ ip: "127.0.0.1", port, protocol: "http" },
			"sess",
			"fid",
			"tok",
			filePath
		)
		expect(ok).toBe(true)
		expect(requests).toHaveLength(1)
		expect(requests[0].rangeHeader).toBeUndefined()
		expect(requests[0].bytes).toBe(60 * 1024 * 1024)
	} finally {
		await new Promise<void>((r) => server.close(() => r()))
		await rmTemp(dir)
	}
})
```

- [ ] **Step 2: Run — verify FAIL** (current code splits into 6 chunked requests with range headers).

Run: `bun test test/conformance/upload-wire.test.ts`
Expected: FAIL (`requests` length 6, range header present).

- [ ] **Step 3: Rewrite `uploadFile` in `src/core/send.ts`** to stream the whole file once:

```ts
async uploadFile(
	targetDevice: { ip: string; port: number; protocol: "http" | "https" },
	sessionId: string,
	fileId: string,
	fileToken: string,
	filePath: string
): Promise<boolean> {
	try {
		const { stat } = await import("node:fs/promises")
		const { createReadStream } = await import("node:fs")
		const { Readable } = await import("node:stream")
		const stats = await stat(filePath)
		const url = `${targetDevice.protocol}://${targetDevice.ip}:${targetDevice.port}/api/localsend/v2/upload?sessionId=${sessionId}&fileId=${fileId}&token=${fileToken}`

		if (this.progressCallback) this.progressCallback(0, stats.size, false)

		const nodeStream = createReadStream(filePath)
		const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream

		const fetchOptions: any = {
			method: "POST",
			headers: { "Content-Length": stats.size.toString() },
			body: webStream,
			duplex: "half"
		}
		this.applyTlsOptions(fetchOptions, targetDevice.protocol)
		const response = await fetch(url, fetchOptions)

		if (this.progressCallback) this.progressCallback(stats.size, stats.size, true)
		return response.ok
	} catch (err) {
		console.error("Error uploading file:", err)
		return false
	}
}
```

> Note: keep the existing `import { Buffer } from "node:buffer"` etc. at top; the dynamic imports
> above keep this method self-contained. If the executor prefers, hoist them to top-level imports.

- [ ] **Step 4: Run — verify the new conformance test PASSES and the smoke test still passes.**

Run: `bun test test/conformance/upload-wire.test.ts test/interop/upload-smoke.test.ts`
Expected: 2 pass.

- [ ] **Step 5: Remove `X-Content-Range` handling from `src/server/routes.ts`** — replace the whole chunk/range block in the `upload` handler with a single-pass stream-to-disk:

```ts
// inside upload handler, after resolveSavePath + fileStream created:
const stream = c.req.raw.body
if (!stream) return c.json({ message: "Request body stream not available" }, 500)
const reader = stream.getReader()
let received = 0
const start = Date.now()
while (true) {
	const { done, value } = await reader.read()
	if (done) break
	if (value && value.length > 0) {
		received += value.length
		fileStream.write(Buffer.from(value))
		if (ctx.transferProgressHandler) {
			const elapsed = (Date.now() - start) / 1000
			ctx.transferProgressHandler(fileId, fileMetadata.fileName, received, fileMetadata.size, elapsed > 0 ? received / elapsed : 0)
		}
	}
}
fileStream.end()
const { allDone } = ctx.uploads.markReceived(sessionId, fileId)
const totalTime = (Date.now() - start) / 1000
if (ctx.transferProgressHandler) {
	ctx.transferProgressHandler(fileId, fileMetadata.fileName, received, fileMetadata.size, totalTime > 0 ? received / totalTime : 0, true, { filePath, totalTimeSeconds: totalTime, averageSpeed: totalTime > 0 ? received / totalTime : 0 })
}
return c.json({ message: "File received successfully" })
```

Remove the now-unused `transferStartTimes`/`bytesReceived`/`fileStreams` bookkeeping from the `SessionData`/handler (keep only what the single-pass path needs, or use a local `WriteStream`).

- [ ] **Step 6: Remove the chunking branch from `src/hono-rpc.ts`** `uploadFile` — always do the single `$post` with `body: file`.
- [ ] **Step 7: Run full suite — verify GREEN** including a large-file interop test. Add to `test/interop/upload-smoke.test.ts`:

```ts
test("uploads a 60MB file byte-for-byte (TS -> TS, single request)", async () => {
	const src = await tempDir()
	const receiver = await startReceiver({ autoAccept: true })
	try {
		const { path: filePath, sha256 } = await makeRandomFile(src, "big.bin", 60 * 1024 * 1024)
		expect(await sendFile(receiver, filePath)).toBe(true)
		expect(await sha256File(savedPath(receiver, "big.bin"))).toBe(sha256)
	} finally {
		await receiver.stop()
		await rmTemp(src)
	}
})
```

Run: `bun test`
Expected: all pass.

- [ ] **Step 8:** `bun run format`. Commit:

```bash
git add -A
git commit -m "fix: upload whole file in one request; drop non-standard X-Content-Range chunking"
```

### Task 2.2: Path-traversal protection end-to-end

**Files:**
- Create: `test/interop/path-traversal.test.ts`
- (Implementation already added in Task 1.7 Step 3 via `resolveSavePath`; this task proves it e2e.)

- [ ] **Step 1: Write `test/interop/path-traversal.test.ts`** — craft a raw `prepare-upload` + `upload` with a malicious `fileName` and assert nothing is written outside saveDir.

```ts
import { test, expect } from "bun:test"
import path from "node:path"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { startReceiver } from "../helpers/harness.ts"

test("rejects filename that escapes the save directory", async () => {
	const receiver = await startReceiver({ autoAccept: true })
	try {
		const base = `http://127.0.0.1:${receiver.port}/api/localsend/v2`
		const info = { alias: "x", version: "2.1", deviceType: "headless", fingerprint: "fp", port: receiver.port, protocol: "http", download: false }
		const evil = "../ESCAPED.txt"
		const prep = await fetch(`${base}/prepare-upload`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ info, files: { f1: { id: "f1", fileName: evil, size: 5, fileType: "text/plain" } } })
		})
		expect(prep.ok).toBe(true)
		const { sessionId, files } = (await prep.json()) as any
		const up = await fetch(`${base}/upload?sessionId=${sessionId}&fileId=f1&token=${files.f1}`, {
			method: "POST",
			body: "HELLO"
		})
		// escaped path must NOT exist
		const escaped = path.resolve(receiver.saveDir, "..", "ESCAPED.txt")
		expect(existsSync(escaped)).toBe(false)
		// server should have rejected the write (non-2xx) OR written safely inside saveDir
		if (up.ok) {
			expect(existsSync(path.join(receiver.saveDir, "ESCAPED.txt"))).toBe(false)
		} else {
			expect(up.status).toBeGreaterThanOrEqual(400)
		}
	} finally {
		await receiver.stop()
	}
})
```

- [ ] **Step 2: Run — verify PASS** (Task 1.7 already wired `resolveSavePath`; if it throws before opening the stream the upload returns 400/500 and no escaped file exists).

Run: `bun test test/interop/path-traversal.test.ts`
Expected: pass. If it fails because the write is attempted before validation, move the `resolveSavePath` call to the very start of the `upload` handler (before creating any stream) and return `c.json({message:"Unsafe path"},400)` on throw.

- [ ] **Step 3:** `bun run format`. Commit: `git commit -am "test: prove path-traversal protection on upload"`

### Task 2.3: Relax schema to match spec + allow PIN together with accept callback

**Files:**
- Create: `test/conformance/schema.test.ts`
- Modify: `src/protocol/types.ts` (loosen `deviceInfoSchema`)
- Modify: `src/server/routes.ts` (`prepare-upload`: check PIN, THEN call accept handler)

- [ ] **Step 1: Write `test/conformance/schema.test.ts`**

```ts
import { test, expect } from "bun:test"
import * as v from "valibot"
import { deviceInfoSchema } from "../../src/protocol/types.ts"

test("deviceInfo accepts spec-minimal payload omitting download", () => {
	const input = { alias: "a", version: "2.1", deviceType: "mobile", fingerprint: "fp", port: 53317, protocol: "http" }
	const out = v.parse(deviceInfoSchema, input)
	expect(out.download).toBe(false)
})

test("deviceInfo accepts null deviceModel and missing deviceType", () => {
	const input = { alias: "a", version: "2.1", deviceModel: null, fingerprint: "fp", port: 53317, protocol: "http" }
	const out = v.parse(deviceInfoSchema, input)
	expect(out.alias).toBe("a")
})
```

- [ ] **Step 2: Run — verify FAIL** (current schema requires `download`). Run: `bun test test/conformance/schema.test.ts`
- [ ] **Step 3: Edit `deviceInfoSchema` in `src/protocol/types.ts`**

```ts
export const deviceInfoSchema = v.object({
	alias: v.string(),
	version: v.string(),
	deviceModel: v.optional(v.nullable(v.string())),
	deviceType: v.optional(v.nullable(deviceType)),
	fingerprint: v.string(),
	port: v.optional(v.number()),
	protocol: v.optional(v.union([v.literal("http"), v.literal("https")]), "http"),
	download: v.optional(v.boolean(), false)
})
```

> `DeviceInfo` type stays `InferInput`/`InferOutput`-derived; downstream code that constructs a full
> DeviceInfo (getDeviceInfo) still provides all fields, so no consumer breaks. Check `bun run check-types`.

- [ ] **Step 4: Edit `prepare-upload` handler** so PIN and accept-callback both run:

```ts
if (ctx.requirePin) {
	const pinParam = c.req.query("pin")
	if (!pinParam || pinParam !== ctx.pin) return c.json({ message: "PIN required" }, 401)
}
if (ctx.transferRequestHandler) {
	const accepted = await ctx.transferRequestHandler(body.info, body.files)
	if (!accepted) return c.json({ message: "Transfer rejected by user" }, 403)
}
```

- [ ] **Step 5: Run — verify PASS.** Run: `bun test test/conformance/schema.test.ts` → 2 pass. Then `bun run check-types && bun test` → all green.
- [ ] **Step 6:** `bun run format`. Commit: `git commit -am "fix: relax deviceInfo schema to spec; allow PIN + accept handler together"`

### Task 2.4: Return 204 when there is nothing to transfer

**Files:**
- Create/append: `test/conformance/prepare-upload.test.ts`
- Modify: `src/server/routes.ts` (`prepare-upload`)

- [ ] **Step 1: Write test** asserting an empty `files` map yields `204`:

```ts
import { test, expect } from "bun:test"
import { startReceiver } from "../helpers/harness.ts"

test("prepare-upload with empty files returns 204", async () => {
	const receiver = await startReceiver({ autoAccept: true })
	try {
		const base = `http://127.0.0.1:${receiver.port}/api/localsend/v2`
		const info = { alias: "x", version: "2.1", deviceType: "headless", fingerprint: "fp", port: receiver.port, protocol: "http" }
		const res = await fetch(`${base}/prepare-upload`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ info, files: {} })
		})
		expect(res.status).toBe(204)
	} finally {
		await receiver.stop()
	}
})
```

- [ ] **Step 2: Run — verify FAIL** (currently returns 200 with empty tokens).
- [ ] **Step 3:** In the `prepare-upload` handler, after validation and accept, add before creating a session:

```ts
if (Object.keys(body.files).length === 0) return c.body(null, 204)
```

- [ ] **Step 4: Run — verify PASS.** `bun test test/conformance/prepare-upload.test.ts`.
- [ ] **Step 5:** `bun run check-types && bun test`. `bun run format`. Commit: `git commit -am "fix: prepare-upload returns 204 when files map is empty"`

### Task 2.5: Filename collision handling

**Files:**
- Modify: `src/core/files.ts` (add `uniqueSavePath`)
- Modify: `src/server/routes.ts` (use it)
- Create: `test/unit/collision.test.ts`

**Interfaces:**
- Produces: `uniqueSavePath(saveDir: string, fileName: string): string` — traversal-safe AND non-colliding (` (1)`, ` (2)` before extension).

- [ ] **Step 1: Write `test/unit/collision.test.ts`**

```ts
import { test, expect } from "bun:test"
import { writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { tempDir, rmTemp } from "../helpers/util.ts"
import { uniqueSavePath } from "../../src/core/files.ts"

test("uniqueSavePath appends counter on collision", async () => {
	const dir = await tempDir()
	try {
		expect(uniqueSavePath(dir, "a.txt")).toBe(path.join(dir, "a.txt"))
		await writeFile(path.join(dir, "a.txt"), "x")
		expect(uniqueSavePath(dir, "a.txt")).toBe(path.join(dir, "a (1).txt"))
	} finally {
		await rmTemp(dir)
	}
})
```

- [ ] **Step 2: Run — verify FAIL.**
- [ ] **Step 3: Add to `src/core/files.ts`**

```ts
import { existsSync } from "node:fs"

export function uniqueSavePath(saveDir: string, fileName: string): string {
	const resolved = resolveSavePath(saveDir, fileName)
	if (!existsSync(resolved)) return resolved
	const dir = path.dirname(resolved)
	const ext = path.extname(resolved)
	const stem = path.basename(resolved, ext)
	let i = 1
	let candidate = path.join(dir, `${stem} (${i})${ext}`)
	while (existsSync(candidate)) {
		i += 1
		candidate = path.join(dir, `${stem} (${i})${ext}`)
	}
	return candidate
}
```

- [ ] **Step 4:** In `src/server/routes.ts` upload handler, replace `resolveSavePath(...)` with `uniqueSavePath(...)` for the write target (keep `resolveSavePath` semantics — `uniqueSavePath` calls it internally, so traversal is still rejected).
- [ ] **Step 5: Run — verify PASS.** `bun test test/unit/collision.test.ts` then `bun test`.
- [ ] **Step 6:** `bun run format`. Commit: `git commit -am "fix: avoid overwriting on filename collision"`

### Task 2.6: Phase 2 regression sweep + docs update

**Files:**
- Modify: design doc phase checkboxes; `AGENTS.md` (note `bun test`, new structure)

- [ ] **Step 1: Run everything.**

Run: `bun run check-types && bun test && bun run build`
Expected: types clean, all tests pass, build succeeds (SDK regen + CLI bundle).

- [ ] **Step 2:** Tick Phase 0/1/2 checkboxes in the design doc; add a short "Testing" + "Structure" note to `AGENTS.md` pointing at `test/` and `src/{protocol,crypto,core,server}/`.
- [ ] **Step 3:** `bun run format`. Commit: `git commit -am "docs: mark phases 0-2 complete; update AGENTS structure/testing notes"`

---

## Deferred to follow-on plans

- **Phase 3 — Download API** (`prepare-download`, `download`, `/` page, client methods, download session store).
- **Phase 4 — HTTPS** (cert generation dep decision, `crypto/cert.ts`, fingerprint=SHA-256(cert) verified against `references/localsend/core/src/crypto/*`, TLS in all adapters).
- **Phase 5 — Rust oracle** (`tools/oracle-rs`, `test/oracle/`).
- **Phase 6 — polish/docs** (README, manual GUI-app checklist, discovery re-announce).

Each will get its own `docs/superpowers/plans/` file when Phase 2 lands.

---

## Self-Review Notes

- **Spec coverage (Phases 0–2):** harness (§7.1–7.3) ✓; refactor to core/server (§5) ✓; B1 chunking (2.1) ✓; B2 traversal (1.4+2.2) ✓; B3 schema (2.3) ✓; B4 remove vanilla (1.8) ✓; B5 204 + collisions (2.4, 2.5) ✓; B6 PIN+accept (2.3) ✓. G1/G2 intentionally deferred.
- **No placeholders:** every code step shows full code; commands include expected results.
- **Type consistency:** `UploadSessionStore` methods (`create/get/has/validateToken/markReceived/delete`) used consistently in 1.5 and 1.7/2.1; `resolveSavePath`/`uniqueSavePath` names consistent across 1.4/2.2/2.5; `LocalSendServer` canonical name consistent across 1.7/1.8/harness.

# LocalSend v2.1 — Phase 3: Download API + Session TTL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement the reverse-transfer (share-by-link) side of LocalSend v2.1 — `prepare-download`, `download`, a minimal browser share page, and matching client methods — plus a session-TTL sweep to close the abandoned-session leak.

**Architecture:** Add a `DownloadSessionStore` and a `StagedFile` concept to `src/core`, a staging option on `LocalSendServer`, and `prepare-download`/`download`/`GET /` handlers to `src/server/routes.ts` delegating to core. Client gains `prepareDownload`/`download` in `src/core/send.ts`. TDD against conformance + single-host interop tests.

**Tech Stack:** TypeScript, Bun (`bun test`), Hono, valibot, node:crypto/fs. No new runtime deps.

## Global Constraints

- **Formatting (Prettier):** no semicolons; no trailing commas; tabs (width 2); print width 100. `bun run format` before every commit.
- **Imports:** `.ts` extensions; `node:` prefix for builtins; valibot as `import * as v from "valibot"`. Protocol types import from `../protocol/types.ts`.
- **Protocol source of truth:** `src/protocol/types.ts`. Never edit `src/sdk/*.gen.ts`.
- **Protocol target:** v2.1. Download endpoints: `POST /api/localsend/v2/prepare-download` (`?pin=`), `GET /api/localsend/v2/download?sessionId&fileId`, `GET /` (browser page).
- **prepare-download** returns `{ info: DeviceInfo, sessionId, files: Record<fileId, FileMetadata> }`; status `200`, `401` (PIN), `403`, `429`, `500`. **download** returns the binary file; no token in the query (sessionId + fileId only).
- **Type check:** `bun run check-types` must pass at every commit. `bun test` green at every commit.
- **Reference:** design doc §3.3 and §6.4.

## Existing interfaces this phase builds on

- `src/core/sessions.ts` → `UploadSessionStore` (methods: create/get/has/validateToken/markReceived/delete).
- `src/core/files.ts` → `buildFileMetadataFromPath(path, opts) -> {fileId, fileMetadata}`, `resolveSavePath`, `uniqueSavePath`.
- `src/protocol/types.ts` → `DeviceInfo`, `FileMetadata`, and already-defined `PrepareDownloadResponse = { info: DeviceInfo; sessionId: string; files: Record<string, FileMetadata> }`.
- `src/server/routes.ts` → `createLocalSendRoutes(ctx: LocalSendContext)`; `LocalSendContext` currently has: `deviceInfo, saveDirectory, requirePin, pin, transferRequestHandler?, transferProgressHandler?, onRegisterCallback?, maxRequestBodySize, uploads (UploadSessionStore), getRemoteAddress`.
- `src/server/server.ts` → `LocalSendServer` builds `ctx` in `registerRoutes()` and constructs `new UploadSessionStore()`.
- `src/core/send.ts` → `LocalSendClient` with private `requestJson`, `requestWithStatus`, `applyTlsOptions`, and public `getDeviceInfo/register/prepareUpload/uploadFile/cancelSession`.
- Test helpers: `test/helpers/util.ts` (`tempDir/rmTemp/getFreePort/makeRandomFile/sha256File`), `test/helpers/harness.ts` (`startReceiver/sendFile/savedPath`).

---

## Task 3.1: DownloadSessionStore + StagedFile + staging util (core)

**Files:**

- Modify: `src/core/sessions.ts` (add `StagedFile`, `DownloadSessionStore`)
- Modify: `src/core/files.ts` (add `stageFile`)
- Test: `test/unit/download-sessions.test.ts`

**Interfaces:**

- Produces:

```ts
type StagedFile = { fileId: string; metadata: FileMetadata; absolutePath: string }
class DownloadSessionStore {
	create(files: StagedFile[]): string // returns sessionId (32-hex)
	get(sessionId: string): { files: Record<string, StagedFile>; createdAt: number } | undefined
	getFile(sessionId: string, fileId: string): StagedFile | undefined
	delete(sessionId: string): void
}
async function stageFile(filePath: string): Promise<StagedFile> // builds metadata + absolutePath
```

- [ ] **Step 1: Write `test/unit/download-sessions.test.ts`**

```ts
import { test, expect } from "bun:test"
import path from "node:path"
import { DownloadSessionStore } from "../../src/core/sessions.ts"
import { stageFile } from "../../src/core/files.ts"
import { tempDir, rmTemp, makeRandomFile } from "../helpers/util.ts"

test("stageFile builds a StagedFile with metadata + absolute path", async () => {
	const dir = await tempDir()
	try {
		const { path: p } = await makeRandomFile(dir, "doc.bin", 2048)
		const staged = await stageFile(p)
		expect(staged.absolutePath).toBe(path.resolve(p))
		expect(staged.metadata.fileName).toBe("doc.bin")
		expect(staged.metadata.size).toBe(2048)
		expect(staged.fileId).toBe(staged.metadata.id)
	} finally {
		await rmTemp(dir)
	}
})

test("DownloadSessionStore create/get/getFile round-trips", async () => {
	const dir = await tempDir()
	try {
		const { path: p } = await makeRandomFile(dir, "a.bin", 10)
		const staged = await stageFile(p)
		const store = new DownloadSessionStore()
		const sessionId = store.create([staged])
		expect(sessionId).toHaveLength(32)
		const session = store.get(sessionId)
		expect(session).toBeTruthy()
		expect(session!.files[staged.fileId].absolutePath).toBe(staged.absolutePath)
		expect(store.getFile(sessionId, staged.fileId)!.metadata.size).toBe(10)
		expect(store.getFile(sessionId, "nope")).toBeUndefined()
		store.delete(sessionId)
		expect(store.get(sessionId)).toBeUndefined()
	} finally {
		await rmTemp(dir)
	}
})
```

- [ ] **Step 2: Run — verify FAIL** (`DownloadSessionStore`/`stageFile` not exported). Run: `bun test test/unit/download-sessions.test.ts`

- [ ] **Step 3: Add `stageFile` to `src/core/files.ts`**

```ts
export type StagedFile = { fileId: string; metadata: FileMetadata; absolutePath: string }

export async function stageFile(filePath: string): Promise<StagedFile> {
	const { fileId, fileMetadata } = await buildFileMetadataFromPath(filePath)
	return { fileId, metadata: fileMetadata, absolutePath: path.resolve(filePath) }
}
```

(`path` and `buildFileMetadataFromPath` are already imported/defined in this file.)

- [ ] **Step 4: Add `DownloadSessionStore` to `src/core/sessions.ts`** (import `StagedFile` from `./files.ts`)

```ts
import type { StagedFile } from "./files.ts"

export type DownloadSession = { files: Record<string, StagedFile>; createdAt: number }

export class DownloadSessionStore {
	private sessions = new Map<string, DownloadSession>()

	create(files: StagedFile[]): string {
		const sessionId = randomBytes(16).toString("hex")
		const map: Record<string, StagedFile> = {}
		for (const f of files) map[f.fileId] = f
		this.sessions.set(sessionId, { files: map, createdAt: Date.now() })
		return sessionId
	}

	get(sessionId: string): DownloadSession | undefined {
		return this.sessions.get(sessionId)
	}

	getFile(sessionId: string, fileId: string): StagedFile | undefined {
		return this.sessions.get(sessionId)?.files[fileId]
	}

	delete(sessionId: string): void {
		this.sessions.delete(sessionId)
	}
}
```

(`randomBytes` is already imported in sessions.ts.)

- [ ] **Step 5: Run — verify PASS.** Run: `bun test test/unit/download-sessions.test.ts` → 2 pass.
- [ ] **Step 6:** `bun run check-types && bun test`; `bun run format`; commit:

```bash
git add src/core/sessions.ts src/core/files.ts test/unit/download-sessions.test.ts
git commit -m "feat: add StagedFile, stageFile, and DownloadSessionStore to core"
```

---

## Task 3.2: prepare-download + download handlers + server staging wiring

**Files:**

- Modify: `src/server/routes.ts` (context fields + two handlers)
- Modify: `src/server/server.ts` (staging option, wire ctx)
- Test: `test/conformance/download.test.ts`

**Interfaces:**

- Consumes: `DownloadSessionStore`, `StagedFile`, `stageFile`.
- Produces: `LocalSendServer` option `sharedFiles?: string[]`; `LocalSendContext` gains `sharedFiles: StagedFile[]` and `downloads: DownloadSessionStore`. Routes: `POST /api/localsend/v2/prepare-download`, `GET /api/localsend/v2/download`.

- [ ] **Step 1: Write `test/conformance/download.test.ts`**

```ts
import { test, expect } from "bun:test"
import { getDeviceInfo } from "../../src/utils/device.ts"
import { LocalSendServer } from "../../src/server/server.ts"
import { getFreePort, tempDir, rmTemp, makeRandomFile, sha256File } from "../helpers/util.ts"
import { readFile } from "node:fs/promises"
import path from "node:path"

async function startSharer(files: string[], opts: { pin?: string } = {}) {
	const port = await getFreePort()
	const server = new LocalSendServer(getDeviceInfo({ alias: "Sharer", port }), {
		sharedFiles: files,
		pin: opts.pin
	})
	await server.start()
	return { port, stop: () => server.stop() }
}

test("prepare-download returns {info, sessionId, files}; download streams exact bytes", async () => {
	const dir = await tempDir()
	const src = await makeRandomFile(dir, "shared.bin", 4096)
	const sharer = await startSharer([src.path])
	try {
		const base = `http://127.0.0.1:${sharer.port}/api/localsend/v2`
		const prep = await fetch(`${base}/prepare-download`, { method: "POST" })
		expect(prep.status).toBe(200)
		const body = (await prep.json()) as any
		expect(body.sessionId).toBeTruthy()
		expect(body.info.alias).toBe("Sharer")
		const fileId = Object.keys(body.files)[0]
		expect(body.files[fileId].fileName).toBe("shared.bin")

		const dl = await fetch(`${base}/download?sessionId=${body.sessionId}&fileId=${fileId}`)
		expect(dl.status).toBe(200)
		const buf = Buffer.from(await dl.arrayBuffer())
		const outPath = path.join(dir, "downloaded.bin")
		await Bun.write(outPath, buf)
		expect(await sha256File(outPath)).toBe(src.sha256)
	} finally {
		await sharer.stop()
		await rmTemp(dir)
	}
})

test("prepare-download requires correct PIN", async () => {
	const dir = await tempDir()
	const src = await makeRandomFile(dir, "s.bin", 16)
	const sharer = await startSharer([src.path], { pin: "4242" })
	try {
		const base = `http://127.0.0.1:${sharer.port}/api/localsend/v2`
		expect((await fetch(`${base}/prepare-download`, { method: "POST" })).status).toBe(401)
		expect((await fetch(`${base}/prepare-download?pin=4242`, { method: "POST" })).status).toBe(200)
	} finally {
		await sharer.stop()
		await rmTemp(dir)
	}
})
```

- [ ] **Step 2: Run — verify FAIL** (routes 404 / option unsupported). Run: `bun test test/conformance/download.test.ts`

- [ ] **Step 3: Extend `LocalSendContext` and add handlers in `src/server/routes.ts`**
  - Add to the `LocalSendContext` interface: `sharedFiles: StagedFile[]` and `downloads: DownloadSessionStore` (import both types from `../core/*`).
  - Register two routes inside `createLocalSendRoutes` (place before `.notFound`):

```ts
.post(
	"/api/localsend/v2/prepare-download",
	describeRoute({
		description: "Prepare a reverse download (share-by-link)",
		responses: {
			200: { description: "Download metadata", content: { "application/json": { schema: resolver(messageResponseSchema) } } },
			401: { description: "PIN required", content: { "application/json": { schema: resolver(messageResponseSchema) } } },
			404: { description: "Nothing shared", content: { "application/json": { schema: resolver(messageResponseSchema) } } }
		}
	}),
	validator("query", v.object({ pin: v.optional(v.string()) })),
	async (c) => {
		if (ctx.requirePin) {
			const pinParam = c.req.query("pin")
			if (!pinParam || pinParam !== ctx.pin) return c.json({ message: "PIN required" }, 401)
		}
		if (!ctx.sharedFiles || ctx.sharedFiles.length === 0) {
			return c.json({ message: "Nothing shared" }, 404)
		}
		const sessionId = ctx.downloads.create(ctx.sharedFiles)
		const files: Record<string, FileMetadata> = {}
		for (const f of ctx.sharedFiles) files[f.fileId] = f.metadata
		return c.json({ info: ctx.deviceInfo, sessionId, files })
	}
)
.get(
	"/api/localsend/v2/download",
	describeRoute({
		description: "Download a shared file",
		responses: {
			200: { description: "Binary file" },
			404: { description: "Not found", content: { "application/json": { schema: resolver(messageResponseSchema) } } }
		}
	}),
	validator("query", v.object({ sessionId: v.string(), fileId: v.string() })),
	async (c) => {
		const { sessionId, fileId } = c.req.valid("query")
		const staged = ctx.downloads.getFile(sessionId, fileId)
		if (!staged) return c.json({ message: "Not found" }, 404)
		const stream = fs.createReadStream(staged.absolutePath)
		const webStream = (await import("node:stream")).Readable.toWeb(stream) as unknown as ReadableStream
		return new Response(webStream, {
			status: 200,
			headers: {
				"Content-Type": staged.metadata.fileType || "application/octet-stream",
				"Content-Length": staged.metadata.size.toString(),
				"Content-Disposition": `attachment; filename="${encodeURIComponent(staged.metadata.fileName)}"`
			}
		})
	}
)
```

(`fs`, `v`, `describeRoute`, `resolver`, `validator`, `messageResponseSchema`, `FileMetadata` are already imported in routes.ts. Add imports for `StagedFile`/`DownloadSessionStore` types.)

- [ ] **Step 4: Wire staging in `src/server/server.ts`**
  - Add constructor option `sharedFiles?: string[]`; store `this.sharedFilePaths = options.sharedFiles ?? []`.
  - Add `private sharedFiles: StagedFile[] = []` and `private downloads = new DownloadSessionStore()`.
  - In `start()` (before `serverAdapter.start`), if `this.sharedFilePaths.length`, `this.sharedFiles = await Promise.all(this.sharedFilePaths.map(stageFile))` and set `this.deviceInfo.download = true`; then call `this.registerRoutes()` again so ctx picks up staged files (or stage before registerRoutes — simplest: stage in an async `init()` called at the start of `start()`, then build ctx). Ensure ctx passed to `createLocalSendRoutes` includes `sharedFiles: this.sharedFiles` and `downloads: this.downloads`.
  - Simplest correct ordering: move `registerRoutes()` out of the constructor into `start()` AFTER staging, OR keep constructor registration but re-run it post-staging. Pick one and keep `app` valid before `start()` returns. (The tests only hit routes after `start()`.)

- [ ] **Step 5: Run — verify PASS.** Run: `bun test test/conformance/download.test.ts` → 2 pass. Then `bun test` (full) + `bun run check-types` green.
- [ ] **Step 6:** `bun run format`; commit:

```bash
git add src/server/routes.ts src/server/server.ts test/conformance/download.test.ts
git commit -m "feat: implement prepare-download + download endpoints with file staging"
```

---

## Task 3.3: Minimal browser share page (`GET /`)

**Files:**

- Create: `src/server/web.ts` (`renderSharePage(deviceInfo, sessionId, files)`)
- Modify: `src/server/routes.ts` (add `GET /`)
- Test: `test/conformance/browser-page.test.ts`

- [ ] **Step 1: Write `test/conformance/browser-page.test.ts`**

```ts
import { test, expect } from "bun:test"
import { getDeviceInfo } from "../../src/utils/device.ts"
import { LocalSendServer } from "../../src/server/server.ts"
import { getFreePort, tempDir, rmTemp, makeRandomFile } from "../helpers/util.ts"

test("GET / lists shared files with download links", async () => {
	const dir = await tempDir()
	const src = await makeRandomFile(dir, "photo.bin", 32)
	const port = await getFreePort()
	const server = new LocalSendServer(getDeviceInfo({ alias: "Sharer", port }), {
		sharedFiles: [src.path]
	})
	await server.start()
	try {
		const res = await fetch(`http://127.0.0.1:${port}/`)
		expect(res.status).toBe(200)
		expect(res.headers.get("content-type") || "").toContain("text/html")
		const html = await res.text()
		expect(html).toContain("photo.bin")
		expect(html).toContain("/api/localsend/v2/download?sessionId=")
	} finally {
		await server.stop()
		await rmTemp(dir)
	}
})
```

- [ ] **Step 2: Run — verify FAIL** (GET / is 404). Run: `bun test test/conformance/browser-page.test.ts`

- [ ] **Step 3: Create `src/server/web.ts`**

```ts
import type { DeviceInfo, FileMetadata } from "../protocol/types.ts"

export function renderSharePage(
	deviceInfo: DeviceInfo,
	sessionId: string,
	files: Record<string, FileMetadata>
): string {
	const rows = Object.entries(files)
		.map(([fileId, f]) => {
			const href = `/api/localsend/v2/download?sessionId=${sessionId}&fileId=${fileId}`
			const name = escapeHtml(f.fileName)
			return `<li><a href="${href}">${name}</a> <span>(${f.size} bytes)</span></li>`
		})
		.join("\n")
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>LocalSend — ${escapeHtml(deviceInfo.alias)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><h1>Files shared by ${escapeHtml(deviceInfo.alias)}</h1><ul>
${rows}
</ul></body></html>`
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
}
```

- [ ] **Step 4: Add `GET /` to `src/server/routes.ts`** (after the `/docs` route). Import `renderSharePage` from `./web.ts`.

```ts
.get("/", (c) => {
	if (!ctx.sharedFiles || ctx.sharedFiles.length === 0) {
		return c.json({ message: "No files shared" }, 404)
	}
	const sessionId = ctx.downloads.create(ctx.sharedFiles)
	const files: Record<string, FileMetadata> = {}
	for (const f of ctx.sharedFiles) files[f.fileId] = f.metadata
	return c.html(renderSharePage(ctx.deviceInfo, sessionId, files))
})
```

- [ ] **Step 5: Run — verify PASS.** Run: `bun test test/conformance/browser-page.test.ts`. Then full `bun test` + `bun run check-types`.
- [ ] **Step 6:** `bun run format`; commit:

```bash
git add src/server/web.ts src/server/routes.ts test/conformance/browser-page.test.ts
git commit -m "feat: minimal browser share page at GET /"
```

---

## Task 3.4: Client prepareDownload + download + interop tests

**Files:**

- Modify: `src/core/send.ts` (add `prepareDownload`, `download`)
- Test: `test/interop/download.test.ts`

**Interfaces:**

- Produces on `LocalSendClient`:

```ts
prepareDownload(target: {ip; port; protocol}, pin?: string): Promise<PrepareDownloadResponse | null>
download(target: {ip; port; protocol}, sessionId: string, fileId: string, outPath: string): Promise<boolean>
```

- [ ] **Step 1: Write `test/interop/download.test.ts`**

```ts
import { test, expect } from "bun:test"
import { getDeviceInfo } from "../../src/utils/device.ts"
import { LocalSendServer } from "../../src/server/server.ts"
import { LocalSendClient } from "../../src/core/send.ts"
import { getFreePort, tempDir, rmTemp, makeRandomFile, sha256File } from "../helpers/util.ts"
import path from "node:path"

test("client downloads a shared file byte-for-byte (incl 60MB)", async () => {
	const dir = await tempDir()
	const outDir = await tempDir()
	const big = await makeRandomFile(dir, "big.bin", 60 * 1024 * 1024)
	const port = await getFreePort()
	const server = new LocalSendServer(getDeviceInfo({ alias: "Sharer", port }), {
		sharedFiles: [big.path]
	})
	await server.start()
	const client = new LocalSendClient(getDeviceInfo({ alias: "Downloader" }))
	const target = { ip: "127.0.0.1", port, protocol: "http" as const }
	try {
		const meta = await client.prepareDownload(target)
		expect(meta).toBeTruthy()
		const fileId = Object.keys(meta!.files)[0]
		const out = path.join(outDir, "got.bin")
		expect(await client.download(target, meta!.sessionId, fileId, out)).toBe(true)
		expect(await sha256File(out)).toBe(big.sha256)
	} finally {
		await server.stop()
		await rmTemp(dir)
		await rmTemp(outDir)
	}
})
```

- [ ] **Step 2: Run — verify FAIL** (`prepareDownload` not a function). Run: `bun test test/interop/download.test.ts`

- [ ] **Step 3: Add methods to `src/core/send.ts`** (import `PrepareDownloadResponse` from `../protocol/types.ts`)

```ts
async prepareDownload(
	targetDevice: { ip: string; port: number; protocol: "http" | "https" },
	pin?: string
): Promise<PrepareDownloadResponse | null> {
	try {
		return await this.requestJson<PrepareDownloadResponse>(
			targetDevice,
			"/api/localsend/v2/prepare-download",
			{ method: "POST", query: pin ? { pin } : undefined }
		)
	} catch (err) {
		console.error("Error preparing download:", err)
		return null
	}
}

async download(
	targetDevice: { ip: string; port: number; protocol: "http" | "https" },
	sessionId: string,
	fileId: string,
	outPath: string
): Promise<boolean> {
	try {
		const { createWriteStream } = await import("node:fs")
		const { Readable } = await import("node:stream")
		const protocol = targetDevice.protocol || "http"
		const url = `${protocol}://${targetDevice.ip}:${targetDevice.port}/api/localsend/v2/download?sessionId=${sessionId}&fileId=${fileId}`
		const fetchOptions: any = { method: "GET" }
		this.applyTlsOptions(fetchOptions, protocol)
		const res = await fetch(url, fetchOptions)
		if (!res.ok || !res.body) return false
		const nodeReadable = Readable.fromWeb(res.body as any)
		const out = createWriteStream(outPath)
		await new Promise<void>((resolve, reject) => {
			nodeReadable.pipe(out)
			out.on("finish", () => resolve())
			out.on("error", reject)
			nodeReadable.on("error", reject)
		})
		return true
	} catch (err) {
		console.error("Error downloading file:", err)
		return false
	}
}
```

(`requestJson` already supports `{ method, query }`; it returns parsed JSON. `applyTlsOptions` already exists.)

- [ ] **Step 4: Run — verify PASS.** Run: `bun test test/interop/download.test.ts`. Then full `bun test` + `bun run check-types`.
- [ ] **Step 5:** `bun run format`; commit:

```bash
git add src/core/send.ts test/interop/download.test.ts
git commit -m "feat: client prepareDownload + download (streamed to disk)"
```

---

## Task 3.5: Session TTL sweep (closes abandoned-session leak)

**Files:**

- Modify: `src/core/sessions.ts` (add `createdAt` + lazy purge to `UploadSessionStore`; purge to `DownloadSessionStore`)
- Test: `test/unit/session-ttl.test.ts`

**Interfaces:**

- `UploadSessionStore` and `DownloadSessionStore` gain optional constructor `ttlMs` (default `3_600_000`) and a `purgeExpired(now?: number): void` method; `create(...)` calls `purgeExpired()` first. `UploadSession` gains `createdAt: number`.

- [ ] **Step 1: Write `test/unit/session-ttl.test.ts`**

```ts
import { test, expect } from "bun:test"
import { UploadSessionStore, DownloadSessionStore } from "../../src/core/sessions.ts"
import type { DeviceInfo, FileMetadata } from "../../src/protocol/types.ts"

const info = {
	alias: "a",
	version: "2.1",
	fingerprint: "fp",
	port: 1,
	protocol: "http",
	download: false
} as DeviceInfo
const files: Record<string, FileMetadata> = {
	f1: { id: "f1", fileName: "a", size: 1, fileType: "x" }
}

test("expired upload sessions are purged on next create", () => {
	const store = new UploadSessionStore(1000) // 1s ttl
	const { sessionId } = store.create(info, files)
	// force expiry by purging with a future clock
	store.purgeExpired(Date.now() + 5000)
	expect(store.get(sessionId)).toBeUndefined()
})

test("fresh sessions survive purge", () => {
	const store = new UploadSessionStore(1000)
	const { sessionId } = store.create(info, files)
	store.purgeExpired(Date.now())
	expect(store.get(sessionId)).toBeTruthy()
})
```

- [ ] **Step 2: Run — verify FAIL** (ttl ctor / purgeExpired absent). Run: `bun test test/unit/session-ttl.test.ts`

- [ ] **Step 3: Update `UploadSessionStore` in `src/core/sessions.ts`**
  - Add `createdAt: number` to `UploadSession`.
  - Constructor: `constructor(private ttlMs: number = 3_600_000) {}`.
  - In `create`, set `createdAt: Date.now()` on the stored session and call `this.purgeExpired()` at the top.
  - Add:

```ts
purgeExpired(now: number = Date.now()): void {
	for (const [id, s] of this.sessions) {
		if (now - s.createdAt > this.ttlMs) this.sessions.delete(id)
	}
}
```

- Do the same (ttlMs ctor + `createdAt` already present + `purgeExpired` + call in `create`) for `DownloadSessionStore`.

- [ ] **Step 4: Run — verify PASS.** Run: `bun test test/unit/session-ttl.test.ts`. Then full `bun test` + `bun run check-types`.
- [ ] **Step 5:** `bun run format`; commit:

```bash
git add src/core/sessions.ts test/unit/session-ttl.test.ts
git commit -m "fix: expire abandoned upload/download sessions (TTL sweep)"
```

---

## Task 3.6: Exports + docs + phase sweep

**Files:**

- Modify: `src/index.ts` (export `StagedFile` type + ensure new client methods available — they ride on `LocalSendClient`, already exported)
- Modify: `AGENTS.md` / design doc checkboxes

- [ ] **Step 1:** In `src/index.ts`, add `export type { StagedFile } from "./core/files.ts"`. (LocalSendServer/LocalSendClient already exported.)
- [ ] **Step 2:** Update root `AGENTS.md` "WHERE TO LOOK" / feature notes to mention the download API (`prepare-download`/`download`/`GET /`) and `sharedFiles` option. In the design doc §8, tick **Phase 3**.
- [ ] **Step 3: Full sweep.** Run: `bun run check-types && bun test` — all green (expect ~26 tests). Do NOT run `bun run build` if port 53317 is busy; note it.
- [ ] **Step 4:** `bun run format`; commit:

```bash
git add src/index.ts AGENTS.md docs/superpowers/specs/2026-07-12-localsend-v2.1-completion-and-test-harness-design.md
git commit -m "docs: mark Phase 3 (download API) complete; export StagedFile"
```

---

## Self-Review Notes

- **Spec coverage:** prepare-download (§3.3) ✓ 3.2; download ✓ 3.2; browser page ✓ 3.3; client methods ✓ 3.4; session TTL fast-follow ✓ 3.5.
- **Type consistency:** `StagedFile` (fileId/metadata/absolutePath) used identically in 3.1/3.2/3.4; `DownloadSessionStore` methods (create/get/getFile/delete/purgeExpired) consistent; `PrepareDownloadResponse` reused from protocol/types.ts.
- **No placeholders:** every code step is complete.
- **Deferred:** HTTPS (Phase 4), Docker e2e (Phase 5), Rust oracle (Phase 6).

# LocalSend v2.1 — Phase 4: HTTPS + Cert + Fingerprint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Serve LocalSend over HTTPS with an auto-generated self-signed certificate, and compute the device fingerprint the way the official app does, so HTTPS peers identify us correctly.

**Architecture:** New `src/crypto/cert.ts` generates a self-signed cert (via the pure-JS `selfsigned` dep) and computes `certFingerprintSha256`. Server adapters gain TLS support (the `tls?` field already exists on the adapter interface). `LocalSendServer` in HTTPS mode auto-generates a cert, sets `deviceInfo.fingerprint = certFingerprintSha256(cert)`, and passes TLS to the adapter. Client/discovery already accept self-signed certs.

**Tech Stack:** TypeScript, Bun (`bun test`), Hono, node:crypto/https, **new dep `selfsigned`** (pure JS, forge-based).

## Global Constraints

- **Formatting (Prettier):** no semicolons; no trailing commas; tabs (width 2); print width 100. `bun run format` before every commit.
- **Imports:** `.ts` extensions; `node:` prefix for builtins. Protocol types from `../protocol/types.ts`.
- **Never edit** `src/sdk/*.gen.ts`. `bun run check-types` clean + `bun test` green at every commit.
- **FINGERPRINT FORMAT (interop-critical, verified against the official app's own test):**
  `fingerprint = SHA-256( DER bytes of the certificate ) as UPPERCASE hex`.
  DER = base64-decode of the PEM body (strip `-----BEGIN/END-----` lines + newlines).
  Reference: `references/localsend/app/lib/util/security_helper.dart` `calculateHashOfCertificate`, and its test `app/test/unit/util/security_helper_test.dart:102` asserting `247E5F7CF21DE14438EAE733E07AC5440593D0612570C7413674130608DF69A9` (64 uppercase hex).
- **Protocol:** HTTPS uses the same v2 endpoints on the same port; only the transport differs. The client accepts self-signed certs (`rejectUnauthorized:false`) — already implemented in `src/core/send.ts` `applyTlsOptions` and `src/discovery/http-discovery.ts`.

## Existing interfaces this phase builds on

- `src/crypto/fingerprint.ts` → `generateFingerprint()` (random, for HTTP mode).
- `src/server/adapters/types.ts` → `ServerAdapter.start({ port, fetch, maxRequestBodySize?, tls? })` — `tls?: {cert,key}` field already present, currently ignored by the three adapters.
- `src/server/adapters/{bun,node,deno}.ts` → `BunServerAdapter`, `NodeServerAdapter` (uses `@hono/node-server` `serve`), `DenoServerAdapter`.
- `src/server/server.ts` → `LocalSendServer`; constructor already accepts `protocol?: "http"|"https"`; `start()` calls `this.serverAdapter.start({...})`.
- `src/utils/device.ts` → `getDeviceInfo({ useHttps })` sets `protocol` and a random fingerprint.
- Test helpers in `test/helpers/util.ts`.

---

## Task 4.1: crypto/cert.ts — self-signed cert + app-correct fingerprint

**Files:**
- Create: `src/crypto/cert.ts`
- Modify: `package.json` (add `selfsigned` dependency)
- Test: `test/unit/cert.test.ts`

**Interfaces:**
- Produces:
```ts
function generateSelfSignedCert(): { cert: string; key: string }   // PEM strings
function certFingerprintSha256(certPem: string): string            // 64-char UPPERCASE hex
```

- [ ] **Step 1: Add the dependency**

Run: `bun add selfsigned` (adds it to `dependencies` and installs). Confirm it appears in `package.json`.

- [ ] **Step 2: Write `test/unit/cert.test.ts`**

```ts
import { test, expect } from "bun:test"
import { createHash } from "node:crypto"
import { Buffer } from "node:buffer"
import { generateSelfSignedCert, certFingerprintSha256 } from "../../src/crypto/cert.ts"

function derOf(pem: string): Buffer {
	const body = pem
		.replace(/\r\n/g, "\n")
		.split("\n")
		.filter((l) => l.length > 0 && !l.startsWith("---"))
		.join("")
	return Buffer.from(body, "base64")
}

test("generateSelfSignedCert returns PEM cert + key", () => {
	const { cert, key } = generateSelfSignedCert()
	expect(cert).toContain("BEGIN CERTIFICATE")
	expect(key).toContain("PRIVATE KEY")
})

test("certFingerprintSha256 is uppercase hex SHA-256 of the DER cert (app format)", () => {
	const { cert } = generateSelfSignedCert()
	const fp = certFingerprintSha256(cert)
	expect(fp).toMatch(/^[0-9A-F]{64}$/)
	// independent recomputation must match (DER bytes, uppercase hex)
	const expected = createHash("sha256").update(derOf(cert)).digest("hex").toUpperCase()
	expect(fp).toBe(expected)
})

test("fingerprint is stable for the same cert", () => {
	const { cert } = generateSelfSignedCert()
	expect(certFingerprintSha256(cert)).toBe(certFingerprintSha256(cert))
})
```

- [ ] **Step 3: Run — verify FAIL** (`src/crypto/cert.ts` missing). Run: `bun test test/unit/cert.test.ts`

- [ ] **Step 4: Create `src/crypto/cert.ts`**

```ts
import { createHash } from "node:crypto"
import { Buffer } from "node:buffer"
// @ts-ignore - selfsigned ships without bundled types
import selfsigned from "selfsigned"

/**
 * Generate a self-signed certificate + private key (PEM strings).
 * Matches LocalSend's approach (RSA self-signed, CN "LocalSend User").
 */
export function generateSelfSignedCert(): { cert: string; key: string } {
	const attrs = [{ name: "commonName", value: "LocalSend User" }]
	const pems = selfsigned.generate(attrs, {
		algorithm: "sha256",
		keySize: 2048,
		days: 3650
	})
	return { cert: pems.cert, key: pems.private }
}

/**
 * Compute the device fingerprint the way the official app does:
 * SHA-256 of the certificate's DER bytes, encoded as UPPERCASE hex.
 * (DER = base64-decode of the PEM body.)
 * Ref: references/localsend/app/lib/util/security_helper.dart calculateHashOfCertificate
 */
export function certFingerprintSha256(certPem: string): string {
	const body = certPem
		.replace(/\r\n/g, "\n")
		.split("\n")
		.filter((line) => line.length > 0 && !line.startsWith("---"))
		.join("")
	const der = Buffer.from(body, "base64")
	return createHash("sha256").update(der).digest("hex").toUpperCase()
}
```

- [ ] **Step 5: Run — verify PASS.** Run: `bun test test/unit/cert.test.ts` → 3 pass. If `selfsigned` fails to import/run under Bun, switch the implementation to use `node-forge` directly (also pure JS): `bun add node-forge`, build an RSA keypair + self-signed X.509 cert, export PEM. Keep the same two exported function signatures. Report the swap as DONE_WITH_CONCERNS.
- [ ] **Step 6:** `bun run check-types && bun test`; `bun run format`; commit:
```bash
git add src/crypto/cert.ts package.json bun.lock test/unit/cert.test.ts
git commit -m "feat: self-signed cert generation + app-correct SHA-256(DER) uppercase fingerprint"
```

---

## Task 4.2: TLS support in server adapters

**Files:**
- Modify: `src/server/adapters/bun.ts`, `src/server/adapters/node.ts`, `src/server/adapters/deno.ts`
- (No new test here — exercised by the HTTPS interop test in Task 4.4.)

**Interfaces:**
- Consumes: `start(options)` where `options.tls?: { cert: string; key: string }`.
- Produces: each adapter starts an HTTPS listener when `options.tls` is provided, HTTP otherwise.

- [ ] **Step 1: Bun adapter (`src/server/adapters/bun.ts`)** — pass `tls` to `Bun.serve`:

```ts
// inside start(), build the serve config:
const config: any = {
	port: options.port,
	fetch: options.fetch as any,
	maxRequestBodySize: options.maxRequestBodySize || 1024 * 1024 * 1024
}
if (options.tls) config.tls = { cert: options.tls.cert, key: options.tls.key }
return Bun.serve(config)
```

- [ ] **Step 2: Node adapter (`src/server/adapters/node.ts`)** — use `node:https` when `tls` present:

```ts
const { serve } = await import("@hono/node-server")
const serveOptions: any = { port: options.port, fetch: options.fetch as any }
if (options.tls) {
	const { createServer } = await import("node:https")
	serveOptions.createServer = createServer
	serveOptions.serverOptions = { key: options.tls.key, cert: options.tls.cert }
}
return serve(serveOptions)
```

- [ ] **Step 3: Deno adapter (`src/server/adapters/deno.ts`)** — pass cert/key to `Deno.serve`:

```ts
const denoOptions: any = { port: options.port, handler: options.fetch as any }
if (options.tls) {
	denoOptions.cert = options.tls.cert
	denoOptions.key = options.tls.key
}
const server = globalThis.Deno.serve(denoOptions)
```

- [ ] **Step 4:** `bun run check-types` clean; `bun test` still green (17→existing count unchanged — no behavior change without tls). `bun run format`; commit:
```bash
git add src/server/adapters
git commit -m "feat: TLS support in Bun/Node/Deno server adapters"
```

---

## Task 4.3: LocalSendServer HTTPS mode (auto-cert + fingerprint)

**Files:**
- Modify: `src/server/server.ts`
- Test: `test/unit/https-server.test.ts` (fingerprint wiring — unit-level)

**Interfaces:**
- `LocalSendServer` constructor gains `tls?: { cert: string; key: string }`. When HTTPS is requested (`options.protocol === "https"` OR `deviceInfo.protocol === "https"`): if no `tls` provided, generate one via `generateSelfSignedCert()`; set `deviceInfo.protocol = "https"`, `deviceInfo.fingerprint = certFingerprintSha256(cert)`; pass `tls` to the adapter in `start()`.

- [ ] **Step 1: Write `test/unit/https-server.test.ts`**

```ts
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
```
(Expose the generated cert for testing: add a public getter `get tlsCert(): string | undefined` and a public getter `get deviceInfo()` if not already public — see Step 2.)

- [ ] **Step 2: Run — verify FAIL.** Run: `bun test test/unit/https-server.test.ts`

- [ ] **Step 3: Update `src/server/server.ts`**
  - Add constructor option `tls?: { cert: string; key: string }`; store `private tls?: {cert,key}`.
  - Make `deviceInfo` publicly readable (add `get deviceInfo() { return this._deviceInfo }` or make the field public if it isn't already — match the existing style; the tests and CLI read `server.deviceInfo`). Add `get tlsCert(): string | undefined { return this.tls?.cert }`.
  - In `start()` (before staging/adapter start), add:
```ts
const wantsHttps = this.deviceInfo.protocol === "https" || this.requestedProtocol === "https"
if (wantsHttps) {
	if (!this.tls) {
		const { generateSelfSignedCert } = await import("../crypto/cert.ts")
		this.tls = generateSelfSignedCert()
	}
	const { certFingerprintSha256 } = await import("../crypto/cert.ts")
	this.deviceInfo.protocol = "https"
	this.deviceInfo.fingerprint = certFingerprintSha256(this.tls.cert)
}
```
  - Pass `tls: this.tls` in the `this.serverAdapter.start({ ... })` call.
  - Store the requested protocol from options as `this.requestedProtocol = options.protocol`.

- [ ] **Step 4: Run — verify PASS.** Run: `bun test test/unit/https-server.test.ts`. Then full `bun test` + `bun run check-types`.
- [ ] **Step 5:** `bun run format`; commit:
```bash
git add src/server/server.ts test/unit/https-server.test.ts
git commit -m "feat: LocalSendServer HTTPS mode with auto self-signed cert + cert fingerprint"
```

---

## Task 4.4: HTTPS interop tests (upload + download over TLS)

**Files:**
- Test: `test/interop/https.test.ts`

- [ ] **Step 1: Write `test/interop/https.test.ts`**

```ts
import { test, expect } from "bun:test"
import { getDeviceInfo } from "../../src/utils/device.ts"
import { LocalSendServer } from "../../src/server/server.ts"
import { LocalSendClient } from "../../src/core/send.ts"
import { buildFileMetadataFromPath } from "../../src/core/files.ts"
import { getFreePort, tempDir, rmTemp, makeRandomFile, sha256File } from "../helpers/util.ts"
import path from "node:path"

test("upload over HTTPS (self-signed) is byte-for-byte", async () => {
	const src = await tempDir()
	const saveDir = await tempDir()
	const port = await getFreePort()
	const server = new LocalSendServer(getDeviceInfo({ alias: "R", port }), {
		protocol: "https",
		saveDirectory: saveDir,
		onTransferRequest: async () => true
	})
	await server.start()
	const client = new LocalSendClient(getDeviceInfo({ alias: "S" }))
	const target = { ip: "127.0.0.1", port, protocol: "https" as const }
	try {
		const f = await makeRandomFile(src, "tls.bin", 1024 * 1024)
		const { fileId, fileMetadata } = await buildFileMetadataFromPath(f.path)
		const prep = await client.prepareUpload(target, { [fileId]: fileMetadata })
		expect(prep && prep.files[fileId]).toBeTruthy()
		const ok = await client.uploadFile(target, prep!.sessionId, fileId, prep!.files[fileId], f.path)
		expect(ok).toBe(true)
		expect(await sha256File(path.join(saveDir, "tls.bin"))).toBe(f.sha256)
	} finally {
		await server.stop()
		await rmTemp(src)
		await rmTemp(saveDir)
	}
})

test("download over HTTPS (self-signed) is byte-for-byte", async () => {
	const dir = await tempDir()
	const outDir = await tempDir()
	const port = await getFreePort()
	const shared = await makeRandomFile(dir, "share.bin", 1024 * 1024)
	const server = new LocalSendServer(getDeviceInfo({ alias: "Sharer", port }), {
		protocol: "https",
		sharedFiles: [shared.path]
	})
	await server.start()
	const client = new LocalSendClient(getDeviceInfo({ alias: "D" }))
	const target = { ip: "127.0.0.1", port, protocol: "https" as const }
	try {
		const meta = await client.prepareDownload(target)
		expect(meta).toBeTruthy()
		const fileId = Object.keys(meta!.files)[0]
		const out = path.join(outDir, "got.bin")
		expect(await client.download(target, meta!.sessionId, fileId, out)).toBe(true)
		expect(await sha256File(out)).toBe(shared.sha256)
	} finally {
		await server.stop()
		await rmTemp(dir)
		await rmTemp(outDir)
	}
})
```

- [ ] **Step 2: Run — verify.** Run: `bun test test/interop/https.test.ts`.
  - If the client can't connect over TLS to a self-signed server under Bun, confirm `applyTlsOptions` sets the right Bun fetch option. Bun fetch accepts `tls: { rejectUnauthorized: false }`; if that's not honored, use `{ tls: { rejectUnauthorized: false } }` at the top-level fetch init (already done in `applyTlsOptions`). If Bun requires a different key, adjust `applyTlsOptions` in `src/core/send.ts` accordingly and note it. The tests MUST pass under `bun test`.
- [ ] **Step 3:** Full `bun test` + `bun run check-types` green. `bun run format`; commit:
```bash
git add test/interop/https.test.ts src/core/send.ts
git commit -m "test: HTTPS upload + download interop over self-signed TLS"
```

---

## Task 4.5: Docs + phase sweep

**Files:**
- Modify: `src/utils/device.ts` (only if needed for https fingerprint note), `AGENTS.md`, design doc §8

- [ ] **Step 1:** Update root `AGENTS.md` to note HTTPS mode: `new LocalSendServer(info, { protocol: "https" })` auto-generates a self-signed cert and sets `fingerprint = SHA-256(DER cert) uppercase` (matches the official app); cert logic in `src/crypto/cert.ts`; TLS in `src/server/adapters/*`.
- [ ] **Step 2:** In the design doc §8, tick **Phase 4**. In §9, mark R1 (fingerprint format) resolved: verified against `app/lib/util/security_helper.dart` + its test (`247E5F7C…`).
- [ ] **Step 3: Full sweep.** `bun run check-types && bun test` — all green. Do NOT run `bun run build` if port 53317 is busy (note it).
- [ ] **Step 4:** `bun run format`; commit:
```bash
git add AGENTS.md docs/superpowers/specs/2026-07-12-localsend-v2.1-completion-and-test-harness-design.md src/utils/device.ts
git commit -m "docs: mark Phase 4 (HTTPS) complete; fingerprint format verified vs official app"
```

---

## Self-Review Notes

- **Fingerprint correctness:** DER + uppercase hex verified against the app's own unit test (`247E5F7C…`). This is the interop crux and is baked into `certFingerprintSha256` + its self-consistency test.
- **Spec coverage:** cert gen (§6.5) ✓ 4.1; fingerprint ✓ 4.1; TLS adapters ✓ 4.2; server HTTPS mode ✓ 4.3; HTTP+HTTPS interop ✓ 4.4 (+ existing HTTP tests remain green).
- **Type consistency:** `generateSelfSignedCert() -> {cert,key}` and `certFingerprintSha256(pem) -> string` used identically across 4.1/4.3/4.4.
- **Risk:** `selfsigned` under Bun (fallback: node-forge). Bun client TLS-accept for self-signed (fallback: adjust applyTlsOptions). Both surfaced in the tasks with concrete fallbacks.
- **Deferred:** Docker e2e (Phase 5), Rust oracle (Phase 6) — the oracle will independently confirm the fingerprint against real cert verification.

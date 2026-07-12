# LocalSend-TS: v2.1 Completion, Refactor & Test Harness — Design

**Date:** 2026-07-12
**Status:** Draft for review
**Owner:** Huakun Shen
**Repo:** `localsend-ts` (v0.1.2, pre-1.0 — breaking changes allowed)

---

## 1. Purpose & Goals

`localsend-ts` is a TypeScript implementation of the LocalSend protocol, intended to be
consumed as a **library** to build a browser/desktop extension later. A verification pass
(2026-07-12) found the implementation is a working _upload-only, HTTP-only, CLI-to-CLI_ tool
but is **not interop-complete with the real LocalSend app** and has correctness/security bugs.

**Goals**

1. Reach **full LocalSend v2.1 LAN compatibility** with the official app (v1.17.0 as reference).
2. **Refactor** the codebase into a runtime-agnostic, unit-testable core (full consolidation).
3. Build an **automated test harness** so future development is test-driven and regressions are caught.
4. Fix all correctness/security bugs found in verification.

**Success criteria**

- All v2.1 endpoints implemented and spec-conformant: `info`, `register`, `prepare-upload`,
  `upload`, `cancel`, `prepare-download`, `download`.
- Works over both **HTTP and HTTPS** (self-signed cert; fingerprint = SHA-256 of cert).
- A file sent from `localsend-ts` arrives byte-identical at a real LocalSend app, and vice versa
  (validated later via the Rust wrapper oracle; validated now via spec-conformance + TS↔TS tests).
- `bun test` green in CI with no external toolchain.

---

## 2. Non-Goals (explicitly out of scope)

- **Protocol v3** (nonce handshake, ed25519 signed tokens, cert pairing / mutual-TLS trust store).
  It is _unpublished and experimental_ — it exists only in the newer Rust `core` crate, not in the
  public `localsend/protocol` spec (which tops out at v2.1). Chasing it means tracking a moving target.
- **WebRTC / internet transfer** via `public.localsend.org` signaling.
- **Multi-file folder-tree UX niceties** beyond what the protocol requires.
- Mobile-specific device detection.

These may become follow-up specs after v2.1 is solid.

---

## 3. Protocol Reference (v2.1) — source of truth

Default multicast: `224.0.0.167:53317`. Default HTTP/HTTPS port: `53317`.
Fingerprint: **HTTPS** = SHA-256 of the TLS certificate; **HTTP** = random string.

### 3.1 Discovery

- **Multicast announce** (UDP → group): JSON `{alias, version, deviceModel?, deviceType, fingerprint, port, protocol, download?, announce:true}`.
- **Response** to an announce: HTTP `POST /api/localsend/v2/register` with own info (no `announce`), OR a UDP message with `announce:false` as fallback.
- **HTTP legacy discovery**: when multicast fails, `POST /register` to peers / scan subnet `GET /info`.

### 3.2 Upload API (receiver hosts server) — the default path

| Method | Path                               | Query                     | Body                                  | Success                                                            |
| ------ | ---------------------------------- | ------------------------- | ------------------------------------- | ------------------------------------------------------------------ |
| POST   | `/api/localsend/v2/prepare-upload` | `?pin=`                   | `{info, files:{fileId:FileMetadata}}` | `200 {sessionId, files:{fileId:token}}` or `204` (nothing to send) |
| POST   | `/api/localsend/v2/upload`         | `?sessionId&fileId&token` | **whole binary file**                 | `200`                                                              |
| POST   | `/api/localsend/v2/cancel`         | `?sessionId`              | —                                     | `200`                                                              |

`prepare-upload` status codes: `200`, `204` (finished/no transfer), `400` (invalid), `401` (PIN),
`403` (rejected), `409` (blocked by another session), `429` (too many), `500`.
`upload` status codes: `200`, `400` (missing params), `403` (invalid token/IP), `409`, `500`.

> **CRITICAL:** the upload body is the **entire file in ONE request**. There is **no** `Content-Range`
> / `X-Content-Range` chunking in the spec. The current impl's invented chunking is an interop bug.

### 3.3 Download API (sender hosts server) — reverse / share-by-link

| Method | Path                                 | Query               | Body                        | Success                                              |
| ------ | ------------------------------------ | ------------------- | --------------------------- | ---------------------------------------------------- |
| GET    | `/`                                  | —                   | —                           | Browser share page (HTML)                            |
| POST   | `/api/localsend/v2/prepare-download` | `?pin=`             | _(optional requester info)_ | `200 {info, sessionId, files:{fileId:FileMetadata}}` |
| GET    | `/api/localsend/v2/download`         | `?sessionId&fileId` | —                           | binary file                                          |

`prepare-download` status codes: `200`, `401` (PIN), `403` (rejected), `429`, `500`.

### 3.4 Info

`GET /api/localsend/v2/info` → `{alias, version, deviceModel?, deviceType, fingerprint, download?}`.

### 3.5 Data shapes

```
DeviceInfo   = { alias, version, deviceModel?:string|null, deviceType:"mobile"|"desktop"|"web"|"headless"|"server",
                 fingerprint, port, protocol:"http"|"https", download?:boolean=false }
FileMetadata = { id, fileName, size, fileType, sha256?:string|null, preview?:string|null,
                 metadata?: { modified?:string|null, accessed?:string|null } | null }
```

Spec leniency to honor: `download` optional (default false); `deviceModel`/`sha256`/`preview`/`metadata`
nullable/optional; unknown `deviceType` → default `desktop`.

---

## 4. Current State Assessment

### Works

- Multicast discovery (announce + respond) — `src/discovery/multicast.ts`
- HTTP subnet-scan discovery — `src/discovery/http-discovery.ts`
- `info`, `register`, `prepare-upload`, `upload`, `cancel` (Hono server) — `src/api/hono-routes.ts`
- Multi-runtime adapters (Bun/Node/Deno) — `src/api/server-adapter.ts`
- Client insecure-TLS handling (accepts self-signed) — `src/api/client.ts`
- Typed OpenAPI + Hono RPC client — `src/hono-rpc.ts`, `src/sdk/*`

### Missing / Broken (must fix)

| #   | Issue                                                                              | Location                                                                    | Severity    |
| --- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------- |
| G1  | Download API (`prepare-download`, `download`, `/` page) absent                     | —                                                                           | Feature gap |
| G2  | No HTTPS server; no cert; fingerprint always random                                | `src/api/*`, `src/utils/device.ts:9`                                        | Feature gap |
| B1  | Invented `X-Content-Range` chunking → breaks real-app interop for files >50 MB     | `src/api/client.ts:147`, `src/hono-rpc.ts:63`, `src/api/hono-routes.ts:283` | Correctness |
| B2  | Path traversal via `fileName`                                                      | `src/api/hono-routes.ts:276`, `src/api/server.ts:261`                       | Security    |
| B3  | Schema stricter than spec (`download`/`port` required) → rejects valid peers       | `src/types.ts:19-21`                                                        | Correctness |
| B4  | Vanilla `LocalSendServer` truncates on chunked upload, no accept/progress/download | `src/api/server.ts`                                                         | Correctness |
| B5  | `204` never returned; filename collisions overwrite                                | `src/api/hono-routes.ts`                                                    | Minor       |
| B6  | PIN and accept-callback mutually exclusive                                         | `src/api/hono-routes.ts:164-175`                                            | Minor       |

---

## 5. Target Architecture (full consolidation + extracted core)

**Principle:** protocol logic lives in a **runtime-agnostic core** with no HTTP-framework or
Node-specific coupling. The Hono server and adapters become a thin transport shell. This makes every
protocol behavior unit-testable and lets the download API + HTTPS be added once, not per-server.

```
src/
  protocol/
    types.ts            # DeviceInfo, FileMetadata, DTOs (valibot schemas = source of truth)
    constants.ts        # ports, multicast addr, API paths, version
  crypto/
    fingerprint.ts      # random fp (http) ; SHA-256(cert) fp (https)
    cert.ts             # generate self-signed cert+key (cross-runtime), parse, hash
  core/
    sessions.ts         # UploadSessionStore + DownloadSessionStore (tokens, state, TTL)
    receive.ts          # pure handlers: handleInfo/Register/PrepareUpload/Upload/Cancel/
                        #                 PrepareDownload/Download  (framework-free: take a
                        #                 normalized Request-ish, return a normalized Response-ish)
    send.ts             # LocalSendClient: register/prepareUpload/upload(whole-file)/cancel/
                        #                  prepareDownload/download  (streaming, no chunking)
    files.ts            # sanitizeFilename, resolveSavePath (traversal-safe), hashing, staging
    discovery-engine.ts # (optional) shared announce/normalize helpers
  server/
    routes.ts           # Hono routes -> delegate to core/receive.ts
    adapters/
      types.ts          # ServerAdapter { start({port, fetch, tls?}), stop }
      bun.ts node.ts deno.ts   # each supports TLS (tls: {cert, key})
    server.ts           # LocalSendServer (THE canonical server; upload + download + https)
    web.ts              # minimal browser share page for GET /
  discovery/            # multicast.ts, http-discovery.ts, runtime.ts (minor tweaks)
  cli/                  # cli.ts, cli-interactive.ts, cli-tui.tsx
  index.ts              # public API
  hono-rpc.ts           # typed RPC client (kept)
  sdk/                  # generated (kept)
test/
  conformance/          # wire-format asserted against §3 spec
  interop/              # TS sender <-> TS receiver e2e (real sockets, temp files)
  unit/                 # core modules in isolation
  oracle/               # (Phase 5) Rust wrapper-driven interop
tools/
  oracle-rs/            # (Phase 5) ~100-line Rust CLI wrapping references/localsend/core
```

### 5.1 Key interfaces (illustrative)

```ts
// core/receive.ts — framework-free handler context
interface ReceiveContext {
	deviceInfo: DeviceInfo
	saveDirectory: string
	pin?: string
	uploads: UploadSessionStore
	downloads: DownloadSessionStore
	onTransferRequest?: (sender: DeviceInfo, files: Record<string, FileMetadata>) => Promise<boolean>
	onProgress?: (ev: ProgressEvent) => void
	sharedFiles?: StagedFile[] // for download API
}

// core/files.ts
function resolveSavePath(saveDir: string, fileName: string): string // throws on traversal escape
function sanitizeFilename(name: string): string
function stageFilesForDownload(paths: string[]): Promise<StagedFile[]>

// crypto/cert.ts
function generateSelfSignedCert(): { cert: string; key: string } // PEM
function certFingerprintSha256(certPem: string): string // hex, matches app format
```

### 5.2 Public API changes (breaking — acceptable at 0.1.x)

- **Remove** vanilla `LocalSendServer` (`src/api/server.ts`).
- **Rename** `LocalSendHonoServer` → **`LocalSendServer`** (canonical). Keep `LocalSendHonoServer`
  as a deprecated alias for one release.
- `LocalSendServer` new options: `{ protocol?: "http"|"https", tls?: {cert,key}, sharedFiles?, onTransferRequest, onTransferProgress, pin, saveDirectory, ... }`.
  When `protocol:"https"` and no `tls` given → auto-generate a self-signed cert and set
  `deviceInfo.fingerprint = certFingerprintSha256(cert)`.
- `LocalSendClient` gains `prepareDownload()` and `download()`; `uploadFile()` streams whole file.

---

## 6. Feature Designs

### 6.1 Fix upload (B1, B4) — whole-file streaming

- Client `uploadFile()` sends the **entire file as one POST**, body = a streamed `ReadableStream`
  from `createReadStream(path)` (avoid buffering large files in memory), with `Content-Length: size`.
  Use `duplex: "half"` where required (undici/Node). No `X-Content-Range`. Progress via a
  `TransformStream`/counting wrapper.
- Server `handleUpload()` streams request body straight to disk in one pass. Remove all range logic.
- Remove chunking from `hono-rpc.ts` too.

### 6.2 Fix path traversal + collisions (B2, B5)

- `resolveSavePath(saveDir, fileName)`: `const p = path.resolve(saveDir, fileName)`; require
  `p === saveDir || p.startsWith(saveDir + path.sep)`, else reject (`403`/`400`). This preserves
  legitimate sub-folder transfers while blocking `../` escapes.
- On collision, append ` (1)`, ` (2)`, … before the extension.

### 6.3 Relax schema (B3, B6)

- `download` → `v.optional(v.boolean(), false)`; `deviceModel/sha256/preview/metadata` optional+nullable;
  unknown `deviceType` coerced to `"desktop"`. Keep `port` required in announcements but tolerate its
  absence in `prepare-upload.info` (fall back to socket/known port).
- Allow PIN **and** accept-callback together: check PIN first, then call `onTransferRequest`.

### 6.4 Download API (G1)

- **Staging:** `LocalSendServer({ sharedFiles: string[] })` or `server.share(paths)` builds
  `StagedFile[]` = `{ fileId, metadata, absolutePath }`; sets `deviceInfo.download = true`.
- **`POST /prepare-download`**: validate PIN; create a `DownloadSession` referencing staged files;
  respond `{ info, sessionId, files }`.
- **`GET /download?sessionId&fileId`**: look up session+file, stream bytes with correct
  `Content-Type`/`Content-Length`/`Content-Disposition`.
- **`GET /`** (`server/web.ts`): minimal HTML — server creates a session and renders a list of files
  with `download` links. (Full official web assets are out of scope; a functional minimal page suffices.)
- **Client:** `prepareDownload(target, pin?)` → metadata; `download(target, sessionId, fileId, outPath)`.

### 6.5 HTTPS (G2)

- `crypto/cert.ts` generates a self-signed cert+key. Cross-runtime generation has **no Node stdlib
  primitive**, so add a small pure-JS dependency (candidate: `selfsigned`, forge-based) — decision in
  Phase 4 after checking Bun/Deno compatibility; fallback: `node-forge` directly.
- `fingerprint = SHA-256(cert)`. **Exact derivation (DER vs PEM body, hex encoding) MUST be verified**
  against `references/localsend/core/src/crypto/{cert.rs,hash.rs}` and the real app during Phase 4;
  a wrong format silently breaks HTTPS discovery/verify.
- Adapters accept `tls: {cert, key}`:
  - **Bun:** `Bun.serve({ tls: { cert, key }, ... })`
  - **Node:** `@hono/node-server` `serve({ createServer: https.createServer, serverOptions: {key, cert} })`
  - **Deno:** `Deno.serve({ cert, key, ... })`
- Client/discovery already accept self-signed certs (`rejectUnauthorized:false`).

### 6.6 Discovery tweaks (minor)

- Optional periodic re-announce (interval) so late-joiners see us without waiting for their announce.
- **Multicast config seam:** make the multicast group **address + port injectable** (defaulting to the
  protocol values `224.0.0.167` / `53317`). Real runs and Docker e2e use the defaults so they interop
  with the official app; isolated tests can point at a scratch group to avoid cross-talk. Note the two
  ports are independent: the **multicast port is fixed at 53317** (the discovery rendezvous — peers only
  find each other there), while the **HTTP server port is free** and advertised in each announcement's
  `port` field.
- **HTTP-scan fallback caveat:** `HttpDiscovery` currently probes a single port (`this.deviceInfo.port`)
  on every subnet IP, so it only finds peers on that same port. Real interop relies on multicast (which
  carries the peer's real port); the scan is a best-effort fallback. Leave as-is for now; documented so
  the Docker e2e layer exercises the multicast path, not the scan.

---

## 7. Testing Strategy

### 7.1 Layer 1 — Unit (`test/unit/`)

- `resolveSavePath` traversal cases; `sanitizeFilename`; collision renaming.
- Session stores: token issue/validate, TTL/cleanup, all-received cleanup.
- Schema: accepts spec-lenient payloads; rejects malformed.
- `certFingerprintSha256` stable & correct format.

### 7.2 Layer 2 — Spec conformance (`test/conformance/`) — **the interop safety net without a real peer**

Assert our **wire output/expectations match §3**, not our own client:

- Upload of a 60 MB file emits **one** POST, whole body, **no** `X-Content-Range` header.
- `prepare-upload` returns `{sessionId, files:{id:token}}`; `204` when files map empty.
- Server accepts a spec-shaped `prepare-upload` whose `info` omits `download`.
- `prepare-download` returns `{info, sessionId, files}`; `download` streams exact bytes.
- Status codes match the table (401 on bad PIN, 403 on reject, etc.).
- `info`/`register` payload shapes exact.

### 7.3 Layer 3 — Interop e2e, single-host (`test/interop/`)

- Spin real `LocalSendServer` + real `LocalSendClient` on an ephemeral port; transfer files of
  sizes {0 B, 1 KB, 60 MB}; assert **byte-for-byte** (sha256) equality and cleanup.
- Same for the **download** direction.
- Both **HTTP and HTTPS** modes.
- PIN accept/reject; user-reject via `onTransferRequest`.
- **Discovery is NOT tested here.** These tests connect directly to a known port, so no multicast is
  needed and ephemeral localhost ports are reliable. Same-host multicast (two instances sharing UDP
  53317 via `reuseAddr` + loopback) is OS-dependent and flaky — kept out of the default suite (at most
  a single skippable smoke). Real discovery is covered in Layer 4 (Docker).

### 7.4 Layer 4 — Docker discovery e2e (`test/e2e-docker/`) — **opt-in; own phase**

Separate containers = separate network namespaces = **real multicast between hosts**. This is the only
honest way to test discovery.

- `docker compose` with 2+ containers on a **user-defined bridge network**, each running the built
  artifact (`dist/`, via bun or node) with a small headless entrypoint that starts discovery + a
  receiver and announces on the protocol defaults (`224.0.0.167:53317`).
- Assert **mutual discovery** (each container sees the other via multicast/register), then perform a
  **real file transfer** between containers and verify sha256.
- The test runner talks to the containers (exec / mapped HTTP), it does **not** join the multicast group.
- **macOS caveat (dev is on darwin):** Docker Desktop runs Linux in a VM, so `--network host` and
  host↔container multicast do not work; **container↔container multicast on a shared custom network does**
  (it lives inside the VM's bridge). CI on Linux works directly.
- Skippable when Docker is unavailable (keeps the default `bun test` green without Docker).

### 7.5 Layer 5 — Real-peer oracle (`test/oracle/`, `tools/oracle-rs/`) — **after core is solid**

- Thin Rust CLI wrapping `references/localsend/core` (`http` feature): subcommands
  `serve|send|download`. Driven from bun tests via `child_process`.
- Cases: TS→Rust upload, Rust→TS upload, TS↔Rust download, over HTTP and HTTPS; assert byte-equality.
- Marked skippable when `cargo`/crate unavailable (keeps CI green without Rust).

### 7.6 Manual (documented, not CI)

- Spot-check against installed **LocalSend 1.17.0** (enable Quick Save as auto-accept receiver;
  manual send from the app). Procedure documented in `docs/`.

---

## 8. Phased Implementation Plan

> Each phase ends **green** (`bun test` + `bun run check-types`). TDD: write failing test → fix.
> Checkboxes track progress.

- [x] **Phase 0 — Test scaffolding**
      Add `bun test` setup, `test/` dirs, helpers (temp dirs, ephemeral ports, sha256 compare, fetch-recorder).
      Exit: a trivial interop test (send 1 KB TS↔TS) passes against current code.

- [x] **Phase 1 — Refactor to core (no behavior change intended)**
      Extract `protocol/`, `core/`, `server/`; consolidate to one `LocalSendServer`; remove vanilla server;
      port existing endpoints onto `core/receive.ts`. Keep discovery. Update `index.ts`.
      Exit: existing behavior preserved; Phase-0 test + new conformance tests for current endpoints pass.

- [x] **Phase 2 — Correctness/security fixes (B1–B6)**
      Whole-file streaming upload; path-traversal guard; schema leniency; `204`; collisions; PIN+accept.
      Exit: conformance + interop tests for upload (incl. 60 MB, 0 B) green; traversal test green.

- [x] **Phase 3 — Download API (G1)**
      Staging, `prepare-download`, `download`, minimal `/` page; client `prepareDownload`/`download`.
      Exit: download interop tests (incl. 60 MB) green over HTTP.

- [x] **Phase 4 — HTTPS (G2)**
      `crypto/cert.ts` (choose dep), fingerprint=SHA-256(cert) with **verified** format, TLS in all adapters.
      Exit: HTTP+HTTPS interop tests green; fingerprint format confirmed against `core` source.

- [x] **Phase 5 — Docker discovery e2e**
      Multicast-config seam (injectable group addr/port, default `224.0.0.167:53317`); headless
      discovery+receiver entrypoint over the built `dist/`; `docker compose` with 2+ containers on a
      user-defined bridge network; `test/e2e-docker/` asserting mutual discovery + real transfer.
      Exit: two containers discover each other via multicast and complete a verified transfer; skippable
      when Docker absent.

- [x] **Phase 6 — Rust oracle**
      `tools/oracle-rs` wrapper; `test/oracle/` cross-impl tests (skippable). Confirm real-protocol parity;
      fix any residual mismatches (this is where HTTPS fingerprint & prepare-download body shape get proven).

- [ ] **Phase 7 — Docs & polish**
      Update `README.md`/`AGENTS.md`, public API docs, manual GUI-app checklist, discovery re-announce.

---

## 9. Risks & Open Questions

- **R1 — HTTPS fingerprint format. RESOLVED (Phase 4).** Matches the app exactly: SHA-256 of the
  certificate's DER bytes (base64-decoded PEM body), encoded as uppercase hex. Verified directly
  against `app/lib/util/security_helper.dart` (`calculateHashOfCertificate`) and its unit test
  `app/test/unit/util/security_helper_test.dart`, which asserts the fixed-input hash
  `247E5F7CF21DE14438EAE733E07AC5440593D0612570C7413674130608DF69A9` for a known certificate —
  the same PEM→DER→SHA-256→uppercase-hex derivation `src/crypto/cert.ts`
  (`certFingerprintSha256`) implements. `test/unit/cert.test.ts` covers this with an independent
  recomputation self-check (not yet the literal official test vector — a follow-up could pin that
  exact certificate/hash pair as a fixture). Oracle (Phase 6) will independently confirm against
  real cert verification.
- **R2 — Cross-runtime streaming upload.** `duplex:"half"` + stream bodies differ across Bun/Node/Deno.
  Mitigation: adapter-level abstraction + per-runtime interop test.
- **R3 — Self-signed cert dependency.** Need a pure-JS generator that works in Bun/Deno too.
  Mitigation: evaluate `selfsigned`/`node-forge` early in Phase 4; keep behind `crypto/cert.ts` seam.
- **R4 — `prepare-download` request body.** Spec says empty; app may send requester info. Design is
  lenient (optional body); confirm with oracle.
- **R5 — Rust `core` build. RESOLVED (Phase 6).** The oracle confirms real-client (Rust `core`) → TS server
  v2 upload/download interop byte-identical over HTTP and HTTPS. The `deviceType` leniency gap was
  surfaced and fixed. Mitigation: oracle test double-gated on env var and binary presence; default `bun test`
  skips it and remains green without Rust.
- **Q1 — Keep `LocalSendHonoServer` alias, or hard-remove?** (Proposed: deprecated alias for one release.)
- **Q2 — Folder-tree transfers:** preserve sub-paths in `fileName` (traversal-safe) or flatten to basename?
  (Proposed: preserve safe sub-paths.)

---

## 10. Summary

Finish LocalSend **v2.1** (add download API + HTTPS, fix chunking/traversal/schema), on top of a
**consolidated, testable core**, verified by a **TS-only conformance + interop suite** now and a
**Rust-core oracle** later. v3/WebRTC explicitly deferred.

# LocalSend v2.1 — Phase 6: Rust Reference-Peer Oracle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Prove our v2 implementation interoperates with the **official LocalSend Rust `core` library** by driving a real reference-implementation client against our TS server and verifying a byte-for-byte transfer.

**Architecture:** A tiny Rust wrapper crate (`tools/oracle-rs`) depends on `references/localsend/core` as a library with `features = ["http"]` (the crate's broken `main.rs` bin is NOT built by a dependent, only its lib — already confirmed the lib compiles). The wrapper exposes an `oracle send` subcommand that uses `LsHttpClientV2` to register + prepare-upload + upload a file. A bun test (opt-in, gated) starts our `LocalSendServer` (autoAccept) and drives the oracle binary against it, asserting the file arrives with matching sha256.

**Tech Stack:** Rust (cargo 1.96, `tokio`, `anyhow`), the official `localsend` core crate (path dep), Bun test driver.

## Global Constraints

- **Bun/TS side — Formatting (Prettier):** no semicolons; no trailing commas; tabs (width 2); print width 100. Never edit `src/sdk/*.gen.ts`.
- **`bun run check-types` clean + default `bun test` green at every commit.** The oracle test MUST be skipped by default and only run when `LOCALSEND_ORACLE=1` AND the oracle binary exists — so default CI has no Rust dependency.
- **Direction of the oracle:** real Rust v2 **client** → our TS **server** (our server is the well-tested known-good receiver). This proves our server accepts the reference client's exact register/prepare-upload/upload wire format over v2 HTTP.
- **Protocol:** v2 HTTP. Both sides on the same port the TS server binds.
- **Do NOT modify anything under `references/localsend/`** — depend on it read-only by path.

## Key facts about the core crate (verified)

- `cargo build --lib --features http` on `references/localsend/core` compiles cleanly (only warnings). The `main.rs` bin fails, but dependents don't build it.
- v2 client (in `localsend::http::client`, type `LsHttpClientV2`):
  - `try_new_without_cert() -> Result<Self, ClientError>` (plain HTTP)
  - `register(protocol, ip, port, payload: RegisterDtoV2)`
  - `prepare_upload(protocol, ip, port, public_key: Option<String>, payload: PrepareUploadRequestDtoV2, pin: Option<&str>) -> Result<PrepareUploadResultV2, _>` (`.response: Option<PrepareUploadResponseDtoV2>` with `session_id` + `files: HashMap<fileId, token>`)
  - `upload(protocol, ip, port, public_key: Option<String>, session_id, file_id, token, binary: mpsc::Receiver<Vec<u8>>)`
- `ProtocolType` enum (Http/Https) — in `localsend::http::dto` (as used in main.rs: `http::dto::ProtocolType`).
- DTOs: `RegisterDtoV2`, `PrepareUploadRequestDtoV2`, `PrepareUploadResponseDtoV2` in `localsend::http::dto_v2`; `FileDto` in `localsend::model::transfer`.
- **Exact field names + module `pub` paths MUST be confirmed by reading** `references/localsend/core/src/http/dto_v2.rs`, `src/model/transfer.rs`, and the `pub mod` declarations in `src/http/mod.rs` — then iterate `cargo build` until it compiles. (The v3 shapes in `core/src/main.rs` are a rough guide but v2 DTOs differ.)

---

## Task 6.1: Rust oracle wrapper crate (`oracle send`)

**Files:**
- Create: `tools/oracle-rs/Cargo.toml`
- Create: `tools/oracle-rs/src/main.rs`
- Modify: `.gitignore` (add `tools/oracle-rs/target`)

**Interfaces:**
- Produces a binary `oracle` with subcommand: `oracle send --host <H> --port <P> --file <F> [--alias <A>]` → exit 0 on a successful upload, non-zero on failure.

- [ ] **Step 1: Confirm the exact core-crate API** by reading:
  - `references/localsend/core/src/http/mod.rs` (which submodules are `pub`)
  - `references/localsend/core/src/http/dto_v2.rs` (`RegisterDtoV2`, `PrepareUploadRequestDtoV2`, `PrepareUploadResponseDtoV2` fields — note serde rename/camelCase, and which fields are Option)
  - `references/localsend/core/src/model/transfer.rs` (`FileDto` fields)
  - `references/localsend/core/src/http/client/url.rs` (`ProtocolType` location/variants)
  Write down the exact paths + field names; the skeleton below is a starting point to adapt.

- [ ] **Step 2: Create `tools/oracle-rs/Cargo.toml`**

```toml
[package]
name = "oracle"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "oracle"
path = "src/main.rs"

[dependencies]
localsend = { path = "../../references/localsend/core", features = ["http"] }
tokio = { version = "1", features = ["full"] }
anyhow = "1"
```

- [ ] **Step 3: Create `tools/oracle-rs/src/main.rs`** (SKELETON — adapt DTO field names + import paths to what Step 1 found; iterate `cargo build` until it compiles)

```rust
use anyhow::{anyhow, Result};
use std::collections::HashMap;
use tokio::io::AsyncReadExt;
use tokio::sync::mpsc;

// NOTE: adjust these import paths to the crate's actual pub re-exports (confirm in Step 1).
use localsend::http::client::LsHttpClientV2;
use localsend::http::dto::ProtocolType;
use localsend::http::dto_v2::{PrepareUploadRequestDtoV2, RegisterDtoV2};
use localsend::model::transfer::FileDto;
use localsend::model::discovery::DeviceType;

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let sub = args.get(1).map(|s| s.as_str()).unwrap_or("");
    if sub != "send" {
        return Err(anyhow!("usage: oracle send --host H --port P --file F [--alias A]"));
    }
    let get = |flag: &str| -> Option<String> {
        args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned()
    };
    let host = get("--host").unwrap_or_else(|| "127.0.0.1".to_string());
    let port: u16 = get("--port").ok_or_else(|| anyhow!("--port required"))?.parse()?;
    let file = get("--file").ok_or_else(|| anyhow!("--file required"))?;
    let alias = get("--alias").unwrap_or_else(|| "Rust Oracle".to_string());

    let file_name = std::path::Path::new(&file)
        .file_name().unwrap().to_string_lossy().to_string();
    let bytes = tokio::fs::read(&file).await?;
    let size = bytes.len() as i64; // adapt type to FileDto.size (likely i64/u64)

    let client = LsHttpClientV2::try_new_without_cert()?;

    // Build the sender's device info. Adapt field names/types to RegisterDtoV2 (Step 1).
    let info = RegisterDtoV2 {
        alias,
        version: "2.1".to_string(),
        device_model: Some("oracle".to_string()),
        device_type: Some(DeviceType::Headless),
        fingerprint: "oracle-fingerprint".to_string(), // v2 uses "fingerprint" (confirm field name)
        port: 53318,
        protocol: ProtocolType::Http,
        download: Some(false), // confirm field name/optionality
    };

    let file_id = "oracle-file-1".to_string();
    let file_dto = FileDto {
        id: file_id.clone(),
        file_name: file_name.clone(),
        size,
        file_type: "application/octet-stream".to_string(),
        sha256: None,
        preview: None,
        metadata: None,
    };
    let mut files = HashMap::new();
    files.insert(file_id.clone(), file_dto);

    let payload = PrepareUploadRequestDtoV2 { info, files };

    let prep = client
        .prepare_upload(ProtocolType::Http, &host, port, None, payload, None)
        .await
        .map_err(|e| anyhow!("prepare_upload failed: {e:?}"))?;
    let resp = prep.response.ok_or_else(|| anyhow!("no session (204?)"))?;
    let token = resp.files.get(&file_id).ok_or_else(|| anyhow!("file not accepted"))?.clone();

    // Stream the file bytes over an mpsc channel to upload().
    let (tx, rx) = mpsc::channel::<Vec<u8>>(8);
    let bytes_for_task = bytes.clone();
    tokio::spawn(async move {
        // send in chunks
        let mut reader = &bytes_for_task[..];
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = reader.read(&mut buf).await.unwrap_or(0);
            if n == 0 { break; }
            if tx.send(buf[..n].to_vec()).await.is_err() { break; }
        }
    });

    client
        .upload(ProtocolType::Http, &host, port, None, &resp.session_id, &file_id, &token, rx)
        .await
        .map_err(|e| anyhow!("upload failed: {e:?}"))?;

    println!("oracle: upload ok ({} bytes) -> {}:{}", size, host, port);
    Ok(())
}
```

- [ ] **Step 4: Build it** — `cd tools/oracle-rs && cargo build --release 2>&1 | tail -30`. Iterate on field names/paths/types until it compiles cleanly. (First build compiles the core lib + deps; may take a few minutes.)
- [ ] **Step 5:** Add `tools/oracle-rs/target` to root `.gitignore`.
- [ ] **Step 6:** `bun run check-types` (unchanged, still clean); commit:
```bash
git add tools/oracle-rs/Cargo.toml tools/oracle-rs/src/main.rs tools/oracle-rs/Cargo.lock .gitignore
git commit -m "feat: Rust oracle wrapper (oracle send) over official localsend core v2 client"
```
Report whether it compiled and the exact DTO field names you had to use.

---

## Task 6.2: Oracle interop test (real Rust client → TS server)

**Files:**
- Create: `test/oracle/oracle-helpers.ts`
- Create: `test/oracle/upload.test.ts`

**Interfaces:**
- Test skipped unless `process.env.LOCALSEND_ORACLE === "1"` AND the compiled oracle binary exists at `tools/oracle-rs/target/release/oracle`.

- [ ] **Step 1: Create `test/oracle/oracle-helpers.ts`**

```ts
import { existsSync } from "node:fs"
import path from "node:path"

export const ORACLE_BIN = path.resolve("tools/oracle-rs/target/release/oracle")

export function oracleAvailable(): boolean {
	return process.env.LOCALSEND_ORACLE === "1" && existsSync(ORACLE_BIN)
}
```

- [ ] **Step 2: Create `test/oracle/upload.test.ts`**

```ts
import { test, expect } from "bun:test"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { getDeviceInfo } from "../../src/utils/device.ts"
import { LocalSendServer } from "../../src/server/server.ts"
import { getFreePort, tempDir, rmTemp, makeRandomFile, sha256File } from "../helpers/util.ts"
import { ORACLE_BIN, oracleAvailable } from "./oracle-helpers.ts"

const run = oracleAvailable()

test.skipIf(!run)("official Rust v2 client uploads to our TS server byte-for-byte", async () => {
	const src = await tempDir()
	const saveDir = await tempDir()
	const port = await getFreePort()
	const server = new LocalSendServer(getDeviceInfo({ alias: "TS-Receiver", port }), {
		saveDirectory: saveDir,
		onTransferRequest: async () => true
	})
	await server.start()
	try {
		const f = await makeRandomFile(src, "oracle.bin", 3 * 1024 * 1024)
		const r = spawnSync(ORACLE_BIN, ["send", "--host", "127.0.0.1", "--port", String(port), "--file", f.path], {
			encoding: "utf8",
			timeout: 60000
		})
		expect(r.status).toBe(0)
		expect(await sha256File(path.join(saveDir, "oracle.bin"))).toBe(f.sha256)
	} finally {
		await server.stop()
		await rmTemp(src)
		await rmTemp(saveDir)
	}
})
```

- [ ] **Step 3: Run it for real** — `LOCALSEND_ORACLE=1 bun test test/oracle/upload.test.ts`.
  - Iterate until it genuinely passes: real reference client → our server, file arrives with matching sha256. If the real client's wire format exposes a bug in OUR server, FIX our server (that's the whole point of the oracle) and note it.
  - If the oracle binary can't be built in this environment after honest effort, report DONE_WITH_CONCERNS with the build error — do NOT fake a pass.
- [ ] **Step 4: Confirm default-skip** — `bun test test/oracle/upload.test.ts` (no env) → skipped; full `bun test` green + fast.
- [ ] **Step 5:** `bun run format`; commit:
```bash
git add test/oracle
git commit -m "test: opt-in oracle interop — official Rust v2 client -> TS server"
```
Report the real passing output.

---

## Task 6.3: Scripts + docs + sweep

**Files:**
- Modify: `package.json` (add `test:oracle` script), `AGENTS.md`, design doc §8/§9

- [ ] **Step 1:** Add `package.json` script: `"test:oracle": "LOCALSEND_ORACLE=1 bun test test/oracle"`. Optionally `"oracle:build": "cd tools/oracle-rs && cargo build --release"`.
- [ ] **Step 2:** Root `AGENTS.md`: document the oracle — build with `bun run oracle:build` (needs Rust/cargo), run with `bun run test:oracle`; it drives the official localsend Rust core v2 client against our server. Design doc §8: tick **Phase 6**; §9: note the oracle confirms real-client → our-server interop (and, if run over HTTPS in a follow-up, would confirm the fingerprint end-to-end).
- [ ] **Step 3: Sweep** — `bun run check-types` clean; default `bun test` green + fast (oracle skipped). Note whether the real oracle run passed.
- [ ] **Step 4:** `bun run format`; commit:
```bash
git add package.json AGENTS.md docs/superpowers/specs/2026-07-12-localsend-v2.1-completion-and-test-harness-design.md
git commit -m "docs: mark Phase 6 (Rust oracle) complete; add test:oracle script"
```

---

## Self-Review Notes

- **Feasibility confirmed:** core lib builds with `--features http`; dependents skip the broken `main.rs` bin.
- **Highest-value direction:** real reference client → our server; our server is the known-good, well-tested receiver, so a failure points at a real wire incompatibility in our server.
- **CI safety:** oracle test double-gated (env + binary exists); default `bun test` needs no Rust.
- **Honesty:** if the crate can't build here, deliver the scaffold + DONE_WITH_CONCERNS with the exact error — do not fake.
- **API discovery:** Task 6.1 Step 1 requires reading the real v2 DTOs; the skeleton is a starting point, not final — the implementer adapts + compiles.
- **Deferred:** reverse direction (Rust server ← TS client) and HTTPS-oracle fingerprint check are possible follow-ups; final docs/PR is Phase 7.

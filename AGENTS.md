# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-15 · **Updated:** 2026-07-12
**Branch:** main

> `CLAUDE.md` is a symlink to this file — this is the single canonical knowledge base for all agents.

## OVERVIEW

TypeScript implementation of LocalSend protocol (file sharing over local network). Multi-runtime support (Bun, Node, Deno) with CLI and library interfaces.

## ESSENTIAL COMMANDS

```bash
# Test (run these two after every change)
bun test               # Full suite: unit + conformance + interop (~2s, no network/Docker needed)
bun run check-types    # TypeScript validation: tsc --noEmit

# Build
bun run build          # Generate SDK + bundle CLIs (spawns hono-receiver on port 53317)
bun run format         # Prettier format (MUST run before commits)

# Run examples as functional tests
bun examples/basic-sender.ts <ip> <file>           # Test file sending
bun examples/basic-receiver.ts                      # Test vanilla server
bun examples/hono-receiver.ts                       # Test Hono server (on port 53317)
bun examples/hono-rpc-sender.ts                    # Test RPC client
bun examples/runtime-selector.ts                   # Test server adapters

# Development
bun run dev            # Watch mode for dev.ts
bun run tui            # React Ink TUI (recommended CLI)
bun run cli            # Menu-driven interactive CLI
```

## BUILD & TOOLCHAIN NOTES

### `bun run build` needs port 53317 free

`build.ts` spawns `examples/hono-receiver.ts` and fetches its `/openapi` endpoint to regenerate the
SDK before bundling. That receiver binds the LocalSend discovery port **53317** (TCP + UDP). If the
**official LocalSend desktop app (or any other LocalSend instance) is running locally, it already
holds 53317** and codegen fails with `EADDRINUSE` / a socket error. `build.ts` catches this, logs it,
and still bundles the CLIs, so the SDK just isn't regenerated. CI has no such conflict. To regenerate
the SDK locally, quit the LocalSend app first (or generate against a spare port in a throwaway script
that starts only `LocalSendServer` without `MulticastDiscovery`, then `app.request("/openapi")`).

### TypeScript: dev toolchain must stay on 5.x

- **`devDependencies.typescript` is pinned to `^5.9.0`** on purpose. `@hey-api/openapi-ts` (the SDK
  codegen) uses the TypeScript **compiler API** (`ts.SyntaxKind`, etc.). TypeScript **7**'s native
  port does not expose that programmatic API compatibly, so `bun run build` crashes under TS 7 with
  `TypeError: undefined is not an object (evaluating 'ts.SyntaxKind.AnyKeyword')`. Keep the repo's
  build/codegen on TS 5.x until openapi-ts supports TS 7.
- **`peerDependencies.typescript` is intentionally broad (`>=5.0.0`)** so consumers on TS 5 / 6 / 7
  can all use the package. Consumers only type-check the shipped `.ts` source (which TS 7 does fine —
  `tsc --noEmit` passes); they never run codegen, so the TS-7 codegen limitation doesn't affect them.

## CODE STYLE GUIDELINES

### Formatting (Prettier)

- **No semicolons** - `const x = 1` (not `const x = 1;`)
- **No trailing commas** - `{ a: 1, b: 2 }` (not `{ a: 1, b: 2, }`)
- **Use tabs** - 2 spaces/tab indentation
- **Print width**: 100 characters
- **Always run** `bun run format` before committing

### Import Rules

- **Allow .ts extensions** - `import { X } from "./file.ts"` (config: allowImportingTsExtensions)
- **Valibot imports** - Use `import * as v from "valibot"` in types.ts
- **Bun/Node imports** - Use node: prefix for Node.js APIs (node:fs, node:crypto, etc.)
- **Standard import order**:
  1. Node/builtin imports (node:\*)
  2. External packages
  3. Internal imports (relative paths starting with ./)

### Naming Conventions

- **Classes**: PascalCase - `LocalSendServer`, `LocalSendClient`, `MulticastDiscovery`
- **Functions**: camelCase - `getDeviceInfo`, `createServerAdapter`, `prepareUpload`
- **Constants**: SCREAMING_SNAKE_CASE - `DEFAULT_CONFIG`, `ANNOUNCE_DELAYS_MS`
- **Types**: PascalCase - `DeviceInfo`, `FileMetadata`, `PrepareUploadResponse`
- **Interfaces**: PascalCase - `ServerAdapter`, `Discovery`, `LocalSendContext`
- **Schema objects**: camelCase with Schema suffix - `deviceInfoSchema`, `fileMetadataSchema`

### Type Safety

- **Use Valibot schemas** in `src/types.ts` for protocol types - never manual definitions
- **Strict TypeScript** - All files use `"strict": true`
- **Type exports** - Export types separately from types.ts for public API
- **Generated types** - `*.gen.ts` files in `src/sdk/` are auto-generated, never edit

### Error Handling Patterns

- **Server routes**: `c.json({ message: "..." }, statusCode)` for API errors
- **Client methods**: `throw new Error("...")` for critical failures
- **Logging**: `console.error()` for debugging (never for production errors)
- **Async failures**: Always wrap in try-catch with proper error propagation

### Hono Server Patterns

- **Use validators** - All routes with request bodies must use `validator()` middleware
- **OpenAPI decorators** - Add `describeRoute()` to all routes for SDK generation
- **Response format** - Use `c.json()` with typed schemas or `c.text()` for simple strings
- **Query parameters**: Validate with `v.object()` in validator middleware

### RPC Client Patterns

- **Custom fetch** - Use custom fetch for binary uploads to support RequestInit.body
- **Type assertions sparingly** - Only use `as any` when Hono RPC doesn't support a pattern
- **Response handling**: Check `res.ok` before calling `res.json()`

## ANTI-PATTERNS (STRICT RULES)

- **DO NOT edit `src/sdk/*.gen.ts`** - Regenerated on every build from OpenAPI spec
- **DO NOT commit to `dist/`** - Build output only, gitignored
- **DO NOT use semicolons** - Prettier config forbids them
- **DO NOT use trailing commas** - Prettier config forbids them
- **NEVER modify protocol types manually** - Use Valibot schemas in `src/types.ts`
- **DON'T add semicolons** - Formatter will remove them, causing diff noise
- **DON'T manually type responses from RPC** - Infer from server types instead

## STRUCTURE

```
./
├── src/
│   ├── protocol/     # Constants + Valibot schemas (source of truth for wire types)
│   ├── crypto/       # Fingerprint derivation
│   ├── core/         # files.ts, send.ts (LocalSendClient), sessions.ts (UploadSessionStore)
│   ├── server/       # server.ts (LocalSendServer), routes.ts, adapters/ (Bun/Node/Deno)
│   ├── api/          # Thin re-export shims over core/ + server/ (back-compat import paths)
│   ├── discovery/    # Device discovery (multicast UDP, HTTP)
│   ├── sdk/          # Auto-generated OpenAPI SDK (DO NOT EDIT)
│   ├── utils/        # Device info, file operations
│   ├── types.ts      # Re-exports src/protocol/types.ts
│   ├── cli.ts        # Traditional CLI (send/receive/discover)
│   ├── cli-interactive.ts  # Menu-driven CLI
│   ├── cli-tui.tsx   # React Ink TUI (recommended)
│   └── hono-rpc.ts   # Type-safe Hono RPC client
├── test/
│   ├── unit/         # Pure logic (files, sessions, collisions)
│   ├── conformance/  # Protocol/schema/wire-format checks against the spec
│   ├── interop/      # End-to-end checks against a running server (path traversal, upload smoke)
│   └── helpers/      # Shared test harness + utilities
├── examples/         # Functional examples (serve as integration tests)
├── tools/            # generate-openapi.ts (dump spec), oracle-rs/ (Rust interop oracle)
├── openapi.json      # Committed OpenAPI 3.1 spec (bun run openapi:dump; .prettierignore'd)
├── build.ts          # Custom build: spawns hono-receiver to generate SDK
└── dist/             # Build output (generated, never commit)
```

## WHERE TO LOOK

| Task             | Location                 | Notes                                   |
| ---------------- | ------------------------ | --------------------------------------- |
| Send file        | `src/api/client.ts`      | LocalSendClient.sendFile()              |
| Receive file     | `src/api/server.ts`      | LocalSendServer (vanilla)               |
| Download file    | `src/core/send.ts`       | Client: prepareDownload/download()      |
| Download API     | `src/server/routes.ts`   | prepare-download / download endpoints   |
| Download UI      | `src/server/web.ts`      | GET / (browser page & file streaming)   |
| Share files      | `src/server/server.ts`   | LocalSendServer({ sharedFiles: [...] }) |
| HTTPS mode       | `src/crypto/cert.ts`     | Self-signed cert + fingerprint          |
| Hono server      | `src/api/hono-server.ts` | OpenAPI integration                     |
| RPC client       | `src/hono-rpc.ts`        | Type-safe Hono client                   |
| Discover devices | `src/discovery/*.ts`     | Multicast + HTTP fallback               |
| Build process    | `build.ts`               | Spawns hono-receiver on port 53317      |
| Protocol types   | `src/types.ts`           | Valibot schemas (source of truth)       |
| CLI entry        | `src/cli.ts`             | Citty framework                         |

## RUNTIME SUPPORT

- **Bun** - Primary runtime (bun:fs, bun:crypto native APIs)
- **Node.js** - Full support via node:\* imports
- **Deno** - Full support via @hono/node-server adapter
- **Server adapters** - Auto-detect or explicitly: BunServerAdapter, NodeServerAdapter, DenoServerAdapter

## TESTING

Tests live under `test/{unit,conformance,interop}/` and run with `bun test`. `test/unit/` covers
pure logic, `test/conformance/` checks protocol/schema/wire-format behavior, and `test/interop/`
spins up a real server (via `test/helpers/harness.ts`) for end-to-end checks. Examples in
`examples/` remain useful for manual, runnable demonstrations of a feature. Always run
`bun run check-types` and `bun test` after changes.

### Quick reference

| Command                     | What it runs                                    | Needs                                  |
| --------------------------- | ----------------------------------------------- | -------------------------------------- |
| `bun test`                  | unit + conformance + interop (default suite)    | nothing — servers bind ephemeral ports |
| `bun run check-types`       | `tsc --noEmit` type check                       | —                                      |
| `bun test test/unit`        | just the pure-logic tests                       | —                                      |
| `bun test test/conformance` | just protocol/schema/wire-format checks         | —                                      |
| `bun test test/interop`     | end-to-end against a live in-process server     | —                                      |
| `bun test:e2e:docker`       | multicast discovery across containers (opt-in)  | Docker running                         |
| `bun test:oracle`           | interop vs official Rust `core` client (opt-in) | Rust/cargo + built oracle              |

The default `bun test` suite is self-contained: interop tests start their own server on an
ephemeral port through `test/helpers/harness.ts`, so it does **not** collide with a running
LocalSend app and needs no network setup. Expected baseline: **56 pass / 2 skip / 0 fail**.

### Docker E2E (opt-in)

`bun run test:e2e:docker` runs multicast discovery tests in Docker containers. Requires Docker to
be running; validates real multicast discovery between separate containers on a user-defined bridge
network. Skipped by default (`bun test` does NOT run these tests) — enable only when Docker is
available and you need to verify cross-container discovery.

### Oracle (real-peer interop)

`bun run test:oracle` drives the **official LocalSend Rust `core` v2 client** (`tools/oracle-rs`) against
our TypeScript server to prove real-implementation interop. First build the oracle with
`bun run oracle:build` (requires Rust/cargo and the `http` feature-enabled localsend/core crate in
`references/localsend/core`). Oracle tests confirm byte-identical upload/download across HTTP and HTTPS,
and surface any residual wire-format mismatches. Skipped by default (`bun test` does NOT run oracle tests)
— enable only when the Rust crate builds and you need final verification against the reference implementation.

## OPENAPI SCHEMA

The HTTP API's OpenAPI 3.1 spec is committed at repo root as **`openapi.json`** so other languages
can generate clients straight from this repo. Regenerate it with **`bun run openapi:dump`**
(`tools/generate-openapi.ts`), which builds the Hono app in-process and calls `app.fetch("/openapi")` —
no server bind, so it does **not** need port 53317 free (unlike `bun run build`). The file is listed
in `.prettierignore` (the generator owns its formatting) and shipped in the npm/JSR package. Re-run
`bun run openapi:dump` whenever routes or schemas change.

## HTTPS MODE

`new LocalSendServer(info, { protocol: "https" })` auto-generates a self-signed
certificate (RSA, CN "LocalSend User") on `start()` and sets
`fingerprint = SHA-256(DER cert bytes) uppercase hex` on the device info — this matches
the official app's `calculateHashOfCertificate` (see
`references/localsend/app/lib/util/security_helper.dart`). Cert generation and
fingerprinting live in `src/crypto/cert.ts` (`generateSelfSignedCert`,
`certFingerprintSha256`); adapter-level TLS wiring lives in `src/server/adapters/*`.
The adapter only receives `tls` when HTTPS is actually requested (device protocol or
`options.protocol === "https"`), so plain HTTP servers never get a mismatched
advertise/actual protocol.

## PROTOCOL REFERENCE

- **Spec**: https://github.com/localsend/protocol/blob/main/README.md
- **Multicast**: 224.0.0.167:53317
- **Default port**: 53317
- **Authentication**: PIN-based (optional, server-configured)
- **Uploads**: Whole-file POST in one request (no Content-Range chunking)

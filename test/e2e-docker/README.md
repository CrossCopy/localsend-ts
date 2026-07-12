# Container-based e2e / interop test

A fully automated, no-AI, reproducible test that stands up **two real
LocalSend-TS peers in separate Docker containers** on a shared network and
proves they can **find each other and exchange files and text**. It exists
because the things that break interop — multicast discovery across real network
namespaces, the exact HTTP register/prepare-upload/upload wire format, byte
integrity — cannot be exercised by in-process unit tests on one host.

It doubles as a **reference harness**: when you write a LocalSend client in
another language (Rust, Go, …), you can vendor this TypeScript repo, build its
peer image, and point your own peer at it to check your implementation stays
aligned with a known-good one.

## What it asserts

Run by `test/e2e-docker/interop.test.ts`, in order:

1. **Mutual discovery** — each peer runs the CLI receiver with `--verbose` and
   logs `Device discovered: <alias>`; the test asserts both peers logged the
   other. This proves multicast (and the HTTP register fallback) works across
   the two containers' separate network namespaces.
2. **File transfer, both directions** — make a 200 KB random file in peer A,
   `send` it to peer B by container DNS name, assert the received file's
   `sha256` equals the source. Then the same B → A.
3. **Text transfer, both directions** — send a UTF-8 text file (the LocalSend
   wire form of a text message) and assert the received content matches exactly,
   including non-ASCII (`你好 📨`). Then B → A.

## How it's built

```
docker/Dockerfile          oven/bun image; installs deps, copies src, runs from source
docker/docker-compose.yml  two services (peer-a, peer-b) on one user-defined bridge net
test/e2e-docker/
  docker-helpers.ts        dockerAvailable() gate + sh()/dexec()/dsh() runners
  interop.test.ts          the gated bun test (build → up → assert → down)
```

Design choices worth knowing:

- **Runs from source, no build step.** The container command is
  `bun src/cli.ts receive …`; Bun runs the TypeScript directly. Fast to iterate,
  nothing to compile. (Deps are installed non-`--production` because the CLI
  imports `citty`, a devDependency — and this also lets the image run the TUI.)
- **Two peers = two network namespaces.** A user-defined bridge network
  (`lsnet`) is what makes multicast between containers work (Docker's _default_
  bridge does not forward multicast reliably; a user-defined one does, which is
  why the compose declares its own). Discovery genuinely exercises UDP multicast
  here, not a localhost shortcut.
- **Transfers are addressed by DNS name** (`send lspeer-b …`), not by a
  discovered IP. That keeps the transfer assertions independent of discovery
  timing — discovery is verified separately, so a flaky-multicast environment
  can't mask a real transfer regression, and vice versa.
- **Text is sent as a `.txt` file.** At the LocalSend wire level a text message
  _is_ a file (`fileType: text/plain` with a preview); sending a `.txt` and
  checking the received bytes exercises the same path.

## Running it

```sh
# One command. Opt-in via the env var; skipped otherwise so plain `bun test`
# stays fast and needs no Docker.
LOCALSEND_E2E_DOCKER=1 bun test test/e2e-docker/interop.test.ts
```

The test itself does the whole lifecycle: `docker compose … up -d --build` →
wait for discovery → run the four transfers → `down -v`. First run pays for the
image build (~cold cache minutes); after that the whole suite is ~40s.

To poke at it by hand:

```sh
docker compose -f docker/docker-compose.yml up -d --build
docker compose -f docker/docker-compose.yml logs -f            # watch discovery
docker exec lspeer-a sh -c 'echo hi > /tmp/m.txt'
docker exec lspeer-a bun src/cli.ts send lspeer-b /tmp/m.txt --protocol http
docker exec lspeer-b cat /received/m.txt                       # -> hi
docker compose -f docker/docker-compose.yml down -v
```

Gating: `dockerAvailable()` returns true only when `LOCALSEND_E2E_DOCKER=1`
**and** `docker info` succeeds, so the test is inert in CI/dev unless explicitly
asked for and Docker is actually up.

## Reusing this as a cross-language interop reference

The point is you don't need this repo to be a framework. To check a client you
write in another language against this TS reference:

1. **Vendor** this repo into your project (git submodule / subtree / copy).
2. **Build its peer image** yourself — `docker build -f docker/Dockerfile .` —
   or copy the 10-line Dockerfile. That gives you a known-good LocalSend peer
   you can run as `receive` (server) or `send` (client).
3. **Add your own peer image** for your implementation. It only needs to speak
   the LocalSend v2 HTTP protocol and offer the same tiny CLI surface you want
   to drive: something like `receive --port P --save DIR --autoAccept`,
   `send <host> <file>`. The flags don't have to match ours — your test script
   knows your client's flags.
4. **Write a small test script** (bash or a `bun test` like this one) that runs
   both peers on one network and asserts, in each direction, that a file's
   `sha256` and a text message's content survive the round trip. That matrix
   (TS↔TS baseline, TS↔yours, yours↔TS) is your alignment check — a failure in
   one cell points straight at which side/direction breaks the wire format.

Keep it loose: the harness is just "two containers on a network + sha256
assertions." Clear logic and this doc matter more than a rigid abstraction.

## CLI vs TUI in the container

The automated transfers use the **CLI** because it's deterministic and
exit-coded — the right tool for assertions. The same image _can_ run the **TUI**
(`bun src/cli.ts --tui`), since the optional `@opentui/*` deps install in the
image and Bun provides the FFI the renderer needs. To drive the TUI inside a
container interactively, attach a PTY and use the `shell-use` workflow (see the
`testing-tui-cli` skill) — useful for a human-in-the-loop demo, not for the
automated gate.

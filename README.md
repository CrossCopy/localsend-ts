# localsend-ts

<div align="center">
  <img src="./localsend-ts.jpeg" alt="LocalSend TypeScript Banner" width="80%">
</div>

[![NPM Version](https://img.shields.io/npm/v/localsend)](https://www.npmjs.com/package/localsend)
[![JSR](https://jsr.io/badges/@crosscopy/localsend)](https://jsr.io/@crosscopy/localsend)

> A TypeScirpt implementation of the LocalSend protocol

LocalSend provides a documentation for their protocol at https://github.com/localsend/protocol

Readme to the protocol: https://github.com/localsend/protocol/blob/main/README.md

I've seen some implementations in rust

- https://crates.io/crates/localsend
- https://github.com/tom8zds/localsend_rs

I want to build a LocalSend integration extension for my project https://github.com/kunkunsh/kunkun

So I decided to build a TypeScript implementation of the LocalSend protocol.

## CLI

### Interactive TUI (Recommended)

The TUI is part of the `localsend` CLI — running `localsend` with no subcommand opens the dashboard:

```bash
# Bare command opens the TUI dashboard
localsend
# from source
bun src/cli.ts

# ...or ask for it explicitly, with options
localsend --tui --port 8080 --alias "My Device"
```

`localsend --help` shows the CLI, and `localsend send|receive|discover` run the CLI commands; anything else (bare, or `--tui`) opens the dashboard.

> The TUI needs a runtime with FFI for OpenTUI's native renderer: **Bun** (recommended), or **Node.js ≥ 26.4** started with `--experimental-ffi`. Under an older Node, `localsend --tui` prints how to run it under Bun; the rest of the CLI works on any Node. The JSX is transformed into `dist/cli.js` at build time, so no separate TUI binary ships.

The TUI provides a dashboard interface built with **OpenTUI (Solid.js)**, modeled on the official LocalSend app, featuring:

- **Tab dashboard** - Send / Receive / Settings, switchable with `1`/`2`/`3` or `Tab`
- **Always-on receiver** - discoverable and ready to accept transfers the moment it launches
- **Content-first send** - build a selection (files with `a`, text with `t`), then press `Enter` on a nearby device to send
- **Real-time device scanning** - continuously discover LocalSend devices; `s` rescans, `i` adds a device by IP, `f` toggles a favorite
- **Incoming consent** - each incoming transfer prompts Accept/Decline, with a Quick Save mode (`off`/`favorites`/`on`) to auto-accept
- **Transfer progress** - per-file status, overall progress, speed and ETA, with cancel/retry
- **Persistent settings** - alias, favorites, and Quick Save mode persist across runs

### Simple Interactive CLI

```bash
# Run the basic menu-driven CLI
npm run cli

# With custom settings
npm run cli -- --port 8080 --alias "My Device"
```

Basic menu interface with:

- Device discovery and selection
- Text and file sending
- Receiver mode with graceful shutdown

### Traditional CLI

```bash
npx localsend

# Please use a subcommand: send | receive | discover
# Examples:
#   localsend send 192.168.1.100 ./file.txt
#   localsend receive --saveDir ./downloads
#   localsend discover --timeout 10
```

## Library

```ts
import {
	BunServerAdapter,
	NodeServerAdapter,
	DenoServerAdapter,
	createServerAdapter,
	LocalSendServer,
	LocalSendHonoServer,
	LocalSendClient,
	MulticastDiscovery,
	HttpDiscovery
} from "localsend"

// see ./examples and src/cli.ts for how to use them
```

## Development

```bash
deno -A --unstable-sloppy-imports --unstable-net src/cli.ts receive -=alias deno-client
bun run src/cli.ts receive
```

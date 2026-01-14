# localsend-ts

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

```bash
# Run the sophisticated TUI with real-time device scanning
npm run tui
# or with Bun
bun src/cli-tui.tsx

# With custom port and alias
npm run tui -- --port 8080 --alias "My Device"
```

The TUI provides a sophisticated interface built with **Ink (React for CLI)** featuring:
- **Real-time device scanning** - Continuously discover LocalSend devices
- **Device selection** - Navigate and select from discovered devices
- **Send text messages** - Interactive text input and sending
- **Send files** - File path input with validation
- **Receiver mode** - Real-time file receiving with progress
- **Settings** - Dynamic device configuration

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

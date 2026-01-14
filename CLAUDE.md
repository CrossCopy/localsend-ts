# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a TypeScript implementation of the LocalSend protocol - a cross-platform file sharing solution. The project supports multiple JavaScript runtimes (Node.js, Bun, Deno) and provides both a CLI tool and library for LocalSend integration.

The protocol description can be found at https://github.com/localsend/protocol/blob/main/README.md

## Common Commands

- **Build**: `bun build.ts` - Builds the CLI and generates SDK from OpenAPI spec
- **Format**: `prettier --write .` - Format code with Prettier
- **Dev CLI (Bun)**: `bun run src/cli.ts receive` - Run CLI in development mode with Bun
- **Dev CLI (Deno)**: `deno -A --unstable-sloppy-imports --unstable-net src/cli.ts receive` - Run CLI with Deno

## Project Structure

### Core Architecture
- **Multi-runtime support**: Abstracts server implementations through `ServerAdapter` interface (Bun, Node.js, Deno)
- **Discovery mechanisms**: Two discovery approaches - multicast UDP and HTTP discovery with runtime-specific implementations
- **Protocol implementation**: LocalSend protocol client and server with OpenAPI spec generation

### Key Directories
- `src/api/` - Core server and client implementations, runtime adapters
- `src/discovery/` - Device discovery (multicast UDP, HTTP, runtime detection)
- `src/sdk/` - Auto-generated OpenAPI client (generated during build)
- `examples/` - Usage examples for different runtimes

### Entry Points
- `src/index.ts` - Main library exports
- `src/cli.ts` - CLI implementation using citty
- `build.ts` - Build script that generates SDK and bundles CLI

### Runtime Abstractions
- Server adapters in `src/api/server-adapter.ts` handle Bun/Node/Deno differences
- Discovery uses runtime detection in `src/discovery/runtime.ts` to choose appropriate UDP implementation
- Deno-specific implementations in `src/discovery/deno-udp.ts` and `src/api/deno-client.ts`

## Publishing

The project publishes to both NPM (`localsend`) and JSR (`@crosscopy/localsend`) with separate package configurations.

## Development Notes

- Uses Bun for build tooling but supports all three major JS runtimes
- OpenAPI spec is generated from running Hono server during build
- CLI is bundled to `dist/cli.js` for Node.js execution
- TypeScript with strict mode and modern ESNext target
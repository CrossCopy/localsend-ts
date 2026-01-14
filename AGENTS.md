# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-15
**Commit:** HEAD
**Branch:** main

## OVERVIEW

TypeScript implementation of LocalSend protocol (file sharing over local network). Multi-runtime support (Bun, Node, Deno) with CLI and library interfaces.

## STRUCTURE

```
./
├── src/
│   ├── api/          # HTTP server/client, OpenAPI integration
│   ├── discovery/    # Device discovery (multicast UDP, HTTP)
│   ├── sdk/          # Auto-generated OpenAPI SDK (DO NOT EDIT)
│   ├── utils/        # Device info, file operations
│   ├── cli.ts        # Traditional CLI (send/receive/discover)
│   ├── cli-interactive.ts  # Menu-driven CLI
│   └── cli-tui.tsx   # React Ink TUI (recommended)
├── examples/         # Functional examples + build integration
├── build.ts          # Custom build: spawns hono-receiver to generate SDK
└── dist/             # Build output (generated)
```

## WHERE TO LOOK

| Task             | Location                 | Notes                              |
| ---------------- | ------------------------ | ---------------------------------- |
| Send file        | `src/api/client.ts`      | LocalSendClient.sendFile()         |
| Receive file     | `src/api/server.ts`      | LocalSendServer (vanilla)          |
| Hono server      | `src/api/hono-server.ts` | OpenAPI integration                |
| Discover devices | `src/discovery/*.ts`     | Multicast + HTTP fallback          |
| Build process    | `build.ts`               | Spawns hono-receiver on port 53317 |
| Protocol types   | `src/types.ts`           | Valibot schemas                    |
| CLI entry        | `src/cli.ts`             | Citty framework                    |

## CONVENTIONS

- **Generated code**: `*.gen.ts` files in `src/sdk/` are auto-generated—never edit manually
- **Build dependency**: `examples/hono-receiver.ts` must be on port 53317 during build for OpenAPI generation
- **Dual registry**: Package published to both npm (`localsend`) and JSR (`@crosscopy/localsend`)
- **Examples as tests**: No formal test suite—examples serve as functional integration tests
- **CLI binaries**: Two CLIs bundled—`localsend` (cli.ts) and `localsend-interactive` (cli-interactive.ts)

## ANTI-PATTERNS (THIS PROJECT)

- **DO NOT edit `src/sdk/*.gen.ts`** - Regenerated on every build from OpenAPI spec
- **DO NOT commit to `dist/`** - Build output only
- **DO NOT use semicolons** - Prettier config forbids them
- **DO NOT use trailing commas** - Prettier config forbids them
- **NEVER modify protocol types manually** - Use Valibot schemas in `src/types.ts`

## UNIQUE STYLES

- Build spawns temporary server during build process to generate SDK
- Three CLI interfaces: traditional, interactive, TUI (React Ink)
- Runtime auto-detection for server adapters (Bun/Node/Deno)
- No CI/CD workflows configured (unusual for npm+JSR package)

## COMMANDS

```bash
bun run build          # Generate SDK + bundle CLIs
bun run format         # Prettier (required before commits)
bun run tui            # React Ink TUI (recommended)
bun run cli            # Menu-driven CLI
./dist/cli.js discover --timeout 5
./dist/cli.js receive --saveDir ./downloads
bun examples/basic-sender.ts <ip> <file>
```

## NOTES

- Protocol spec: https://github.com/localsend/protocol/blob/main/README.md
- Multicast address: 224.0.0.167:53317
- Default port: 53317
- Transfer authentication: PIN-based
- No test framework configured (Bun test recommended when adding tests)

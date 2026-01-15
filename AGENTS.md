# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-15
**Commit:** HEAD
**Branch:** main

## OVERVIEW

TypeScript implementation of LocalSend protocol (file sharing over local network). Multi-runtime support (Bun, Node, Deno) with CLI and library interfaces.

## ESSENTIAL COMMANDS

```bash
# Build
bun run build          # Generate SDK + bundle CLIs (spawns hono-receiver on port 53317)
bun run format         # Prettier format (MUST run before commits)

# Type checking
bun run check-types    # TypeScript validation: tsc --noEmit

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
│   ├── api/          # HTTP server/client, OpenAPI integration
│   ├── discovery/    # Device discovery (multicast UDP, HTTP)
│   ├── sdk/          # Auto-generated OpenAPI SDK (DO NOT EDIT)
│   ├── utils/        # Device info, file operations
│   ├── types.ts       # Protocol types via Valibot schemas (source of truth)
│   ├── cli.ts        # Traditional CLI (send/receive/discover)
│   ├── cli-interactive.ts  # Menu-driven CLI
│   ├── cli-tui.tsx   # React Ink TUI (recommended)
│   └── hono-rpc.ts   # Type-safe Hono RPC client
├── examples/         # Functional examples (serve as integration tests)
├── build.ts          # Custom build: spawns hono-receiver to generate SDK
└── dist/             # Build output (generated, never commit)
```

## WHERE TO LOOK

| Task             | Location                 | Notes                              |
| ---------------- | ------------------------ | ---------------------------------- |
| Send file        | `src/api/client.ts`      | LocalSendClient.sendFile()         |
| Receive file     | `src/api/server.ts`      | LocalSendServer (vanilla)          |
| Hono server      | `src/api/hono-server.ts` | OpenAPI integration                |
| RPC client       | `src/hono-rpc.ts`        | Type-safe Hono client              |
| Discover devices | `src/discovery/*.ts`     | Multicast + HTTP fallback          |
| Build process    | `build.ts`               | Spawns hono-receiver on port 53317 |
| Protocol types   | `src/types.ts`           | Valibot schemas (source of truth)  |
| CLI entry        | `src/cli.ts`             | Citty framework                    |

## RUNTIME SUPPORT

- **Bun** - Primary runtime (bun:fs, bun:crypto native APIs)
- **Node.js** - Full support via node:\* imports
- **Deno** - Full support via @hono/node-server adapter
- **Server adapters** - Auto-detect or explicitly: BunServerAdapter, NodeServerAdapter, DenoServerAdapter

## TESTING STRATEGY

**No formal test suite** - Examples serve as functional integration tests. To test a feature:

1. **Create an example** in `examples/` directory
2. **Run directly with Bun** - `bun examples/your-feature.ts [args]`
3. **Manual verification** - Check output/log for expected behavior
4. **Type checking** - Always run `bun run check-types` after changes

For formal tests, Bun test is recommended (project currently uses examples instead).

## PROTOCOL REFERENCE

- **Spec**: https://github.com/localsend/protocol/blob/main/README.md
- **Multicast**: 224.0.0.167:53317
- **Default port**: 53317
- **Authentication**: PIN-based (optional, server-configured)
- **Chunked uploads**: Files >50MB split into 10MB chunks with Content-Range header

# API Module

**Generated:** 2026-01-15

## OVERVIEW

HTTP server and client implementations for LocalSend protocol with multi-runtime support (Bun, Node, Deno).

## WHERE TO LOOK

| Task                | Location                    | Notes                                                   |
| ------------------- | --------------------------- | ------------------------------------------------------- |
| Send files          | `src/api/client.ts`         | LocalSendClient with chunked uploads, progress tracking |
| Vanilla HTTP server | `src/api/server.ts`         | Node.js only, no OpenAPI                                |
| Hono server         | `src/api/hono-server.ts`    | OpenAPI at /docs, recommended                           |
| Runtime adapters    | `src/api/server-adapter.ts` | Bun/Node/Deno abstraction                               |
| Deno client         | `src/api/deno-client.ts`    | @hey-api wrapper for Deno                               |

## KEY EXPORTS

- `LocalSendClient` - File sender with prepare/upload/cancel flow
- `LocalSendServer` - Vanilla Node.js HTTP receiver
- `LocalSendHonoServer` - Hono-based receiver with OpenAPI (preferred)
- `createServerAdapter()` - Runtime auto-detection for HTTP servers

## CONVENTIONS

- **Server choice**: Use LocalSendHonoServer for new implementations (cross-runtime, OpenAPI)
- **Hono routes**: All routes decorated with `describeRoute()` for OpenAPI spec generation
- **Validation**: Request bodies validated via `validator()` with Valibot schemas
- **Chunked uploads**: Files >50MB split into 10MB chunks with Content-Range header
- **PIN auth**: Optional via query param, validated before session creation

## ANTI-PATTERNS

- **DO NOT mix server.ts and hono-server.ts** - Separate implementations, choose one
- **DO NOT use LocalSendServer for new work** - Lacks OpenAPI, Node-only
- **DO NOT skip OpenAPI decorators** - Required for SDK generation in build.ts

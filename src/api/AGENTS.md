# API Module

**Updated:** 2026-07-12

## OVERVIEW

`src/api/*` are thin re-export shims kept for backwards-compatible import paths. The real
implementations live in `src/server/` (Hono server, routes, runtime adapters) and `src/core/`
(client/send, file handling, upload session store). HTTP server and client for the LocalSend
protocol with multi-runtime support (Bun, Node, Deno).

## WHERE TO LOOK

| Task             | Location                                                            | Notes                                                 |
| ---------------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| Send files       | `src/core/send.ts` (re-exported by `src/api/client.ts`)             | LocalSendClient, whole-file upload, progress tracking |
| Hono server      | `src/server/server.ts` (re-exported by `src/api/hono-server.ts`)    | OpenAPI at /docs, recommended                         |
| Hono routes      | `src/server/routes.ts` (re-exported by `src/api/hono-routes.ts`)    | Route handlers + OpenAPI decorators                   |
| Runtime adapters | `src/server/adapters/` (re-exported by `src/api/server-adapter.ts`) | Bun/Node/Deno abstraction                             |

## KEY EXPORTS

- `LocalSendClient` - File sender with prepare/upload/cancel flow
- `LocalSendServer` (aliased as `LocalSendHonoServer`) - Hono-based receiver with OpenAPI
- `createServerAdapter()` - Runtime auto-detection for HTTP servers

## CONVENTIONS

- **Server choice**: `LocalSendServer` (from `src/server/server.ts`) is the only server implementation
- **Hono routes**: All routes decorated with `describeRoute()` for OpenAPI spec generation
- **Validation**: Request bodies validated via `validator()` with Valibot schemas
- **Uploads**: Files are sent as a single whole-file POST (chunking was removed)
- **PIN auth**: Optional via query param, validated before session creation

## ANTI-PATTERNS

- **DO NOT hand-edit `src/api/*.ts`** - They are re-export shims; edit `src/server/` or `src/core/` instead
- **DO NOT skip OpenAPI decorators** - Required for SDK generation in build.ts

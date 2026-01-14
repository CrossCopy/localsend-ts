# UTILS KNOWLEDGE BASE

**Generated:** 2026-01-15

## OVERVIEW

Utility functions for device information, fingerprint generation, and file operations with SHA-256 checksums.

## WHERE TO LOOK

| Task                 | Location              | Notes                                                  |
| -------------------- | --------------------- | ------------------------------------------------------ |
| Get device info      | `src/utils/device.ts` | `getDeviceInfo()` returns DeviceInfo with fingerprint  |
| Generate fingerprint | `src/utils/device.ts` | `generateFingerprint()` creates 32-byte hex ID         |
| File metadata        | `src/utils/file.ts`   | `buildFileMetadataFromPath()` extracts stats + SHA-256 |
| SHA-256 checksum     | `src/utils/file.ts`   | `computeSha256FromFile()` streams large files          |

## CONVENTIONS

- **Node.js only**: Utilities use `node:crypto` and `node:fs` - not cross-runtime compatible
- **Fingerprint persistence**: Each `getDeviceInfo()` call generates a NEW fingerprint (non-persistent)
- **Async file ops**: File metadata functions are async; use `computeSha256FromBytes()` for in-memory data

## ANTI-PATTERNS

- **DO NOT use for large files without streaming**: `computeSha256FromFile()` streams but loads entire file into memory for `buildFileMetadataFromPath()`
- **DO NOT expect fingerprint to persist across restarts**: Fingerprint is regenerated on each call
- **DO NOT use in browser**: Node.js APIs only

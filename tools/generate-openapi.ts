/**
 * Generates the OpenAPI 3.1 spec for the LocalSend HTTP API and writes it to
 * `openapi.json` at the repo root so other languages/tools can generate clients
 * straight from this repository.
 *
 * Runs fully in-process (no server bind, no port 53317) by constructing the Hono
 * app and calling `app.fetch("/openapi")` directly.
 *
 * Usage: `bun run openapi:dump`
 */
import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getDeviceInfo } from "../src/utils/device.ts"
import { LocalSendServer } from "../src/server/server.ts"

const server = new LocalSendServer(
	getDeviceInfo({ alias: "openapi-generator", enableDownloadApi: true }),
	{
		// keep the throwaway receive dir out of the repo
		saveDirectory: join(tmpdir(), "localsend-openapi-generator")
	}
)

const res = await server.app.fetch(new Request("http://localhost/openapi"))
if (!res.ok) {
	console.error(`Failed to generate OpenAPI spec: ${res.status} ${res.statusText}`)
	process.exit(1)
}

const spec = await res.json()
const outPath = join(import.meta.dir, "..", "openapi.json")
// tab indent + trailing newline to match the repo's Prettier config (idempotent output)
writeFileSync(outPath, JSON.stringify(spec, null, "\t") + "\n")
console.log(`Wrote OpenAPI spec to ${outPath}`)

import { createClient } from "@hey-api/openapi-ts"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { $ } from "bun"
const port = 53317

// The TUI (`localsend --tui`) is dynamically imported by src/cli.ts, so cli.js
// bundles the OpenTUI/Solid dashboard. Its JSX is transformed at build time by
// OpenTUI's Solid plugin. The native renderer and its per-platform prebuilds are
// kept external so they resolve at runtime from the installed optional deps
// (importing them is inert; FFI only loads when render() runs under Bun/Node≥26.4).
const tuiExternal = [
	"bun",
	"bun:*",
	"@opentui/core",
	"@opentui/solid",
	"solid-js",
	"solid-js/store",
	"solid-js/web",
	"@opentui/core-darwin-arm64",
	"@opentui/core-darwin-x64",
	"@opentui/core-linux-x64",
	"@opentui/core-linux-arm64",
	"@opentui/core-win32-x64",
	"@opentui/core-win32-arm64",
	"@opentui/core-linux-x64-musl",
	"@opentui/core-linux-arm64-musl"
]

const proc = Bun.spawn(["bun", "./examples/hono-receiver.ts"], {
	// cwd: ".",
	env: {
		PORT: port.toString(),
		...process.env
	}
})
// sleep for 1 second
await new Promise((resolve) => setTimeout(resolve, 1000))
try {
	await createClient({
		input: `http://localhost:${port}/openapi`,
		output: "src/sdk",
		plugins: ["@hey-api/client-fetch"]
	})
} catch (error) {
	console.error(error)
} finally {
	await proc.kill()
}
await $`rm -rf ./dist`
await Bun.build({
	entrypoints: ["./src/cli.ts", "./src/cli-interactive.ts"],
	target: "node",
	outdir: "./dist",
	minify: true,
	format: "esm",
	plugins: [createSolidTransformPlugin()],
	external: ["node:*", ...tuiExternal]
})
// Make the CLIs executable
await $`chmod +x ./dist/cli.js ./dist/cli-interactive.js`
console.log("Made CLIs executable: chmod +x ./dist/cli.js ./dist/cli-interactive.js")

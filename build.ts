import { createClient } from "@hey-api/openapi-ts"
import { $ } from "bun"
const port = 53317

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
	entrypoints: ["./src/cli.ts"],
	target: "node",
	outdir: "./dist",
	minify: true
})
// Make the CLI executable
await $`chmod +x ./dist/cli.js`
console.log("Made CLI executable: chmod +x ./dist/cli.js")

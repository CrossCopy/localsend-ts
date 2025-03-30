import { createClient } from "@hey-api/openapi-ts"

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

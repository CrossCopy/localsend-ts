import { createClient } from "@hey-api/openapi-ts"

const proc = Bun.spawn(["bun", "./examples/hono-receiver.ts"], {
	// cwd: ".",
	env: {
		PORT: "1566",
		...process.env
	}
})
// sleep for 1 second
await new Promise((resolve) => setTimeout(resolve, 1000))
try {
	await createClient({
		input: "http://localhost:1566/openapi",
		output: "src/sdk",
		plugins: ["@hey-api/client-fetch"]
	})
} catch (error) {
	console.error(error)
} finally {
	await proc.kill()
}

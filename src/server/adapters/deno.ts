import type { ServerAdapter } from "./types.ts"

/**
 * Deno Server Adapter that uses Deno's Serve API
 */
export class DenoServerAdapter implements ServerAdapter {
	async start(options: {
		port: number
		fetch: Function
		maxRequestBodySize?: number
	}): Promise<unknown> {
		try {
			// Check if we're running in Deno
			// @ts-ignore - Deno global is not recognized in non-Deno environments
			if (typeof globalThis.Deno !== "undefined") {
				// @ts-ignore - Deno specific API
				const server = globalThis.Deno.serve({
					port: options.port,
					handler: options.fetch as any
					// Note: maxRequestBodySize is not directly supported in Deno
					// body size limits should be handled by Hono middleware
				})
				return server
			}
			throw new Error("Not running in Deno environment")
		} catch (error) {
			console.error("Error starting Deno server:", error)
			throw error
		}
	}

	async stop(server: unknown): Promise<void> {
		if (server && typeof (server as any).shutdown === "function") {
			await (server as any).shutdown()
		}
	}
}

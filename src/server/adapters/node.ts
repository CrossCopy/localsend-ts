import type { ServerAdapter } from "./types.ts"

/**
 * Node.js Server Adapter that uses @hono/node-server
 */
export class NodeServerAdapter implements ServerAdapter {
	async start(options: {
		port: number
		fetch: Function
		maxRequestBodySize?: number
		tls?: { cert: string; key: string }
	}): Promise<unknown> {
		try {
			// Dynamically import to avoid issues when running in Bun or Deno
			const { serve } = await import("@hono/node-server")

			// Note: maxRequestBodySize is not directly supported in the Node adapter,
			// body size limits should be handled by Hono middleware instead
			const serveOptions: any = { port: options.port, fetch: options.fetch as any }
			if (options.tls) {
				const { createServer } = await import("node:https")
				serveOptions.createServer = createServer
				serveOptions.serverOptions = { key: options.tls.key, cert: options.tls.cert }
			}
			return serve(serveOptions)
		} catch (error) {
			console.error("Error starting Node server:", error)
			throw error
		}
	}

	async stop(server: unknown): Promise<void> {
		if (server && typeof (server as any).close === "function") {
			;(server as any).close()
		}
	}
}

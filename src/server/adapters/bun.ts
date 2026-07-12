import type { ServerAdapter } from "./types.ts"

/**
 * Bun Server Adapter that uses Bun's native HTTP server
 */
export class BunServerAdapter implements ServerAdapter {
	async start(options: {
		port: number
		fetch: Function
		maxRequestBodySize?: number
		tls?: { cert: string; key: string }
	}): Promise<unknown> {
		try {
			const config: any = {
				port: options.port,
				fetch: options.fetch as any,
				// Set a high max request body size to handle large files
				// Default to 1GB if not specified
				maxRequestBodySize: options.maxRequestBodySize || 1024 * 1024 * 1024
			}
			if (options.tls) {
				config.tls = { cert: options.tls.cert, key: options.tls.key }
			}
			// @ts-ignore - Bun specific API
			return Bun.serve(config)
		} catch (error) {
			console.error("Error starting Bun server:", error)
			throw error
		}
	}

	async stop(server: unknown): Promise<void> {
		if (server && typeof (server as any).stop === "function") {
			;(server as any).stop()
		}
	}
}

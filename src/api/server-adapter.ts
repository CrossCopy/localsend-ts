import { Hono } from "hono"

/**
 * Server adapter interface that abstracts the underlying HTTP server implementation
 */
export interface ServerAdapter {
	start(options: { port: number; fetch: Function }): Promise<unknown>
	stop(server: unknown): Promise<void>
}

/**
 * Bun Server Adapter that uses Bun's native HTTP server
 */
export class BunServerAdapter implements ServerAdapter {
	async start(options: { port: number; fetch: Function }): Promise<unknown> {
		try {
			// @ts-ignore - Bun specific API
			return Bun.serve({
				port: options.port,
				fetch: options.fetch as any
			})
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

/**
 * Node.js Server Adapter that uses @hono/node-server
 */
export class NodeServerAdapter implements ServerAdapter {
	async start(options: { port: number; fetch: Function }): Promise<unknown> {
		try {
			// Dynamically import to avoid issues when running in Bun or Deno
			const { serve } = await import("@hono/node-server")
			return serve({
				port: options.port,
				fetch: options.fetch as any
			})
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

/**
 * Deno Server Adapter that uses Deno's Serve API
 */
export class DenoServerAdapter implements ServerAdapter {
	async start(options: { port: number; fetch: Function }): Promise<unknown> {
		try {
			// Check if we're running in Deno
			// @ts-ignore - Deno global is not recognized in non-Deno environments
			if (typeof globalThis.Deno !== "undefined") {
				// @ts-ignore - Deno specific API
				const server = globalThis.Deno.serve({
					port: options.port,
					handler: options.fetch as any
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

/**
 * Factory function to create an appropriate server adapter based on the detected runtime
 */
export function createServerAdapter(): ServerAdapter {
	// Check if running in Bun
	// @ts-ignore - Bun global is not recognized in non-Bun environments
	if (typeof globalThis.Bun !== "undefined") {
		console.log("Using Bun server adapter")
		return new BunServerAdapter()
	}

	// Check if running in Deno
	// @ts-ignore - Deno global is not recognized in non-Deno environments
	if (typeof globalThis.Deno !== "undefined") {
		console.log("Using Deno server adapter")
		return new DenoServerAdapter()
	}

	// Default to Node.js
	console.log("Using Node.js server adapter")
	return new NodeServerAdapter()
}

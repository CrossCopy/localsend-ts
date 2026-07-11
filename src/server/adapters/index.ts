import type { ServerAdapter } from "./types.ts"
import { BunServerAdapter } from "./bun.ts"
import { NodeServerAdapter } from "./node.ts"
import { DenoServerAdapter } from "./deno.ts"

export type { ServerAdapter } from "./types.ts"
export { BunServerAdapter } from "./bun.ts"
export { NodeServerAdapter } from "./node.ts"
export { DenoServerAdapter } from "./deno.ts"

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

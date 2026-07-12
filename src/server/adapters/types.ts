/**
 * Server adapter interface that abstracts the underlying HTTP server implementation
 */
export interface ServerAdapter {
	start(options: {
		port: number
		fetch: Function
		maxRequestBodySize?: number
		tls?: { cert: string; key: string }
	}): Promise<unknown>
	stop(server: unknown): Promise<void>
}

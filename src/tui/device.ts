import { getDeviceInfo } from "../index.ts"
import type { DeviceInfo } from "../index.ts"

/** Startup options for the OpenTUI dashboard, threaded from the CLI. */
export interface TuiOptions {
	alias?: string
	port?: number
	saveDir?: string
	/** Serve/advertise over HTTPS. Defaults to true to match the official app. */
	https?: boolean
}

/**
 * Build the TUI's own device identity from CLI options.
 *
 * Defaults to HTTPS to match the official LocalSend app (which serves HTTPS with
 * a self-signed cert pinned by fingerprint). Pass `https: false` — the CLI's
 * `--no-https` flag — for plain-HTTP interop or testing against HTTP-only peers.
 */
export function buildTuiDeviceInfo(opts: TuiOptions): DeviceInfo {
	const alias = opts.alias || `LocalSend TUI ${Math.floor(100 + Math.random() * 900)}`
	return getDeviceInfo({
		alias,
		port: opts.port,
		useHttps: opts.https ?? true,
		enableDownloadApi: false
	})
}

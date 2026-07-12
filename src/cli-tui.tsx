#!/usr/bin/env bun
import { render } from "@opentui/solid"
import { getDeviceInfo } from "./index.ts"
import { createTuiStore } from "./tui/store.ts"
import { App } from "./tui/App.tsx"

export interface TuiOptions {
	alias?: string
	port?: number
}

/** Build the store and render the OpenTUI dashboard. Called by `localsend` (no
 *  subcommand) and `localsend --tui`; needs a runtime with FFI (Bun / Node ≥26.4). */
export function runTui(opts: TuiOptions = {}): void {
	const alias = opts.alias || `LocalSend TUI ${Math.floor(100 + Math.random() * 900)}`
	const deviceInfo = getDeviceInfo({ alias, port: opts.port, enableDownloadApi: false })
	const store = createTuiStore(deviceInfo)
	render(() => <App store={store} />, { exitOnCtrlC: true })
}

// Allow running the TUI directly: `bun src/cli-tui.tsx`
if (import.meta.main) {
	runTui()
}

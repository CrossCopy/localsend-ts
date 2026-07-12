#!/usr/bin/env bun
import { render } from "@opentui/solid"
import { createTuiStore } from "./tui/store.ts"
import { App } from "./tui/App.tsx"
import { buildTuiDeviceInfo, type TuiOptions } from "./tui/device.ts"

export type { TuiOptions }

/** Build the store and render the OpenTUI dashboard. Called by `localsend` (no
 *  subcommand) and `localsend --tui`; needs a runtime with FFI (Bun / Node ≥26.4). */
export function runTui(opts: TuiOptions = {}): void {
	const deviceInfo = buildTuiDeviceInfo(opts)
	const store = createTuiStore(deviceInfo, undefined, { saveDir: opts.saveDir })
	render(() => <App store={store} />, { exitOnCtrlC: true })
}

// Allow running the TUI directly: `bun src/cli-tui.tsx`
if (import.meta.main) {
	runTui()
}

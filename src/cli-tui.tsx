#!/usr/bin/env bun
import { render } from "@opentui/solid"
import { defineCommand, runMain } from "citty"
import { getDeviceInfo } from "./index.ts"
import { createTuiStore } from "./tui/store.ts"
import { App } from "./tui/App.tsx"

const main = defineCommand({
	meta: {
		name: "localsend-tui",
		version: "0.1.0",
		description: "LocalSend Interactive TUI (OpenTUI + Solid)"
	},
	args: {
		port: {
			type: "string",
			description: "Custom port number"
		},
		alias: {
			type: "string",
			description: "Custom device alias"
		}
	},
	async run({ args }) {
		const portString = args.port as string | undefined
		const port = portString ? parseInt(portString, 10) : undefined
		const alias =
			(args.alias as string | undefined) || `LocalSend TUI ${Math.floor(100 + Math.random() * 900)}`
		const deviceInfo = getDeviceInfo({ alias, port, enableDownloadApi: false })
		const store = createTuiStore(deviceInfo)
		render(() => <App store={store} />, { exitOnCtrlC: true })
	}
})

runMain(main)

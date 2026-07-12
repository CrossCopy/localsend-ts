#!/usr/bin/env bun
import { render, useKeyboard, useRenderer } from "@opentui/solid"

const App = () => {
	const renderer = useRenderer()
	useKeyboard((key) => {
		if (key.name === "q" || key.name === "escape") {
			renderer.destroy()
			process.exit(0)
		}
	})
	return (
		<box flexDirection="column" padding={1}>
			<text fg="#00FFFF">
				<b>🌐 LocalSend TUI</b>
			</text>
			<text fg="#808080">OpenTUI migration in progress — press q to quit</text>
		</box>
	)
}

render(() => <App />)

import { Match, Show, Switch, onCleanup, onMount } from "solid-js"
import { useKeyboard, useRenderer } from "@opentui/solid"
import type { KeyEvent } from "@opentui/core"
import { colors } from "./theme.ts"
import type { TuiStore } from "./store.ts"
import {
	HintBar,
	IncomingModal,
	ReceiveTab,
	SendTab,
	SettingsTab,
	StatusBar,
	TabBar,
	TransferOverlay
} from "./components.tsx"

const hintFor = (store: TuiStore): string => {
	if (store.state.incomingRequest) return "Y accept · N decline"
	if (store.state.session) {
		const settled =
			store.state.session.status !== "sending" && store.state.session.status !== "waiting"
		return settled ? "Enter/Esc close · r retry failed" : "c cancel"
	}
	if (store.state.inputMode) return "Enter confirm · Esc cancel"
	if (store.state.tab === "send") {
		return store.state.focusedPane === "selection"
			? "j/k move · a add file · t text · d remove · x clear · Tab → devices"
			: "j/k move · Enter send · s rescan · i manual IP · f favorite · Tab → selection"
	}
	if (store.state.tab === "receive") return "Q cycle quick-save"
	return "Tab/1-3 switch tabs · ? help · q quit"
}

export const App = (props: { store: TuiStore }) => {
	const store = props.store
	const renderer = useRenderer()

	const exit = () => {
		void store.cleanup().finally(() => {
			renderer.destroy()
			process.exit(0)
		})
	}

	onMount(() => {
		void store.boot()
	})
	onCleanup(() => {
		void store.cleanup()
	})

	useKeyboard((key: KeyEvent) => {
		// 1. Incoming consent modal owns all keys
		if (store.state.incomingRequest) {
			if (key.name === "y") store.acceptIncoming()
			else if (key.name === "n" || key.name === "escape") store.declineIncoming()
			return
		}

		// 2. Transfer overlay. A bare Escape lags ~1s in terminals without the kitty
		// keyboard protocol, so once the transfer settles allow Enter/q to dismiss too.
		if (store.state.session) {
			const settled =
				store.state.session.status !== "sending" && store.state.session.status !== "waiting"
			if (key.name === "c") store.cancelSession()
			else if (key.name === "r") void store.retryFailed()
			else if (key.name === "escape") {
				// Only tear down a settled session. Mid-transfer, Escape cancels instead —
				// closing would null `session` while runSendQueue still reads it (crash).
				if (settled) store.closeSession()
				else store.cancelSession()
			} else if (settled && (key.name === "return" || key.name === "q")) {
				store.closeSession()
			}
			return
		}

		// 3. An inline input is focused — it owns typing; we only handle Escape
		if (store.state.inputMode) {
			if (key.name === "escape") store.closeInput()
			return
		}

		// 4. Global keys — plain `q` quits, but Shift+Q (sequence "Q") is reserved
		// for the Receive tab's quick-save toggle, so let it fall through.
		if (key.name === "q" && !key.shift && key.sequence !== "Q") {
			exit()
			return
		}
		if (key.name === "tab") {
			// Tab switches panes on the send tab, otherwise cycles tabs
			if (store.state.tab === "send") store.togglePane()
			else store.cycleTab(key.shift ? -1 : 1)
			return
		}
		if (key.name === "1") return store.setTab("send")
		if (key.name === "2") return store.setTab("receive")
		if (key.name === "3") return store.setTab("settings")

		// 5. Tab-specific keys
		if (store.state.tab === "send") return handleSendKeys(store, key)
		if (store.state.tab === "receive") {
			if (key.name === "q" || key.name === "Q" || key.sequence === "Q") store.cycleQuickSave()
			return
		}
	})

	return (
		<box flexDirection="column" width="100%" height="100%">
			<TabBar store={store} />
			<box flexGrow={1} flexDirection="column">
				<Switch>
					<Match when={store.state.tab === "send"}>
						<SendTab store={store} />
					</Match>
					<Match when={store.state.tab === "receive"}>
						<ReceiveTab store={store} />
					</Match>
					<Match when={store.state.tab === "settings"}>
						<SettingsTab store={store} />
					</Match>
				</Switch>
			</box>
			<StatusBar store={store} />
			<HintBar text={hintFor(store)} />
			<Show when={store.state.session} fallback={<box />}>
				<TransferOverlay store={store} />
			</Show>
			<Show when={store.state.incomingRequest} fallback={<box />}>
				<IncomingModal store={store} />
			</Show>
		</box>
	)
}

function handleSendKeys(store: TuiStore, key: KeyEvent) {
	if (store.state.focusedPane === "selection") {
		if (key.name === "j" || key.name === "down") store.moveSelection(1)
		else if (key.name === "k" || key.name === "up") store.moveSelection(-1)
		else if (key.name === "a") store.openInput("add-path")
		else if (key.name === "t") store.openInput("compose-text")
		else if (key.name === "d") store.removeSelectionItem(store.state.selectionIndex)
		else if (key.name === "x") store.clearSelection()
		else if (key.name === "right") store.setPane("devices")
	} else {
		if (key.name === "j" || key.name === "down") store.moveDevice(1)
		else if (key.name === "k" || key.name === "up") store.moveDevice(-1)
		else if (key.name === "return") {
			const device = store.selectedDevice()
			if (device) void store.sendToDevice(device)
			else store.setStatus("No device selected", "error")
		} else if (key.name === "s") void store.rescan()
		else if (key.name === "i") store.openInput("manual-ip")
		else if (key.name === "f") store.toggleFavorite()
		else if (key.name === "left") store.setPane("selection")
	}
}

// re-export for convenience
export { colors }

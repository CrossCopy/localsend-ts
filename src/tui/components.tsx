import { For, Show } from "solid-js"
import prettyBytes from "pretty-bytes"
import { createTextAttributes } from "@opentui/core"
import { colors, formatEta, progressBar } from "./theme.ts"
import {
	deviceGlyph,
	selectionTotalBytes,
	visualId,
	type Session,
	type SessionFile,
	type TuiStore
} from "./store.ts"

const BOLD = createTextAttributes({ bold: true })

const fileStatusGlyph: Record<SessionFile["status"], string> = {
	queued: "⏳",
	sending: "▸",
	done: "✓",
	failed: "✗",
	skipped: "↷"
}

// ── Top tab bar ──

export const TabBar = (props: { store: TuiStore }) => {
	const tabs: Array<{ key: string; id: "send" | "receive" | "settings"; label: string }> = [
		{ key: "1", id: "send", label: "Send" },
		{ key: "2", id: "receive", label: "Receive" },
		{ key: "3", id: "settings", label: "Settings" }
	]
	return (
		<box flexDirection="row" paddingLeft={1} paddingRight={1} gap={1}>
			<text fg={colors.accent} attributes={BOLD}>
				LocalSend
			</text>
			<For each={tabs}>
				{(tab) => (
					<text
						fg={props.store.state.tab === tab.id ? colors.black : colors.gray}
						bg={props.store.state.tab === tab.id ? colors.accent : undefined}
					>
						{` ${tab.key} ${tab.label} `}
					</text>
				)}
			</For>
		</box>
	)
}

// ── Bottom status + hint bars ──

export const StatusBar = (props: { store: TuiStore }) => {
	const s = () => props.store.state
	const statusColor = () =>
		s().statusLevel === "error"
			? colors.red
			: s().statusLevel === "success"
				? colors.green
				: colors.yellow
	return (
		<box
			flexDirection="column"
			borderStyle="single"
			border={true}
			borderColor={colors.panelBorder}
			paddingLeft={1}
			paddingRight={1}
		>
			<box flexDirection="row">
				<text fg={colors.white}>{s().settings.alias}</text>
				<text fg={colors.dim}>{` #${visualId(props.store.deviceInfo.fingerprint)}`}</text>
				<text fg={colors.dim}>{` · :${s().settings.port} · `}</text>
				<text fg={s().serverRunning ? colors.green : colors.red}>
					{s().serverRunning ? "● receiving" : "○ offline"}
				</text>
				<text
					fg={colors.dim}
				>{` · ${s().devices.length} devices · quicksave:${s().quickSave}`}</text>
			</box>
			<Show when={s().statusMessage} fallback={<box />}>
				<text fg={statusColor()}>{s().statusMessage}</text>
			</Show>
		</box>
	)
}

export const HintBar = (props: { text: string }) => (
	<box paddingLeft={1}>
		<text fg={colors.dim}>{props.text}</text>
	</box>
)

// ── Inline input row ──

const InlineInput = (props: {
	label: string
	placeholder: string
	onSubmit: (value: string) => void
}) => (
	<box flexDirection="row" marginTop={1}>
		<text fg={colors.yellow}>{`${props.label} `}</text>
		<input
			focused={true}
			placeholder={props.placeholder}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- InputProps.onSubmit is an intersection of two signatures
			onSubmit={((value: string) => props.onSubmit(value)) as any}
			flexGrow={1}
			backgroundColor={colors.panel}
			focusedBackgroundColor={colors.panel}
			textColor={colors.white}
			cursorColor={colors.accent}
		/>
	</box>
)

// ── Send tab ──

const SelectionPane = (props: { store: TuiStore }) => {
	const store = props.store
	const focused = () => store.state.focusedPane === "selection"
	return (
		<box
			flexDirection="column"
			flexGrow={1}
			borderStyle="single"
			border={true}
			borderColor={focused() ? colors.focusBorder : colors.panelBorder}
			title=" Selection "
			paddingLeft={1}
			paddingRight={1}
		>
			<text fg={colors.dim}>
				{`${store.state.selection.length} item${
					store.state.selection.length === 1 ? "" : "s"
				} · ${prettyBytes(selectionTotalBytes(store.state.selection))}`}
			</text>
			<Show
				when={store.state.selection.length > 0}
				fallback={
					<box marginTop={1}>
						<text fg={colors.dim}>Nothing selected. Press a to add a file, t to write text.</text>
					</box>
				}
			>
				<For each={store.state.selection}>
					{(item, index) => {
						const sel = () => focused() && store.state.selectionIndex === index()
						const label =
							item.kind === "file"
								? `${item.name}  ${prettyBytes(item.size)}`
								: `✎ "${item.content.slice(0, 30)}${item.content.length > 30 ? "…" : ""}"`
						return (
							<text fg={sel() ? colors.black : colors.white} bg={sel() ? colors.accent : undefined}>
								{(sel() ? "▶ " : "  ") + label}
							</text>
						)
					}}
				</For>
			</Show>
			<Show when={store.state.inputMode === "add-path"} fallback={<box />}>
				<InlineInput
					label="path:"
					placeholder="/absolute/path/to/file"
					onSubmit={(v) => void store.submitInput(v)}
				/>
			</Show>
			<Show when={store.state.inputMode === "compose-text"} fallback={<box />}>
				<InlineInput
					label="text:"
					placeholder="Type a message…"
					onSubmit={(v) => void store.submitInput(v)}
				/>
			</Show>
		</box>
	)
}

const DevicesPane = (props: { store: TuiStore }) => {
	const store = props.store
	const focused = () => store.state.focusedPane === "devices"
	return (
		<box
			flexDirection="column"
			flexGrow={1}
			borderStyle="single"
			border={true}
			borderColor={focused() ? colors.focusBorder : colors.panelBorder}
			title={` Nearby devices (${store.state.devices.length}) ${
				store.state.scanState === "scanning" ? "· scanning…" : ""
			}`}
			paddingLeft={1}
			paddingRight={1}
		>
			<Show
				when={store.state.devices.length > 0}
				fallback={
					<box marginTop={1}>
						<text fg={colors.dim}>No devices found. Press s to rescan, i to enter an IP.</text>
					</box>
				}
			>
				<For each={store.state.devices}>
					{(device, index) => {
						const sel = () => focused() && store.state.deviceIndex === index()
						const star = store.isFavorite(device.fingerprint) ? " ★" : ""
						const label = `${deviceGlyph(device.deviceType)} ${device.alias}  ${device.ip}:${device.port}${star}`
						return (
							<text fg={sel() ? colors.black : colors.white} bg={sel() ? colors.accent : undefined}>
								{(sel() ? "▶ " : "  ") + label}
							</text>
						)
					}}
				</For>
			</Show>
			<Show when={store.state.inputMode === "manual-ip"} fallback={<box />}>
				<InlineInput
					label="addr:"
					placeholder="192.168.1.5 or 192.168.1.5:53317"
					onSubmit={(v) => void store.submitInput(v)}
				/>
			</Show>
		</box>
	)
}

export const SendTab = (props: { store: TuiStore }) => (
	<box flexDirection="row" flexGrow={1} gap={1} paddingLeft={1} paddingRight={1}>
		<SelectionPane store={props.store} />
		<DevicesPane store={props.store} />
	</box>
)

// ── Receive tab ──

export const ReceiveTab = (props: { store: TuiStore }) => {
	const s = () => props.store.state
	const modes: Array<"off" | "favorites" | "on"> = ["off", "favorites", "on"]
	return (
		<box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1} gap={1}>
			<box
				flexDirection="column"
				borderStyle="rounded"
				border={true}
				borderColor={colors.panelBorder}
				title=" You are visible as "
				paddingLeft={1}
				paddingRight={1}
			>
				<text fg={colors.accent} attributes={BOLD}>
					{s().settings.alias}
				</text>
				<text fg={colors.dim}>
					{`#${visualId(props.store.deviceInfo.fingerprint)} · port ${s().settings.port} · ${
						s().settings.protocol
					} · ${s().serverRunning ? "listening" : "offline"}`}
				</text>
				<box flexDirection="row" marginTop={1} gap={1}>
					<text fg={colors.white}>Quick Save:</text>
					<For each={modes}>
						{(mode) => (
							<text
								fg={s().quickSave === mode ? colors.black : colors.gray}
								bg={s().quickSave === mode ? colors.accent : undefined}
							>
								{` ${mode} `}
							</text>
						)}
					</For>
				</box>
			</box>
			<box
				flexDirection="column"
				flexGrow={1}
				borderStyle="single"
				border={true}
				borderColor={colors.panelBorder}
				title=" Recent receives "
				paddingLeft={1}
				paddingRight={1}
			>
				<Show
					when={s().recentReceives.length > 0}
					fallback={<text fg={colors.dim}>Nothing received yet.</text>}
				>
					<For each={s().recentReceives.slice(0, 8)}>
						{(file) => (
							<box flexDirection="row">
								<text fg={colors.dim}>{`${file.time} `}</text>
								<text fg={colors.white}>{`${file.fileName} `}</text>
								<text fg={colors.dim}>{`${prettyBytes(file.size)} from ${file.from}`}</text>
							</box>
						)}
					</For>
				</Show>
			</box>
		</box>
	)
}

// ── Settings tab ──

export const SettingsTab = (props: { store: TuiStore }) => {
	const s = () => props.store.state.settings
	const row = (label: string, value: string) => (
		<box flexDirection="row">
			<text fg={colors.dim}>{label.padEnd(10)}</text>
			<text fg={colors.white}>{value}</text>
		</box>
	)
	return (
		<box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2} gap={1}>
			<text fg={colors.yellow} attributes={BOLD}>
				Settings
			</text>
			{row("Alias:", s().alias)}
			{row("Port:", String(s().port))}
			{row("Save dir:", s().saveDir)}
			{row("Protocol:", s().protocol)}
			<text fg={colors.dim}>
				Set these with --alias / --port / --save-dir. Favorites and Quick Save persist.
			</text>
		</box>
	)
}

// ── Transfer overlay ──

const sessionTitle = (session: Session | null): string => {
	if (!session) return " Transfer "
	const verb = session.direction === "send" ? "Sending to" : "Receiving from"
	return ` ${verb} ${session.peer.alias} `
}

const statusLine = (session: Session | null): { text: string; color: string } => {
	switch (session?.status) {
		case "waiting":
			return { text: "waiting for recipient…", color: colors.yellow }
		case "sending":
			return { text: session.direction === "send" ? "sending…" : "receiving…", color: colors.cyan }
		case "finished":
			return { text: "complete", color: colors.green }
		case "finishedWithErrors":
			return { text: "finished with errors", color: colors.red }
		case "declined":
			return { text: "declined by recipient", color: colors.red }
		case "canceledBySender":
			return { text: "canceled", color: colors.red }
		case "canceledByReceiver":
			return { text: "canceled by recipient", color: colors.red }
		default:
			return { text: "", color: colors.dim }
	}
}

const fileColor = (status: SessionFile["status"]): string =>
	status === "done" ? colors.green : status === "failed" ? colors.red : colors.white

// Null-safe: element children of <Show> evaluate eagerly, so every accessor
// here must tolerate a null session (rendered but hidden until one exists).
export const TransferOverlay = (props: { store: TuiStore }) => {
	const session = () => props.store.state.session
	const files = () => session()?.files ?? []
	const doneFiles = () => files().filter((f) => f.status === "done").length
	const totalBytes = () => files().reduce((a, f) => a + f.size, 0)
	const sentBytes = () =>
		files().reduce((a, f) => a + (f.status === "done" ? f.size : f.received), 0)
	const eta = () => {
		const speed = session()?.speed ?? 0
		const remaining = totalBytes() - sentBytes()
		return speed > 0 ? formatEta(remaining / speed) : "—"
	}
	const status = () => session()?.status
	const active = () => status() === "sending" || status() === "waiting"
	return (
		<Overlay>
			<box
				flexDirection="column"
				borderStyle="rounded"
				border={true}
				borderColor={colors.accent}
				title={sessionTitle(session())}
				paddingLeft={1}
				paddingRight={1}
				width={60}
			>
				<text fg={statusLine(session()).color}>{`status: ${statusLine(session()).text}`}</text>
				<box flexDirection="column" marginTop={1}>
					<For each={files()}>
						{(file) => (
							<box flexDirection="row">
								<text fg={fileColor(file.status)}>
									{`${fileStatusGlyph[file.status]} ${file.name}`}
								</text>
								<text fg={colors.dim}>{` ${prettyBytes(file.size)}`}</text>
								<Show when={file.status === "sending" && file.size > 0} fallback={<box />}>
									<text fg={colors.cyan}>{` ${progressBar(file.received / file.size, 12)}`}</text>
								</Show>
							</box>
						)}
					</For>
				</box>
				<box marginTop={1}>
					<text fg={colors.dim}>
						{`Files ${doneFiles()}/${files().length} · ${prettyBytes(sentBytes())}/${prettyBytes(
							totalBytes()
						)}${
							session()?.direction === "receive" || (session()?.speed ?? 0) > 0
								? ` · ${prettyBytes(session()?.speed ?? 0)}/s · ETA ${eta()}`
								: ""
						}`}
					</text>
				</box>
				<box marginTop={1}>
					<text fg={colors.dim}>
						{active()
							? "c cancel · Esc close"
							: status() === "finishedWithErrors"
								? "r retry failed · Enter/Esc close"
								: "Enter/Esc close"}
					</text>
				</box>
			</box>
		</Overlay>
	)
}

// ── Incoming consent modal ──

export const IncomingModal = (props: { store: TuiStore }) => {
	const req = () => props.store.state.incomingRequest
	const reqFiles = () => req()?.files ?? []
	const totalBytes = () => reqFiles().reduce((a, f) => a + f.size, 0)
	return (
		<Overlay>
			<box
				flexDirection="column"
				borderStyle="rounded"
				border={true}
				borderColor={colors.yellow}
				title={` Incoming from ${req()?.sender.alias ?? ""} `}
				paddingLeft={1}
				paddingRight={1}
				width={58}
			>
				<text fg={colors.dim}>
					{`${deviceGlyph(req()?.sender.deviceType)} ${req()?.sender.ip ?? ""} · #${visualId(
						req()?.sender.fingerprint ?? ""
					)}`}
				</text>
				<Show
					when={req()?.isMessage}
					fallback={
						<box flexDirection="column" marginTop={1}>
							<text fg={colors.white}>
								{`wants to send ${reqFiles().length} file${
									reqFiles().length === 1 ? "" : "s"
								} (${prettyBytes(totalBytes())})`}
							</text>
							<For each={reqFiles()}>
								{(file) => (
									<box flexDirection="row">
										<text fg={colors.white}>{`• ${file.name} `}</text>
										<text fg={colors.dim}>{prettyBytes(file.size)}</text>
									</box>
								)}
							</For>
						</box>
					}
				>
					<box flexDirection="column" marginTop={1}>
						<text fg={colors.dim}>sent a message:</text>
						<text fg={colors.white}>{req()?.message ?? ""}</text>
					</box>
				</Show>
				<box flexDirection="row" marginTop={1} gap={1}>
					<text fg={colors.green}>Y accept</text>
					<text fg={colors.dim}>·</text>
					<text fg={colors.red}>N decline</text>
				</box>
			</box>
		</Overlay>
	)
}

// ── Full-screen overlay wrapper ──

const Overlay = (props: { children: any }) => (
	<box
		position="absolute"
		top={0}
		left={0}
		width="100%"
		height="100%"
		flexDirection="column"
		alignItems="center"
		justifyContent="center"
		backgroundColor={colors.black}
		zIndex={100}
	>
		{props.children}
	</box>
)

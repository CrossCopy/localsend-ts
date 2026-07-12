# LocalSend TUI — UX Design (OpenTUI Solid)

Companion to [2026-07-12-tui-opentui-migration.md](./2026-07-12-tui-opentui-migration.md). That plan ports the old Ink TUI 1:1; this document redesigns the UX based on the official LocalSend app's interaction model (studied from `~/Dev/others/localsend/app/lib` and the localsend/localsend DeepWiki), **adapted for the terminal rather than copied**.

## 1. What the official GUI does (research summary)

Three tabs (`home_page.dart`): **Receive / Send / Settings**.

- **Receive tab** (`tabs/receive_tab.dart`): identity card — big alias, `#visualId` per network interface, port; a spinning logo while the server runs (the receive server is **always on**, the tab just shows identity); a **Quick Save** segmented control (`off / favorites / on` = auto-accept incoming); corner buttons for **History** and an info card.
- **Send tab** (`tabs/send_tab.dart`): **content-first** — pick _what_ (file / folder / text / clipboard via `BigButton` grid, collapsing into a summary card with count + total size + edit), _then_ pick _who_ from a **live nearby-devices list** (`DeviceListTile`: device-type icon, alias, IP, ★ favorite toggle). Header actions: **rescan** (spinning sync icon), **manual IP** (`AddressInputDialog`, accepts `#visualId` or raw IP), **favorites** dialog, send-mode (single/multiple/link).
- **Send session** (`send_page.dart`): after tapping a device — "waiting for recipient to accept" with Cancel; status enum: `waiting / recipientBusy / declined / tooManyAttempts / sending / finished / finishedWithErrors / canceledBySender / canceledByReceiver`.
- **Progress page** (`progress_page.dart`, shared by send & receive): per-file rows (name, size, progress bar or status: queued/skipped/error/done, **retry** for failed), bottom summary: overall bar, `finished/total` files, bytes, **speed**, **ETA**, Cancel (with confirm) / Done, optional auto-close.
- **Receive consent** (`receive_page.dart` + `receive_options_page.dart`): full-page request — sender alias, device badge, file count; **Accept / Decline**; options page lets the receiver **check/uncheck individual files**, rename, and change the destination folder per-transfer. Text messages render inline with **Copy** / **Open link** actions.
- **Extras**: favorites with custom alias override; receive history page; PIN protection; multi-send fan-out; share-via-link web page.

## 2. Where our current TUI falls short

The old Ink TUI (and its 1:1 port) is **menu-first**: a 6-item main menu, each feature on its own screen, device selection disconnected from sending (select a device on one screen, remember it, then navigate to "Send Text"). Specific problems:

1. **Receiver is off by default** and only runs while you sit on the "Receive" screen. The official app's server is always on — a peer can't discover you or send to you while you browse the menu.
2. **Device-first, not content-first.** You must pre-select a device, then pick what to send. The GUI's _what → who_ order matches how people think ("send this file").
3. **No transfer feedback** beyond a one-line status message — no per-file progress, speed, or cancel.
4. **No incoming consent** — `onTransferRequest` auto-returns `true`. Anyone on the LAN can drop files on you silently.
5. Everything is buried one menu level deep; a TUI's strength is showing everything at once with single-key actions.

## 3. Terminal-first design principles

1. **Dashboard, not menu tree.** Terminal real estate is cheap and text is dense — show the device list, selection, and status simultaneously. Kill the main menu.
2. **Always-on receiver.** Start the HTTP server + discovery announce at boot (matches official behavior). Incoming requests interrupt as a modal wherever you are.
3. **Consent by default.** Incoming transfer = modal with Accept/Decline. Quick Save (`off/favorites/on`) is an explicit toggle, like the GUI.
4. **Single-keystroke everything**, with a persistent hint bar. Vim keys (`j/k`) alongside arrows.
5. **Session states verbatim** from the GUI's `SessionStatus` enum — same vocabulary, same lifecycle.

## 4. Screen design

### 4.1 Global layout

```
┌──────────────────────────────────────────────────────────────────┐
│  LocalSend   [1 Send]  [2 Receive]  [3 Settings]                 │ ← tab_select
│                                                                  │
│  (active tab content)                                            │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ Kitchen-Mac #4F2A · :53317 · ● receiving · 3 devices │ last msg  │ ← status bar
│ Tab/1-3 switch · ? help · q quit                                 │ ← hint bar
└──────────────────────────────────────────────────────────────────┘
```

- Tab bar: OpenTUI `<tab_select>`; also `1/2/3` and `Tab` to cycle.
- Status bar is **always visible**: alias, visual ID, port, server state (● green = listening), device count, last status message (colored by level).
- Hint bar shows context-sensitive keys for the focused pane; `?` opens a full keymap overlay.

### 4.2 Send tab (default tab) — two panes

```
┌ Selection ──────────────┐  ┌ Nearby devices (3) ── s rescan ─────┐
│ 2 files · 4.2 MB        │  │ ▶ 💻 Anna's MacBook   192.168.1.7 ★ │
│  report.pdf     3.1 MB  │  │   📱 Pixel 8          192.168.1.12  │
│  photo.png      1.1 MB  │  │   💻 Work-PC          192.168.1.20  │
│                         │  │                                     │
│ a add · t text · x clear│  │ Enter send · f fav · i manual IP    │
└─────────────────────────┘  └─────────────────────────────────────┘
```

- **Content-first**: build a selection (left), then `Enter` on a device (right) sends it. `Enter` with an empty selection prompts "Nothing selected — press a to add a file or t to write a message" (the GUI's `NoFilesDialog`).
- **Selection pane** (`Tab`/`←→` moves focus between panes):
  - `a` → inline input row: type an absolute path, `Enter` adds it (validated with `stat`, shows size), repeatable. Also accepts a directory (recursed, like the GUI's folder picker).
  - `t` → message composer overlay (`<textarea>`), `Ctrl+S`/`Enter` attaches the message as a text item (mirrors `MessageInputDialog`).
  - **Paste to add**: OpenTUI `usePaste` — pasting into the selection pane adds the pasted text as a message item, or as file paths if every line is an existing path (the GUI's clipboard picker, free in a terminal).
  - `j/k` navigate items, `d` removes one, `x` clears all.
  - CLI args pre-fill it: `localsend-tui send ./a.pdf ./b.png` starts on the Send tab with the selection loaded.
- **Devices pane**:
  - Auto-scan on boot; `s` rescans (clears + re-announces + HTTP sweep; header shows a braille spinner ⠋⠙⠸ while scanning). Idle empty state: "No devices found — s to rescan, i to enter an IP".
  - Rows: device-type glyph (💻 desktop / 📱 mobile / 🌐 web, from `deviceType`), alias, IP, `★` if favorite. Favorites sort first.
  - `f` toggles favorite on the highlighted device (persisted, see §6).
  - `i` → manual-address input row accepting `#visualId` or `ip[:port]` (the GUI's `AddressInputDialog`); on resolve, the device is added to the list and highlighted.

### 4.3 Transfer session overlay (send & receive share it)

Modal `<box>` over the current tab (OpenTUI `Portal`), mirroring `send_page.dart` → `progress_page.dart`:

```
┌ Sending to Anna's MacBook ───────────────────────────┐
│ status: waiting for recipient…            (c cancel) │
├──────────────────────────────────────────────────────┤
│ ✓ report.pdf   3.1 MB                                │
│ ▸ photo.png    1.1 MB  ██████████░░░░░░  62%         │
│ ⏳ notes.txt    2 KB                                  │
├──────────────────────────────────────────────────────┤
│ Files 1/3 · 3.8/4.2 MB · 2.1 MB/s · ETA 0:04         │
│ c cancel · r retry failed · Esc close (when done)    │
└──────────────────────────────────────────────────────┘
```

- Status line uses the `SessionStatus` vocabulary: `waiting` → `sending` → `finished` / `finishedWithErrors` / `declined` / `canceledByReceiver`…
- Per-file glyphs: `⏳` queued · `▸` in flight (unicode-block bar) · `✓` done · `✗` failed · `↷` skipped.
- `c` cancels (confirm prompt while sending, like `CancelSessionDialog`); `r` retries failed files; overlay auto-closes 3 s after clean finish (GUI's `autoFinish`), any key keeps it open.
- v1 capability note: receive side has real per-file progress (`onTransferProgress` exists); send side currently exposes no upload progress callback in `LocalSendClient` — v1 shows per-file in-flight/done/fail on send and defers byte-level send progress to an SDK enhancement (see §7).

### 4.4 Incoming request modal (receive consent)

Appears over any tab; grabs focus (mirrors `receive_page.dart` + `receive_options_page.dart`):

```
┌ Incoming from Pixel 8  #7C21 · Android ──────────────┐
│ wants to send 3 files (12.4 MB)                      │
│                                                      │
│ [x] IMG_0291.jpg   4.1 MB                            │
│ [x] IMG_0292.jpg   4.0 MB                            │
│ [ ] video.mp4      4.3 MB                            │
│                                                      │
│ save to: ~/Downloads/localsend   (e edit)            │
│ Y accept · N decline · Space toggle · a all · n none │
└──────────────────────────────────────────────────────┘
```

- Blocks the sender's `prepareUpload` until answered — `onTransferRequest` already supports `async → boolean`, so the modal simply resolves a pending Promise.
- Per-file checkboxes (`Space`/`a`/`n`) mirror `selectedReceivingFilesProvider`. v1 ships **accept-all / decline** if the server API can't express partial acceptance yet (see §7); the checkbox UI still lands, wired to whatever the server supports.
- Text-message transfers render the message inline instead of a file list, with `y` copy (OSC 52 clipboard write — a real terminal superpower) and `o` open URL (mirrors the GUI's Copy/Open).
- **Quick Save** modes short-circuit this modal: `on` = auto-accept everything; `favorites` = auto-accept favorites, modal for strangers; `off` (default) = always ask.

### 4.5 Receive tab

Identity + activity (replaces the old "Receiver Mode" screen — the server is always on, so this tab is informational):

```
┌ You are visible as ─────────────────────────────┐
│   Kitchen-Mac                                   │  ← ascii_font, GUI's 48px alias
│   #4F2A (en0 192.168.1.5) · port 53317 · https  │
│                                                 │
│ Quick Save:  (●) off  ( ) favorites  ( ) on     │
│ Save folder: ~/Downloads/localsend    (e edit)  │
├ Recent receives ────────────────────────────────┤
│ 12:03  IMG_0291.jpg   4.1 MB  from Pixel 8      │
│ 11:47  message        "see you at 6"            │
│ o open folder · c copy visual ID                │
└─────────────────────────────────────────────────┘
```

- Big alias via `<ascii_font>` (the GUI's oversized alias, terminal-native).
- Quick Save segmented control: `←/→` or `Q` cycles `off/favorites/on`.
- Recent receives doubles as lightweight **history** (last N this session); full persistent history is v2.

### 4.6 Settings tab

Simple form (`<input>` fields + toggles): alias, port (restart server on change), save directory, quick-save default, protocol. Persisted (§6).

## 5. Keymap

| Key                                   | Context           | Action                                                                 |
| ------------------------------------- | ----------------- | ---------------------------------------------------------------------- |
| `1/2/3`, `Tab`                        | global            | switch tab                                                             |
| `?`                                   | global            | keymap overlay                                                         |
| `q` / `Ctrl+C`                        | global (no modal) | quit (clean shutdown: stop server, restore terminal)                   |
| `Esc`                                 | modal/input       | close modal / cancel input; at top level: nothing (no accidental quit) |
| `j/k`, `↑/↓`                          | lists             | navigate                                                               |
| `←/→`, `Tab`                          | Send tab          | switch pane focus                                                      |
| `Enter`                               | devices pane      | send selection to device                                               |
| `a` / `t` / `d` / `x`                 | selection pane    | add path / compose text / remove / clear                               |
| `s` / `i` / `f`                       | devices pane      | rescan / manual IP / toggle favorite                                   |
| `Y` / `N` / `Space` / `a` / `n` / `e` | incoming modal    | accept / decline / toggle file / all / none / edit dest                |
| `c` / `r`                             | transfer overlay  | cancel / retry failed                                                  |
| `Q`                                   | receive tab       | cycle quick-save mode                                                  |

Deliberate divergence from the old TUI: `Esc` no longer quits from the top level (too easy to hit; `q` is deliberate), and there is no "select device then navigate away" statefulness — selection and target meet in one action.

## 6. State & persistence (store changes vs. the 1:1 plan)

`TuiState` reshaped:

```
screen/tab: "send" | "receive" | "settings"
selection: Array<{ kind: "file", path, size } | { kind: "text", content }>
devices: DiscoveredDevice[] (favoritesFirst sort)
favorites: Array<{ fingerprint, alias, ip, port }>      ← new
scanState: "idle" | "scanning"
session: null | {                                        ← replaces isSending
  direction: "send" | "receive"
  peer: DiscoveredDevice
  status: SessionStatus            ← GUI enum verbatim
  files: Array<{ id, name, size, received, status: FileStatus }>
  startedAt, speed, eta
}
incomingRequest: null | { sender, files, resolve(accepted: string[] | false) }  ← consent modal
quickSave: "off" | "favorites" | "on"
recentReceives: ReceivedFile[]
settings: { alias, port, saveDir, protocol }
```

Persistence: single JSON at `~/.config/localsend-tui/config.json` (settings + favorites + quickSave), read at boot, written on change. No new dependencies — `node:fs`.

## 7. Library gaps this design surfaces (SDK work, not TUI work)

1. **Partial accept**: `LocalSendHonoServer.onTransferRequest` returns `boolean`; per-file consent needs it to accept a subset (e.g. return `string[]` of file ids, or a richer response). Until then the checkbox UI degrades to all-or-nothing.
2. **Send-side progress**: `LocalSendClient.uploadFile` has no progress callback; add one (bytes sent / total) to light up the send progress bar.
3. **Per-transfer save directory**: server takes `saveDirectory` at construction; changing it per-request (modal's `e`) needs a setter or per-session option.

Each is a small, independent `src/` improvement; the TUI design works without them and gets better as they land. Spin each off as its own task when reached.

## 8. Phasing & impact on the migration plan

- **Phase 1 (revise migration plan Tasks 3–4)**: OpenTUI migration builds _this_ layout directly instead of porting the menu UI — tab shell, status bar, Send tab two-pane (path add + text compose + paste), always-on receiver, consent modal (accept-all/decline), transfer overlay with receive-side progress, quick-save toggle, keymap. Migration plan Tasks 1 (toolchain) and 2 (transfer module) are unchanged; Task 3's store and Task 4's components are superseded by §6 and §4.
- **Phase 2**: favorites + manual IP/`#visualId` entry + config persistence + recent-receives panel + OSC 52 copy.
- **Phase 3** (needs §7 SDK work): per-file consent, send-side byte progress, per-transfer save dir, then optionally history page, PIN, multi-send.

Explicitly not planned: web-share link mode (browser flow, out of TUI scope), drag-and-drop (no terminal analog — paste + CLI args replace it).

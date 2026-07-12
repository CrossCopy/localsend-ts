---
name: testing-tui-cli
description: >-
  Drive and verify terminal UIs (TUIs) and CLIs end-to-end in a headless PTY
  with the shell-use tool — launch the program, send keystrokes/mouse, read the
  rendered screen, and assert on it. Use this whenever you need to actually run
  a terminal program to confirm a change works — an OpenTUI/Ink/Bubble Tea/
  ratatui/blessed TUI, an interactive prompt (inquirer, clack, citty), a curses/
  ncurses app, a REPL, or any CLI whose behavior you can't fully confirm from
  unit tests alone. Reach for it on "test the TUI", "does the app actually run",
  "verify the CLI works", "drive the interactive prompt", "screenshot the
  terminal", or after editing anything with a real terminal surface. Prefer this
  over piping into `script`/`expect` or eyeballing — it renders a true terminal
  emulator so you can assert on exactly what a user would see.
---

# Testing TUIs and CLIs with shell-use

Unit tests check your state and render logic in isolation; they cannot catch
what only appears when a real terminal drives your program: key routing between
a focused input and global handlers, escape-sequence timing, layout at a given
size, a process that crashes on boot, or two instances failing to talk to each
other. `shell-use` runs the program in a real headless PTY behind a terminal
emulator, so you send the exact bytes a user's keyboard sends and read back the
exact grid a user would see. This is how you turn "the tests pass" into "I
watched it work."

**Prerequisite:** the `shell-use` skill/CLI must be installed (`which shell-use`).
Read its own skill for the full command surface; this skill is the *workflow* for
testing terminal programs, plus the gotchas that bite specifically when driving
a TUI.

## The core loop

Every check is the same four beats: **launch → settle → inspect → assert.**

```sh
shell-use --session app run <program> [args...]   # launch in its own PTY
shell-use --session app wait idle                 # let it finish painting
shell-use --session app text                       # read the rendered screen
shell-use --session app expect text "Main Menu"   # assert (exit 1 if absent)
```

Always name sessions with `--session <name>`. It keeps parallel programs apart
(essential for networked apps — see below) and makes cleanup unambiguous. Close
with `shell-use --session app close`, or `shell-use close --all` at the end.

## Launching the program

Use `run <program> [args...]` to exec the program directly (no shell wrapper).
For a Bun/Node TUI that's `run bun src/cli-tui.tsx --flag value`.

**Gotcha — flag ambiguity.** shell-use has its own flags (`--cols`, `--rows`,
`--cwd`, `--env`). When they sit *after* your program name, they can be swallowed
by shell-use instead of reaching your program — or vice versa. Don't fight the
parser: launch first, then set the size explicitly.

```sh
shell-use --session app run bun src/cli-tui.tsx --alias Test --port 53420
sleep 2                                   # give the native renderer a beat to boot
shell-use --session app resize 100 32     # set terminal size deterministically
shell-use --session app wait idle
```

A default session is 80×30. Resize when your layout needs the room, or to test
reflow. `sleep` briefly after `run` for heavy runtimes (native renderers, WASM,
FFI) — `wait idle` alone can return before the first paint on a slow boot.

## Reading the screen

- `text` — the rendered viewport as plain text. Your primary inspection tool;
  pipe it through `grep`/`sed` to focus on a region.
- `text --full` — include scrollback.
- `state` — cwd, size, cursor, last command + exit code, plus a snapshot.
- `cells X Y W H` — per-cell char/fg/bg/flags, when you need to assert *color*.
- `screenshot out.svg` — a full-color SVG of the screen for a visual artifact
  (great for a PR or bug report; crisp at any zoom).

## Sending input — pick the right verb

| Verb | Sends | Use for |
| --- | --- | --- |
| `type "text"` | literal text, no Enter | filling a focused input field |
| `submit ["text"]` | text + Return | running a shell command, or submitting a field |
| `press <Key...>` | named keys | `press Enter`, `press Escape`, `press j`, `press a` |
| `keys "Ctrl+a"` | one combo | `keys "shift+q"`, `keys "Ctrl+c"` |
| `mouse click --on-text "OK"` | a click on a label | clickable TUIs |
| `write <bytes>` | raw bytes | escape sequences the parsers mangle |

## Waiting — never assume instant

Screen updates are asynchronous; asserting immediately reads a stale frame.
Match the wait to what you're waiting for:

- `wait text "T"` — until specific text appears. **The most precise wait**; use it
  whenever you know the expected output. `--not` waits for text to disappear.
- `wait idle` — until the screen stops repainting (~250ms quiet). Use it to let a
  TUI finish drawing after an action. It tracks *visual quiescence, not
  completion* — a silent background task looks idle immediately.
- `wait command` — until the foreground command finishes (shell integration).
  The right wait after `submit`-ing a CLI command.
- `wait exit` — until the program itself exits (after quit, or for a `run` program).

## Asserting

`expect` returns exit 0 on pass, 1 on fail — branch on it in scripts.

```sh
shell-use --session app expect text "3 devices"          # substring present
shell-use --session app expect text "ERROR" --fg "#ff0000" # present AND red
shell-use --session app expect text "Sending" --not       # absent
shell-use --session app expect snapshot main-view          # matches saved snapshot
shell-use --session app expect exit-code 0                 # last command's code
```

Snapshots (`expect snapshot NAME -u` to record, then without `-u` to check) are
excellent regression guards for a whole screen. `--include-colors` also diffs
per-cell color.

## Worked example: driving a dashboard TUI

```sh
# launch + settle
shell-use --session tui run bun src/cli-tui.tsx --alias Test --port 53420
sleep 2; shell-use --session tui resize 100 32; shell-use --session tui wait idle

# assert the dashboard rendered
shell-use --session tui expect text "Main Menu"

# switch a tab, assert the new view
shell-use --session tui press 2
shell-use --session tui wait idle
shell-use --session tui expect text "You are visible as"

# fill a focused text input and submit it
shell-use --session tui press 1          # back to the input's tab
shell-use --session tui wait idle
shell-use --session tui press t          # open the composer
shell-use --session tui wait idle
shell-use --session tui type "hello from shell-use"
shell-use --session tui submit           # Enter
shell-use --session tui wait idle
shell-use --session tui expect text "1 item"   # it was added

shell-use --session tui close
```

## CLI (non-TUI) flavor

For a plain command or an interactive prompt, open a shell and use command-level
waits and assertions:

```sh
shell-use --session cli open                       # a shell session
shell-use --session cli submit "mycli build --watch=false"
shell-use --session cli wait command               # block until it finishes
shell-use --session cli expect exit-code 0
shell-use --session cli expect output "Build succeeded"
# an interactive prompt (inquirer/clack/citty):
shell-use --session cli submit "mycli init"
shell-use --session cli wait text "Project name"
shell-use --session cli submit "my-app"            # answer the prompt
shell-use --session cli press Down Enter           # pick a list option
shell-use --session cli close
```

## Networked / multi-instance apps

For peer-to-peer or client/server programs, run each end in its own named
session so they discover and talk to each other on the same host:

```sh
shell-use --session recv run bun src/cli-tui.tsx --alias Receiver --port 53500
shell-use --session send run bun src/cli-tui.tsx --alias Sender   --port 53501
sleep 3
shell-use --session send expect text "Receiver"   # sender discovered receiver?
# drive the send on `send`, then assert the consent/receipt on `recv`
```

Give each instance **distinct identity flags** (`--port`, `--alias`). If your app
persists config, a shared config file can make two instances collide (e.g. both
loading the same saved port) — see the persistence gotcha below.

## Gotchas that specifically bite TUIs

These are the failure modes that waste the most time. Internalize them.

1. **A running process does not pick up your code edits.** `bun x.tsx` reads
   source at launch, but a *session you already started* is frozen at the old
   code. After editing, `close` and `run` the session again. (Symptom: your fix
   "doesn't work" but the unit test passes.)

2. **Bare `Escape` lags ~1s in terminals without the kitty keyboard protocol.**
   shell-use's emulator (and many real terminals) don't negotiate kitty, so a
   lone `\x1b` is held pending disambiguation until a timeout or the next key.
   Escape *does* work — wait longer (`sleep 1.2` or `wait text --not`), or send a
   following key. If your TUI relies on Escape to dismiss something, consider
   offering a non-ambiguous key (Enter/q) too — a real UX win in legacy terminals.

3. **The key that opens an input can leak into that input.** If pressing `t`
   focuses a text field in the same key-dispatch pass, the field may capture the
   `t` (you get `"thello"`). Test every open-input path by typing right after and
   asserting the value has no stray leading trigger char. (The app-side fix is to
   defer focusing the input one tick.)

4. **A focused input and your global key handler can double-handle a key.**
   `useKeyboard`-style global handlers fire for every keypress regardless of
   focus. Test that typing into a field doesn't also trigger a global shortcut,
   and that a shortcut on one screen isn't stolen by a global one (e.g. `Shift+Q`
   arriving as name `q` and hitting a global `q`-to-quit). Distinguish by
   modifier/sequence.

5. **Rapid input is racy — insert `wait idle` between steps.** Firing several
   `press`/`type` calls back-to-back can outrun rendering and async state
   updates, so an assertion reads a half-updated frame. One `wait idle` (or a
   precise `wait text`) per meaningful step makes runs deterministic.

6. **Persisted config can override CLI args and collide instances.** If the app
   writes settings to disk and reloads them on boot, a stale file can shadow
   `--port`/`--alias`. When multi-instance discovery misbehaves, wipe the config
   (`rm ~/.config/<app>/config.json`) and relaunch. The app-side fix is to let
   CLI args win over persisted values.

7. **`wait idle` ≠ done.** It means "screen stopped repainting," not "the
   operation finished." For a real completion signal, `wait text` on the outcome
   (e.g. `"finished"`, `"complete"`, an error string) rather than `wait idle`.

## Why this is worth doing

Driving the real program is how you find the bugs that unit tests structurally
cannot: this workflow, on a freshly-migrated TUI whose 62 unit tests were green,
surfaced four real defects in one session — a global shortcut swallowing a
screen-local key, a trigger key leaking into a focused input, persisted config
colliding two instances on one port, and an Escape-only dismissal that lagged in
common terminals. Each was invisible to the tests and obvious the moment a real
keyboard hit a real screen. When you claim a terminal program works, drive it
first.

## Artifacts for humans

- `screenshot out.svg` — attach a full-color screen capture to a PR or bug report.
- `get-recording <session> > demo.cast` — the session records automatically from
  launch; export the asciinema cast, then `asciinema play demo.cast` or render a
  GIF with `agg demo.cast demo.gif`.
- `shell-use --session <name> monitor` — watch the live session in a second
  terminal while you drive it from the first.

# LocalSend v2.1 — Phase 5: Docker Discovery E2E — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Prove multicast **discovery** works between real, separate network namespaces (which single-host tests cannot), by running two `localsend-ts` peers in Docker containers on a shared network and asserting they discover each other and complete a real file transfer.

**Architecture:** Make the multicast group address/port injectable (default `224.0.0.167:53317`) for test isolation. Add a Docker image + compose that runs two peers via the existing CLI `receive`. Add an opt-in `bun test` that orchestrates docker (build → up → assert mutual discovery via `discover --json` → real transfer → down), skipped by default and when Docker is unavailable.

**Tech Stack:** TypeScript, Bun, existing CLI (`src/cli.ts`), Docker + docker compose (`oven/bun` base image).

## Global Constraints

- **Formatting (Prettier):** no semicolons; no trailing commas; tabs (width 2); print width 100. `bun run format` before every commit.
- **Imports:** `.ts` extensions; `node:` prefix for builtins. Never edit `src/sdk/*.gen.ts`.
- **`bun run check-types` clean + `bun test` green at every commit.** The Docker e2e test MUST be skipped by default (fast CI) and only run when `LOCALSEND_E2E_DOCKER=1` AND Docker is reachable.
- **Multicast:** group `224.0.0.167:53317` is the protocol default; containers use it. The injectable seam defaults to these exact values.
- **Reference:** design doc §6.6 (multicast config seam) and §7.4 (Docker e2e).

## Existing interfaces this phase builds on

- `src/discovery/multicast.ts` → `class MulticastDiscovery { constructor(deviceInfo) ... }` — currently reads `DEFAULT_CONFIG.MULTICAST_ADDRESS`/`MULTICAST_PORT` directly.
- `src/discovery/runtime.ts` → `createDiscovery(deviceInfo)`.
- CLI `src/cli.ts` → `receive` (starts server + multicast + announce + http-scan; `--alias`, `--autoAccept`, `--saveDir`, `--port`, `--verbose`), `discover` (`--json`, `--timeout`, `--alias`), `send <target> <file>` (target may be a hostname — fetch resolves it).
- `src/protocol/constants.ts` → `DEFAULT_CONFIG.MULTICAST_ADDRESS`, `MULTICAST_PORT`.

---

## Task 5.1: Injectable multicast config seam

**Files:**
- Modify: `src/discovery/multicast.ts`
- Test: `test/unit/multicast-config.test.ts`

**Interfaces:**
- `MulticastDiscovery` constructor gains an optional 2nd arg: `constructor(deviceInfo: DeviceInfo, options?: { multicastAddress?: string; multicastPort?: number })`. Defaults to `DEFAULT_CONFIG.MULTICAST_ADDRESS` / `MULTICAST_PORT`. Expose the resolved values as readonly public fields `multicastAddress` / `multicastPort` for testability. All internal uses of the constant are replaced with these fields.

- [ ] **Step 1: Write `test/unit/multicast-config.test.ts`**

```ts
import { test, expect } from "bun:test"
import { MulticastDiscovery } from "../../src/discovery/multicast.ts"
import { getDeviceInfo } from "../../src/utils/device.ts"
import { DEFAULT_CONFIG } from "../../src/protocol/constants.ts"

test("defaults to the protocol multicast group", () => {
	const d = new MulticastDiscovery(getDeviceInfo({ alias: "x" }))
	expect(d.multicastAddress).toBe(DEFAULT_CONFIG.MULTICAST_ADDRESS)
	expect(d.multicastPort).toBe(DEFAULT_CONFIG.MULTICAST_PORT)
	d.stop()
})

test("honors an injected multicast group (for test isolation)", () => {
	const d = new MulticastDiscovery(getDeviceInfo({ alias: "x" }), {
		multicastAddress: "239.1.2.3",
		multicastPort: 50000
	})
	expect(d.multicastAddress).toBe("239.1.2.3")
	expect(d.multicastPort).toBe(50000)
	d.stop()
})
```
Note: constructing `MulticastDiscovery` creates a dgram socket but does NOT bind until `start()`; `stop()` closes it. If `stop()` on an unbound socket throws, guard it. If constructing-without-start leaks, add a minimal guard — keep the test green and clean.

- [ ] **Step 2: Run — verify FAIL.** Run: `bun test test/unit/multicast-config.test.ts`

- [ ] **Step 3: Edit `src/discovery/multicast.ts`**
  - Add readonly public fields set in the constructor:
```ts
public readonly multicastAddress: string
public readonly multicastPort: number
constructor(private deviceInfo: DeviceInfo, options: { multicastAddress?: string; multicastPort?: number } = {}) {
	this.multicastAddress = options.multicastAddress ?? DEFAULT_CONFIG.MULTICAST_ADDRESS
	this.multicastPort = options.multicastPort ?? DEFAULT_CONFIG.MULTICAST_PORT
	// ... existing socket/client/interfaceAddresses setup ...
}
```
  - Replace every `DEFAULT_CONFIG.MULTICAST_ADDRESS` with `this.multicastAddress` and every `DEFAULT_CONFIG.MULTICAST_PORT` with `this.multicastPort` in `start()` (bind + addMembership) and `sendUdpMessage()`.
  - If `stop()` can be called before `start()`, wrap `this.socket.close()` in try/catch.

- [ ] **Step 4: Run — verify PASS.** Run: `bun test test/unit/multicast-config.test.ts`. Then full `bun test` + `bun run check-types`.
- [ ] **Step 5:** `bun run format`; commit:
```bash
git add src/discovery/multicast.ts test/unit/multicast-config.test.ts
git commit -m "feat: injectable multicast group (address/port) for discovery, default 224.0.0.167:53317"
```

---

## Task 5.2: Docker image + compose for two peers

**Files:**
- Create: `docker/Dockerfile`
- Create: `docker/docker-compose.yml`
- Create: `docker/README.md`
- Modify: `.dockerignore` (create if absent)

- [ ] **Step 1: Create `.dockerignore`** (repo root) to keep the build context small:
```
node_modules
dist
.git
received_files
downloads
.superpowers
docs
references
*.jpeg
```

- [ ] **Step 2: Create `docker/Dockerfile`** (bun base; install deps; run the CLI)
```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src ./src
COPY tsconfig.json ./
# default command overridden by compose
CMD ["bun", "src/cli.ts", "--help"]
```

- [ ] **Step 3: Create `docker/docker-compose.yml`** (two peers on a shared user-defined bridge network)
```yaml
services:
  peer-a:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    image: localsend-ts-peer
    container_name: lspeer-a
    command: ["bun", "src/cli.ts", "receive", "--alias", "PeerA", "--autoAccept", "--saveDir", "/received", "--verbose"]
    networks: [lsnet]
  peer-b:
    image: localsend-ts-peer
    container_name: lspeer-b
    command: ["bun", "src/cli.ts", "receive", "--alias", "PeerB", "--autoAccept", "--saveDir", "/received", "--verbose"]
    networks: [lsnet]
    depends_on: [peer-a]
networks:
  lsnet:
    driver: bridge
```

- [ ] **Step 4: Create `docker/README.md`** documenting: what this is (real multicast discovery between containers), how to run manually (`docker compose -f docker/docker-compose.yml up --build`), and the macOS caveat (container↔container multicast works inside Docker Desktop's Linux VM; host↔container / `--network host` does not).

- [ ] **Step 5: Smoke the build manually** (this is the task's verification — no bun test yet):

Run: `docker compose -f docker/docker-compose.yml build 2>&1 | tail -20`
Expected: image builds successfully. Then bring it up briefly:
Run: `docker compose -f docker/docker-compose.yml up -d && sleep 12 && docker compose -f docker/docker-compose.yml logs --no-color | grep -iE "discovered|PeerA|PeerB" | head; docker compose -f docker/docker-compose.yml down -v`
Expected: logs show each peer discovering the other (multicast working). If multicast does NOT work between containers on this host, capture the exact output and report DONE_WITH_CONCERNS (do not fake it) — the code is still correct; it's an environment limitation.

- [ ] **Step 6:** `bun run format` (no TS changed, but keep habit); commit:
```bash
git add docker .dockerignore
git commit -m "feat: Docker image + compose for two-peer multicast discovery"
```
Report the actual discovery-log output in your report.

---

## Task 5.3: Opt-in Docker e2e test (discovery + transfer)

**Files:**
- Create: `test/e2e-docker/discovery.test.ts`
- Test helper: `test/e2e-docker/docker-helpers.ts` (spawn helpers)

**Interfaces:**
- The test is skipped unless `process.env.LOCALSEND_E2E_DOCKER === "1"` AND `docker info` succeeds.

- [ ] **Step 1: Create `test/e2e-docker/docker-helpers.ts`**
```ts
import { spawnSync } from "node:child_process"

export function dockerAvailable(): boolean {
	if (process.env.LOCALSEND_E2E_DOCKER !== "1") return false
	const r = spawnSync("docker", ["info"], { stdio: "ignore" })
	return r.status === 0
}

export function sh(cmd: string, args: string[], timeoutMs = 180000): { code: number; out: string } {
	const r = spawnSync(cmd, args, { encoding: "utf8", timeout: timeoutMs })
	return { code: r.status ?? -1, out: (r.stdout || "") + (r.stderr || "") }
}
```

- [ ] **Step 2: Create `test/e2e-docker/discovery.test.ts`**
```ts
import { test, expect } from "bun:test"
import { dockerAvailable, sh } from "./docker-helpers.ts"

const COMPOSE = ["compose", "-f", "docker/docker-compose.yml"]
const run = dockerAvailable()

test.skipIf(!run)("two containers discover each other via multicast and transfer a file", () => {
	// clean slate
	sh("docker", [...COMPOSE, "down", "-v"])
	try {
		// build + start both peers
		expect(sh("docker", [...COMPOSE, "up", "-d", "--build"]).code).toBe(0)
		// give multicast announce + register a moment
		sh("sleep", ["12"])
		const logs = sh("docker", [...COMPOSE, "logs", "--no-color"]).out
		// each peer should have discovered the other (verbose logs the alias)
		expect(logs).toContain("PeerB")
		expect(logs).toContain("PeerA")
		// real transfer: create a file in peer-a and send to peer-b by container DNS name
		sh("docker", ["exec", "lspeer-a", "sh", "-c", "echo hello-localsend > /tmp/t.txt"])
		const send = sh("docker", [
			"exec", "lspeer-a", "bun", "src/cli.ts", "send", "lspeer-b", "/tmp/t.txt", "--pin", ""
		])
		expect(send.out).toMatch(/uploaded successfully|✅/i)
		// verify receipt on peer-b
		const recv = sh("docker", ["exec", "lspeer-b", "sh", "-c", "cat /received/t.txt"])
		expect(recv.out).toContain("hello-localsend")
	} finally {
		sh("docker", [...COMPOSE, "down", "-v"])
	}
})
```
Note: adjust the exact assertions to what the CLI actually logs (check `src/cli.ts` `receive --verbose` discovery log text and `send` success text) so the assertions match real output. The `send` target uses the container name `lspeer-b`, resolved by Docker's embedded DNS on the user-defined network; confirm the client accepts a hostname (it builds `http://<host>:<port>/...`, so a hostname works).

- [ ] **Step 3: Run it for real** (Docker is available on this machine):

Run: `LOCALSEND_E2E_DOCKER=1 bun test test/e2e-docker/discovery.test.ts`
Expected: 1 pass (mutual discovery + transfer). Iterate on the assertion strings / timings until it genuinely passes. If multicast between containers is truly unavailable on this host, report DONE_WITH_CONCERNS with the captured logs (showing whether announce was sent/received) — do NOT weaken the test to pass without real discovery.

- [ ] **Step 4: Confirm default skip.** Run: `bun test test/e2e-docker/discovery.test.ts` (without the env var) → the test is skipped (0 fail). And `bun test` (full) stays green + fast.
- [ ] **Step 5:** `bun run format`; commit:
```bash
git add test/e2e-docker
git commit -m "test: opt-in Docker e2e — two-peer multicast discovery + transfer"
```
Report whether the real run passed and paste the key discovery log lines.

---

## Task 5.4: Scripts + docs + sweep

**Files:**
- Modify: `package.json` (add `test:e2e:docker` script), `AGENTS.md`, design doc §8

- [ ] **Step 1:** Add to `package.json` scripts: `"test:e2e:docker": "LOCALSEND_E2E_DOCKER=1 bun test test/e2e-docker"`.
- [ ] **Step 2:** Root `AGENTS.md`: add a "Docker E2E" note — how to run (`bun run test:e2e:docker`), that it needs Docker, and that it validates real multicast discovery between containers. Design doc §8: tick **Phase 5**.
- [ ] **Step 3: Sweep.** `bun run check-types` clean; `bun test` (default) green and does NOT run the docker test. Note whether the opt-in docker run passed (from Task 5.3).
- [ ] **Step 4:** `bun run format`; commit:
```bash
git add package.json AGENTS.md docs/superpowers/specs/2026-07-12-localsend-v2.1-completion-and-test-harness-design.md
git commit -m "docs: mark Phase 5 (Docker discovery e2e) complete; add test:e2e:docker script"
```

---

## Self-Review Notes

- **Real multicast:** the value is separate netns per container → genuine multicast, the one thing single-host can't do. Task 5.3 actually runs it (Docker is available here).
- **CI safety:** the docker test is double-gated (env var + `docker info`), so default `bun test` stays fast and green.
- **Honesty:** if container multicast is blocked on this host, the tasks require reporting DONE_WITH_CONCERNS with captured logs, not faking a pass.
- **Reuse:** peers run the existing CLI `receive`/`send`; no duplicate transfer logic.
- **Deferred:** Rust oracle (Phase 6), final docs/PR (Phase 7).

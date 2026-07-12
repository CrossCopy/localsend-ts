import { spawnSync } from "node:child_process"

/**
 * True only when the opt-in env var is set AND a real Docker daemon is
 * reachable. Any other case (env var unset, `docker` missing, daemon down)
 * returns false so the e2e test stays skipped by default and a plain
 * `bun test` needs no Docker.
 */
export function dockerAvailable(): boolean {
	if (process.env.LOCALSEND_E2E_DOCKER !== "1") return false
	return spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0
}

/**
 * Run a command synchronously, capturing combined stdout+stderr. Never throws
 * on a non-zero exit — callers inspect `code`/`out` and assert themselves.
 */
export function sh(cmd: string, args: string[], timeoutMs = 180000): { code: number; out: string } {
	const r = spawnSync(cmd, args, { encoding: "utf8", timeout: timeoutMs })
	return { code: r.status ?? -1, out: (r.stdout || "") + (r.stderr || "") }
}

/** `docker exec <container> <argv...>` */
export function dexec(container: string, argv: string[], timeoutMs = 60000) {
	return sh("docker", ["exec", container, ...argv], timeoutMs)
}

/** `docker exec <container> sh -c "<script>"` — for shell pipelines inside a peer. */
export function dsh(container: string, script: string, timeoutMs = 60000) {
	return sh("docker", ["exec", container, "sh", "-c", script], timeoutMs)
}

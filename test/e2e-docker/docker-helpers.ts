import { spawnSync } from "node:child_process"

/**
 * True only when the opt-in env var is set AND a real Docker daemon is
 * reachable. Any other case (env var unset, `docker` missing, daemon down)
 * returns false so the e2e test stays skipped by default.
 */
export function dockerAvailable(): boolean {
	if (process.env.LOCALSEND_E2E_DOCKER !== "1") return false
	const r = spawnSync("docker", ["info"], { stdio: "ignore" })
	return r.status === 0
}

/**
 * Run a command synchronously and capture combined stdout+stderr.
 * Never throws on non-zero exit - callers inspect `code`/`out` instead.
 */
export function sh(cmd: string, args: string[], timeoutMs = 180000): { code: number; out: string } {
	const r = spawnSync(cmd, args, { encoding: "utf8", timeout: timeoutMs })
	return { code: r.status ?? -1, out: (r.stdout || "") + (r.stderr || "") }
}

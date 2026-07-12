import { test, expect } from "bun:test"
import { dockerAvailable, sh } from "./docker-helpers.ts"

// Opt-in, real-infrastructure e2e test: brings up two `localsend-ts` CLI
// containers via docker compose, proves they discover each other over real
// UDP multicast on the Docker bridge network, then drives a real HTTP file
// transfer between them and verifies the bytes landed on the receiver.
//
// Skipped unless LOCALSEND_E2E_DOCKER=1 AND a Docker daemon is reachable, so
// a plain `bun test` stays fast and doesn't require Docker.

const COMPOSE = ["compose", "-f", "docker/docker-compose.yml"]
const run = dockerAvailable()

test.skipIf(!run)(
	"two containers discover each other via multicast and transfer a file",
	() => {
		// clean slate in case a previous run left containers behind
		sh("docker", [...COMPOSE, "down", "-v"])
		try {
			// build + start both peers (image build can take a while on a cold cache)
			const up = sh("docker", [...COMPOSE, "up", "-d", "--build"], 300000)
			expect(up.code).toBe(0)

			// give multicast announce + discovery a moment to happen
			sh("sleep", ["15"])

			const logs = sh("docker", [...COMPOSE, "logs", "--no-color"]).out
			// each peer runs with --verbose, so it logs the exact alias of any
			// device it discovers via multicast (see src/cli.ts receive command)
			expect(logs).toContain("Device discovered: PeerB")
			expect(logs).toContain("Device discovered: PeerA")

			// real transfer: create a file inside peer-a and send it to peer-b,
			// addressed by the container's Docker DNS name on the lsnet network
			sh("docker", ["exec", "lspeer-a", "sh", "-c", "echo hello-localsend > /tmp/t.txt"])
			const send = sh(
				"docker",
				["exec", "lspeer-a", "bun", "src/cli.ts", "send", "lspeer-b", "/tmp/t.txt", "--pin", ""],
				60000
			)
			expect(send.out).toMatch(/uploaded successfully|✅/i)

			// verify the bytes actually landed on peer-b's save directory
			const recv = sh("docker", ["exec", "lspeer-b", "sh", "-c", "cat /received/t.txt"])
			expect(recv.out).toContain("hello-localsend")
		} finally {
			sh("docker", [...COMPOSE, "down", "-v"])
		}
	},
	360000
)

import { test, expect, beforeAll, afterAll } from "bun:test"
import { dockerAvailable, sh, dexec, dsh } from "./docker-helpers.ts"

// Opt-in, real-infrastructure e2e: brings up two `localsend-ts` peers as Docker
// containers on a shared bridge network, proves they discover each other over
// real UDP multicast (separate network namespaces — impossible on one host),
// then drives real HTTP transfers of BOTH a binary file and a text message in
// BOTH directions, asserting the bytes/content land intact on the other side.
//
// Skipped unless LOCALSEND_E2E_DOCKER=1 AND a Docker daemon is reachable, so a
// plain `bun test` stays fast and Docker-free.
//
// Run it:  LOCALSEND_E2E_DOCKER=1 bun test test/e2e-docker/interop.test.ts

const COMPOSE = ["compose", "-f", "docker/docker-compose.yml"]
const run = dockerAvailable()

// A peer's transfer target is `<host>:<its own configured port>`; both peers
// use the default 53317, and transfers are addressed by Docker DNS name.
const A = "lspeer-a"
const B = "lspeer-b"

beforeAll(() => {
	if (!run) return
	sh("docker", [...COMPOSE, "down", "-v"]) // clean slate
	const up = sh("docker", [...COMPOSE, "up", "-d", "--build"], 600000)
	expect(up.code).toBe(0)
	sh("sleep", ["12"]) // let multicast announce + discovery settle
}, 600000) // image build can be slow on a cold cache

afterAll(() => {
	if (!run) return
	sh("docker", [...COMPOSE, "down", "-v"])
}, 120000)

test.skipIf(!run)("peers discover each other over multicast", () => {
	const logs = sh("docker", [...COMPOSE, "logs", "--no-color"]).out
	// each peer runs --verbose and logs the alias of any peer it discovers
	expect(logs).toContain("Device discovered: PeerA")
	expect(logs).toContain("Device discovered: PeerB")
})

/** Send a binary file from `src` container to `dst` container and assert sha256 match. */
function assertFileTransfer(src: string, dst: string, name: string) {
	// make a random file in the sender and record its hash
	const made = dsh(
		src,
		`head -c 200000 /dev/urandom > /tmp/${name}; sha256sum /tmp/${name} | cut -d' ' -f1`
	)
	expect(made.code).toBe(0)
	const srcHash = made.out.trim().split("\n").pop()!.trim()
	expect(srcHash).toMatch(/^[0-9a-f]{64}$/)

	// send it, addressed by the receiver's DNS name
	const sent = dexec(src, ["bun", "src/cli.ts", "send", dst, `/tmp/${name}`, "--protocol", "http"])
	expect(sent.code).toBe(0)

	// verify the received bytes match, retrying briefly for write settle
	let dstHash = ""
	for (let i = 0; i < 10; i++) {
		const got = dsh(dst, `sha256sum /received/${name} 2>/dev/null | cut -d' ' -f1`)
		dstHash = got.out.trim()
		if (dstHash === srcHash) break
		sh("sleep", ["1"])
	}
	expect(dstHash).toBe(srcHash)
}

/** Send a text message (as a .txt file) from `src` to `dst` and assert the content. */
function assertTextTransfer(src: string, dst: string, name: string, content: string) {
	const made = dsh(src, `printf '%s' ${JSON.stringify(content)} > /tmp/${name}`)
	expect(made.code).toBe(0)

	const sent = dexec(src, ["bun", "src/cli.ts", "send", dst, `/tmp/${name}`, "--protocol", "http"])
	expect(sent.code).toBe(0)

	let received = ""
	for (let i = 0; i < 10; i++) {
		const got = dsh(dst, `cat /received/${name} 2>/dev/null`)
		received = got.out
		if (received === content) break
		sh("sleep", ["1"])
	}
	expect(received).toBe(content)
}

test.skipIf(!run)("transfers a binary file A -> B", () => {
	assertFileTransfer(A, B, "a-to-b.bin")
})

test.skipIf(!run)("transfers a binary file B -> A", () => {
	assertFileTransfer(B, A, "b-to-a.bin")
})

test.skipIf(!run)("transfers a text message A -> B", () => {
	assertTextTransfer(A, B, "a-to-b.txt", "hello from PeerA — 你好 📨")
})

test.skipIf(!run)("transfers a text message B -> A", () => {
	assertTextTransfer(B, A, "b-to-a.txt", "reply from PeerB — 收到 ✅")
})

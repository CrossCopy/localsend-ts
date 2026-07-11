import { mkdtemp, rm, stat, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createServer } from "node:net"
import { createHash, randomBytes } from "node:crypto"

export async function tempDir(): Promise<string> {
	return await mkdtemp(path.join(tmpdir(), "localsend-test-"))
}

export async function rmTemp(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true })
}

export function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = createServer()
		srv.once("error", reject)
		srv.listen(0, () => {
			const addr = srv.address()
			if (addr && typeof addr === "object") {
				const port = addr.port
				srv.close(() => resolve(port))
			} else {
				srv.close(() => reject(new Error("no port")))
			}
		})
	})
}

export async function makeRandomFile(
	dir: string,
	name: string,
	size: number
): Promise<{ path: string; sha256: string }> {
	const filePath = path.join(dir, name)
	const buf = randomBytes(size)
	await writeFile(filePath, buf)
	return { path: filePath, sha256: createHash("sha256").update(buf).digest("hex") }
}

export async function sha256File(filePath: string): Promise<string> {
	const buf = await readFile(filePath)
	return createHash("sha256").update(buf).digest("hex")
}

export async function fileSize(filePath: string): Promise<number> {
	return (await stat(filePath)).size
}

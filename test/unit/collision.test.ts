import { test, expect } from "bun:test"
import { writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { tempDir, rmTemp } from "../helpers/util.ts"
import { uniqueSavePath } from "../../src/core/files.ts"

test("uniqueSavePath appends counter on collision", async () => {
	const dir = await tempDir()
	try {
		expect(uniqueSavePath(dir, "a.txt")).toBe(path.join(dir, "a.txt"))
		await writeFile(path.join(dir, "a.txt"), "x")
		expect(uniqueSavePath(dir, "a.txt")).toBe(path.join(dir, "a (1).txt"))
	} finally {
		await rmTemp(dir)
	}
})

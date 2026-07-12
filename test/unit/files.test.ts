import { test, expect } from "bun:test"
import path from "node:path"
import { resolveSavePath, sanitizeFilename } from "../../src/core/files.ts"

const SAVE = "/tmp/ls-save"

test("resolveSavePath keeps plain names inside saveDir", () => {
	expect(resolveSavePath(SAVE, "a.txt")).toBe(path.join(SAVE, "a.txt"))
})

test("resolveSavePath allows safe subfolders", () => {
	expect(resolveSavePath(SAVE, "sub/dir/a.txt")).toBe(path.join(SAVE, "sub/dir/a.txt"))
})

test("resolveSavePath rejects parent traversal", () => {
	expect(() => resolveSavePath(SAVE, "../evil.txt")).toThrow()
	expect(() => resolveSavePath(SAVE, "sub/../../evil.txt")).toThrow()
	expect(() => resolveSavePath(SAVE, "/etc/passwd")).toThrow()
})

test("sanitizeFilename strips path separators", () => {
	expect(sanitizeFilename("../../x.txt")).toBe("x.txt")
	expect(sanitizeFilename("a/b/c.txt")).toBe("c.txt")
})

test("sanitizeFilename neutralizes .., ., and empty", () => {
	expect(sanitizeFilename("..")).toBe("unnamed_file")
	expect(sanitizeFilename("a/..")).toBe("unnamed_file")
	expect(sanitizeFilename(".")).toBe("unnamed_file")
	expect(sanitizeFilename("")).toBe("unnamed_file")
})

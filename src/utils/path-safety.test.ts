import path from "node:path"

import { describe, expect, test } from "bun:test"

import { safeJoinReceivePath } from "./path-safety.ts"

describe("safeJoinReceivePath", () => {
	const baseDirectory = path.join("tmp", "received")

	test("allows simple file names", () => {
		expect(safeJoinReceivePath(baseDirectory, "photo.jpg")).toBe(
			path.join(baseDirectory, "photo.jpg")
		)
	})

	test("preserves safe nested relative paths", () => {
		expect(safeJoinReceivePath(baseDirectory, "album/2026/photo.jpg")).toBe(
			path.join(baseDirectory, "album", "2026", "photo.jpg")
		)
	})

	test("rejects paths that escape the receive directory", () => {
		expect(() => safeJoinReceivePath(baseDirectory, "../secret.txt")).toThrow("Unsafe receive path")
		expect(() => safeJoinReceivePath(baseDirectory, "album/../../secret.txt")).toThrow(
			"Unsafe receive path"
		)
	})

	test("rejects absolute and Windows-style paths", () => {
		expect(() => safeJoinReceivePath(baseDirectory, "/tmp/secret.txt")).toThrow(
			"Unsafe receive path"
		)
		expect(() => safeJoinReceivePath(baseDirectory, "C:/Users/alice/secret.txt")).toThrow(
			"Unsafe receive path"
		)
		expect(() => safeJoinReceivePath(baseDirectory, "C:\\Users\\alice\\secret.txt")).toThrow(
			"Unsafe receive path"
		)
		expect(() => safeJoinReceivePath(baseDirectory, "..\\secret.txt")).toThrow(
			"Unsafe receive path"
		)
	})

	test("rejects empty segments", () => {
		expect(() => safeJoinReceivePath(baseDirectory, "")).toThrow("Unsafe receive path")
		expect(() => safeJoinReceivePath(baseDirectory, "album//photo.jpg")).toThrow(
			"Unsafe receive path"
		)
		expect(() => safeJoinReceivePath(baseDirectory, "album/photo.jpg/")).toThrow(
			"Unsafe receive path"
		)
	})
})

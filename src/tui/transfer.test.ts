import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { getDeviceInfo } from "../index.ts"
import {
	buildFileMetadata,
	sendFileToDevice,
	sendPathToDevice,
	sendTextToDevice,
	type DiscoveredDevice,
	type SendFileFn
} from "./transfer.ts"

const info = getDeviceInfo({ alias: "TestDevice", port: 53317, enableDownloadApi: false })
const device: DiscoveredDevice = { ...info, alias: "Peer", ip: "127.0.0.1" }

test("buildFileMetadata for a text message", () => {
	const buffer = Buffer.from("hello")
	const meta = buildFileMetadata("/tmp/x.txt", buffer, true)
	expect(meta.fileName).toBe("message.txt")
	expect(meta.fileType).toBe("text/plain")
	expect(meta.preview).toBe("hello")
	expect(meta.size).toBe(5)
	expect(meta.sha256).toBe(createHash("sha256").update(buffer).digest("hex"))
	expect(meta.id).toBe(createHash("md5").update("/tmp/x.txt").digest("hex"))
})

test("buildFileMetadata for a binary file", () => {
	const meta = buildFileMetadata("/some/dir/photo.png", Buffer.from([1, 2, 3]), false)
	expect(meta.fileName).toBe("photo.png")
	expect(meta.fileType).toBe("application/octet-stream")
	expect(meta.preview).toBeUndefined()
})

test("sendTextToDevice writes temp file, sends it, cleans up", async () => {
	let sentPath = ""
	let sentContent = ""
	const fakeSend: SendFileFn = async (_info, _device, filePath, isText) => {
		sentPath = filePath
		sentContent = await readFile(filePath, "utf8")
		expect(isText).toBe(true)
		return { ok: true, message: "ok" }
	}
	const result = await sendTextToDevice(info, device, "hi there", fakeSend)
	expect(result.ok).toBe(true)
	expect(sentContent).toBe("hi there")
	expect(existsSync(sentPath)).toBe(false)
})

test("sendFileToDevice surfaces the failure reason instead of a bare 'Upload failed'", async () => {
	// 127.0.0.1:1 refuses immediately, so prepare-upload fails with a real error that
	// must be preserved (not collapsed to a generic literal).
	const dead: DiscoveredDevice = {
		...info,
		alias: "Dead",
		ip: "127.0.0.1",
		port: 1,
		protocol: "http"
	}
	const result = await sendFileToDevice(info, dead, import.meta.path, false)
	expect(result.ok).toBe(false)
	expect(result.message).toMatch(/^Failed to prepare upload: .+/)
})

test("sendPathToDevice includes the underlying error when the send throws", async () => {
	const throwing: SendFileFn = async () => {
		throw new Error("kaboom")
	}
	const result = await sendPathToDevice(info, device, import.meta.path, throwing)
	expect(result.ok).toBe(false)
	expect(result.message).toContain("kaboom")
})

test("sendPathToDevice rejects a missing file without calling send", async () => {
	let called = false
	const fakeSend: SendFileFn = async () => {
		called = true
		return { ok: true, message: "" }
	}
	const result = await sendPathToDevice(info, device, "/definitely/not/here.bin", fakeSend)
	expect(result.ok).toBe(false)
	expect(result.message).toBe("File not found or inaccessible")
	expect(called).toBe(false)
})

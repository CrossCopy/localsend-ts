import { createHash } from "node:crypto"
import { readFile, stat, unlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { LocalSendClient } from "../index.ts"
import type { DeviceInfo, FileMetadata } from "../index.ts"

/** A device discovered on the network — always carries a resolved IP. */
export interface DiscoveredDevice extends DeviceInfo {
	ip: string
}

export interface SendResult {
	ok: boolean
	message: string
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Append a concrete reason to a base failure message when one is available. */
const withReason = (base: string, reason: string | null | undefined): string =>
	reason ? `${base}: ${reason}` : base

export function buildFileMetadata(
	filePath: string,
	fileBuffer: Buffer,
	isTextMessage: boolean
): FileMetadata {
	return {
		id: createHash("md5").update(filePath).digest("hex"),
		fileName: isTextMessage ? "message.txt" : path.basename(filePath),
		size: fileBuffer.length,
		fileType: isTextMessage ? "text/plain" : "application/octet-stream",
		sha256: createHash("sha256").update(fileBuffer).digest("hex"),
		preview: isTextMessage ? fileBuffer.toString("utf8") : undefined,
		metadata: {
			modified: new Date().toISOString()
		}
	}
}

export async function sendFileToDevice(
	deviceInfo: DeviceInfo,
	device: DiscoveredDevice,
	filePath: string,
	isTextMessage: boolean
): Promise<SendResult> {
	const client = new LocalSendClient(deviceInfo)
	const fileBuffer = await readFile(filePath)
	const fileMetadata = buildFileMetadata(filePath, fileBuffer, isTextMessage)
	const target = {
		ip: device.ip,
		port: device.port,
		protocol: device.protocol || "https"
	}

	const uploadPrepare = await client.prepareUpload(target, {
		[fileMetadata.id]: fileMetadata
	})
	if (!uploadPrepare) {
		return { ok: false, message: withReason("Failed to prepare upload", client.getLastError()) }
	}

	const fileToken = uploadPrepare.files?.[fileMetadata.id]
	if (!fileToken) {
		if (isTextMessage) {
			return { ok: true, message: "Text message delivered" }
		}
		return { ok: false, message: "No file token returned" }
	}

	const success = await client.uploadFile(
		target,
		uploadPrepare.sessionId,
		fileMetadata.id,
		fileToken,
		filePath
	)
	return success
		? { ok: true, message: "File sent successfully" }
		: { ok: false, message: withReason("Upload failed", client.getLastError()) }
}

export type SendFileFn = typeof sendFileToDevice

export async function sendTextToDevice(
	deviceInfo: DeviceInfo,
	device: DiscoveredDevice,
	message: string,
	send: SendFileFn = sendFileToDevice
): Promise<SendResult> {
	const tempFilePath = path.join(os.tmpdir(), `localsend-message-${Date.now()}.txt`)
	try {
		await writeFile(tempFilePath, message)
		return await send(deviceInfo, device, tempFilePath, true)
	} catch (err) {
		return { ok: false, message: withReason("Failed to send message", errText(err)) }
	} finally {
		try {
			await unlink(tempFilePath)
		} catch {}
	}
}

export async function sendPathToDevice(
	deviceInfo: DeviceInfo,
	device: DiscoveredDevice,
	filePath: string,
	send: SendFileFn = sendFileToDevice
): Promise<SendResult> {
	try {
		await stat(filePath)
	} catch {
		return { ok: false, message: "File not found or inaccessible" }
	}
	try {
		return await send(deviceInfo, device, filePath, false)
	} catch (err) {
		return { ok: false, message: withReason("Upload failed", errText(err)) }
	}
}

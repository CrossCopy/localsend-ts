import { getDeviceInfo } from "../../src/utils/device.ts"
import { LocalSendServer } from "../../src/server/server.ts"
import { LocalSendClient } from "../../src/api/client.ts"
import { getFreePort, tempDir, rmTemp } from "./util.ts"
import path from "node:path"

export interface Receiver {
	port: number
	saveDir: string
	deviceInfo: ReturnType<typeof getDeviceInfo>
	stop(): Promise<void>
}

export async function startReceiver(
	opts: { pin?: string; autoAccept?: boolean } = {}
): Promise<Receiver> {
	const port = await getFreePort()
	const saveDir = await tempDir()
	const deviceInfo = getDeviceInfo({ alias: "Test Receiver", port })
	const server = new LocalSendServer(deviceInfo, {
		saveDirectory: saveDir,
		pin: opts.pin,
		onTransferRequest: async () => opts.autoAccept ?? true
	})
	await server.start()
	return {
		port,
		saveDir,
		deviceInfo,
		async stop() {
			await server.stop()
			await rmTemp(saveDir)
		}
	}
}

export async function sendFile(
	receiver: Pick<Receiver, "port">,
	filePath: string,
	opts: { pin?: string } = {}
): Promise<boolean> {
	const sender = getDeviceInfo({ alias: "Test Sender" })
	const client = new LocalSendClient(sender)
	const target = { ip: "127.0.0.1", port: receiver.port, protocol: "http" as const }
	const { buildFileMetadataFromPath } = await import("../../src/utils/file.ts")
	const { fileId, fileMetadata } = await buildFileMetadataFromPath(filePath)
	const prep = await client.prepareUpload(target, { [fileId]: fileMetadata }, opts.pin)
	if (!prep || !prep.files[fileId]) return false
	return client.uploadFile(target, prep.sessionId, fileId, prep.files[fileId], filePath)
}

export function savedPath(receiver: Receiver, name: string): string {
	return path.join(receiver.saveDir, name)
}

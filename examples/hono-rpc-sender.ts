import { LocalSendRpcClient } from "../src/hono-rpc.ts"
import { getDeviceInfo } from "../src"
import type { FileMetadata } from "../src"

async function main() {
	const myDevice = getDeviceInfo({
		alias: "RPC Sender",
		port: 53318
	})

	const targetUrl = "http://192.168.1.100:53317"

	const client = new LocalSendRpcClient({
		baseUrl: targetUrl
	})

	const deviceInfo = await client.getInfo()
	console.log("Connected to device:", deviceInfo.alias)

	await client.register(myDevice)
	console.log("Registered successfully")

	const fileMetadata: FileMetadata = {
		id: "test-file-id",
		fileName: "test.txt",
		size: 1024,
		fileType: "text/plain"
	}

	const prepare = await client.prepareUpload(myDevice, { "test-file-id": fileMetadata }, "123456")
	console.log("Upload prepared, session ID:", prepare.sessionId)

	const blob = new Blob(["Hello from RPC client!"])
	await client.uploadFile(
		prepare.sessionId,
		"test-file-id",
		prepare.files["test-file-id"],
		blob,
		(uploaded, total) => console.log(`Progress: ${uploaded}/${total} bytes`)
	)
	console.log("File uploaded successfully!")
}

main().catch(console.error)

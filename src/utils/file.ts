import { Buffer } from "node:buffer"
import { createHash, randomBytes } from "node:crypto"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import type { FileMetadata } from "../types.ts"

export function createFileId(seed?: string): string {
	if (seed) {
		return createHash("md5").update(seed).digest("hex")
	}
	return randomBytes(16).toString("hex")
}

export async function computeSha256FromFile(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256")
		const stream = createReadStream(filePath)

		stream.on("data", (chunk) => {
			hash.update(chunk)
		})
		stream.on("error", (err) => {
			reject(err)
		})
		stream.on("end", () => {
			resolve(hash.digest("hex"))
		})
	})
}

export function computeSha256FromBytes(payload: Uint8Array): string {
	return createHash("sha256").update(payload).digest("hex")
}

export async function buildFileMetadataFromPath(
	filePath: string,
	options: {
		fileId?: string
		fileName?: string
		fileType?: string
		preview?: string
		metadata?: { modified?: string; accessed?: string }
		computeSha256?: boolean
	} = {}
): Promise<{ fileId: string; fileMetadata: FileMetadata }> {
	const fileStats = await stat(filePath)
	const fileId = options.fileId ?? createFileId(filePath)
	const fileName = options.fileName ?? path.basename(filePath)
	const fileType = options.fileType ?? "application/octet-stream"
	const metadata = options.metadata ?? {
		modified: fileStats.mtime?.toISOString(),
		accessed: fileStats.atime?.toISOString()
	}
	const sha256 = options.computeSha256 === false ? undefined : await computeSha256FromFile(filePath)

	const fileMetadata: FileMetadata = {
		id: fileId,
		fileName,
		size: fileStats.size,
		fileType,
		sha256,
		preview: options.preview,
		metadata
	}

	return { fileId, fileMetadata }
}

export function buildFileMetadataFromBytes(
	payload: Uint8Array,
	options: {
		fileId?: string
		fileName: string
		fileType?: string
		preview?: string
		metadata?: { modified?: string; accessed?: string }
	}
): { fileId: string; fileMetadata: FileMetadata } {
	const buffer = Buffer.from(payload)
	const fileId = options.fileId ?? createFileId()
	const fileType = options.fileType ?? "application/octet-stream"
	const metadata = options.metadata ?? {
		modified: new Date().toISOString()
	}

	const fileMetadata: FileMetadata = {
		id: fileId,
		fileName: options.fileName,
		size: buffer.length,
		fileType,
		sha256: computeSha256FromBytes(buffer),
		preview: options.preview,
		metadata
	}

	return { fileId, fileMetadata }
}

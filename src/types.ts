import * as v from "valibot"

export const deviceType = v.union([
	v.literal("mobile"),
	v.literal("desktop"),
	v.literal("web"),
	v.literal("headless"),
	v.literal("server")
])
export type DeviceType = v.InferOutput<typeof deviceType>

// Define schemas using Valibot
export const deviceInfoSchema = v.object({
	alias: v.string(),
	version: v.string(),
	deviceModel: v.nullable(v.string()),
	deviceType: v.nullable(deviceType),
	fingerprint: v.string(),
	port: v.number(),
	protocol: v.union([v.literal("http"), v.literal("https")]),
	download: v.boolean()
})

export const fileMetadataSchema = v.object({
	id: v.string(),
	fileName: v.string(),
	size: v.number(),
	fileType: v.string(),
	sha256: v.optional(v.nullable(v.string())),
	preview: v.optional(v.nullable(v.string())),
	metadata: v.optional(
		v.nullable(
			v.object({
				modified: v.optional(v.nullable(v.string())),
				accessed: v.optional(v.nullable(v.string()))
			})
		)
	)
})

export const prepareUploadRequestSchema = v.object({
	info: deviceInfoSchema,
	files: v.record(v.string(), fileMetadataSchema)
})

export const prepareUploadResponseSchema = v.object({
	sessionId: v.string(),
	files: v.record(v.string(), v.string())
})

export const messageResponseSchema = v.object({
	message: v.string()
})

// Infer types from schemas
export type DeviceInfo = v.InferInput<typeof deviceInfoSchema>
export type FileMetadata = v.InferInput<typeof fileMetadataSchema>
export type PrepareUploadRequest = v.InferInput<typeof prepareUploadRequestSchema>
export type PrepareUploadResponse = v.InferInput<typeof prepareUploadResponseSchema>
export type MessageResponse = v.InferInput<typeof messageResponseSchema>

export interface AnnouncementMessage extends DeviceInfo {
	announce: boolean
}

export interface PrepareDownloadResponse {
	info: DeviceInfo
	sessionId: string
	files: Record<string, FileMetadata>
}

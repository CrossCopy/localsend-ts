import * as v from "valibot";
import { DeviceType, Protocol } from "./types";
import { object } from "valibot";

export const DeviceInfoSchema = v.object({
  alias: v.string(),
  version: v.string(),
  deviceModel: v.optional(v.string()),
  deviceType: v.enum_(DeviceType),
  fingerprint: v.string(),
  download: v.boolean(),
  port: v.number(),
  protocol: v.enum_(Protocol),
});

export type DeviceInfo = v.InferOutput<typeof DeviceInfoSchema>;
export interface MulticastMessage extends DeviceInfo {
  announce: boolean;
}
export const RegisterRequestSchema = v.object({
  ...DeviceInfoSchema.entries,
  port: v.number(),
  protocol: v.enum_(Protocol),
});

export type RegisterRequest = v.InferOutput<typeof RegisterRequestSchema>;

const FileMetadataSchema = v.object({
  modified: v.optional(v.string()),
  accessed: v.optional(v.string()),
});

const FileInfoSchema = v.object({
  id: v.string(),
  fileName: v.string(),
  size: v.number(),
  fileType: v.string(),
  sha256: v.optional(v.string()),
  preview: v.optional(v.string()),
  metadata: v.optional(FileMetadataSchema),
});

export const PrepareUploadRequestSchema = object({
  info: v.object({
    alias: v.string(),
    version: v.string(),
    deviceModel: v.optional(v.string()),
    deviceType: v.enum_(DeviceType),
    fingerprint: v.string(),
    port: v.number(),
    protocol: v.enum_(Protocol),
    download: v.optional(v.boolean()),
  }),
  files: v.record(v.string(), FileInfoSchema),
});
export type PrepareUploadRequest = v.InferOutput<
  typeof PrepareUploadRequestSchema
>;

export const PrepareUploadResponseSchema = v.object({
  sessionId: v.string(),
  files: v.record(v.string(), v.string()),
});

export type PrepareUploadResponse = v.InferOutput<
  typeof PrepareUploadResponseSchema
>;

export const UploadRequestQuerySchema = v.object({
  sessionId: v.string(),
  fileId: v.string(),
  token: v.string(),
});

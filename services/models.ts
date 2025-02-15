import {
  object,
  string,
  number,
  boolean,
  optional,
  enum_,
  record,
} from "valibot";
import { DeviceType, Protocol } from "./types";

export const RegisterRequestSchema = object({
  alias: string(),
  version: string(),
  deviceModel: optional(string()),
  deviceType: enum_(DeviceType),
  fingerprint: string(),
  port: number(),
  protocol: enum_(Protocol),
  download: optional(boolean()),
});

const FileMetadataSchema = object({
  modified: optional(string()),
  accessed: optional(string()),
});

const FileInfoSchema = object({
  id: string(),
  fileName: string(),
  size: number(),
  fileType: string(),
  sha256: optional(string()),
  preview: optional(string()),
  metadata: optional(FileMetadataSchema),
});

export const PrepareUploadRequestSchema = object({
  info: object({
    alias: string(),
    version: string(),
    deviceModel: optional(string()),
    deviceType: enum_(DeviceType),
    fingerprint: string(),
    port: number(),
    protocol: enum_(Protocol),
    download: optional(boolean()),
  }),
  files: record(string(), FileInfoSchema),
});

export const UploadRequestQuerySchema = object({
  sessionId: string(),
  fileId: string(),
  token: string(),
});

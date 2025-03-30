export type DeviceType = 'mobile' | 'desktop' | 'web' | 'headless' | 'server';

export interface DeviceInfo {
  alias: string;
  version: string;
  deviceModel: string | null;
  deviceType: DeviceType | null;
  fingerprint: string;
  port: number;
  protocol: 'http' | 'https';
  download: boolean;
}

export interface AnnouncementMessage extends DeviceInfo {
  announce: boolean;
}

export interface FileMetadata {
  id: string;
  fileName: string;
  size: number;
  fileType: string;
  sha256?: string | null;
  preview?: string | null;
  metadata?: {
    modified?: string | null;
    accessed?: string | null;
  } | null;
}

export interface PrepareUploadRequest {
  info: DeviceInfo;
  files: Record<string, FileMetadata>;
}

export interface PrepareUploadResponse {
  sessionId: string;
  files: Record<string, string>; // fileId -> fileToken
}

export interface PrepareDownloadResponse {
  info: DeviceInfo;
  sessionId: string;
  files: Record<string, FileMetadata>;
} 
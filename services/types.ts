// Device Types
export enum DeviceType {
  Mobile = "mobile",
  Desktop = "desktop",
  Web = "web",
  Headless = "headless",
  Server = "server",
}

// Protocol Types
export enum Protocol {
  Http = "http",
  Https = "https",
}

// // Base Interfaces
// export interface DeviceInfo {
//   alias: string;
//   version: string;
//   deviceModel?: string;
//   deviceType?: DeviceType;
//   fingerprint: string;
//   port: number;
//   protocol: Protocol;
//   download?: boolean;
// }

// // File Transfer Interfaces
// export interface FileMetadata {
//   modified?: string;
//   accessed?: string;
// }

// export interface FileInfo {
//   id: string;
//   fileName: string;
//   size: number;
//   fileType: string;
//   sha256?: string;
//   preview?: string;
//   metadata?: FileMetadata;
// }

// export interface PrepareUploadRequest {
//   info: DeviceInfo;
//   files: Record<string, FileInfo>;
// }

// export interface PrepareUploadResponse {
//   sessionId: string;
//   files: Record<string, string>; // fileId -> token mapping
// }

// export interface PrepareDownloadResponse {
//   info: DeviceInfo;
//   sessionId: string;
//   files: Record<string, FileInfo>;
// }

// export interface RegisterRequest {
//   alias: string;
//   version: string;
//   deviceModel?: string;
//   deviceType?: DeviceType;
//   fingerprint: string;
//   port: number;
//   protocol: Protocol;
//   download?: boolean;
// }

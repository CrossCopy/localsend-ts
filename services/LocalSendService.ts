import { Protocol, type DeviceType } from "./types";
import { HttpServer } from "./HttpServer";
import { MulticastClient } from "./MulticastClient";
import type {
  DeviceInfo,
  MulticastMessage,
  PrepareUploadRequest,
  PrepareUploadResponse,
} from "./models";

export class LocalSendService {
  private deviceInfo: DeviceInfo;
  private server?: HttpServer;
  private multicastClient: MulticastClient;

  constructor(config: {
    alias: string;
    deviceModel?: string;
    deviceType: DeviceType;
    port?: number;
    protocol?: Protocol;
  }) {
    this.deviceInfo = {
      alias: config.alias,
      version: "2.0",
      deviceModel: config.deviceModel,
      deviceType: config.deviceType,
      fingerprint: this.generateFingerprint(),
      port: config.port || 53317,
      protocol: config.protocol || Protocol.Https,
      download: false,
    };
    this.multicastClient = new MulticastClient();
  }

  private generateFingerprint(): string {
    // Implementation depends on whether we're using HTTP or HTTPS
    // For HTTP: Generate random string
    // For HTTPS: Generate SHA-256 hash of certificate
    return "placeholder-fingerprint";
  }

  async startServer(): Promise<void> {
    // Initialize HTTP server
    this.server = new HttpServer(this.deviceInfo);
    await this.server.start();
  }

  async startDiscovery(): Promise<void> {
    // Start multicast discovery
    await this.announcePresence();
  }

  private async announcePresence(): Promise<void> {
    const message: MulticastMessage = {
      ...this.deviceInfo,
      announce: true,
    };
    await this.multicastClient.send(message);
  }

  async prepareUpload(
    request: PrepareUploadRequest
  ): Promise<PrepareUploadResponse> {
    // Implementation
    return {
      sessionId: "generated-session-id",
      files: {},
    };
  }
}

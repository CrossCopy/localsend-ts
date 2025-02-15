import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type {
  DeviceInfo,
  PrepareUploadRequest,
  PrepareUploadResponse,
  RegisterRequest,
  FileInfo,
} from "./types";
import {
  RegisterRequestSchema,
  PrepareUploadRequestSchema,
  UploadRequestQuerySchema,
} from "./models";
import fs from "fs";
import path from "path";
import * as v from "valibot";

export class HttpServer {
  private app: Hono;
  private deviceInfo: DeviceInfo;
  private activeSessions: Map<
    string,
    {
      files: Record<string, string>; // fileId -> token mapping
      clientIp: string;
      prepareRequest: PrepareUploadRequest;
    }
  > = new Map();

  constructor(deviceInfo: DeviceInfo) {
    this.deviceInfo = deviceInfo;
    this.app = new Hono();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Info endpoint
    this.app.get("/api/localsend/v2/info", (c) => {
      return c.json(this.deviceInfo);
    });

    // Register endpoint
    this.app.post("/api/localsend/v2/register", async (c) => {
      try {
        const body = await c.req.json();
        const registerRequest = v.parse(RegisterRequestSchema, body);
        console.log("register", registerRequest);

        return c.json({
          alias: this.deviceInfo.alias,
          version: this.deviceInfo.version,
          deviceModel: this.deviceInfo.deviceModel,
          deviceType: this.deviceInfo.deviceType,
          fingerprint: this.deviceInfo.fingerprint,
          download: this.deviceInfo.download,
        });
      } catch (error) {
        console.error("Registration error:", error);
        return c.json({ message: "Invalid registration request" }, 400);
      }
    });

    // Prepare upload endpoint
    this.app.post("/api/localsend/v2/prepare-upload", async (c) => {
      try {
        const body = await c.req.json();
        const prepareRequest = v.parse(PrepareUploadRequestSchema, body);
        console.log("prepare-upload", prepareRequest);
        const clientIp =
          c.req.header("x-forwarded-for") || c.req.header("remote-addr") || "";

        // Check if PIN is required and validate it
        if (
          this.requiresPin() &&
          !this.validatePin(v.parse(v.string(), c.req.query("pin")))
        ) {
          return c.json({ message: "PIN required or invalid" }, 401);
        }

        // Check if there's an active session blocking
        if (this.hasActiveBlockingSession(clientIp)) {
          return c.json({ message: "Blocked by another session" }, 409);
        }

        // Generate session and tokens
        const sessionId = this.generateSessionId();
        const fileTokens: Record<string, string> = {};

        // Generate tokens for each file
        Object.keys(prepareRequest.files).forEach((fileId) => {
          fileTokens[fileId] = this.generateFileToken();
        });

        // Store session
        this.activeSessions.set(sessionId, {
          files: fileTokens,
          clientIp,
          prepareRequest,
        });

        const response: PrepareUploadResponse = {
          sessionId,
          files: fileTokens,
        };

        return c.json(response);
      } catch (error) {
        console.error("Prepare upload error:", error);
        return c.json({ message: "Invalid prepare-upload request" }, 400);
      }
    });

    // Upload endpoint
    this.app.post("/api/localsend/v2/upload", async (c) => {
      try {
        const query = c.req.query();
        const { sessionId, fileId, token } = v.parse(
          UploadRequestQuerySchema,
          query
        );
        console.log("upload", sessionId, fileId, token);
        const clientIp =
          c.req.header("x-forwarded-for") || c.req.header("remote-addr") || "";

        // Validate session and token
        const session = this.activeSessions.get(sessionId);
        if (!this.validateFileTransfer(sessionId, fileId, token, clientIp)) {
          return c.json({ message: "Invalid token or IP address" }, 403);
        }

        // Get file info from prepare request
        const prepareRequest = session?.prepareRequest;
        const fileInfo = prepareRequest?.files[fileId];
        if (!fileInfo) {
          return c.json({ message: "File info not found" }, 404);
        }

        // Create downloads directory if it doesn't exist
        const downloadDir = path.join(process.cwd(), "downloads");
        if (!fs.existsSync(downloadDir)) {
          fs.mkdirSync(downloadDir, { recursive: true });
        }

        // Save file to downloads directory
        const filePath = path.join(downloadDir, fileInfo.fileName);
        const fileDir = path.dirname(filePath);

        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }

        const arrayBuffer = await c.req.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

        return c.json(null, 200);
      } catch (error) {
        console.error("Upload error:", error);
        return c.json({ message: "Internal server error" }, 500);
      }
    });

    // Cancel endpoint
    this.app.post("/api/localsend/v2/cancel", (c) => {
      try {
        const sessionId = c.req.query("sessionId");
        console.log("cancel", sessionId);
        if (typeof sessionId === "string") {
          this.activeSessions.delete(sessionId);
        }

        return c.json(null, 200);
      } catch (error) {
        return c.json({ message: "Internal server error" }, 500);
      }
    });
  }

  private validateFileTransfer(
    sessionId: string,
    fileId: string,
    token: string,
    clientIp: string
  ): boolean {
    const session = this.activeSessions.get(sessionId);
    if (!session) return false;
    if (session.clientIp !== clientIp) return false;
    return session.files[fileId] === token;
  }

  private hasActiveBlockingSession(clientIp: string): boolean {
    for (const session of this.activeSessions.values()) {
      if (session.clientIp !== clientIp) return true;
    }
    return false;
  }

  private generateSessionId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private generateFileToken(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private requiresPin(): boolean {
    // TODO: Implement PIN requirement logic
    return false;
  }

  private validatePin(pin: string): boolean {
    // TODO: Implement PIN validation logic
    return true;
  }

  async start(): Promise<void> {
    serve({
      fetch: this.app.fetch,
      port: this.deviceInfo.port,
    });
    console.log(`Server is running on port ${this.deviceInfo.port}`);
  }
}

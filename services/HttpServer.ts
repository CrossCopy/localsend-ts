import express from "express";
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
import { z } from "zod";
import fs from "fs";
import path from "path";
import * as v from "valibot";

export class HttpServer {
  private app: express.Application;
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
    this.app = express();
    this.app.use(express.json());
    this.app.use(express.raw({ type: "*/*", limit: "1000mb" }));
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Info endpoint
    this.app.get("/api/localsend/v2/info", (req, res) => {
      res.json(this.deviceInfo);
    });

    // Register endpoint
    this.app.post(
      "/api/localsend/v2/register",
      (req: express.Request, res: express.Response) => {
        try {
          const registerRequest = v.parse(RegisterRequestSchema, req.body);
          console.log("register", registerRequest);

          // Respond with device info
          res.json({
            alias: this.deviceInfo.alias,
            version: this.deviceInfo.version,
            deviceModel: this.deviceInfo.deviceModel,
            deviceType: this.deviceInfo.deviceType,
            fingerprint: this.deviceInfo.fingerprint,
            download: this.deviceInfo.download,
          });
        } catch (error) {
          if (error instanceof z.ZodError) {
            res.status(400).json({
              message: "Invalid registration request",
              errors: error.errors,
            });
            return;
          }
          res.status(500).json({ message: "Internal server error" });
        }
      }
    );

    // Prepare upload endpoint
    this.app.post(
      "/api/localsend/v2/prepare-upload",
      (req: express.Request, res: express.Response) => {
        console.log("prepare-upload", req.body);

        try {
          const prepareRequest = v.parse(PrepareUploadRequestSchema, req.body);
          console.log("prepare-upload", prepareRequest);
          const clientIp = z.string().parse(req.ip);

          // Check if PIN is required and validate it
          const pin = req.query.pin as string;
          if (this.requiresPin() && !this.validatePin(pin)) {
            res.status(401).json({ message: "PIN required or invalid" });
            return;
          }

          // Check if there's an active session blocking
          if (this.hasActiveBlockingSession(clientIp)) {
            res.status(409).json({ message: "Blocked by another session" });
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

          // Return session info
          const response: PrepareUploadResponse = {
            sessionId,
            files: fileTokens,
          };

          res.json(response);
        } catch (error) {
          if (error instanceof z.ZodError) {
            res.status(400).json({
              message: "Invalid prepare-upload request",
              errors: error.errors,
            });
            return;
          }
          res.status(500).json({ message: "Internal server error" });
        }
      }
    );

    // Upload endpoint
    this.app.post("/api/localsend/v2/upload", (req, res) => {
      console.log("upload");
      try {
        const { sessionId, fileId, token } = v.parse(
          UploadRequestQuerySchema,
          req.query
        );
        console.log("upload", sessionId, fileId, token);
        const clientIp = z.string().parse(req.ip);

        // Validate session and token
        const session = this.activeSessions.get(sessionId as string);
        if (
          !this.validateFileTransfer(
            sessionId as string,
            fileId as string,
            token as string,
            clientIp
          )
        ) {
          res.status(403).json({ message: "Invalid token or IP address" });
          return;
        }

        // Get file info from prepare request
        const prepareRequest = session?.prepareRequest;
        const fileInfo = prepareRequest?.files[fileId as string];
        if (!fileInfo) {
          res.status(404).json({ message: "File info not found" });
          return;
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

        fs.writeFileSync(filePath, req.body);

        res.status(200).send();
      } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // Cancel endpoint
    this.app.post("/api/localsend/v2/cancel", (req, res) => {
      try {
        const { sessionId } = req.query;
        console.log("cancel", sessionId);
        if (typeof sessionId === "string") {
          this.activeSessions.delete(sessionId);
        }

        res.status(200).send();
      } catch (error) {
        res.status(500).json({ message: "Internal server error" });
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
    this.app.listen(this.deviceInfo.port, () => {
      console.log(`Server is running on port ${this.deviceInfo.port}`);
    });
  }
}

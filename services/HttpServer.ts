import { Hono } from "hono";
import { serve } from "@hono/node-server";
// import type {
//   DeviceInfo,
//   PrepareUploadRequest,
//   PrepareUploadResponse,
//   RegisterRequest,
//   FileInfo,
// } from "./types";
import { apiReference } from "@scalar/hono-api-reference";
import {
  RegisterRequestSchema,
  PrepareUploadRequestSchema,
  UploadRequestQuerySchema,
  DeviceInfoSchema,
  PrepareUploadResponseSchema,
  type DeviceInfo,
  type PrepareUploadRequest,
  type PrepareUploadResponse,
} from "./models";
import fs from "fs";
import path from "path";
import * as v from "valibot";
import { describeRoute, openAPISpecs } from "hono-openapi";
import { resolver, validator } from "hono-openapi/valibot";

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
    this.setupOpenAPI();
  }

  setupOpenAPI() {
    this.app.get(
      "/openapi",
      openAPISpecs(this.app, {
        documentation: {
          info: {
            title: "Hono API",
            version: "1.0.0",
            description: "Greeting API",
          },
          servers: [
            { url: "https://api.kunkun.sh" },
            { url: "http://localhost:8787" },
          ],
        },
      })
    );

    this.app.get(
      "/docs",
      apiReference({
        theme: "saturn",
        spec: { url: "/openapi" },
      })
    );
  }

  private setupRoutes(): void {
    // Info endpoint
    this.app.get(
      "/api/localsend/v2/info",
      describeRoute({
        description: "Get device info",
        validateResponse: true,
        responses: {
          200: {
            description: "Successful response",
            content: {
              "application/json": {
                schema: resolver(DeviceInfoSchema),
              },
            },
          },
        },
      }),
      (c) => {
        return c.json(this.deviceInfo);
      }
    );

    // Register endpoint
    this.app.post(
      "/api/localsend/v2/register",
      describeRoute({
        description: "Register a new device",
        validateResponse: true,
        responses: {
          200: {
            description: "Successful response",
            content: {
              "application/json": {
                schema: resolver(DeviceInfoSchema),
              },
            },
          },
        },
      }),
      validator("json", RegisterRequestSchema),
      async (c) => {
        try {
          const body = await c.req.valid("json");
          console.log("register", body);

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
      }
    );

    // Prepare upload endpoint
    this.app.post(
      "/api/localsend/v2/prepare-upload",
      describeRoute({
        description: "Prepare upload",
        validateResponse: true,
        responses: {
          200: {
            description: "Successful response",
            content: {
              "application/json": {
                schema: resolver(PrepareUploadResponseSchema),
              },
            },
          },
        },
      }),
      validator("json", PrepareUploadRequestSchema),
      async (c) => {
        try {
          const prepareRequest = await c.req.valid("json");
          console.log("prepare-upload", prepareRequest);
          const clientIp =
            c.req.header("x-forwarded-for") ||
            c.req.header("remote-addr") ||
            "";

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
      }
    );

    // Upload endpoint
    this.app.post(
      "/api/localsend/v2/upload",
      validator("query", UploadRequestQuerySchema),
      async (c) => {
        try {
          const startTime = Date.now();
          const query = await c.req.valid("query");
          const { sessionId, fileId, token } = query;
          console.log("upload", sessionId, fileId, token);
          const clientIp =
            c.req.header("x-forwarded-for") ||
            c.req.header("remote-addr") ||
            "";

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
          const readStream = c.req.raw.body;
          if (!readStream) {
            return c.json({ message: "No file data provided" }, 400);
          }

          const writeStream = fs.createWriteStream(filePath);
          await readStream.pipeTo(
            new WritableStream({
              write(chunk) {
                writeStream.write(chunk);
              },
            })
          );
          writeStream.end();

          // const arrayBuffer = await c.req.arrayBuffer();
          // fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

          const endTime = Date.now();
          const totalTime = endTime - startTime;
          const speed = fileInfo.size / 1024 / 1024 / (totalTime / 1000); // MB/s

          console.log(`Upload completed:
          File: ${fileInfo.fileName}
          Size: ${fileInfo.size} bytes
          Time: ${totalTime}ms
          Speed: ${speed.toFixed(2)} MB/s`);

          return c.json(null, 200);
        } catch (error) {
          console.error("Upload error:", error);
          return c.json({ message: "Internal server error" }, 500);
        }
      }
    );

    // Cancel endpoint
    this.app.post(
      "/api/localsend/v2/cancel",
      describeRoute({
        description: "Cancel a session",
        validateResponse: true,
        responses: {
          "200": {
            description: "Successful response",
          },
        },
      }),
      validator("query", v.object({ sessionId: v.string() })),
      async (c) => {
        try {
          const { sessionId } = await c.req.valid("query");
          console.log("cancel", sessionId);
          if (typeof sessionId === "string") {
            this.activeSessions.delete(sessionId);
          }

          return c.json(null, 200);
        } catch (error) {
          return c.json({ message: "Internal server error" }, 500);
        }
      }
    );
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

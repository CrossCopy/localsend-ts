import dgram from "dgram";
import type { MulticastMessage } from "./models";

export class MulticastClient {
  private socket: dgram.Socket;
  private readonly multicastAddress = "224.0.0.167";
  private readonly port = 53317;

  constructor() {
    this.socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.setupListeners();
  }

  private setupListeners(): void {
    this.socket.on("message", (message, rinfo) => {
      console.log("socket message", message);
      // Handle incoming multicast messages
      const data: MulticastMessage = JSON.parse(message.toString());
      if (data.announce) {
        this.handleAnnouncement(data, rinfo);
      }
    });
  }

  private handleAnnouncement(
    message: MulticastMessage,
    rinfo: dgram.RemoteInfo
  ): void {
    // Handle device announcement
    console.log("Announcement received:", message);
  }

  async send(message: MulticastMessage): Promise<void> {
    const data = JSON.stringify(message);
    return new Promise((resolve, reject) => {
      this.socket.send(data, this.port, this.multicastAddress, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

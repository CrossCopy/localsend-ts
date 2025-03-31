import type { DeviceInfo } from "../types.ts"

export interface Discovery {
  start(): Promise<void>
  stop(): void
  announcePresence?(): void
  onDeviceDiscovered(callback: (device: DeviceInfo) => void): void
  getKnownDevices(): DeviceInfo[]
  startScan?(): Promise<void>
} 
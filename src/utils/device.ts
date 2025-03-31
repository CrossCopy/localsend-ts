import { randomBytes } from "node:crypto"
import type { DeviceInfo } from "../types.ts"
import { DEFAULT_CONFIG } from "../config.ts"
import os from "node:os"

/**
 * Generate a random fingerprint
 */
export function generateFingerprint(): string {
	return randomBytes(32).toString("hex")
}

/**
 * Determine device type based on OS
 */
export function getDeviceType(): "mobile" | "desktop" | "headless" | "server" {
	if (process.env.HEADLESS) {
		return "headless"
	}

	if (process.env.SERVER) {
		return "server"
	}

	// In a real implementation, we'd need to handle mobile detection properly
	// For now, we'll assume this runs on desktop only
	return "desktop"
}

/**
 * Get device model information
 */
export function getDeviceModel(): string {
	return os.type() + " " + os.release()
}

/**
 * Get local device information
 */
export function getDeviceInfo(
	options: {
		alias?: string
		port?: number
		useHttps?: boolean
		enableDownloadApi?: boolean
	} = {}
): DeviceInfo {
	const {
		alias = "LocalSend TS Device",
		port = DEFAULT_CONFIG.HTTP_PORT,
		useHttps = false,
		enableDownloadApi = false
	} = options

	return {
		alias,
		version: DEFAULT_CONFIG.PROTOCOL_VERSION,
		deviceModel: getDeviceModel(),
		deviceType: getDeviceType(),
		fingerprint: generateFingerprint(),
		port,
		protocol: useHttps ? "https" : "http",
		download: enableDownloadApi
	}
}

import { randomBytes } from "node:crypto"

/** HTTP-mode fingerprint: a random hex string. (HTTPS-mode cert fingerprint arrives in Phase 4.) */
export function generateFingerprint(): string {
	return randomBytes(32).toString("hex")
}

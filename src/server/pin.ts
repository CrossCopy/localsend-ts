export const MAX_TRACKED_PEERS = 1024
export const MAX_WRONG_PIN_ATTEMPTS = 3
export const LOCKOUT_DURATION_MS = 5 * 60 * 1000

export type PinVerdict =
	| { status: "ok"; cleared: boolean }
	| { status: "unauthorized" }
	| { status: "locked_out" }

type PeerAttempts = {
	failures: number
	lockedUntil: number | null
	lastSeenAt: number
}

export class PinGate {
	private pin: string | null
	private peers = new Map<string, PeerAttempts>()
	private wrongGuesses = 0

	constructor(pin?: string | null) {
		this.pin = pin && pin.length > 0 ? pin : null
	}

	get required(): boolean {
		return this.pin !== null
	}

	get currentPin(): string | null {
		return this.pin
	}

	setPin(pin: string | null | undefined): void {
		const next = pin && pin.length > 0 ? pin : null
		if (next !== this.pin) {
			this.pin = next
			this.peers.clear()
			this.wrongGuesses = 0
		}
	}

	get trackedPeers(): number {
		return this.peers.size
	}

	get wrongGuessesSinceClear(): number {
		return this.wrongGuesses
	}

	underGuessingPressure(threshold = 10): boolean {
		return this.wrongGuesses >= threshold
	}

	check(providedPin: string | undefined, peerIp: string, now: number = Date.now()): PinVerdict {
		if (this.pin === null) {
			return { status: "ok", cleared: false }
		}

		const existing = this.peers.get(peerIp)
		if (existing?.lockedUntil !== null && existing?.lockedUntil !== undefined) {
			if (now < existing.lockedUntil) {
				existing.lastSeenAt = now
				return { status: "locked_out" }
			}
			// Lockout expired
			this.peers.delete(peerIp)
		}

		// Missing PIN does not spend the lockout budget or raise wrong-guess pressure
		if (providedPin === undefined || providedPin.length === 0) {
			return { status: "unauthorized" }
		}

		if (providedPin === this.pin) {
			this.peers.delete(peerIp)
			this.wrongGuesses = 0
			return { status: "ok", cleared: true }
		}

		this.wrongGuesses += 1
		let entry = this.peers.get(peerIp)
		if (!entry) {
			this.ensureCapacity(now)
			entry = { failures: 0, lockedUntil: null, lastSeenAt: now }
			this.peers.set(peerIp, entry)
		}

		entry.failures += 1
		entry.lastSeenAt = now
		if (entry.failures >= MAX_WRONG_PIN_ATTEMPTS) {
			entry.lockedUntil = now + LOCKOUT_DURATION_MS
		}

		return { status: "unauthorized" }
	}

	private ensureCapacity(now: number): void {
		if (this.peers.size < MAX_TRACKED_PEERS) return

		// Sweep expired lockouts first
		for (const [ip, entry] of this.peers) {
			if (entry.lockedUntil !== null && now >= entry.lockedUntil) {
				this.peers.delete(ip)
			}
		}
		if (this.peers.size < MAX_TRACKED_PEERS) return

		// Evict the oldest entry
		let oldestIp: string | null = null
		let oldestSeen = Infinity
		for (const [ip, entry] of this.peers) {
			if (entry.lastSeenAt < oldestSeen) {
				oldestSeen = entry.lastSeenAt
				oldestIp = ip
			}
		}
		if (oldestIp !== null) {
			this.peers.delete(oldestIp)
		}
	}
}

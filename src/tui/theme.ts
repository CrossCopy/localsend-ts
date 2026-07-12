export const colors = {
	accent: "#00E0C6", // teal — brand
	cyan: "#00FFFF",
	gray: "#808080",
	dim: "#5A5A5A",
	yellow: "#FFD166",
	green: "#06D6A0",
	red: "#EF476F",
	white: "#FFFFFF",
	black: "#0B0B0B",
	panel: "#1A1A1A",
	panelBorder: "#3A3A3A",
	focusBorder: "#00E0C6"
} as const

/** Render a fixed-width unicode progress bar for a 0..1 ratio. */
export function progressBar(ratio: number, width = 16): string {
	const clamped = Math.max(0, Math.min(1, ratio))
	const filled = Math.round(clamped * width)
	return "█".repeat(filled) + "░".repeat(width - filled)
}

export function formatEta(seconds: number): string {
	if (!isFinite(seconds) || seconds <= 0) return "0:00"
	const m = Math.floor(seconds / 60)
	const s = Math.floor(seconds % 60)
	return `${m}:${s.toString().padStart(2, "0")}`
}

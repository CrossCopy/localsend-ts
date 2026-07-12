import type { DeviceInfo, FileMetadata } from "../protocol/types.ts"

export function renderSharePage(
	deviceInfo: DeviceInfo,
	sessionId: string,
	files: Record<string, FileMetadata>
): string {
	const rows = Object.entries(files)
		.map(([fileId, f]) => {
			const href = `/api/localsend/v2/download?sessionId=${sessionId}&fileId=${fileId}`
			const name = escapeHtml(f.fileName)
			return `<li><a href="${href}">${name}</a> <span>(${f.size} bytes)</span></li>`
		})
		.join("\n")
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>LocalSend — ${escapeHtml(deviceInfo.alias)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><h1>Files shared by ${escapeHtml(deviceInfo.alias)}</h1><ul>
${rows}
</ul></body></html>`
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
}

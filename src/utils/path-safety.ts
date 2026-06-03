import path from "node:path"

const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:/

export function safeJoinReceivePath(baseDirectory: string, receivePath: string) {
	if (!receivePath || receivePath.includes("\0")) {
		throw new Error("Unsafe receive path")
	}

	if (
		path.isAbsolute(receivePath) ||
		receivePath.includes("\\") ||
		WINDOWS_DRIVE_PATH_PATTERN.test(receivePath)
	) {
		throw new Error("Unsafe receive path")
	}

	const segments = receivePath.split("/")
	if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
		throw new Error("Unsafe receive path")
	}

	const basePath = path.resolve(baseDirectory)
	const filePath = path.join(baseDirectory, ...segments)
	const resolvedFilePath = path.resolve(filePath)

	if (resolvedFilePath !== basePath && !resolvedFilePath.startsWith(`${basePath}${path.sep}`)) {
		throw new Error("Unsafe receive path")
	}

	return filePath
}

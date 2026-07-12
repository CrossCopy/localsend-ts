export const DEFAULT_CONFIG = {
	MULTICAST_PORT: 53317,
	MULTICAST_ADDRESS: "224.0.0.167",
	HTTP_PORT: 53317,
	PROTOCOL_VERSION: "2.1"
}

export const API_BASE = "/api/localsend/v2"

export const API_PATHS = {
	info: `${API_BASE}/info`,
	register: `${API_BASE}/register`,
	prepareUpload: `${API_BASE}/prepare-upload`,
	upload: `${API_BASE}/upload`,
	cancel: `${API_BASE}/cancel`,
	prepareDownload: `${API_BASE}/prepare-download`,
	download: `${API_BASE}/download`
}

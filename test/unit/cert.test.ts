import { test, expect } from "bun:test"
import { createHash } from "node:crypto"
import { Buffer } from "node:buffer"
import { generateSelfSignedCert, certFingerprintSha256 } from "../../src/crypto/cert.ts"

function derOf(pem: string): Buffer {
	const body = pem
		.replace(/\r\n/g, "\n")
		.split("\n")
		.filter((l) => l.length > 0 && !l.startsWith("---"))
		.join("")
	return Buffer.from(body, "base64")
}

test("generateSelfSignedCert returns PEM cert + key", () => {
	const { cert, key } = generateSelfSignedCert()
	expect(cert).toContain("BEGIN CERTIFICATE")
	expect(key).toContain("PRIVATE KEY")
})

test("certFingerprintSha256 is uppercase hex SHA-256 of the DER cert (app format)", () => {
	const { cert } = generateSelfSignedCert()
	const fp = certFingerprintSha256(cert)
	expect(fp).toMatch(/^[0-9A-F]{64}$/)
	// independent recomputation must match (DER bytes, uppercase hex)
	const expected = createHash("sha256").update(derOf(cert)).digest("hex").toUpperCase()
	expect(fp).toBe(expected)
})

test("fingerprint is stable for the same cert", () => {
	const { cert } = generateSelfSignedCert()
	expect(certFingerprintSha256(cert)).toBe(certFingerprintSha256(cert))
})

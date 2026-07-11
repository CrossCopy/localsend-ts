import { createHash } from "node:crypto"
import { Buffer } from "node:buffer"
import forge from "node-forge"

/**
 * Generate a self-signed certificate + private key (PEM strings).
 * Matches LocalSend's approach (RSA self-signed, CN "LocalSend User").
 *
 * Implementation note: the `selfsigned` package (npm) shipped a synchronous
 * `generate()` API through v4.x, but v5+ switched to an async-only Promise
 * API. That breaks the synchronous contract this function needs (callers
 * rely on `{ cert, key }` being available immediately, no await). Rather than
 * pin an old, unmaintained major version of `selfsigned`, this uses
 * `node-forge` directly, which is synchronous and pure JS under Bun.
 */
export function generateSelfSignedCert(): { cert: string; key: string } {
	const keys = forge.pki.rsa.generateKeyPair(2048)
	const cert = forge.pki.createCertificate()
	cert.publicKey = keys.publicKey
	cert.serialNumber = "01"
	cert.validity.notBefore = new Date()
	cert.validity.notAfter = new Date()
	cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10)

	const attrs = [{ name: "commonName", value: "LocalSend User" }]
	cert.setSubject(attrs)
	cert.setIssuer(attrs)
	cert.sign(keys.privateKey, forge.md.sha256.create())

	return {
		cert: forge.pki.certificateToPem(cert),
		key: forge.pki.privateKeyToPem(keys.privateKey)
	}
}

/**
 * Compute the device fingerprint the way the official app does:
 * SHA-256 of the certificate's DER bytes, encoded as UPPERCASE hex.
 * (DER = base64-decode of the PEM body.)
 * Ref: references/localsend/app/lib/util/security_helper.dart calculateHashOfCertificate
 */
export function certFingerprintSha256(certPem: string): string {
	const body = certPem
		.replace(/\r\n/g, "\n")
		.split("\n")
		.filter((line) => line.length > 0 && !line.startsWith("---"))
		.join("")
	const der = Buffer.from(body, "base64")
	return createHash("sha256").update(der).digest("hex").toUpperCase()
}

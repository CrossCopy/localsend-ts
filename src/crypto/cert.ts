import { createHash } from "node:crypto"
import { Buffer } from "node:buffer"
import fs from "node:fs"
import path from "node:path"
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

export function isTlsIdentityConsistent(certPem: string, keyPem: string): boolean {
	try {
		const cert = forge.pki.certificateFromPem(certPem)
		const privateKey = forge.pki.privateKeyFromPem(keyPem)
		const certPub = cert.publicKey as forge.pki.rsa.PublicKey
		return certPub.n.compareTo(privateKey.n) === 0 && certPub.e.compareTo(privateKey.e) === 0
	} catch {
		return false
	}
}

function tryLoadValidIdentity(
	certPath: string,
	keyPath: string
): { cert: string; key: string; fingerprint: string } | null {
	try {
		const cert = fs.readFileSync(certPath, "utf8")
		const key = fs.readFileSync(keyPath, "utf8")
		if (!isTlsIdentityConsistent(cert, key)) return null
		return { cert, key, fingerprint: certFingerprintSha256(cert) }
	} catch {
		return null
	}
}

/**
 * Load a persisted certificate/key pair, or generate and atomically persist
 * one when missing or inconsistent. An existing valid identity loads without
 * requiring write access to its directory.
 */
export function loadOrGenerateTlsCertificate(
	certPath: string,
	keyPath: string
): { cert: string; key: string; fingerprint: string } {
	const existing = tryLoadValidIdentity(certPath, keyPath)
	if (existing) return existing

	const dir = path.dirname(certPath)
	fs.mkdirSync(dir, { recursive: true })
	fs.mkdirSync(path.dirname(keyPath), { recursive: true })

	const lockPath = path.join(dir, `.${path.basename(certPath)}.lock`)
	let lockFd: number | null = null
	for (let attempt = 0; attempt < 50; attempt++) {
		try {
			lockFd = fs.openSync(lockPath, "wx", 0o600)
			break
		} catch (err: any) {
			if (err?.code !== "EEXIST") throw err
			const loaded = tryLoadValidIdentity(certPath, keyPath)
			if (loaded) return loaded
			const until = Date.now() + 20
			while (Date.now() < until) {
				// brief spin wait for concurrent writer
			}
		}
	}

	try {
		const rechecked = tryLoadValidIdentity(certPath, keyPath)
		if (rechecked) return rechecked

		const generated = generateSelfSignedCert()
		const tmpCert = `${certPath}.tmp-${process.pid}-${Date.now()}`
		const tmpKey = `${keyPath}.tmp-${process.pid}-${Date.now()}`
		fs.writeFileSync(tmpCert, generated.cert, { mode: 0o644 })
		fs.writeFileSync(tmpKey, generated.key, { mode: 0o600 })
		fs.renameSync(tmpCert, certPath)
		fs.renameSync(tmpKey, keyPath)
		return {
			cert: generated.cert,
			key: generated.key,
			fingerprint: certFingerprintSha256(generated.cert)
		}
	} finally {
		if (lockFd !== null) {
			try {
				fs.closeSync(lockFd)
			} catch {
				// ignore
			}
			try {
				fs.unlinkSync(lockPath)
			} catch {
				// ignore
			}
		}
	}
}

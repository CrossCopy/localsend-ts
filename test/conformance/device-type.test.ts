import { test, expect } from "bun:test"
import * as v from "valibot"
import { deviceInfoSchema } from "../../src/protocol/types.ts"

const base = { alias: "a", version: "2.1", fingerprint: "fp", port: 53317, protocol: "http" }

test("deviceType is case-insensitive: HEADLESS -> headless", () => {
	const out = v.parse(deviceInfoSchema, { ...base, deviceType: "HEADLESS" })
	expect(out.deviceType).toBe("headless")
})

test("unknown deviceType defaults to desktop (spec)", () => {
	const out = v.parse(deviceInfoSchema, { ...base, deviceType: "toaster" })
	expect(out.deviceType).toBe("desktop")
})

test("known lowercase deviceType is preserved", () => {
	const out = v.parse(deviceInfoSchema, { ...base, deviceType: "mobile" })
	expect(out.deviceType).toBe("mobile")
})

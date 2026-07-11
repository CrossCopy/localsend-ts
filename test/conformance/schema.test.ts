import { test, expect } from "bun:test"
import * as v from "valibot"
import { deviceInfoSchema } from "../../src/protocol/types.ts"

test("deviceInfo accepts spec-minimal payload omitting download", () => {
	const input = {
		alias: "a",
		version: "2.1",
		deviceType: "mobile",
		fingerprint: "fp",
		port: 53317,
		protocol: "http"
	}
	const out = v.parse(deviceInfoSchema, input)
	expect(out.download).toBe(false)
})

test("deviceInfo accepts null deviceModel and missing deviceType", () => {
	const input = {
		alias: "a",
		version: "2.1",
		deviceModel: null,
		fingerprint: "fp",
		port: 53317,
		protocol: "http"
	}
	const out = v.parse(deviceInfoSchema, input)
	expect(out.alias).toBe("a")
})

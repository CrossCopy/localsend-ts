import { expect, test } from "bun:test"
import { buildTuiDeviceInfo } from "./device.ts"

test("the TUI defaults to HTTPS, matching the official app", () => {
	expect(buildTuiDeviceInfo({}).protocol).toBe("https")
})

test("the TUI opts down to plain HTTP when https is disabled (--no-https)", () => {
	expect(buildTuiDeviceInfo({ https: false }).protocol).toBe("http")
})

test("an explicit https:true stays HTTPS", () => {
	expect(buildTuiDeviceInfo({ https: true }).protocol).toBe("https")
})

test("options like alias and port are carried onto the device info", () => {
	const info = buildTuiDeviceInfo({ alias: "My TUI", port: 12345 })
	expect(info.alias).toBe("My TUI")
	expect(info.port).toBe(12345)
})

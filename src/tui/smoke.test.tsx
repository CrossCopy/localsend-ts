import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"

test("opentui solid renders text", async () => {
	const { renderOnce, captureCharFrame, renderer } = await testRender(
		() => <text>hello opentui</text>,
		{ width: 40, height: 5 }
	)
	await renderOnce()
	expect(captureCharFrame()).toContain("hello opentui")
	renderer.destroy()
})

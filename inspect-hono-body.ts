import { hc } from "hono/client"
import { Hono } from "hono"

const app = new Hono().post("/upload", (c) => c.text("ok"))
type AppType = typeof app
const client = hc<AppType>("http://localhost", {
	fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
		return fetch(input, init)
	}
})

type PostType = typeof client.upload.$post
type Args = Parameters<PostType>
type Options = Args[1]

const opt: Options = {
	body: "hello"
} as any

import { hc } from "hono/client"
import { Hono } from "hono"

const app = new Hono().post("/upload", (c) => c.text("ok"))
type AppType = typeof app
const client = hc<AppType>("http://localhost")

type PostType = typeof client.upload.$post
type Args = Parameters<PostType>
type Options = Args[1]

// Print keys of Options if possible (via type alias)
const opt: Options = {} as any

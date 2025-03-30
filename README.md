# localsend-ts

[![NPM Version](https://img.shields.io/npm/v/localsend)](https://www.npmjs.com/package/localsend)
[![JSR](https://jsr.io/badges/@crosscopy/localsend)](https://jsr.io/@crosscopy/localsend)

> A TypeScirpt implementation of the LocalSend protocol

LocalSend provides a documentation for their protocol at https://github.com/localsend/protocol

I've seen some implementations in rust

- https://crates.io/crates/localsend
- https://github.com/tom8zds/localsend_rs

I want to build a LocalSend integration extension for my project https://github.com/kunkunsh/kunkun

So I decided to build a TypeScript implementation of the LocalSend protocol.

## CLI

```bash
npx localsend

# Please use a subcommand: send | receive | discover
# Examples:
#   localsend send 192.168.1.100 ./file.txt
#   localsend receive --saveDir ./downloads
#   localsend discover --timeout 10
```

## Library

```ts
import {
	BunServerAdapter,
	NodeServerAdapter,
	DenoServerAdapter,
	createServerAdapter,
	LocalSendServer,
	LocalSendHonoServer,
	LocalSendClient,
	MulticastDiscovery,
	HttpDiscovery
} from "localsend"

// see ./examples and src/cli.ts for how to use them
```

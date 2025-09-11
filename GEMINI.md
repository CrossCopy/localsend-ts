# GEMINI.md

## Project Overview

This project is a TypeScript implementation of the LocalSend protocol. It provides a command-line interface (CLI) and a library for sending and receiving files between devices on the same local network. The project is built with Bun and uses the Hono framework for the server implementation.

## Building and Running

### Building the project

To build the project, run the following command:

```bash
bun run build
```

This will generate the CLI entrypoint at `./dist/cli.js`.

### Running the CLI

The CLI can be used to send, receive, and discover devices.

**Send a file:**

```bash
localsend send <target-ip> <file-path>
```

**Receive files:**

```bash
localsend receive
```

**Discover devices:**

```bash
localsend discover
```

### Development

To run the development server, use the following command:

```bash
bun run dev
```

## Development Conventions

*   **Code Style:** The project uses Prettier for code formatting. To format the code, run `bun run format`.
*   **Testing:** There are no explicit test commands in the `package.json` file. However, the `README.md` file mentions running the CLI with `deno` and `bun` for development purposes.
*   **API Generation:** The project uses `@hey-api/openapi-ts` to generate a client SDK from an OpenAPI specification. The build process in `build.ts` handles this by starting a server, generating the client, and then stopping the server.
